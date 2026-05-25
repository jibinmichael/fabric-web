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
        const selfName =
          typeof window !== "undefined"
            ? window.localStorage.getItem("fabric_user_name") || "Anonymous"
            : "Anonymous";
        const selfAvatar =
          "https://api.dicebear.com/9.x/pixel-art/svg?seed=" +
          encodeURIComponent(selfName);
        return userIds.map((id) => {
          if (id === "agent-1") {
            return {
              name: "Agent 1",
              avatar: "https://api.dicebear.com/9.x/pixel-art/svg?seed=Agent1",
              color: "#22c55e",
            };
          }
          return {
            name: selfName,
            avatar: selfAvatar,
            color: "#22c55e",
          };
        });
      }}
    >
      <RoomProvider
        id={roomId}
        initialPresence={{ viewingSection: null }}
        initialStorage={{
          ownerId: "",
          docTitle: "",
          gapPosted: false,
          planJson: "",
          planLines: [],
          chatMessages: [],
          roomChat: [],
        }}
      >
        <ClientSideSuspense fallback={null}>{children}</ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}
