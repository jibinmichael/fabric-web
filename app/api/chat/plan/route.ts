import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";
import path from "node:path";

const MODEL = "claude-sonnet-4-20250514";

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

const SYSTEM_PROMPT = `You are formatting a product plan from a brainstorming conversation.

This is a Wati product plan.
Wati is a WhatsApp Business API platform.
There is no email. Everything is WhatsApp messaging.
Never mention email, mass email, or spam.
Use WhatsApp-specific terminology only.
API gaps should only list missing Wati API capabilities, not product features.

You have access to the Wati API schema.
When identifying API gaps, reference this schema to ensure the gap is a real missing Wati API capability and not something already supported:

${SCHEMA}

Additional API samples:

Broadcasts API:
${BROADCASTS_SAMPLE}

Sales Pipeline API:
${SALES_PIPELINE_SAMPLE}

Return a JSON object with exactly these fields:
{
  problem: string (2-3 sentences),
  whoIsAffected: string[] (2-3 bullets),
  whatGoodLooksLike: string (2-3 sentences),
  openQuestions: string[] (unanswered questions only),
  answeredQuestions: string[] (answered questions),
  apiGaps: string[] (missing capabilities if any),
  nextActions: string[]
}

Return only valid JSON. No explanation. No markdown. Just the JSON object.`;

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
      { error: "ANTHROPIC_API_KEY is not configured" },
      { status: 500 }
    );
  }

  const body = (await request.json()) as { conversation?: string };
  const conversation = body.conversation?.trim();
  if (!conversation) {
    return Response.json({ error: "conversation is required" }, { status: 400 });
  }

  const client = new Anthropic({ apiKey });

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: conversation }],
    });

    const raw = response.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();

    const cleaned = stripCodeFence(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return Response.json(
        { error: "Model returned invalid JSON", raw },
        { status: 502 }
      );
    }

    return Response.json(parsed);
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Plan generation failed";
    return Response.json({ error: errorMessage }, { status: 500 });
  }
}
