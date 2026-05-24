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
          color: "#999",
          fontFamily:
            '"Sentinel", Georgia, "Times New Roman", serif',
          fontSize: 14,
          background: "#FFFFFF",
          minHeight: "100vh",
        }}
      >
        Invalid link
      </div>
    );
  }

  return (
    <div style={{ background: "#FFFFFF", minHeight: "100vh" }}>
      <SharedDoc roomId={roomId} />
    </div>
  );
}
