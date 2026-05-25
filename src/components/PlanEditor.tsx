"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
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
import {
  useMutation,
  useOthers,
  useRoom,
  useSelf,
  useStorage,
  useThreads,
} from "@liveblocks/react/suspense";
import { AvatarStack } from "@liveblocks/react-ui";
import "@liveblocks/react-ui/styles.css";
import "@liveblocks/react-tiptap/styles.css";
import "./composer-overrides.css";
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

export type PlanSectionKey =
  | "problem"
  | "whoIsAffected"
  | "whatGoodLooksLike"
  | "openQuestions"
  | "apiGaps"
  | "nextActions";

export type PlanEditorHandle = {
  clearBlockNote: () => void;
  typePlan: (plan: PlanData) => Promise<void>;
  getPlanText: () => string;
  patchSection: (section: PlanSectionKey, newContent: string) => boolean;
};

// ─── Presence item (passed in from DocWorkspace) ──────────────────────────────
export type OthersPresenceItem = {
  name: string;
  section: string | null;
  color: string;
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
  agentStatus?: boolean;
  roomId?: string;
  role?: string;
  othersPresence?: OthersPresenceItem[];
};

type RoleBadgeConfig = {
  label: string;
  background: string;
  color: string;
};

const ROLE_BADGES: Record<string, RoleBadgeConfig> = {
  engineering: {
    label: "Engineering View",
    background: "#eff6ff",
    color: "#2563eb",
  },
  qa: {
    label: "QA View",
    background: "#fef9c3",
    color: "#854d0e",
  },
  design: {
    label: "Design View",
    background: "#fdf4ff",
    color: "#7e22ce",
  },
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

  parts.push(`<h2>Who is affected</h2>`);
  parts.push(`<ul>`);
  for (const item of plan.whoIsAffected ?? []) {
    parts.push(`<li>${escapeHtml(item)}</li>`);
  }
  parts.push(`</ul>`);

  parts.push(`<h2>What good looks like</h2>`);
  parts.push(`<p>${escapeHtml(plan.whatGoodLooksLike ?? "")}</p>`);

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

type CommentBodyShape = {
  content?: {
    type?: string;
    children?: { text?: string }[];
  }[];
};

const SECTION_TITLES: Record<PlanSectionKey, string> = {
  problem: "Problem",
  whoIsAffected: "Who is affected",
  whatGoodLooksLike: "What good looks like",
  openQuestions: "Open questions",
  apiGaps: "API gaps",
  nextActions: "Next",
};

function extractCommentText(body: unknown): string {
  const b = body as CommentBodyShape | null;
  if (!b || !Array.isArray(b.content)) return "";
  return b.content
    .map((block) =>
      Array.isArray(block.children)
        ? block.children.map((c) => c.text ?? "").join("")
        : ""
    )
    .join("\n")
    .trim();
}

// ─── TiptapEditor ─────────────────────────────────────────────────────────────

type TiptapEditorProps = {
  othersPresence: OthersPresenceItem[];
};

const TiptapEditor = forwardRef<PlanEditorHandle, TiptapEditorProps>(
  ({ othersPresence }, ref) => {
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
        StarterKit.configure({ undoRedo: false }),
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

    // ── Thing 3: gapPosted — fires exactly once per room ──────────────────────
    const gapPosted = useStorage((root) => root.gapPosted);
    const gapPostedRef = useRef<boolean>(false);
    useEffect(() => {
      gapPostedRef.current = gapPosted ?? false;
    }, [gapPosted]);

    const markGapPosted = useMutation(({ storage }) => {
      storage.set("gapPosted", true);
    }, []);
    const markGapPostedRef = useRef(markGapPosted);
    markGapPostedRef.current = markGapPosted;

    // ── Thing 2: heading positions for presence overlay ───────────────────────
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [headingPositions, setHeadingPositions] = useState<
      { text: string; top: number }[]
    >([]);

    const measureHeadings = useCallback(() => {
      const host = hostRef.current;
      if (!host) return;
      const h2s = host.querySelectorAll(".ProseMirror h2");
      const hostRect = host.getBoundingClientRect();
      const positions = Array.from(h2s).map((el) => ({
        text: (el.textContent ?? "").trim(),
        top:
          (el as HTMLElement).getBoundingClientRect().top - hostRect.top,
      }));
      setHeadingPositions(positions);
    }, []);

    useEffect(() => {
      if (!editor) return;
      measureHeadings();
      editor.on("update", measureHeadings);
      return () => {
        editor.off("update", measureHeadings);
      };
    }, [editor, measureHeadings]);

    // ── Editability sync ──────────────────────────────────────────────────────
    useEffect(() => {
      if (!editor || !isReady) return;
      const hasContent = editor.getText().trim().length > 0;
      if (hasContent) {
        editor.setEditable(true);
      }
    }, [editor, isReady]);

    // ── Threads / agent-replies ───────────────────────────────────────────────
    const { threads } = useThreads();
    const room = useRoom();
    const self = useSelf();
    const processedCommentIdsRef = useRef<Set<string>>(new Set());
    const seededAgentRepliesRef = useRef(false);
    const challengedThreadIds =
      useStorage((root) => root.challengedThreadIds) ?? [];
    const markThreadChallenged = useMutation(
      ({ storage }, threadId: string) => {
        const current = storage.get("challengedThreadIds") ?? [];
        storage.set("challengedThreadIds", [...current, threadId]);
      },
      []
    );

    useEffect(() => {
      if (!threads) return;
      const selfId = self?.id;

      if (!seededAgentRepliesRef.current) {
        seededAgentRepliesRef.current = true;
        for (const t of threads) {
          for (const c of t.comments) {
            processedCommentIdsRef.current.add(c.id);
          }
        }
        return;
      }

      for (const t of threads) {
        for (const c of t.comments) {
          if (processedCommentIdsRef.current.has(c.id)) continue;
          processedCommentIdsRef.current.add(c.id);

          // Challenger fires on new agent-1 replies.
          if (c.userId === "agent-1") {
            const agentReply = extractCommentText(c.body);
            if (!agentReply || agentReply.trim().length < 10) continue;

            if (challengedThreadIds.includes(t.id)) continue;
            markThreadChallenged(t.id);

            const latestPlanText = editorRef.current?.getText() ?? "";
            void fetch("/api/agent-challenge", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                threadId: t.id,
                agentReply,
                planText: latestPlanText,
                roomId: room.id,
              }),
            }).catch(() => {});
            continue;
          }

          // Agent reply: fires on any user comment that mentions @fabric or
          // is a question. Webhook also covers this server-side; both paths
          // hit the same /api/agent-reply route which dedupes via the
          // classifier + thread state.
          const commentText = extractCommentText(c.body);
          if (!commentText) continue;

          const hasFabricMention = commentText
            .toLowerCase()
            .includes("@fabric");
          const isQuestion =
            commentText.includes("?") ||
            /^(how|why|what|can|does|will|is|should)\b/i.test(
              commentText.trim()
            );

          if (!hasFabricMention && !isQuestion) continue;

          if (c.userId === "agent-1") continue;

          const planText = editorRef.current?.getText() ?? "";
          void fetch("/api/agent-reply", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId: t.id,
              commentText,
              planText,
              roomId: room.id,
            }),
          }).catch(() => {});
        }
      }
    }, [threads, room.id, self?.id]);

    // ── Imperative handle ─────────────────────────────────────────────────────
    useImperativeHandle(
      ref,
      () => ({
        clearBlockNote: () => {
          if (!isReadyRef.current || !editorRef.current) return;
          editorRef.current.commands.clearContent();
        },

        typePlan: async (plan: PlanData) => {
          while (!isReadyRef.current || !editorRef.current) {
            await sleep(50);
          }
          const html = buildPlanHtml(plan);
          editorRef.current.commands.setContent(html);
          editorRef.current.setEditable(true);

          // ── Thing 1 + Thing 3: agent-gap → inline comment ──────────────────
          setTimeout(() => {
            // Skip if gap was already posted for this room (Thing 3).
            if (gapPostedRef.current) return;

            const planText = editorRef.current?.getText() ?? "";
            if (!planText) return;

            void fetch("/api/agent-gap", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                planText,
                chatHistory: [],
                roomId: room.id,
              }),
            })
              .then(async (res) => {
                if (!res.ok) return;
                const data = (await res.json().catch(() => null)) as {
                  gap?: string | null;
                  section?: string | null;
                  nextAction?: string | null;
                  engineeringChecklist?: string[];
                  qaChecklist?: string[];
                  designChecklist?: string[];
                  dataMetrics?: {
                    metric?: string;
                    target?: string;
                    owner?: string;
                    frequency?: string;
                  }[];
                } | null;

                // Append any confidently-generated extra sections to the end
                // of the doc. Each section only appears if its array is non-empty.
                const engineeringChecklist = Array.isArray(
                  data?.engineeringChecklist
                )
                  ? data.engineeringChecklist
                  : [];
                const qaChecklist = Array.isArray(data?.qaChecklist)
                  ? data.qaChecklist
                  : [];
                const designChecklist = Array.isArray(data?.designChecklist)
                  ? data.designChecklist
                  : [];
                const dataMetrics = Array.isArray(data?.dataMetrics)
                  ? data.dataMetrics
                  : [];

                const buildChecklistNodes = (
                  heading: string,
                  items: string[]
                ) => [
                  {
                    type: "heading",
                    attrs: { level: 2 },
                    content: [{ type: "text", text: heading }],
                  },
                  {
                    type: "taskList",
                    content: items.map((item) => ({
                      type: "taskItem",
                      attrs: { checked: false },
                      content: [
                        {
                          type: "paragraph",
                          content: [{ type: "text", text: item }],
                        },
                      ],
                    })),
                  },
                ];

                const extraNodes: Record<string, unknown>[] = [];
                if (engineeringChecklist.length > 0) {
                  extraNodes.push(
                    ...buildChecklistNodes(
                      "Engineering checklist",
                      engineeringChecklist
                    )
                  );
                }
                if (qaChecklist.length > 0) {
                  extraNodes.push(
                    ...buildChecklistNodes("QA checklist", qaChecklist)
                  );
                }
                if (designChecklist.length > 0) {
                  extraNodes.push(
                    ...buildChecklistNodes(
                      "Design checklist",
                      designChecklist
                    )
                  );
                }
                if (dataMetrics.length > 0) {
                  extraNodes.push({
                    type: "heading",
                    attrs: { level: 2 },
                    content: [{ type: "text", text: "Data & metrics" }],
                  });
                  for (const m of dataMetrics) {
                    extraNodes.push({
                      type: "paragraph",
                      content: [
                        {
                          type: "text",
                          text: `${m.metric ?? ""} — ${m.target ?? ""} · ${
                            m.owner ?? ""
                          } · ${m.frequency ?? ""}`,
                        },
                      ],
                    });
                  }
                }

                if (extraNodes.length > 0 && editorRef.current) {
                  const endPos = editorRef.current.state.doc.content.size;
                  editorRef.current
                    .chain()
                    .insertContentAt(endPos, extraNodes)
                    .run();
                }

                if (!data?.gap || !data.gap.trim()) return;
                const gap = data.gap.trim();
                const section =
                  typeof data.section === "string"
                    ? data.section.trim()
                    : "";
                if (!section) {
                  markGapPostedRef.current();
                  return;
                }

                const editorInstance = editorRef.current;
                if (!editorInstance) {
                  markGapPostedRef.current();
                  return;
                }

                // Walk doc to find the matching heading, then the first
                // paragraph after it. Select first ~10 words of that paragraph.
                let headingFound = false;
                let targetFrom = -1;
                let targetTo = -1;

                editorInstance.state.doc.descendants((node, pos) => {
                  if (targetFrom >= 0) return false;

                  if (!headingFound) {
                    if (
                      node.type.name === "heading" &&
                      node.textContent.toLowerCase() ===
                        section.toLowerCase()
                    ) {
                      headingFound = true;
                    }
                    return true;
                  }

                  // After heading — find first paragraph with text.
                  if (
                    node.type.name === "paragraph" &&
                    node.textContent.trim().length > 0
                  ) {
                    const text = node.textContent;
                    const words = text
                      .split(/\s+/)
                      .filter(Boolean)
                      .slice(0, 10);
                    if (words.length > 0) {
                      const selectedLength = words.join(" ").length;
                      targetFrom = pos + 1;
                      targetTo = Math.min(
                        pos + 1 + selectedLength,
                        pos + node.nodeSize - 1
                      );
                    }
                    return false;
                  }
                  return true;
                });

                if (targetFrom >= 0 && targetTo > targetFrom) {
                  editorInstance
                    .chain()
                    .focus()
                    .setTextSelection({ from: targetFrom, to: targetTo })
                    .addPendingComment()
                    .run();

                  setTimeout(() => {
                    try {
                      const composer = document.querySelector(
                        ".lb-composer-editor [contenteditable]"
                      ) as HTMLElement | null;
                      if (composer) {
                        composer.focus();
                        document.execCommand("selectAll", false);
                        document.execCommand("insertText", false, gap);
                      }
                    } catch {
                      // silent fail — one shot only
                    }
                    markGapPostedRef.current();
                  }, 600);
                } else {
                  // No matching paragraph found — still mark to avoid retry.
                  markGapPostedRef.current();
                }
              })
              .catch(() => {
                // silent
              });
          }, 2000);

          // Fade-in animation for plan sections.
          setTimeout(() => {
            const proseMirror = document.querySelector(".ProseMirror");
            if (!proseMirror) return;
            const children = Array.from(proseMirror.children);
            children.forEach((child, i) => {
              const el = child as HTMLElement;
              el.style.opacity = "0";
              el.style.transform = "translateY(6px)";
              el.style.transition = "none";
              setTimeout(() => {
                el.style.transition =
                  "opacity 350ms ease, transform 350ms ease";
                el.style.opacity = "1";
                el.style.transform = "translateY(0)";
              }, 80 + i * 130);
            });
          }, 100);
        },

        getPlanText: () => editorRef.current?.getText() ?? "",

        patchSection: (section, newContent) => {
          const editor = editorRef.current;
          if (!editor) return false;
          const title = SECTION_TITLES[section];
          if (!title) return false;

          let headingEndPos: number | null = null;
          let nextHeadingPos: number | null = null;
          editor.state.doc.descendants((node, pos) => {
            if (node.type.name !== "heading" || node.attrs.level !== 2) {
              return true;
            }
            if (headingEndPos === null) {
              if (node.textContent.trim() === title) {
                headingEndPos = pos + node.nodeSize;
              }
            } else if (nextHeadingPos === null) {
              nextHeadingPos = pos;
            }
            return true;
          });

          if (headingEndPos === null) return false;
          const to =
            nextHeadingPos ?? editor.state.doc.content.size;

          editor
            .chain()
            .deleteRange({ from: headingEndPos, to })
            .insertContentAt(headingEndPos, {
              type: "paragraph",
              content: [{ type: "text", text: newContent }],
            })
            .run();
          return true;
        },
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      []
    );

    // ── Comment row derived values ─────────────────────────────────────────────
    const uniqueCommenterIds: string[] = (() => {
      const result: string[] = [];
      const seen = new Set<string>();
      if (!threads) return result;
      for (const t of threads) {
        const first = t.comments[0];
        if (first && first.userId && !seen.has(first.userId)) {
          seen.add(first.userId);
          result.push(first.userId);
        }
      }
      return result;
    })();
    const totalCommentCount = threads
      ? threads.reduce((sum, t) => sum + t.comments.length, 0)
      : 0;

    // ── Render ────────────────────────────────────────────────────────────────
    return (
      <div ref={hostRef} className={styles.blocknoteHost}>
        {/* Thing 2: presence avatars floating beside each section heading */}
        {headingPositions.map(({ text, top }) => {
          const viewers = othersPresence.filter(
            (p) =>
              p.section &&
              p.section.toLowerCase() === text.toLowerCase()
          );
          if (!viewers.length) return null;
          const shown = viewers.slice(0, 2);
          const extra = viewers.length - 2;
          return (
            <div
              key={text}
              style={{
                position: "absolute",
                right: -32,
                top,
                display: "flex",
                alignItems: "center",
              }}
            >
              {shown.map((v, i) => (
                <img
                  key={v.name + String(i)}
                  src={`https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(v.name)}`}
                  alt=""
                  title={v.name}
                  referrerPolicy="no-referrer"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    border: "2px solid #ffffff",
                    overflow: "hidden",
                    objectFit: "cover",
                    marginLeft: i === 0 ? 0 : -6,
                    position: "relative",
                    zIndex: shown.length - i,
                  }}
                />
              ))}
              {extra > 0 && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#f5f5f5",
                    border: "2px solid #ffffff",
                    marginLeft: -6,
                    fontSize: 9,
                    fontWeight: 500,
                    color: "#6b6b6b",
                    fontFamily: "inherit",
                  }}
                >
                  +{extra}
                </span>
              )}
            </div>
          );
        })}

        {/* Comment count row */}
        {threads && threads.length > 0 ? (
          <>
            <div className={styles.commentRow}>
              <div style={{ display: "flex", alignItems: "center" }}>
                {uniqueCommenterIds.slice(0, 3).map((uid, i) => (
                  <img
                    key={uid}
                    src={`https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(uid)}`}
                    alt=""
                    referrerPolicy="no-referrer"
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      border: "1.5px solid #ffffff",
                      marginLeft: i === 0 ? 0 : -4,
                      display: "inline-block",
                      objectFit: "cover",
                    }}
                  />
                ))}
              </div>
              <span className={styles.planningLabel}>
                {totalCommentCount}{" "}
                {totalCommentCount === 1 ? "comment" : "comments"}
              </span>
            </div>
          </>
        ) : null}

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
          <Toolbar.Button
            name="Comment"
            onClick={() => editor?.chain().focus().addPendingComment().run()}
          />
        </FloatingToolbar>
        <FloatingComposer editor={editor} />
        <FloatingThreads editor={editor} threads={threads} />
      </div>
    );
  }
);
TiptapEditor.displayName = "TiptapEditor";

