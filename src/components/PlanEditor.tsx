"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import {
  useLiveblocksExtension,
  useIsEditorReady,
  FloatingToolbar,
  FloatingComposer,
  FloatingThreads,
  Toolbar,
} from "@liveblocks/react-tiptap";
import { useThreads } from "@liveblocks/react/suspense";
import "@liveblocks/react-ui/styles.css";
import "@liveblocks/react-tiptap/styles.css";
import styles from "./PlanEditor.module.css";

export type PlanData = {
  problem: string;
  whoIsAffected: string[];
  whatGoodLooksLike: string;
  openQuestions: string[];
  answeredQuestions: string[];
  apiGaps: string[];
  nextActions: string[];
};

export type PlanEditorHandle = {
  clearBlockNote: () => void;
  typePlan: (plan: PlanData) => Promise<void>;
  getPlanText: () => string;
};

type PlanEditorProps = {
  userEmail: string;
  userName: string;
  userAvatar: string;
  streamingTitle: string;
  isAgentTyping: boolean;
  planLines: string[];
  isMakingPlan: boolean;
  isUpdating: boolean;
  planReady: boolean;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildPlanHtml(plan: PlanData): string {
  const parts: string[] = [];

  parts.push(`<h2>Problem</h2>`);
  parts.push(`<p>${escapeHtml(plan.problem ?? "")}</p>`);

  parts.push(`<hr>`);
  parts.push(`<h2>Who is affected</h2>`);
  parts.push(`<ul>`);
  for (const item of plan.whoIsAffected ?? []) {
    parts.push(`<li>${escapeHtml(item)}</li>`);
  }
  parts.push(`</ul>`);

  parts.push(`<hr>`);
  parts.push(`<h2>What good looks like</h2>`);
  parts.push(`<p>${escapeHtml(plan.whatGoodLooksLike ?? "")}</p>`);

  parts.push(`<hr>`);
  parts.push(`<h2>Open questions</h2>`);
  parts.push(`<ul data-type="taskList">`);
  for (const q of plan.openQuestions ?? []) {
    parts.push(
      `<li data-type="taskItem" data-checked="false"><p>${escapeHtml(q)}</p></li>`
    );
  }
  for (const q of plan.answeredQuestions ?? []) {
    parts.push(
      `<li data-type="taskItem" data-checked="true"><p>${escapeHtml(q)}</p></li>`
    );
  }
  parts.push(`</ul>`);

  if (plan.apiGaps && plan.apiGaps.length > 0) {
    parts.push(`<hr>`);
    parts.push(`<h2>API gaps</h2>`);
    for (const gap of plan.apiGaps) {
      const cleanGap = gap
        .replace(/[⚠️△]/g, "")
        .replace(/^\s*GAP\s*:?\s*/i, "")
        .trim();
      parts.push(
        `<p style="color: #dc2626; font-size: 14px; line-height: 1.7;">* ${escapeHtml(cleanGap)}</p>`
      );
    }
  }

  parts.push(`<hr>`);
  parts.push(`<h2>Next</h2>`);
  parts.push(`<ul data-type="taskList">`);
  for (const action of plan.nextActions ?? []) {
    parts.push(
      `<li data-type="taskItem" data-checked="false"><p>${escapeHtml(action)}</p></li>`
    );
  }
  parts.push(`</ul>`);

  return parts.join("\n");
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function GradientStar({ size = 14 }: { size?: number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        fontSize: size,
        background:
          "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)",
        WebkitBackgroundClip: "text",
        backgroundClip: "text",
        color: "transparent",
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      ✦
    </span>
  );
}

type AskMessage = { role: "user" | "assistant"; content: string };

function AskPanel({
  planHandle,
}: {
  planHandle: React.RefObject<PlanEditorHandle | null>;
}) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    messagesScrollRef.current?.scrollTo({
      top: messagesScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming, open]);

  const handleSend = async () => {
    const q = input.trim();
    if (!q || loading) return;

    const planText = planHandle.current?.getPlanText() ?? "";
    const userMessage: AskMessage = { role: "user", content: q };
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setStreaming("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `Context - this is the plan: ${planText}\n\nQuestion: ${q}`,
            },
          ],
        }),
      });
      if (!res.ok) throw new Error("Request failed");

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");
      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            try {
              const data = JSON.parse(line.slice(5).trim()) as {
                delta?: string;
                error?: string;
              };
              if (typeof data.delta === "string") {
                fullText += data.delta;
                setStreaming(fullText);
              }
            } catch {
              // skip malformed event
            }
          }
        }
        if (done) break;
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: fullText },
      ]);
      setStreaming("");
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to load" },
      ]);
      setStreaming("");
    } finally {
      setLoading(false);
    }
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          position: "fixed",
          bottom: 24,
          left: "70vw",
          transform: "translateX(-50%)",
          zIndex: 100,
          background: "#ffffff",
          color: "#1a1a1a",
          fontSize: 13,
          fontWeight: 400,
          padding: "8px 18px",
          borderRadius: 20,
          border: "0.5px solid #e0e0e0",
          cursor: "pointer",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
          fontFamily: '"Sentinel", Georgia, "Times New Roman", serif',
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          whiteSpace: "nowrap",
        }}
      >
        <GradientStar size={14} />
        <span style={{ color: "#1a1a1a" }}>Ask about this plan</span>
      </button>
      {open ? (
        <div
          style={{
            position: "fixed",
            bottom: 70,
            left: "70vw",
            transform: "translateX(-50%)",
            width: 520,
            maxHeight: 360,
            background: "#ffffff",
            borderRadius: 12,
            boxShadow: "0 8px 32px rgba(0,0,0,0.12)",
            border: "0.5px solid #e5e5e5",
            zIndex: 101,
            overflow: "hidden",
            display: "flex",
            flexDirection: "column",
            fontFamily: '"Sentinel", Georgia, "Times New Roman", serif',
            fontWeight: 400,
            color: "#1a1a1a",
          }}
        >
          <div
            style={{
              padding: "12px 16px",
              borderBottom: "1px solid #eeeeee",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexShrink: 0,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 13,
                color: "#1a1a1a",
              }}
            >
              <GradientStar size={14} />
              <span>Ask about this plan</span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{
                background: "transparent",
                border: "none",
                color: "#999",
                fontSize: 16,
                cursor: "pointer",
                padding: 0,
                lineHeight: 1,
                fontFamily: "inherit",
              }}
            >
              ×
            </button>
          </div>
          <div
            ref={messagesScrollRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "12px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {messages.map((m, i) =>
              m.role === "user" ? (
                <div
                  key={i}
                  style={{
                    alignSelf: "flex-end",
                    maxWidth: "80%",
                    padding: "8px 12px",
                    fontSize: 13,
                    fontWeight: 400,
                    lineHeight: 1.6,
                    borderRadius: 8,
                    background: "#f5f5f5",
                    color: "#1a1a1a",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </div>
              ) : (
                <div
                  key={i}
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    lineHeight: 1.6,
                    color: "#1a1a1a",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {m.content}
                </div>
              )
            )}
            {loading && !streaming ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 13,
                  fontWeight: 400,
                  color: "#999999",
                }}
              >
                <GradientStar size={14} />
                <span>Thinking...</span>
              </div>
            ) : null}
            {streaming ? (
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  lineHeight: 1.6,
                  color: "#1a1a1a",
                  whiteSpace: "pre-wrap",
                }}
              >
                {streaming}
              </div>
            ) : null}
          </div>
          <div
            style={{
              borderTop: "1px solid #eeeeee",
              padding: "10px 16px",
              flexShrink: 0,
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Ask a follow-up..."
              disabled={loading}
              style={{
                width: "100%",
                border: "none",
                outline: "none",
                fontSize: 13,
                fontWeight: 400,
                fontFamily: "inherit",
                background: "transparent",
                color: "#1a1a1a",
              }}
            />
          </div>
        </div>
      ) : null}
    </>,
    document.body
  );
}

