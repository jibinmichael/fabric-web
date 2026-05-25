import Anthropic from "@anthropic-ai/sdk";

export const runtime = "nodejs";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `Summarize this product plan in exactly 2 plain sentences. Focus on: what problem is being solved and what the key technical constraint or API gap is. No markdown. No formatting. No bullet points. Return only the two sentences, nothing else.`;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ summary: "" }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    planText?: string;
    roomId?: string;
  };

  const planText = (body.planText ?? "").trim();
  const roomId = (body.roomId ?? "").trim();

  if (!planText || !roomId) {
    return Response.json({ summary: "" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  let summary = "";
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 150,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: planText }],
    });
    summary = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch {
    return Response.json({ summary: "" });
  }

  if (!summary) {
    return Response.json({ summary: "" });
  }

  // Store the summary via the /api/sessions/summary route
  try {
    const host = request.headers.get("host") ?? "localhost:3000";
    const protocol = host.startsWith("localhost") ? "http" : "https";
    await fetch(`${protocol}://${host}/api/sessions/summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, summary }),
    });
  } catch {
    // best-effort — ignore storage errors, still return the summary
  }

  return Response.json({ summary });
}
