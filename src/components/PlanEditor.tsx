"use client";

import {
  forwardRef,
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
  AiToolbar,
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
      parts.push(
        `<p style="color: #dc2626; font-size: 14px; line-height: 1.7;">* ${escapeHtml(gap)}</p>`
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

const TiptapEditor = forwardRef<PlanEditorHandle>((_, ref) => {
    const liveblocks = useLiveblocksExtension({ ai: true });
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
        <AiToolbar
          editor={editor}
          suggestions={
            <>
              <AiToolbar.Suggestion prompt="Explain this">
                Explain this
              </AiToolbar.Suggestion>
              <AiToolbar.Suggestion prompt="Is this buildable in Wati?">
                Is this buildable in Wati?
              </AiToolbar.Suggestion>
            </>
          }
        />
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

        {mounted ? <TiptapEditor ref={ref} /> : null}
      </div>
    );
  }
);