// ─── PlanEditor (outer shell) ─────────────────────────────────────────────────

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
      agentStatus = false,
      roomId,
      role,
      othersPresence = [],
    },
    ref
  ) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    const others = useOthers();
    const roleBadge = role ? ROLE_BADGES[role] : undefined;
    const [copied, setCopied] = useState(false);
    void copied;

    const handleShare = useCallback(async () => {
      if (!roomId || typeof window === "undefined") return;
      const url = `${window.location.origin}/doc?room=${encodeURIComponent(
        roomId
      )}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        window.prompt("Copy this link:", url);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }, [roomId]);

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
    const cursorOnTitle = isAgentTyping && !hasLines && !isMakingPlan;
    const agentWritingBullet = othersPresence.some(
      (p) => p.section === "writing-bullet"
    );

    return (
      <>
        <div
          className={
            isUpdating
              ? `${styles.editorWrap} ${styles.isUpdating}`
              : styles.editorWrap
          }
        >
          {/* Doc header: agent status, role badge, avatars, share */}
          <div
            style={{
              marginLeft: -72,
              marginRight: -72,
              padding: "20px 24px",
              marginBottom: 24,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 11,
                color: agentStatus ? "#6b7280" : "#a0a0a0",
                lineHeight: 1,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: agentStatus ? "#6b7280" : "#c0bfbc",
                  display: "inline-block",
                }}
              />
              <span>
                {agentStatus ? "Agent 1 is planning" : "Agent 1 listening"}
              </span>
              {roleBadge ? (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    padding: "2px 8px",
                    borderRadius: 4,
                    marginLeft: 8,
                    background: roleBadge.background,
                    color: roleBadge.color,
                    lineHeight: 1.4,
                    fontFamily: "inherit",
                  }}
                >
                  {roleBadge.label}
                </span>
              ) : null}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <button
                type="button"
                onClick={handleShare}
                style={{
                  border: "none",
                  background: "transparent",
                  padding: 0,
                  cursor: "pointer",
                  color: "#808080",
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "inherit",
                  lineHeight: 1,
                }}
              >
                Invite
              </button>

              <div style={{ display: "flex", alignItems: "center" }}>
                <AvatarStack max={4} />
              </div>
            </div>
          </div>

          {isUpdating ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginBottom: 8,
              }}
            >
              <img
                src="https://api.dicebear.com/9.x/pixel-art/svg?seed=Agent1"
                alt=""
                referrerPolicy="no-referrer"
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: "50%",
                  display: "block",
                }}
              />
              <span style={{ fontSize: 11, color: "#a0a0a0" }}>
                Agent 1 is writing...
              </span>
            </div>
          ) : null}

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
              {planLines.map((line, index) => {
                const isLast = index === planLines.length - 1;
                return (
                  <div key={index} className={styles.planLineRow}>
                    <p className={styles.planLine}>{line}</p>
                    {isLast && agentWritingBullet ? (
                      <img
                        src="https://api.dicebear.com/9.x/pixel-art/svg?seed=Agent1"
                        alt=""
                        referrerPolicy="no-referrer"
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          marginLeft: "auto",
                          alignSelf: "center",
                          display: "block",
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          {renderUpdatingText ? (
            <div
              style={{
                fontSize: 13,
                color: "#6b7280",
                marginBottom: 16,
                opacity: isMakingPlan ? 1 : 0,
                transition: "opacity 300ms ease",
              }}
            >
              Agent 1 is updating the plan...
            </div>
          ) : null}

          {mounted ? (
            <TiptapEditor ref={composedRef} othersPresence={othersPresence} />
          ) : null}
        </div>
      </>
    );
  }
);
