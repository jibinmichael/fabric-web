import { kv } from "@vercel/kv";
import { auth0 } from "@/lib/auth0";

type SessionRecord = {
  id: string;
  title: string;
  roomId: string;
  createdAt: number;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
};

function sessionsKey(email: string): string {
  return `sessions:${email}`;
}

async function readSessions(email: string): Promise<SessionRecord[]> {
  const stored = await kv.get<SessionRecord[]>(sessionsKey(email));
  return Array.isArray(stored) ? stored : [];
}

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, ctx: Ctx) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const email =
    typeof session.user.email === "string" ? session.user.email : "";
  if (!email) {
    return Response.json({ error: "Missing user email" }, { status: 400 });
  }

  const { id } = await ctx.params;
  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<{ title: string }>;
  const title = (body.title ?? "").trim();

  try {
    const sessions = await readSessions(email);
    const idx = sessions.findIndex((s) => s.id === id);
    if (idx < 0) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    const updated: SessionRecord = { ...sessions[idx], title };
    sessions[idx] = updated;
    await kv.set(sessionsKey(email), sessions);
    return Response.json({ session: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "KV write failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const email =
    typeof session.user.email === "string" ? session.user.email : "";
  if (!email) {
    return Response.json({ error: "Missing user email" }, { status: 400 });
  }

  const { id } = await ctx.params;

  try {
    const sessions = await readSessions(email);
    const next = sessions.filter((s) => s.id !== id);
    await kv.set(sessionsKey(email), next);
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "KV write failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
