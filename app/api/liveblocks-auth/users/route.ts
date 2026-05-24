import { auth0 } from "@/lib/auth0";

function colorFromString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

type UserInfo = { name: string; avatar: string | undefined; color: string };

export async function POST(request: Request) {
  const session = await auth0.getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const user = session.user;
  const myId =
    (typeof user.sub === "string" && user.sub) ||
    (typeof user.email === "string" && user.email) ||
    "anonymous";
  const myName =
    typeof user.name === "string" && user.name.trim() ? user.name : "Signed in";
  const myAvatarRaw =
    typeof user.picture === "string" ? user.picture : "";
  const myAvatar = myAvatarRaw ? myAvatarRaw : undefined;
  const myColor = colorFromString(myId);

  const body = (await request
    .json()
    .catch(() => ({}))) as { userIds?: string[] };
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];

  const users: (UserInfo | null)[] = userIds.map((id) => {
    if (id === myId) {
      return { name: myName, avatar: myAvatar, color: myColor };
    }
    return null;
  });

  return Response.json({ users });
}
