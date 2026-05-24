"use client";

import type { ReactNode } from "react";
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from "@liveblocks/react/suspense";

export function LiveblocksRoom({
  roomId,
  children,
}: {
  roomId: string;
  children: ReactNode;
}) {
  return (
    <LiveblocksProvider
      authEndpoint="/api/liveblocks-auth"
      resolveUsers={async ({ userIds }) => {
        try {
          const res = await fetch("/api/liveblocks-auth/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userIds }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              users?: ({ name: string; avatar?: string; color?: string } | null)[];
            };
            if (Array.isArray(data.users)) {
              return data.users.map((u) =>
                u
                  ? {
                      name: u.name,
                      avatar: u.avatar ?? "",
                      color: u.color ?? "#666666",
                    }
                  : undefined
              );
            }
          }
        } catch {
          // fall through to undefined array
        }
        return userIds.map(() => undefined);
      }}
    >
      <RoomProvider
        id={roomId}
        initialPresence={{}}
        initialStorage={{
          docTitle: "",
          planJson: "",
          planLines: [],
          chatMessages: [],
        }}
      >
        <ClientSideSuspense fallback={null}>{children}</ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}
