import { Liveblocks, WebhookHandler } from "@liveblocks/node";

// LIVEBLOCKS_WEBHOOK_SECRET=get_from_liveblocks_dashboard
// NEXT_PUBLIC_APP_URL=http://localhost:3000
// After deploy, add webhook endpoint in the Liveblocks dashboard pointing to
// /api/webhooks/liveblocks (commentCreated event).

/* eslint-disable @typescript-eslint/no-explicit-any */
function extractText(body: any): string {
  if (!body?.content) return "";
  return body.content
    .map((block: any) =>
      block.children?.map((c: any) => c.text ?? "").join("") ?? ""
    )
    .join("\n")
    .trim();
}

type PlanDataLike = {
  problem?: string;
  whoIsAffected?: string[];
  whatGoodLooksLike?: string;
  openQuestions?: string[];
  answeredQuestions?: string[];
  apiGaps?: string[];
  nextActions?: string[];
};

function planJsonToText(planJson: string): string {
  if (!planJson) return "";
  let plan: PlanDataLike;
  try {
    plan = JSON.parse(planJson) as PlanDataLike;
  } catch {
    return planJson;
  }
  const parts: string[] = [];
  if (plan.problem) parts.push(`Problem: ${plan.problem}`);
  if (Array.isArray(plan.whoIsAffected) && plan.whoIsAffected.length > 0) {
    parts.push(
      `Who is affected:\n${plan.whoIsAffected.map((x) => `- ${x}`).join("\n")}`
    );
  }
  if (plan.whatGoodLooksLike) {
    parts.push(`What good looks like: ${plan.whatGoodLooksLike}`);
  }
  if (Array.isArray(plan.openQuestions) && plan.openQuestions.length > 0) {
    parts.push(
      `Open questions:\n${plan.openQuestions.map((x) => `- ${x}`).join("\n")}`
    );
  }
  if (Array.isArray(plan.apiGaps) && plan.apiGaps.length > 0) {
    parts.push(`API gaps:\n${plan.apiGaps.map((x) => `- ${x}`).join("\n")}`);
  }
  if (Array.isArray(plan.nextActions) && plan.nextActions.length > 0) {
    parts.push(`Next:\n${plan.nextActions.map((x) => `- ${x}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

export async function POST(request: Request) {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  const webhookSecret = process.env.LIVEBLOCKS_WEBHOOK_SECRET;
  if (!secret) {
    return Response.json(
      { error: "LIVEBLOCKS_SECRET_KEY is not configured" },
      { status: 500 }
    );
  }
  if (!webhookSecret) {
    return Response.json(
      { error: "LIVEBLOCKS_WEBHOOK_SECRET is not configured" },
      { status: 500 }
    );
  }

  const rawBody = await request.text();
  const webhookHandler = new WebhookHandler(webhookSecret);

  let event;
  try {
    event = webhookHandler.verifyRequest({
      headers: request.headers,
      rawBody,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Webhook signature invalid";
    return Response.json({ error: message }, { status: 400 });
  }

  if (event.type !== "commentCreated") {
    return Response.json({ ok: true });
  }

  const { roomId, threadId, commentId } = event.data;

  const liveblocks = new Liveblocks({ secret });

  // The webhook payload does not include the comment body — fetch it.
  let userId = "";
  let commentText = "";
  try {
    const comment = await liveblocks.getComment({
      roomId,
      threadId,
      commentId,
    });
    userId = comment.userId ?? "";
    commentText = extractText(comment.body);
  } catch {
    return Response.json({ ok: true });
  }

  if (
    userId === "agent-1" ||
    userId === "challenger-1" ||
    userId === "fabric"
  ) {
    return Response.json({ ok: true });
  }

  const hasFabricMention = commentText.toLowerCase().includes("@fabric");
  const isQuestion =
    commentText.includes("?") ||
    /^(how|why|what|can|does|will)\b/i.test(commentText.trim());

  if (!hasFabricMention && !isQuestion) {
    return Response.json({ ok: true });
  }

  // Pull the plan from storage and turn it into text for the agent.
  let planText = "";
  try {
    const storage = await liveblocks.getStorageDocument(roomId, "json");
    const planJson =
      typeof (storage as { planJson?: unknown }).planJson === "string"
        ? ((storage as { planJson?: string }).planJson as string)
        : "";
    planText = planJsonToText(planJson);
  } catch {
    // best-effort — proceed with empty plan text rather than failing the webhook
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

  try {
    await fetch(`${appUrl}/api/agent-reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        threadId,
        commentText,
        planText,
        roomId,
      }),
    });
  } catch {
    // best-effort — the webhook still returns ok so Liveblocks doesn't retry
  }

  return Response.json({ ok: true });
}
