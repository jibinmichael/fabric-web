import { Liveblocks } from "@liveblocks/node";
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

export async function POST() {
  const session = await auth0.getSession();
  if (!session?.user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) {
    return Response.json(
      { error: "LIVEBLOCKS_SECRET_KEY is not configured" },
      { status: 500 }
    );
  }

  const liveblocks = new Liveblocks({ secret });
  const user = session.user;

  const id =
    (typeof user.sub === "string" && user.sub) ||
    (typeof user.email === "string" && user.email) ||
    "anonymous";

  const name = typeof user.name === "string" ? user.name : "Signed in";
  const avatar = typeof user.picture === "string" ? user.picture : "";
  const color = colorFromString(id);

  const liveSession = liveblocks.prepareSession(id, {
    userInfo: { name, avatar, color },
  });

  liveSession.allow("fabricv3:doc-1", liveSession.FULL_ACCESS);

  const { status, body } = await liveSession.authorize();
  return new Response(body, { status });
}
