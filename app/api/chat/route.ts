import Anthropic from "@anthropic-ai/sdk";
import type { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";
import fs from "node:fs";
import path from "node:path";

const MODEL = "claude-sonnet-4-6";

const SCHEMA = fs.readFileSync(
  path.join(process.cwd(), "src/lib/wati-schema.json"),
  "utf-8"
);

const BROADCASTS_SAMPLE = fs.readFileSync(
  path.join(process.cwd(), "src/api-samples/broadcasts.json"),
  "utf-8"
);

const SALES_PIPELINE_SAMPLE = fs.readFileSync(
  path.join(process.cwd(), "src/api-samples/sales-pipeline.json"),
  "utf-8"
);

const SYSTEM_INSTRUCTIONS = `You are a sharp product thinking partner for Wati teams. Wati is a WhatsApp Business API platform used by support and sales teams.

You have two tools:
- ask_question: use this to ask ONE sharp question that uncovers what is still unclear
- signal_plan_ready: use this when you have enough context to write a complete plan

Rules:
- You MUST call one tool every response
- Never output plain text without a tool call
- ask_question: first sentence states one sharp insight about the problem. Second sentence is the question.
- Only call signal_plan_ready when you know: the core problem, who is affected, and what good looks like
- Never call signal_plan_ready on greetings, small talk, or messages that don't describe a real product problem. Only call signal_plan_ready when the user has described a specific product problem with enough context to write a plan.
- Never ask about team size, budget, or developers
- Wati is WhatsApp only. No email.`;

const SYSTEM_REFERENCE = `Reference for Wati API capabilities:

${SCHEMA}

Broadcasts API:
${BROADCASTS_SAMPLE}

Sales Pipeline API:
${SALES_PIPELINE_SAMPLE}`;

const TOOLS = [
  {
    name: "ask_question",
    description:
      "Ask the user one sharp clarifying question about their product problem",
    input_schema: {
      type: "object" as const,
      properties: {
        question: {
          type: "string",
          description: "The question to ask",
        },
      },
      required: ["question"],
    },
  },
  {
    name: "signal_plan_ready",
    description:
      "Signal that enough context exists to write the plan. Call this when you know the problem, who is affected, and what good looks like.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "One sentence summary of what will be planned",
        },
      },
      required: ["summary"],
    },
  },
];

type ContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

type ChatMessage = {
  role: "user" | "assistant";
  content: string | ContentBlock[];
};

function sseLine(payload: Record<string, unknown>): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

// Streaming JSON string-field extractor. Tracks the value of a single
// top-level string field across partial JSON chunks and returns any
// newly-decoded characters of that field per push().
function makeJsonStringExtractor(fieldName: string) {
  let buffer = "";
  let state: "BEFORE_FIELD" | "IN_VALUE" | "DONE" = "BEFORE_FIELD";
  let pos = 0;
  let inEscape = false;

  return (chunk: string): string => {
    buffer += chunk;
    let out = "";

    while (pos < buffer.length && state !== "DONE") {
      if (state === "BEFORE_FIELD") {
        const pattern = `"${fieldName}"`;
        const idx = buffer.indexOf(pattern, pos);
        if (idx < 0) {
          break;
        }
        let i = idx + pattern.length;
        while (i < buffer.length && buffer[i] !== '"') {
          i++;
        }
        if (i >= buffer.length) {
          break;
        }
        pos = i + 1;
        state = "IN_VALUE";
        continue;
      }

      const ch = buffer[pos];
      if (inEscape) {
        if (ch === "n") out += "\n";
        else if (ch === "t") out += "\t";
        else if (ch === "r") out += "\r";
        else if (ch === "\\") out += "\\";
        else if (ch === '"') out += '"';
        else if (ch === "/") out += "/";
        else out += ch;
        inEscape = false;
        pos++;
      } else if (ch === "\\") {
        inEscape = true;
        pos++;
      } else if (ch === '"') {
        state = "DONE";
        pos++;
        break;
      } else {
        out += ch;
        pos++;
      }
    }

    return out;
  };
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { messages?: ChatMessage[] };
  const messages = body.messages ?? [];

  if (!messages.length) {
    return Response.json({ error: "messages are required" }, { status: 400 });
  }

  const client = new Anthropic({
    apiKey,
    defaultHeaders: {
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
  });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 4000,
          system: [
            { type: "text", text: SYSTEM_INSTRUCTIONS },
            {
              type: "text",
              text: SYSTEM_REFERENCE,
              cache_control: { type: "ephemeral" },
            },
          ],
          tools: TOOLS,
          tool_choice: { type: "any" },
          messages,
        });

        let toolName = "";
        let extractor: ((chunk: string) => string) | null = null;
        let wordBuffer = "";

        for await (const event of stream as AsyncIterable<MessageStreamEvent>) {
          if (
            event.type === "content_block_start" &&
            event.content_block.type === "tool_use"
          ) {
            toolName = event.content_block.name;
            const field =
              toolName === "ask_question" ? "question" : "summary";
            extractor = makeJsonStringExtractor(field);
          }

          if (
            event.type === "content_block_delta" &&
            event.delta.type === "input_json_delta" &&
            extractor
          ) {
            const text = extractor(event.delta.partial_json);
            if (text) {
              wordBuffer += text;
              const lastBoundary = Math.max(
                wordBuffer.lastIndexOf(" "),
                wordBuffer.lastIndexOf("\n")
              );
              if (lastBoundary >= 0) {
                controller.enqueue(
                  sseLine({ delta: wordBuffer.slice(0, lastBoundary + 1) })
                );
                wordBuffer = wordBuffer.slice(lastBoundary + 1);
              }
            }
          }
        }

        if (wordBuffer) {
          controller.enqueue(sseLine({ delta: wordBuffer }));
          wordBuffer = "";
        }

        if (toolName === "signal_plan_ready") {
          controller.enqueue(sseLine({ delta: "\n[PLAN_READY]" }));
        }

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
