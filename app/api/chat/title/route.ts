import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT = `Generate a 3-5 word title for a product planning session based on this conversation.
The title should describe the specific product problem being solved.
Never generate titles like 'Need More Context' 'General Greeting' or 'Untitled Session'.
If the conversation is a greeting or too vague to title, return exactly: 'Untitled'
Return only the title. No punctuation.`;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { message?: string };
  const message = body.message?.trim();
  if (!message) {
    return Response.json({ error: "message is required" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 64,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: message }],
    });

    const title = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    return Response.json({ title });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Title generation failed";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
