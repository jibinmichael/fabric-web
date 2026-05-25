import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are reviewing a product plan and a new piece of information emerged from conversation.

STRICT RULES:
- Only return shouldUpdate: true if you are 100% certain this new information meaningfully changes the plan. Not 90%. Not probably. Certain.
- If there is ANY doubt — return shouldUpdate: false
- Better to miss an update than make a wrong one
- Do not update based on rephrasing or clarification
- Only update when genuinely NEW information is revealed that changes facts, scope, or feasibility

When shouldUpdate is true return:
{
  "shouldUpdate": true,
  "updates": [
    {
      "section": "problem" | "whoIsAffected" | "whatGoodLooksLike" | "openQuestions" | "apiGaps" | "nextActions",
      "newContent": "..."
    }
  ]
}

Return ALL affected sections in the updates array.
Not just one. All that are definitely affected.
If unsure about a section — exclude it.

When shouldUpdate is false return:
{ "shouldUpdate": false }

Return only valid JSON. No markdown.`;

function stripCodeFence(text: string): string {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { shouldUpdate: false, error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    conversationText?: string;
    currentPlan?: string;
  };
  const conversationText = (body.conversationText ?? "").trim();
  const currentPlan = (body.currentPlan ?? "").trim();

  if (!conversationText) {
    return Response.json({ shouldUpdate: false });
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Current plan:\n${currentPlan}\n\nConversation:\n${conversationText}`,
          },
        ],
      },
      {
        headers: { "anthropic-beta": "interleaved-thinking-2025-05-14" },
      }
    );

    const raw = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();

    const cleaned = stripCodeFence(raw);
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return Response.json({ shouldUpdate: false, raw });
    }

    return Response.json(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Patch call failed";
    return Response.json(
      { shouldUpdate: false, error: message },
      { status: 502 }
    );
  }
}
