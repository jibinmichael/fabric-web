type UserInfo = { name: string; avatar: string | undefined; color: string };

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as { userIds?: string[] };
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];

  const users: UserInfo[] = userIds.map((id) => ({
    name: "Demo User",
    avatar: `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(id)}`,
    color: "#22c55e",
  }));

  return Response.json({ users });
}
