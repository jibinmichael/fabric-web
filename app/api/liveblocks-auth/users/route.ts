type UserInfo = { name: string; avatar: string | undefined; color: string };

export async function POST(request: Request) {
  const body = (await request
    .json()
    .catch(() => ({}))) as { userIds?: string[] };
  const userIds = Array.isArray(body.userIds) ? body.userIds : [];

  const users: UserInfo[] = userIds.map(() => ({
    name: "Demo User",
    avatar: undefined,
    color: "#22c55e",
  }));

  return Response.json({ users });
}
