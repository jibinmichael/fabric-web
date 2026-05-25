import Anthropic from "@anthropic-ai/sdk";
import { Liveblocks } from "@liveblocks/node";
import fs from "node:fs";
import path from "node:path";

const MODEL = "claude-sonnet-4-6";

const SCHEMA = fs.readFileSync(
  path.join(process.cwd(), "src/lib/wati-schema.json"),
  "utf-8"
);

const SYSTEM_INSTRUCTIONS = `You are a product intelligence agent grounded in the Wati WhatsApp Business API.
You have access to the full Wati API schema.
Someone has posted a comment on a product plan.
Reply only if you are highly confident you can give a useful, grounded answer.
If the question is about Wati API capabilities, feasibility, or implementation — answer directly.
Keep reply under 3 sentences.
If you cannot answer confidently say nothing — return empty string.`;

const SYSTEM_REFERENCE = `Reference for Wati API capabilities:

${SCHEMA}`;

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

  let reply = "";
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

  const trimmedReply = reply.trim();
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
