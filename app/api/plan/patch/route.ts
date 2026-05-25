import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You analyze a product planning conversation and decide if the plan needs updating based on new information revealed.

Return ONLY valid JSON in this format:
{
  "shouldUpdate": true/false,
  "section": "problem|whoIsAffected|whatGoodLooksLike|openQuestions|nextActions",
  "newContent": "the updated content for that section"
}

Only return shouldUpdate: true if genuinely new information was revealed that changes the plan. Not just rephrasing. Real new facts.
If no update needed return { shouldUpdate: false }`;

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
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 500,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Current plan:\n${currentPlan}\n\nConversation:\n${conversationText}`,
        },
      ],
    });

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
