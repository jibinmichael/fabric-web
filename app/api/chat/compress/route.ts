import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-20250514";

const SYSTEM_PROMPT =
  "Convert this sentence into a 3-6 word bullet point summary. Return only the bullet text. No punctuation at end. No explanation.";

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { sentence?: string };
  const sentence = body.sentence?.trim();
  if (!sentence) {
    return Response.json({ error: "sentence is required" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 30,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: sentence }],
    });

    const bullet = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    return Response.json({ bullet });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Compression failed";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
