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
  const id = `viewer-${Math.random().toString(36).slice(2, 10)}`;

  const session = liveblocks.prepareSession(id, {
    userInfo: {
      name: "Viewer",
      avatar: `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(id)}`,
      color: "#999999",
    },
  });

  session.allow("fabricv3:*", session.READ_ACCESS);

  const { status, body } = await session.authorize();
  return new Response(body, { status });
}
