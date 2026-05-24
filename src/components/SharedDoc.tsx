"use client";

import { useEffect, useState } from "react";
import {
  LiveblocksProvider,
  RoomProvider,
  ClientSideSuspense,
  useStorage,
} from "@liveblocks/react/suspense";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { useLiveblocksExtension } from "@liveblocks/react-tiptap";
import "@liveblocks/react-ui/styles.css";
import "@liveblocks/react-tiptap/styles.css";
import styles from "./PlanEditor.module.css";

export function SharedDoc({ roomId }: { roomId: string }) {
  return (
    <LiveblocksProvider authEndpoint="/api/liveblocks-public">
      <RoomProvider id={roomId} initialPresence={{}}>
        <ClientSideSuspense fallback={<Fallback />}>
          <SharedDocBody />
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}

function Fallback() {
  return (
    <div
      style={{
        padding: 48,
        textAlign: "center",
        color: "#999",
        fontFamily: '"Sentinel", Georgia, "Times New Roman", serif',
        fontSize: 13,
      }}
    >
      Loading…
    </div>
  );
}

function SharedDocBody() {
  const docTitle = useStorage((root) => root.docTitle);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div
      style={{
        margin: "0 auto",
        maxWidth: 720,
        padding: 48,
        background: "#FFFFFF",
        minHeight: "100vh",
        boxSizing: "border-box",
      }}
    >
      {docTitle ? (
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: "#1a1a1a",
            marginBottom: 32,
            fontFamily: '"Sentinel", Georgia, "Times New Roman", serif',
          }}
        >
          {docTitle}
        </div>
      ) : null}
      <div
        className={styles.editorWrap}
        style={{ padding: 0, height: "auto", minHeight: 0, maxHeight: "none" }}
      >
        {mounted ? <SharedTiptap /> : null}
      </div>
    </div>
  );
}

function SharedTiptap() {
  const liveblocks = useLiveblocksExtension();
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [
      liveblocks,
      StarterKit.configure({ undoRedo: false }),
      TaskList,
      TaskItem.configure({ nested: false }),
    ],
  });

  return <EditorContent editor={editor} />;
}
