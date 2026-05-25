import { SharedDoc } from "@/src/components/SharedDoc";

export default async function SharedDocPage({
  searchParams,
}: {
  searchParams: Promise<{ room?: string }>;
}) {
  const params = await searchParams;
  const roomId =
    typeof params.room === "string" ? params.room.trim() : "";

  if (!roomId) {
    return (
      <div
        style={{
          padding: 48,
          textAlign: "center",
          color: "#a0a0a0",
          fontFamily:
            `"ABC Monument Grotesk Semi Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace`,
          fontSize: 14,
          background: "#ffffff",
          minHeight: "100vh",
        }}
      >
        Invalid link
      </div>
    );
  }

  return (
    <div style={{ background: "#ffffff", minHeight: "100vh" }}>
      <SharedDoc roomId={roomId} />
    </div>
  );
}
