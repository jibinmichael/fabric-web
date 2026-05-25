"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from "@liveblocks/react/suspense";

const ADJECTIVES = [
  "Sharp",
  "Clear",
  "Bold",
  "Quick",
  "Bright",
  "Swift",
  "Keen",
  "Calm",
];

const NOUNS = [
  "Thinker",
  "Planner",
  "Builder",
  "Maker",
  "Solver",
  "Finder",
  "Mover",
];

const STORAGE_NAME_KEY = "fabric_user_name";

function randomName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

function getOrCreateUserName(): string {
  if (typeof window === "undefined") return "";
  try {
    const stored = window.localStorage.getItem(STORAGE_NAME_KEY);
    if (stored && stored.trim().length > 0) return stored;
    const name = randomName();
    window.localStorage.setItem(STORAGE_NAME_KEY, name);
    return name;
  } catch {
    return randomName();
  }
}

export function LiveblocksRoom({
  roomId,
  children,
}: {
  roomId: string;
  children: ReactNode;
}) {
  const nameRef = useRef<string>("");
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    nameRef.current = getOrCreateUserName();
    setResolved(true);
  }, []);

  if (!resolved) {
    return null;
  }

  return (
    <LiveblocksProvider
      authEndpoint={async (room) => {
        const res = await fetch("/api/liveblocks-auth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ room, name: nameRef.current }),
        });
        return await res.json();
      }}
      resolveUsers={async ({ userIds }) => {
        return userIds.map((userId) => {
          if (userId === "agent-1") {
            return {
              name: "Agent 1",
              avatar: "https://api.dicebear.com/9.x/thumbs/svg?seed=Agent1",
              color: "#22c55e",
            };
          } else if (userId === "fabric") {
            return {
              name: "fabric",
              avatar:
                "https://api.dicebear.com/9.x/pixel-art/svg?seed=fabric",
              color: "#2563eb",
            };
          } else if (userId === "challenger-1") {
            return {
              name: "Challenger",
              avatar:
                "https://api.dicebear.com/9.x/pixel-art/svg?seed=Challenger1",
              color: "#ef4444",
            };
          } else {
            return {
              name: userId.slice(0, 12),
              avatar: `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(userId)}`,
              color: "#6b7280",
            };
          }
        });
      }}
    >
      <RoomProvider
        id={roomId}
        initialPresence={{ viewingSection: null, cursor: null }}
        initialStorage={{
          ownerId: "",
          docTitle: "",
          gapPosted: false,
          planJson: "",
          planLines: [],
          chatMessages: [],
          challengedThreadIds: [],
        }}
      >
        <ClientSideSuspense fallback={null}>{children}</ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}