const TiptapEditor = forwardRef<PlanEditorHandle>((_, ref) => {
    const liveblocks = useLiveblocksExtension();
    const editor = useEditor({
      immediatelyRender: false,
      editable: false,
      enableContentCheck: true,
      onContentError: ({ editor, error, disableCollaboration }) => {
        disableCollaboration();
        editor.setEditable(false, false);
        console.error("[PlanEditor] tiptap content validation error:", error);
      },
      extensions: [
        liveblocks,
        StarterKit.configure({
          // Liveblocks extension manages history; must be disabled per skill docs
          undoRedo: false,
        }),
        TaskList,
        TaskItem.configure({ nested: false }),
        Placeholder.configure({
          placeholder: "I will make plans as we brainstorm",
        }),
      ],
    });

    const isReady = useIsEditorReady();
    const isReadyRef = useRef(false);
    isReadyRef.current = isReady;
    const editorRef = useRef<Editor | null>(null);
    editorRef.current = editor;

    useEffect(() => {
      if (!editor || !isReady) return;
      const hasContent = editor.getText().trim().length > 0;
      if (hasContent) {
        editor.setEditable(true);
      }
    }, [editor, isReady]);

    const { threads } = useThreads();

    useImperativeHandle(
      ref,
      () => ({
        clearBlockNote: () => {
          if (!isReadyRef.current || !editorRef.current) {
            return;
          }
          editorRef.current.commands.clearContent();
        },
        typePlan: async (plan: PlanData) => {
          while (!isReadyRef.current || !editorRef.current) {
            await sleep(50);
          }
          const html = buildPlanHtml(plan);
          editorRef.current.commands.setContent(html);
          editorRef.current.setEditable(true);
        },
        getPlanText: () => editorRef.current?.getText() ?? "",
      }),
      []
    );

    return (
      <div className={styles.blocknoteHost}>
        <EditorContent editor={editor} />
        <FloatingToolbar editor={editor}>
          <Toolbar.Toggle
            name="Bold"
            shortcut="CMD-B"
            active={editor?.isActive("bold") ?? false}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          />
          <Toolbar.Toggle
            name="Italic"
            shortcut="CMD-I"
            active={editor?.isActive("italic") ?? false}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          />
          <Toolbar.Toggle
            name="Bullet list"
            active={editor?.isActive("bulletList") ?? false}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          />
          <Toolbar.Toggle
            name="Task list"
            active={editor?.isActive("taskList") ?? false}
            onClick={() => editor?.chain().focus().toggleTaskList().run()}
          />
        </FloatingToolbar>
        <FloatingComposer editor={editor} />
        <FloatingThreads editor={editor} threads={threads} />
      </div>
    );
  }
);
TiptapEditor.displayName = "TiptapEditor";

