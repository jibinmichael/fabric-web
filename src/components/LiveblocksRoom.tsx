"use client";

import type { ReactNode } from "react";
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
} from "@liveblocks/react/suspense";

export const ROOM_ID = "fabricv3:doc-1";

export function LiveblocksRoom({ children }: { children: ReactNode }) {
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-auth">
      <RoomProvider
        id={ROOM_ID}
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
