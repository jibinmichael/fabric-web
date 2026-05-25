import Anthropic from "@anthropic-ai/sdk";
import { Liveblocks } from "@liveblocks/node";

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `You are a ruthless product critic reviewing a plan and an agent reply to a comment on it.
Find ONE critical flaw, untested assumption, or missing piece in the agent reply.
Be specific. Be direct. No markdown. Plain text.
Under 3 sentences.`;

export async function POST(request: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY is not configured", challenge: "" },
      { status: 500 }
    );
  }
  if (!secret) {
    return Response.json(
      { error: "LIVEBLOCKS_SECRET_KEY is not configured", challenge: "" },
      { status: 500 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    threadId?: string;
    agentReply?: string;
    planText?: string;
    roomId?: string;
  };

  const threadId = (body.threadId ?? "").trim();
  const agentReply = (body.agentReply ?? "").trim();
  const planText = (body.planText ?? "").trim();
  const roomId = (body.roomId ?? "").trim();

  if (!threadId || !roomId || !planText) {
    return Response.json({ challenge: "" }, { status: 400 });
  }
  if (!agentReply) {
    return Response.json({ challenge: "" });
  }

  const client = new Anthropic({ apiKey });

  let challenge = "";
  try {
    const response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 6400,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: `Plan: ${planText}\n\nAgent reply being challenged: ${agentReply}`,
          },
        ],
      },
      {
        headers: { "anthropic-beta": "interleaved-thinking-2025-05-14" },
      }
    );

    challenge = response.content
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Claude call failed";
    return Response.json({ challenge: "", error: message }, { status: 502 });
  }

  if (!challenge || challenge.length < 15) {
    return Response.json({ challenge: "" });
  }

  try {
    const liveblocks = new Liveblocks({ secret });
    await liveblocks.createComment({
      roomId,
      threadId,
      data: {
        userId: "challenger-1",
        body: {
          version: 1,
          content: [
            {
              type: "paragraph",
              children: [{ text: challenge }],
            },
          ],
        },
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Liveblocks createComment failed";
    return Response.json({ challenge, error: message }, { status: 502 });
  }

  return Response.json({ challenge });
}