export const PlanEditor = forwardRef<PlanEditorHandle, PlanEditorProps>(
  function PlanEditor(
    {
      userName,
      userAvatar,
      streamingTitle,
      isAgentTyping,
      planLines,
      isMakingPlan,
      isUpdating,
      planReady,
    },
    ref
  ) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const innerHandleRef = useRef<PlanEditorHandle | null>(null);
    const composedRef = useCallback(
      (handle: PlanEditorHandle | null) => {
        innerHandleRef.current = handle;
        if (typeof ref === "function") {
          ref(handle);
        } else if (ref) {
          (ref as React.MutableRefObject<PlanEditorHandle | null>).current =
            handle;
        }
      },
      [ref]
    );

    const [renderUpdatingText, setRenderUpdatingText] = useState(false);
    useEffect(() => {
      if (isMakingPlan) {
        setRenderUpdatingText(true);
        return;
      }
      if (renderUpdatingText) {
        const t = setTimeout(() => setRenderUpdatingText(false), 300);
        return () => clearTimeout(t);
      }
    }, [isMakingPlan, renderUpdatingText]);

    const hasTitle = streamingTitle.length > 0;
    const hasLines = planLines.length > 0 && !planReady && !isMakingPlan;
    const cursorOnTitle =
      isAgentTyping && !hasLines && !isMakingPlan;

    const initial = (userName || "U").trim().charAt(0);

    return (
      <>
      <div
        className={
          isUpdating
            ? `${styles.editorWrap} ${styles.isUpdating}`
            : styles.editorWrap
        }
      >
        <div className={styles.userBar}>
          {userAvatar ? (
            <img
              src={userAvatar}
              alt=""
              className={styles.userAvatar}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className={styles.userAvatarFallback} aria-hidden>
              {initial}
            </span>
          )}
          <span className={styles.userName}>
            {userName || "Signed in"}
          </span>
          <span className={styles.dotSep} aria-hidden>
            ·
          </span>
          <span className={styles.planningLabel}>Planning</span>
        </div>

        {hasTitle ? (
          <div className={styles.titleRow}>
            <span className={styles.titleText}>{streamingTitle}</span>
            {cursorOnTitle ? (
              <span className={styles.cursorWrap}>
                <span className={styles.cursor} aria-hidden />
              </span>
            ) : null}
          </div>
        ) : null}

        {hasLines ? (
          <div className={styles.planLines}>
            {planLines.map((line, index) => (
              <div key={index} className={styles.planLineRow}>
                <p className={styles.planLine}>{line}</p>
              </div>
            ))}
          </div>
        ) : null}

        {renderUpdatingText ? (
          <div
            style={{
              fontSize: 13,
              color: "#22c55e",
              marginBottom: 16,
              opacity: isMakingPlan ? 1 : 0,
              transition: "opacity 300ms ease",
            }}
          >
            Agent 1 is updating the plan...
          </div>
        ) : null}

        {mounted ? <TiptapEditor ref={composedRef} /> : null}
      </div>
      {planReady ? <AskPanel planHandle={innerHandleRef} /> : null}
      </>
    );
  }
);
