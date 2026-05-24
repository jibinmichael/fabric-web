import { redirect } from "next/navigation";
import { DocWorkspace } from "@/src/components/DocWorkspace";

export default async function DocPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const { room } = await searchParams;

  if (!room) {
    const { nanoid } = await import("nanoid");
    const newRoom = "fabricv3:" + nanoid();
    redirect("/doc?room=" + encodeURIComponent(newRoom));
  }

  return (
    <DocWorkspace
      userEmail="demo@wati.io"
      userName="Demo User"
      userAvatar=""
      roomId={room}
    />
  );
}
