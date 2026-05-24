import { redirect } from "next/navigation";
import { kv } from "@vercel/kv";
import { nanoid } from "nanoid";
import { auth0 } from "@/lib/auth0";
import { DocWorkspace } from "@/src/components/DocWorkspace";

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

export default async function DocPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const session = await auth0.getSession();

  if (!session?.user) {
    redirect("/auth/login");
  }

  const user = session.user;
  const email = typeof user.email === "string" ? user.email : "";
  const name = typeof user.name === "string" ? user.name : "";
  const avatar = typeof user.picture === "string" ? user.picture : "";

  const params = await searchParams;
  let roomId = typeof params.room === "string" ? params.room.trim() : "";

  if (!roomId) {
    if (!email) {
      redirect("/auth/login");
    }
    const id = nanoid();
    roomId = `fabricv3:${nanoid()}`;
    const record: SessionRecord = {
      id,
      title: "",
      roomId,
      createdAt: Date.now(),
      ownerId: email,
      ownerName: name,
      ownerAvatar: avatar,
    };
    try {
      const existing = (await kv.get<SessionRecord[]>(sessionsKey(email))) ?? [];
      await kv.set(sessionsKey(email), [
        record,
        ...(Array.isArray(existing) ? existing : []),
      ]);
    } catch {
      // KV write failure shouldn't block entry — user still gets a fresh room
    }
    redirect(`/doc?room=${encodeURIComponent(roomId)}`);
  }

  return (
    <DocWorkspace
      userEmail={email}
      userName={name}
      userAvatar={avatar}
      roomId={roomId}
    />
  );
}
