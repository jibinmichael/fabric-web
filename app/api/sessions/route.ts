import { kv } from "@vercel/kv";
import { nanoid } from "nanoid";
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

export async function GET() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const email =
    typeof session.user.email === "string" ? session.user.email : "";
  if (!email) {
    return Response.json({ sessions: [] });
  }

  try {
    const sessions = await readSessions(email);
    return Response.json({ sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "KV read failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }
  const email =
    typeof session.user.email === "string" ? session.user.email : "";
  if (!email) {
    return Response.json({ error: "Missing user email" }, { status: 400 });
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as Partial<{
    title: string;
    ownerEmail: string;
    ownerName: string;
    ownerAvatar: string;
  }>;

  const title = (body.title ?? "").trim();
  const ownerName = (body.ownerName ?? "").trim();
  const ownerAvatar = (body.ownerAvatar ?? "").trim();

  const id = nanoid();
  const roomId = `fabricv3:${nanoid()}`;
  const record: SessionRecord = {
    id,
    title,
    roomId,
    createdAt: Date.now(),
    ownerId: email,
    ownerName,
    ownerAvatar,
  };

  try {
    const existing = await readSessions(email);
    const next = [record, ...existing];
    await kv.set(sessionsKey(email), next);
    return Response.json({ session: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : "KV write failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
