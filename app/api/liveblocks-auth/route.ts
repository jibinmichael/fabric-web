import { Liveblocks } from "@liveblocks/node";

export async function POST() {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) {
    return Response.json(
      { error: "LIVEBLOCKS_SECRET_KEY is not configured" },
      { status: 500 }
    );
  }

  const liveblocks = new Liveblocks({ secret });

  const id = "demo-user";
  const name = "Demo User";
  const avatar = "";
  const color = "#22c55e";

  const liveSession = liveblocks.prepareSession(id, {
    userInfo: { name, avatar, color },
  });

  liveSession.allow("fabricv3:*", liveSession.FULL_ACCESS);

  const { status, body } = await liveSession.authorize();
  return new Response(body, { status });
}
