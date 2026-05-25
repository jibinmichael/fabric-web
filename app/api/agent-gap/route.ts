import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";

const SCHEMA = fs.readFileSync(
  path.join(process.cwd(), "src/lib/wati-schema.json"),
  "utf-8"
);

const SYSTEM_INSTRUCTIONS = `You are a sharp product intelligence agent grounded in the Wati WhatsApp Business API.

You have just reviewed a product plan and the conversation that built it.

Your job: find ONE critical gap, unvalidated assumption, or missing piece that could derail this feature.

Be specific. Be ruthless. Don't be generic.

Return ONLY a JSON object:
{
  "gap": string (the gap as a sharp question under 25 words),
  "section": string (exactly one of: Problem | Who is affected | What good looks like | Open questions | API gaps | Next),
  "nextAction": string (a specific actionable next step to resolve the gap, under 15 words, plain text, no markdown)
}

Return nothing else. No markdown. Just JSON.`;

const SYSTEM_REFERENCE = `Reference for Wati API capabilities:\n\n${SCHEMA}`;

type ChatTurn = { role?: string; content?: string };

function formatChatHistory(history: ChatTurn[] | undefined): string {
  if (!Array.isArray(history) || history.length === 0) {
    return "(no chat history provided)";
  }
  return history
    .map((turn) => {
      const role =
        turn.role === "user" || turn.role === "assistant" ? turn.role : "user";
      const content =
        typeof turn.content === "string" ? turn.content.trim() : "";
      if (!content) return "";
      const label = role === "user" ? "User" : "Agent";
      return `${label}: ${content}`;
    })
    .filter(Boolean)
    .join("\n");
}

function extractJsonObject(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Try a direct parse first.
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // Fall through to brace-scan.
  }
  // Pull the first {...} block out of fenced/decorated responses.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return trimmed.slice(start, end + 1);
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured", gap: null },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    planText?: string;
    chatHistory?: ChatTurn[];
    roomId?: string;
  };

  const planText = (body.planText ?? "").trim();
  const roomId = (body.roomId ?? "").trim();
  const chatHistoryText = formatChatHistory(body.chatHistory);

  if (!planText || !roomId) {
    return Response.json({ gap: null }, { status: 400 });
  }

  const anthropic = new Anthropic({
    apiKey,
    defaultHeaders: {
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
  });

  let rawResponse = "";
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      system: [
        { type: "text", text: SYSTEM_INSTRUCTIONS },
        {
          type: "text",
          text: SYSTEM_REFERENCE,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: `Plan:\n${planText}\n\nConversation that built the plan:\n${chatHistoryText}`,
        },
      ],
    });
    rawResponse = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claude call failed";
    return Response.json({ gap: null, error: message }, { status: 502 });
  }

  const jsonText = extractJsonObject(rawResponse);
  if (!jsonText) {
    return Response.json({ gap: null });
  }

  let parsed: { gap?: unknown; section?: unknown; nextAction?: unknown };
  try {
    parsed = JSON.parse(jsonText) as {
      gap?: unknown;
      section?: unknown;
      nextAction?: unknown;
    };
  } catch {
    return Response.json({ gap: null });
  }

  const gap =
    typeof parsed.gap === "string" ? parsed.gap.trim() : "";
  const section =
    typeof parsed.section === "string" ? parsed.section.trim() : "";
  const nextAction =
    typeof parsed.nextAction === "string" ? parsed.nextAction.trim() : "";

  if (!gap) {
    return Response.json({ gap: null });
  }

  // Server-side createThread was removed — the client now posts the anchored
  // comment via the Tiptap Liveblocks extension so the thread is bound to the
  // section heading instead of floating unanchored.
  return Response.json({ gap, section, nextAction });
}
