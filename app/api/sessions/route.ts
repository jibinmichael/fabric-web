import { kv } from "@vercel/kv";
import { nanoid } from "nanoid";

const DEMO_EMAIL = "demo@wati.io";

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
  try {
    const sessions = await readSessions(DEMO_EMAIL);
    return Response.json({ sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "KV read failed";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
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
    ownerId: DEMO_EMAIL,
    ownerName,
    ownerAvatar,
  };

  try {
    const existing = await readSessions(DEMO_EMAIL);
    const next = [record, ...existing];
    await kv.set(sessionsKey(DEMO_EMAIL), next);
    return Response.json({ session: record });
  } catch (err) {
    const message = err instanceof Error ? err.message : "KV write failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
