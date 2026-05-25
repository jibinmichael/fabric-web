import Anthropic from "@anthropic-ai/sdk";
import { Liveblocks } from "@liveblocks/node";
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

const SYSTEM_INSTRUCTIONS = `You are a product intelligence agent grounded in the Wati WhatsApp Business API.
Someone highlighted specific text in a product plan and posted a comment about it.
Answer specifically about the highlighted text and the comment.
Reference the exact highlighted text.
Keep answer to 2-3 sentences maximum.
Plain text only. No markdown. No bullets.
No bold. No formatting.`;

const SYSTEM_REFERENCE = `Reference for Wati API capabilities:

${SCHEMA}

Broadcasts API:
${BROADCASTS_SAMPLE}

Sales Pipeline API:
${SALES_PIPELINE_SAMPLE}`;

function stripMarkdown(text: string): string {
  return text
    // **bold** / __bold__
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    // *italic* / _italic_ (single delimiter, not part of a pair)
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1$2")
    // Inline `code`
    .replace(/`([^`]+)`/g, "$1")
    // Leading bullet markers (-, *, +)
    .replace(/^\s*[-*+]\s+/gm, "")
    // Leading numbered list markers (1. 2. ...)
    .replace(/^\s*\d+\.\s+/gm, "")
    // Heading markers (#, ##, ...)
    .replace(/^\s*#{1,6}\s+/gm, "")
    // Blockquote markers
    .replace(/^\s*>\s+/gm, "")
    // Collapse multiple newlines (and any surrounding whitespace) to a single space
    .replace(/\s*\n+\s*/g, " ")
    // Collapse runs of whitespace
    .replace(/[ \t]+/g, " ")
    .trim();
}

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured", reply: "" },
      { status: 500 }
    );
  }
  if (!secret) {
    return Response.json(
      { error: "LIVEBLOCKS_SECRET_KEY is not configured", reply: "" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    threadId?: string;
    commentText?: string;
    planText?: string;
    roomId?: string;
  };

  const threadId = (body.threadId ?? "").trim();
  const commentText = (body.commentText ?? "").trim();
  const planText = (body.planText ?? "").trim();
  const roomId = (body.roomId ?? "").trim();

  if (!threadId || !commentText || !roomId) {
    return Response.json({ reply: "" }, { status: 400 });
  }

  const anthropic = new Anthropic({
    apiKey,
    defaultHeaders: {
      "anthropic-beta": "prompt-caching-2024-07-31",
    },
  });

  // ── Confidence check ───────────────────────────────────────────────────────
  // Quick classifier — only proceed with the full reply call when the
  // comment is genuinely answerable from a plan / API schema.
  try {
    const classifier = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 10,
      system:
        "Reply YES if this comment is asking a genuine question or requesting information that can be answered from a product plan or API schema. Reply NO if it is a statement, opinion, or acknowledgement.",
      messages: [{ role: "user", content: commentText }],
    });
    const verdict = classifier.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim()
      .toUpperCase();
    if (!verdict.startsWith("YES")) {
      return Response.json({ reply: "" });
    }
  } catch {
    // If the classifier itself fails, fall through to the main call rather
    // than silently dropping the comment.
  }

  let reply = "";
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 3400,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      thinking: { type: "adaptive" },
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
          content: `Plan:\n${planText}\n\nComment: ${commentText}`,
        },
      ],
    });
    reply = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claude call failed";
    return Response.json({ reply: "", error: message }, { status: 502 });
  }

  // Liveblocks comment body is plain-text only — strip any markdown the model
  // emitted (bold, italics, lists, headings, blockquotes, inline code) and
  // collapse newlines into spaces before posting.
  const trimmedReply = stripMarkdown(reply);
  if (
    !trimmedReply ||
    trimmedReply.length <= 10 ||
    trimmedReply === '""' ||
    trimmedReply === "null" ||
    trimmedReply === "undefined"
  ) {
    return Response.json({ reply: "" });
  }

  try {
    const liveblocks = new Liveblocks({ secret });
    await liveblocks.createComment({
      roomId,
      threadId,
      data: {
        userId: "agent-1",
        body: {
          version: 1,
          content: [
            {
              type: "paragraph",
              children: [{ text: trimmedReply }],
            },
          ],
        },
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Liveblocks createComment failed";
    return Response.json(
      { reply: trimmedReply, error: message },
      { status: 502 }
    );
  }

  return Response.json({ reply: trimmedReply });
}
