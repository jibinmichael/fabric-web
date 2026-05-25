import { kv } from "@vercel/kv";

const DEMO_EMAIL = "demo@wati.io";

type SessionRecord = {
  id: string;
  title: string;
  roomId: string;
  createdAt: number;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
  summary: string;
};

function sessionsKey(email: string): string {
  return `sessions:${email}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    roomId?: string;
    summary?: string;
  };

  const roomId = (body.roomId ?? "").trim();
  const summary = (body.summary ?? "").trim();

  if (!roomId) {
    return Response.json(
      { success: false, error: "roomId is required" },
      { status: 400 }
    );
  }

  try {
    const key = sessionsKey(DEMO_EMAIL);
    const stored = await kv.get<SessionRecord[]>(key);
    const sessions = Array.isArray(stored) ? stored : [];

    const idx = sessions.findIndex((s) => s.roomId === roomId);
    if (idx < 0) {
      return Response.json(
        { success: false, error: "session not found" },
        { status: 404 }
      );
    }

    sessions[idx] = { ...sessions[idx], summary };
    await kv.set(key, sessions);

    return Response.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "KV error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
