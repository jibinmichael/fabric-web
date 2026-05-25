import { Liveblocks } from "@liveblocks/node";

function colorFromString(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

export async function POST(request: Request) {
  const secret = process.env.LIVEBLOCKS_SECRET_KEY;
  if (!secret) {
    return Response.json(
      { error: "LIVEBLOCKS_SECRET_KEY is not configured" },
      { status: 500 }
    );
  }

  const body = (await request
    .json()
    .catch(() => ({}))) as { room?: string; name?: string };

  const providedName =
    typeof body.name === "string" && body.name.trim().length > 0
      ? body.name.trim()
      : "Anonymous";

  const liveblocks = new Liveblocks({ secret });

  const name = providedName;
  const avatar = `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(
    name
  )}`;
  const color = colorFromString(name);
  const id = "demo-" + name.toLowerCase().replace(/\s+/g, "-");

  const liveSession = liveblocks.prepareSession(id, {
    userInfo: { name, avatar, color },
  });

  liveSession.allow("fabricv3:*", liveSession.FULL_ACCESS);

  const { status, body: respBody } = await liveSession.authorize();
  return new Response(respBody, { status });
}
