import { redirect } from "next/navigation";
import { DocWorkspace } from "@/src/components/DocWorkspace";

const VALID_ROLES = ["engineering", "qa", "design"] as const;
type Role = (typeof VALID_ROLES)[number];

export default async function DocPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string; role?: string }>;
}) {
  const { room, role } = await searchParams;

  if (!room) {
    const { nanoid } = await import("nanoid");
    const newRoom = "fabricv3:" + nanoid();
    redirect("/doc?room=" + encodeURIComponent(newRoom));
  }

  const validatedRole: Role | undefined = VALID_ROLES.includes(role as Role)
    ? (role as Role)
    : undefined;

  return (
    <DocWorkspace
      userEmail="demo@wati.io"
      userName="Demo User"
      userAvatar=""
      roomId={room}
      role={validatedRole}
    />
  );
}
