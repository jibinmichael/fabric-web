"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SessionRecord = {
  id: string;
  title: string;
  roomId: string;
  createdAt: number;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
};

export default function Home() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/sessions");
        if (!res.ok) return;
        const data = (await res.json()) as { sessions?: SessionRecord[] };
        setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      } catch {
        // ignore
      }
    })();
  }, []);

  const handleNew = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled",
          ownerEmail: "demo@wati.io",
          ownerName: "Demo User",
          ownerAvatar: "",
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { session?: { roomId: string } };
      if (data.session?.roomId) {
        router.push("/doc?room=" + encodeURIComponent(data.session.roomId));
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        background: "#f7f6f3",
        minHeight: "100vh",
        padding: "40px 0",
      }}
    >
      <div
        style={{
          maxWidth: 680,
          margin: "0 auto",
          padding: "0 32px",
        }}
      >
        {/* Header row */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              fontSize: 18,
              fontWeight: 500,
              color: "#1a1a1a",
            }}
          >
            fabric
          </span>
          <button
            type="button"
            onClick={() => void handleNew()}
            disabled={creating}
            style={{
              background: "#1a1a1a",
              color: "#ffffff",
              fontSize: 12,
              fontWeight: 500,
              padding: "6px 14px",
              borderRadius: 6,
              border: "none",
              cursor: creating ? "default" : "pointer",
              fontFamily: "inherit",
              opacity: creating ? 0.6 : 1,
            }}
          >
            + New session
          </button>
        </div>

        {/* Column headers */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 80px 80px 80px",
            padding: "6px 12px",
            fontSize: 10,
            fontWeight: 500,
            color: "#a0a0a0",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
          }}
        >
          <span>Title</span>
          <span>Status</span>
          <span>Owner</span>
          <span>Threads</span>
        </div>

        {/* Session rows */}
        {sessions.map((s) => {
          const seed = s.ownerName || "Demo";
          const avatarSrc = `https://api.dicebear.com/9.x/pixel-art/svg?seed=${encodeURIComponent(seed)}`;
          return (
            <div
              key={s.id}
              onClick={() =>
                router.push(`/doc?room=${encodeURIComponent(s.roomId)}`)
              }
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 80px 80px 80px",
                padding: "10px 12px",
                borderRadius: 6,
                cursor: "pointer",
                background: "transparent",
                transition: "background 150ms",
                alignItems: "center",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "#ffffff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
              }}
            >
              {/* Col 1 — title */}
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#1a1a1a",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  display: "block",
                  paddingRight: 8,
                }}
              >
                {s.title || "Untitled"}
              </span>

              {/* Col 2 — status pill */}
              <span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    padding: "2px 8px",
                    borderRadius: 10,
                    display: "inline-block",
                    color: "#f59e0b",
                    background: "#fffbeb",
                  }}
                >
                  Planning
                </span>
              </span>

              {/* Col 3 — owner avatar */}
              <span>
                <img
                  src={avatarSrc}
                  alt=""
                  referrerPolicy="no-referrer"
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    display: "block",
                  }}
                />
              </span>

              {/* Col 4 — threads */}
              <span
                style={{
                  fontSize: 11,
                  color: "#a0a0a0",
                }}
              >
                —
              </span>
            </div>
          );
        })}

        {sessions.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "40px 0",
              fontSize: 13,
              color: "#a0a0a0",
            }}
          >
            No sessions yet. Create one above.
          </div>
        )}
      </div>
    </div>
  );
}
