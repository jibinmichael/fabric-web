import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type {
  MessageParam,
  MessageStreamEvent,
} from "@anthropic-ai/sdk/resources/messages";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-20250514";
const CLASSIFIER_MODEL = "claude-sonnet-4-6";

const VALID_DETECTED_ROLES = [
  "engineering",
  "qa",
  "design",
  "pm",
] as const;
type DetectedRole = (typeof VALID_DETECTED_ROLES)[number];

const CLASSIFIER_SYSTEM = `Classify this question into ONE word only. No explanation. Return exactly one of: engineering, qa, design, pm

engineering = feasibility, APIs, implementation, technical effort, code, architecture, backend, endpoints
qa = testing, edge cases, what could break, bugs, acceptance criteria, validation
design = UI, user flow, visual, interface, UX, screens, components, layout
pm = scope, priority, users, business value, roadmap, general product questions`;

function extractQuestion(content: string): string {
  const idx = content.lastIndexOf("Question:");
  if (idx >= 0) {
    return content.slice(idx + "Question:".length).trim();
  }
  return content.trim();
}

function extractQuestionFromContent(content: unknown): string {
  if (typeof content === "string") {
    return extractQuestion(content);
  }
  if (Array.isArray(content)) {
    const text = content
      .map((block) => {
        if (
          block &&
          typeof block === "object" &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          return (block as { text: string }).text;
        }
        return "";
      })
      .join(" ")
      .trim();
    return extractQuestion(text);
  }
  return "";
}

async function detectRoleFromQuestion(
  client: Anthropic,
  question: string
): Promise<DetectedRole | null> {
  if (!question) return null;
  try {
    const response = await client.messages.create({
      model: CLASSIFIER_MODEL,
      max_tokens: 5,
      system: CLASSIFIER_SYSTEM,
      messages: [{ role: "user", content: question }],
    });
    const text = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim()
      .toLowerCase();
    for (const r of VALID_DETECTED_ROLES) {
      if (text === r) return r;
    }
    for (const r of VALID_DETECTED_ROLES) {
      if (text.includes(r)) return r;
    }
    return null;
  } catch {
    return null;
  }
}

const WATI_SCHEMA_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "wati-schema.json"
);

let cachedWatiSchema: string | null = null;
function getWatiSchemaText(): string {
  if (cachedWatiSchema !== null) return cachedWatiSchema;
  try {
    const raw = fs.readFileSync(WATI_SCHEMA_PATH, "utf-8");
    cachedWatiSchema = `Wati WhatsApp Business API schema (reference):\n\n${raw}`;
  } catch {
    cachedWatiSchema = "Wati WhatsApp Business API schema unavailable.";
  }
  return cachedWatiSchema;
}

const DEFAULT_PROMPT = `You are a sharp product thinking partner for Wati teams. Answer questions about this product plan concisely and clearly.
Ground your answers in the Wati WhatsApp Business API schema provided.`;

const ENGINEERING_PROMPT = `You are a senior engineering lead at Wati reviewing a product plan.
Answer questions about technical feasibility, implementation effort, API availability, and technical risks.
Be specific about which exact Wati API endpoints can support this feature.
Flag what needs custom development beyond existing APIs.
Reference the Wati schema provided.
Keep answers under 4 sentences. Be direct.`;

const QA_PROMPT = `You are a QA lead at Wati reviewing a product plan.
Answer questions about edge cases, acceptance criteria, what could go wrong, and how to test this feature.
Think about failure modes, API rate limits, and user error scenarios in WhatsApp context.
Reference the Wati schema where relevant.
Keep answers under 4 sentences. Be direct.`;

const DESIGN_PROMPT = `You are a product designer at Wati reviewing a product plan.
Answer questions about user flows, UI patterns, and how this fits into the Wati WhatsApp interface.
Reference existing Wati UI patterns and WhatsApp constraints.
Keep answers under 4 sentences. Be direct.`;

function promptForRole(role: string | undefined): string {
  switch (role) {
    case "engineering":
      return ENGINEERING_PROMPT;
    case "qa":
      return QA_PROMPT;
    case "design":
      return DESIGN_PROMPT;
    default:
      return DEFAULT_PROMPT;
  }
}

type ChatMessage = {
  role: "user" | "assistant";
  content: string | unknown[];
};

function sseLine(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as {
    messages?: ChatMessage[];
    role?: string;
    planContext?: string;
  };
  const messages = body.messages ?? [];
  const urlRole = typeof body.role === "string" ? body.role : undefined;
  const planContext =
    typeof body.planContext === "string" ? body.planContext.trim() : "";

  if (!messages.length) {
    return Response.json({ error: "messages are required" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const questionText = lastUser
    ? extractQuestionFromContent(lastUser.content)
    : "";
  const detectedRole = await detectRoleFromQuestion(client, questionText);
  // Question-detected role wins over URL role; URL role is the fallback when
  // detection fails. If both are absent, fall back to "pm" (default partner).
  const finalRole: DetectedRole =
    detectedRole ??
    (VALID_DETECTED_ROLES.includes(urlRole as DetectedRole)
      ? (urlRole as DetectedRole)
      : "pm");

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream(
          {
            model: MODEL,
            max_tokens: 4000,
            thinking: {
              type: "enabled",
              budget_tokens: 3000,
            },
            system: planContext
              ? [
                  {
                    type: "text",
                    text: `Here is the current product plan for context:\n${planContext}\n\nAnswer questions about this plan.\nAuto-detect the domain from the question and answer from the right perspective.\n\n${promptForRole(
                      finalRole
                    )}`,
                  },
                  {
                    type: "text",
                    text: getWatiSchemaText(),
                    cache_control: { type: "ephemeral" },
                  },
                ]
              : [
                  {
                    type: "text",
                    text: promptForRole(finalRole),
                  },
                  {
                    type: "text",
                    text: getWatiSchemaText(),
                    cache_control: { type: "ephemeral" },
                  },
                ],
            messages: messages as MessageParam[],
          },
          {
            headers: {
              "anthropic-beta": "prompt-caching-2024-07-31",
            },
          }
        );

        for await (const event of stream as AsyncIterable<MessageStreamEvent>) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(sseLine({ delta: event.delta.text }));
          }
        }

        controller.enqueue(sseLine({ role: finalRole }));
        controller.enqueue(sseLine({ done: true }));
        controller.close();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Chat stream failed";
        controller.enqueue(sseLine({ error: message }));
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
