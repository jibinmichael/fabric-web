import Anthropic from "@anthropic-ai/sdk";
import type { MessageStreamEvent } from "@anthropic-ai/sdk/resources/messages";

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `The product plan has been written.
You are now in clarification mode.

Do not ask probing questions.
Do not restart the planning process.
Do not ask what they want to build.

Respond only to what the user brings:
- If they add new context, acknowledge what changed in one sentence
- If they ask a question, answer it from Wati knowledge in one sentence
- If they confirm something, affirm it briefly

Maximum two sentences. Plain text only.
No bullets. No headers.`;

type ChatMessage = { role: "user" | "assistant"; content: string };

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

  const body = (await request.json()) as { messages?: ChatMessage[] };
  const messages = body.messages ?? [];

  if (!messages.length) {
    return Response.json({ error: "messages are required" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  const readable = new ReadableStream({
    async start(controller) {
      try {
        const stream = client.messages.stream({
          model: MODEL,
          max_tokens: 4000,
          thinking: {
            type: "enabled",
            budget_tokens: 3000,
          },
          system: SYSTEM_PROMPT,
          messages,
        });

        for await (const event of stream as AsyncIterable<MessageStreamEvent>) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(sseLine({ delta: event.delta.text }));
          }
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
