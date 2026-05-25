"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Plus, Search } from "lucide-react";
import {
  useMutation,
  useOthers,
  useSelf,
  useStorage,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";
import { Cursors } from "@liveblocks/react-ui";
import { ChatPanel, type ConversationTurn } from "./ChatPanel";
import chatStyles from "./ChatPanel.module.css";
import {
  PlanEditor,
  type OthersPresenceItem,
  type PlanData,
  type PlanEditorHandle,
  type PlanSectionKey,
} from "./PlanEditor";
import { LiveblocksRoom } from "./LiveblocksRoom";

type JoinerAttachment =
  | {
      kind: "image";
      base64: string;
      mediaType: string;
      name: string;
      previewUrl: string;
    }
  | {
      kind: "text";
      name: string;
      content: string;
    };

type JoinerApiContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

type JoinerMessage = {
  role: "user" | "assistant";
  content: string;
  attachment?: JoinerAttachment;
};

const JOINER_WELCOME: JoinerMessage = {
  role: "assistant",
  content:
    "The plan is ready. Ask me anything about it — I'll answer from the right perspective automatically.",
};

function joinerReadAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function joinerReadAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function JoinerChat({
  planEditorRef,
}: {
  planEditorRef: React.RefObject<PlanEditorHandle | null>;
}) {
  const [messages, setMessages] = useState<JoinerMessage[]>([JOINER_WELCOME]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [planUpdated, setPlanUpdated] = useState(false);
  const [pendingAttachment, setPendingAttachment] =
    useState<JoinerAttachment | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileSelect = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) return;
      if (file.type.startsWith("image/")) {
        try {
          const dataUrl = await joinerReadAsDataURL(file);
          const base64 = dataUrl.split(",")[1] ?? "";
          setPendingAttachment({
            kind: "image",
            base64,
            mediaType: file.type || "image/jpeg",
            name: file.name,
            previewUrl: dataUrl,
          });
        } catch {
          // skip unreadable file
        }
      } else {
        try {
          const content = await joinerReadAsText(file);
          setPendingAttachment({
            kind: "text",
            name: file.name,
            content: content.slice(0, 50000),
          });
        } catch {
          // skip unreadable file
        }
      }
    },
    []
  );

  const handleSend = useCallback(async () => {
    const q = input.trim();
    if ((!q && !pendingAttachment) || loading) return;
    const planText = planEditorRef.current?.getPlanText() ?? "";
    const attachmentToSend = pendingAttachment;

    setMessages((prev) => [
      ...prev,
      {
        role: "user",
        content: q,
        attachment: attachmentToSend ?? undefined,
      },
    ]);
    setInput("");
    setPendingAttachment(null);
    setStreaming("");
    setLoading(true);

    let apiContent: string | JoinerApiContentBlock[];
    if (attachmentToSend?.kind === "image") {
      const blocks: JoinerApiContentBlock[] = [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: attachmentToSend.mediaType,
            data: attachmentToSend.base64,
          },
        },
      ];
      if (q) {
        blocks.push({ type: "text", text: q });
      }
      apiContent = blocks;
    } else if (attachmentToSend?.kind === "text") {
      const prefix = `[Attachment: ${attachmentToSend.name}]\n${attachmentToSend.content}`;
      apiContent = q ? `${prefix}\n\n${q}` : prefix;
    } else {
      apiContent = q;
    }

    try {
      const res = await fetch("/api/chat/clarify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: apiContent }],
          planContext: planText,
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

      // Best-effort plan patch: if the joiner Q&A revealed new information,
      // let the agent decide whether to update one or more plan sections.
      if (fullText && q) {
        const planSnapshot = planEditorRef.current?.getPlanText() ?? "";
        const VALID_SECTIONS: PlanSectionKey[] = [
          "problem",
          "whoIsAffected",
          "whatGoodLooksLike",
          "openQuestions",
          "apiGaps",
          "nextActions",
        ];
        void fetch("/api/plan/patch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationText: `User: ${q}\nAgent: ${fullText}`,
            currentPlan: planSnapshot,
          }),
        })
          .then(async (res) => {
            if (!res.ok) return;
            const data = (await res.json().catch(() => null)) as {
              shouldUpdate?: boolean;
              updates?: { section?: string; newContent?: string }[];
            } | null;
            if (!data?.shouldUpdate || !data.updates?.length) return;
            let appliedAny = false;
            for (const update of data.updates) {
              if (!update.section || !update.newContent) continue;
              if (
                !VALID_SECTIONS.includes(update.section as PlanSectionKey)
              ) {
                continue;
              }
              planEditorRef.current?.patchSection(
                update.section as PlanSectionKey,
                update.newContent
              );
              appliedAny = true;
            }
            if (appliedAny) {
              setPlanUpdated(true);
              setTimeout(() => setPlanUpdated(false), 2000);
            }
          })
          .catch(() => {
            // best-effort, ignore errors
          });
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Failed to load" },
      ]);
      setStreaming("");
    } finally {
      setLoading(false);
    }
  }, [input, loading, pendingAttachment, planEditorRef]);

  return (
    <div className={chatStyles.chatPanel} style={{ position: "relative" }}>
      {planUpdated ? (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(0,0,0,0.85)",
            color: "#ffffff",
            fontSize: 12,
            fontWeight: 500,
            padding: "5px 10px",
            borderRadius: 6,
            zIndex: 10,
            pointerEvents: "none",
            fontFamily: "inherit",
          }}
        >
          ✦ Plan updated
        </div>
      ) : null}
      <div className={chatStyles.messages} ref={scrollRef}>
        <div className={chatStyles.messageList}>
          {messages.map((m, i) =>
            m.role === "user" ? (
              <div key={i} className={chatStyles.userMessage}>
                {m.attachment ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginBottom: m.content ? 8 : 0,
                    }}
                  >
                    {m.attachment.kind === "image" ? (
                      <img
                        src={m.attachment.previewUrl}
                        alt={m.attachment.name}
                        style={{
                          width: 80,
                          height: 80,
                          borderRadius: 6,
                          objectFit: "cover",
                          display: "block",
                        }}
                      />
                    ) : (
                      <span
                        title={m.attachment.name}
                        style={{
                          display: "inline-block",
                          padding: "4px 8px",
                          background: "rgba(0,0,0,0.06)",
                          borderRadius: 6,
                          fontSize: 12,
                          color: "#1a1a1a",
                          maxWidth: 220,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        📎 {m.attachment.name}
                      </span>
                    )}
                  </div>
                ) : null}
                {m.content}
              </div>
            ) : (
              <div key={i} className={chatStyles.agentRow}>
                <span className={chatStyles.agentAvatar} aria-hidden />
                <div className={chatStyles.assistantMessage}>{m.content}</div>
              </div>
            )
          )}
          {loading && !streaming ? (
            <div className={chatStyles.thinkingIndicator}>
              <span className={chatStyles.thinkingDots}>
                <span className={chatStyles.thinkingDot}>•</span>
                <span className={chatStyles.thinkingDot}>•</span>
                <span className={chatStyles.thinkingDot}>•</span>
              </span>
            </div>
          ) : null}
          {streaming ? (
            <div className={chatStyles.agentRow}>
              <span className={chatStyles.agentAvatar} aria-hidden />
              <div className={chatStyles.assistantMessage}>{streaming}</div>
            </div>
          ) : null}
        </div>
      </div>
      <div className={chatStyles.inputRegion}>
        {pendingAttachment ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 8,
            }}
          >
            <div
              style={{
                position: "relative",
                display: "inline-flex",
                alignItems: "center",
              }}
            >
              {pendingAttachment.kind === "image" ? (
                <img
                  src={pendingAttachment.previewUrl}
                  alt={pendingAttachment.name}
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 6,
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <span
                  title={pendingAttachment.name}
                  style={{
                    display: "inline-block",
                    padding: "4px 10px",
                    background: "#f0f0f0",
                    borderRadius: 6,
                    fontSize: 12,
                    color: "#1a1a1a",
                    maxWidth: 220,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  📎 {pendingAttachment.name}
                </span>
              )}
              <button
                type="button"
                onClick={() => setPendingAttachment(null)}
                aria-label="Remove attachment"
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  width: 18,
                  height: 18,
                  borderRadius: 9999,
                  background: "#1a1a1a",
                  color: "#ffffff",
                  border: "none",
                  fontSize: 11,
                  lineHeight: 1,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  fontFamily: "inherit",
                }}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}
        <div className={chatStyles.inputWrap}>
          <span className={chatStyles.prompt} aria-hidden>
            ›
          </span>
          <textarea
            className={chatStyles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() === "/attach") {
                  setInput("");
                  openFilePicker();
                  return;
                }
                void handleSend();
              }
            }}
            placeholder="Ask about this plan..."
            rows={1}
            disabled={loading}
          />
        </div>

        <div className={chatStyles.footer}>
          <span className={chatStyles.footerHint}>enter to send</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            className={chatStyles.footerAction}
            onClick={openFilePicker}
          >
            /attach
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          accept="image/*,.pdf"
          onChange={handleFileSelect}
        />
      </div>
    </div>
  );
}

type DocWorkspaceProps = {
  userEmail: string;
  userName: string;
  userAvatar: string;
  roomId: string;
  role?: string;
};

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

function formatConversation(turns: ConversationTurn[]): string {
  return turns
    .map(
      (turn) =>
        `${turn.role === "user" ? "User" : "Agent"}: ${turn.content}`
    )
    .join("\n");
}

export function DocWorkspace(props: DocWorkspaceProps) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      <div className="flex min-w-0 flex-1 flex-col">
        <LiveblocksRoom roomId={props.roomId}>
          <DocBody {...props} />
        </LiveblocksRoom>
      </div>
    </div>
  );
}

function DocBody({
  userEmail,
  userName,
  userAvatar,
  roomId,
  role,
}: DocWorkspaceProps) {
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/sessions", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as {
          sessions?: { id: string; roomId: string }[];
        };
        const match = Array.isArray(data.sessions)
          ? data.sessions.find((s) => s.roomId === roomId)
          : undefined;
        if (match && !cancelled) {
          setCurrentSessionId(match.id);
        }
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [roomId]);
  const storedDocTitle = useStorage((root) => root.docTitle);
  const storedPlanJson = useStorage((root) => root.planJson);
  const storedPlanLines = useStorage((root) => root.planLines);
  const storedChatMessages = useStorage((root) => root.chatMessages);
  const storedOwnerId = useStorage((root) => root.ownerId);
  const self = useSelf();

  // ── Search command palette ─────────────────────────────────────────────────
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [searchSessions, setSearchSessions] = useState<any[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === "Escape") setShowSearch(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!showSearch) return;
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setSearchSessions(d.sessions ?? []))
      .catch(() => {});
    setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [showSearch]);

  // ── Thing 2: presence tracking ─────────────────────────────────────────────
  const updateMyPresence = useUpdateMyPresence();
  const others = useOthers();
  const othersPresence: OthersPresenceItem[] = others.map((o) => ({
    name:
      typeof o.info?.name === "string" && o.info.name
        ? o.info.name
        : "Anonymous",
    section: o.presence?.viewingSection ?? null,
    color:
      typeof o.info?.color === "string" ? o.info.color : "#22c55e",
  }));

  const editorScrollRef = useRef<HTMLDivElement | null>(null);

  const handleEditorScroll = useCallback(() => {
    const container = editorScrollRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const threshold = containerRect.top + containerRect.height / 3;
    const h2s = Array.from(
      container.querySelectorAll(".ProseMirror h2")
    );
    let viewingSection: string | null = null;
    for (const h2 of h2s) {
      const rect = h2.getBoundingClientRect();
      if (rect.top <= threshold) {
        viewingSection = (h2.textContent ?? "").trim() || null;
      }
    }
    updateMyPresence({ viewingSection });
  }, [updateMyPresence]);

  useEffect(() => {
    const container = editorScrollRef.current;
    if (!container) return;
    container.addEventListener("scroll", handleEditorScroll, {
      passive: true,
    });
    return () => container.removeEventListener("scroll", handleEditorScroll);
  }, [handleEditorScroll]);
  const selfId = self?.id ?? "";

  const claimOwnership = useMutation(({ storage }, id: string) => {
    const current = storage.get("ownerId");
    if (!current) {
      storage.set("ownerId", id);
    }
  }, []);

  useEffect(() => {
    if (!selfId) return;
    if (storedOwnerId) return;
    claimOwnership(selfId);
  }, [selfId, storedOwnerId, claimOwnership]);

  const isJoiner =
    !!storedPlanJson &&
    (storedChatMessages?.length ?? 0) > 0 &&
    !!storedOwnerId &&
    selfId !== storedOwnerId;

  const updateDocTitle = useMutation(({ storage }, title: string) => {
    storage.set("docTitle", title);
  }, []);
  const updatePlanJson = useMutation(({ storage }, json: string) => {
    storage.set("planJson", json);
  }, []);
  const updatePlanLines = useMutation(({ storage }, lines: string[]) => {
    storage.set("planLines", lines);
  }, []);
  const updateChatMessages = useMutation(
    ({ storage }, msgs: { role: string; content: string }[]) => {
      storage.set("chatMessages", msgs);
    },
    []
  );

  const [planReady, setPlanReady] = useState(Boolean(storedPlanJson));
  const [streamingTitle, setStreamingTitle] = useState(storedDocTitle ?? "");
  const lastSyncedTitleRef = useRef<string | null>(null);

  useEffect(() => {
    if (!currentSessionId) return;
    const title = streamingTitle.trim();
    if (!title) return;
    if (lastSyncedTitleRef.current === title) return;
    const t = setTimeout(() => {
      lastSyncedTitleRef.current = title;
      void fetch(
        `/api/sessions/${encodeURIComponent(currentSessionId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }
      ).catch(() => {
        // swallow — title sync is best-effort
      });
    }, 500);
    return () => clearTimeout(t);
  }, [currentSessionId, streamingTitle]);
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [planLines, setPlanLines] = useState<string[]>(
    storedPlanLines ? [...storedPlanLines] : []
  );
  const [isMakingPlan, setIsMakingPlan] = useState(false);

  const titleStartedRef = useRef(Boolean(storedDocTitle));
  const animationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingTasksRef = useRef(0);
  const extractedTextsRef = useRef<Set<string>>(new Set());
  const agentResponseCountRef = useRef(0);
  const planRequestedRef = useRef(false);
  const hasMadeFirstPlanRef = useRef(Boolean(storedPlanJson));
  const responsesSinceLastPlanRef = useRef(0);
  const lastConversationRef = useRef<ConversationTurn[]>([]);
  const planEditorRef = useRef<PlanEditorHandle>(null);
  const planRestoredRef = useRef(false);
  const planLinesInitRef = useRef(true);

  useEffect(() => {
    if (planRestoredRef.current) return;
    if (!storedPlanJson) return;
    planRestoredRef.current = true;
    try {
      const plan = JSON.parse(storedPlanJson) as PlanData;
      void planEditorRef.current?.typePlan(plan);
    } catch {
      // ignore parse error
    }
  }, [storedPlanJson]);

  useEffect(() => {
    if (planLinesInitRef.current) {
      planLinesInitRef.current = false;
      return;
    }
    updatePlanLines(planLines);
  }, [planLines, updatePlanLines]);

  const writingBulletInitRef = useRef(true);
  useEffect(() => {
    if (writingBulletInitRef.current) {
      writingBulletInitRef.current = false;
      return;
    }
    if (planLines.length === 0) return;
    updateMyPresence({ viewingSection: "writing-bullet" });
    const t = setTimeout(() => {
      updateMyPresence({ viewingSection: null });
    }, 1500);
    return () => clearTimeout(t);
  }, [planLines, updateMyPresence]);

  const enqueueAnimation = useCallback((task: () => Promise<void>) => {
    pendingTasksRef.current += 1;
    setIsAgentTyping(true);
    animationQueueRef.current = animationQueueRef.current
      .then(task)
      .catch(() => {
        // swallow per-task errors so the queue keeps draining
      })
      .finally(() => {
        pendingTasksRef.current -= 1;
        if (pendingTasksRef.current === 0) {
          setIsAgentTyping(false);
        }
      });
  }, []);

  const extractAndAppend = useCallback(
    async (text: string) => {
      const trimmedSource = text.trim();
      if (!trimmedSource || extractedTextsRef.current.has(trimmedSource)) {
        return;
      }
      extractedTextsRef.current.add(trimmedSource);

      const first = splitSentences(trimmedSource)[0];
      if (!first || first.length < 10) {
        return;
      }

      setIsAgentTyping(true);
      let bullet = first;
      try {
        const res = await fetch("/api/chat/compress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sentence: first }),
        });
        if (res.ok) {
          const data = (await res.json()) as { bullet?: string };
          const compressed = (data.bullet ?? "").trim();
          if (compressed) {
            bullet = compressed;
          }
        }
      } catch {
        // fall back to the original sentence
      }

      setPlanLines((prev) => [...prev, bullet]);
      setIsAgentTyping(false);
    },
    []
  );

  const handleFirstMessage = useCallback(() => {
    // Title generation moved to handlePlanReady so it runs against the full
    // conversation at the moment the plan writes.
  }, []);

  const generateTitleFromConversation = useCallback(() => {
    if (titleStartedRef.current) return;
    titleStartedRef.current = true;

    const conversation = lastConversationRef.current;
    if (!conversation.length) {
      titleStartedRef.current = false;
      return;
    }
    const text = formatConversation(conversation);

    enqueueAnimation(async () => {
      let title = "";
      try {
        const res = await fetch("/api/chat/title", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok) return;
        const data = (await res.json()) as { title?: string };
        title = (data.title ?? "").trim();
      } catch {
        return;
      }
      if (!title) return;

      setStreamingTitle("");
      for (let i = 1; i <= title.length; i++) {
        setStreamingTitle(title.slice(0, i));
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
      updateDocTitle(title);
    });
  }, [enqueueAnimation, updateDocTitle]);

  const makePlan = useCallback(async () => {
    if (isMakingPlan) {
      return;
    }
    const conversation = lastConversationRef.current;
    if (!conversation.length) {
      return;
    }

    setPlanLines([]);
    extractedTextsRef.current.clear();

    planEditorRef.current?.clearBlockNote();

    setIsMakingPlan(true);

    let plan: PlanData | null = null;
    try {
      const res = await fetch("/api/chat/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversation: formatConversation(conversation),
        }),
      });
      if (!res.ok) {
        setIsMakingPlan(false);
        return;
      }
      plan = (await res.json()) as PlanData;
    } catch {
      setIsMakingPlan(false);
      return;
    }

    setIsAgentTyping(true);
    setPlanLines([]);
    try {
      await planEditorRef.current?.typePlan(plan);
      updatePlanJson(JSON.stringify(plan));
      // best-effort: generate and store a 2-sentence session summary
      const planTextForSummary =
        planEditorRef.current?.getPlanText() ?? "";
      if (planTextForSummary && roomId) {
        void fetch("/api/sessions/summarize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            planText: planTextForSummary,
            roomId,
          }),
        }).catch(() => {});
      }
    } catch {
      // typePlan errored; fall through to cleanup
    } finally {
      setIsAgentTyping(false);
      setIsMakingPlan(false);
      setPlanReady(true);
      planRequestedRef.current = false;
      hasMadeFirstPlanRef.current = true;
      responsesSinceLastPlanRef.current = 0;
    }
  }, [isMakingPlan, updatePlanJson]);

  const handleWritePlan = useCallback(() => {
    if (planRequestedRef.current) {
      return;
    }
    planRequestedRef.current = true;
    void makePlan();
  }, [makePlan]);

  const handleAgentResponse = useCallback(
    (text: string, conversation: ConversationTurn[]) => {
      extractAndAppend(text);
      lastConversationRef.current = conversation;

      agentResponseCountRef.current += 1;
      responsesSinceLastPlanRef.current += 1;

      if (
        hasMadeFirstPlanRef.current &&
        responsesSinceLastPlanRef.current >= 3 &&
        !planRequestedRef.current
      ) {
        handleWritePlan();
        return;
      }

      if (
        agentResponseCountRef.current >= 7 &&
        !planRequestedRef.current
      ) {
        handleWritePlan();
      }
    },
    [extractAndAppend, handleWritePlan]
  );

  const handlePlanReady = useCallback(() => {
    setPlanReady(true);
    generateTitleFromConversation();
    handleWritePlan();
  }, [generateTitleFromConversation, handleWritePlan]);

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
  }, [roomId]);

  return (
    <div
      className="flex h-full flex-col bg-[#ffffff]"
      onPointerMove={(e) =>
        updateMyPresence({ cursor: { x: e.clientX, y: e.clientY } })
      }
      onPointerLeave={() => updateMyPresence({ cursor: null })}
    >
      <Cursors />
      <div className="flex flex-1 min-h-0 bg-[#ffffff]">
        <div className="w-2/5 bg-[#ffffff] flex flex-col min-h-0">
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              padding: "0 12px",
              gap: 8,
              height: 44,
            }}
          >
            <span
              style={{
                fontSize: 11.8,
                fontWeight: 600,
                color: "#1A1A1A",
                opacity: 0.7,
                letterSpacing: "-0.15px",
                whiteSpace: "nowrap",
                marginRight: "auto",
              }}
            >
              {streamingTitle || "Untitled"}
            </span>
            <button
              type="button"
              aria-label="New doc"
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
              onClick={() => (window.location.href = "/doc")}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.8")}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            >
              <Plus size={16} color="#9DA3AE" strokeWidth={2} />
            </button>

            <button
              type="button"
              aria-label="Search"
              onClick={() => setShowSearch(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 7px",
                borderRadius: 6,
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: "#9DA3AE",
                fontFamily: "inherit",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.backgroundColor = "rgba(0,0,0,0.04)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <Search size={13} strokeWidth={1.8} />
              <span
                style={{
                  fontSize: 10,
                  color: "#B0B7C3",
                  background: "rgba(0,0,0,0.05)",
                  borderRadius: 4,
                  padding: "1px 5px",
                }}
              >
                ⌘K
              </span>
            </button>
          </div>
          {isJoiner ? (
            <JoinerChat planEditorRef={planEditorRef} />
          ) : (
            <ChatPanel
              initialMessages={storedChatMessages ?? []}
              onMessagesChange={updateChatMessages}
              onFirstMessage={handleFirstMessage}
              onAgentResponse={handleAgentResponse}
              onPlanReady={handlePlanReady}
              planReady={planReady}
            />
          )}
        </div>
        <div
          ref={editorScrollRef}
          className="flex-1 overflow-y-auto"
          style={{
            padding: "0 24px",
            background: "#F6F5F4",
          }}
        >
          <div
            style={{
              margin: "40px auto",
              width: "100%",
              maxWidth: "800px",
              minHeight: "calc(100vh - 80px)",
              height: "auto",
              border: "1px solid rgba(232, 232, 230, 0.2)",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              borderRadius: "12px",
              background: "#ffffff",
              overflow: "hidden",
            }}
          >
            <PlanEditor
              ref={planEditorRef}
              userEmail={userEmail}
              userName={userName}
              userAvatar={userAvatar}
              streamingTitle={streamingTitle}
              isAgentTyping={isAgentTyping}
              planLines={planLines}
              isMakingPlan={isMakingPlan}
              isUpdating={isMakingPlan}
              planReady={planReady}
              agentStatus={isMakingPlan}
              roomId={roomId}
              role={role}
              othersPresence={othersPresence}
            />
          </div>
        </div>
      </div>
      {showSearch && (
        <div
          onClick={() => setShowSearch(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.25)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 120,
            zIndex: 100,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#ffffff",
              borderRadius: 10,
              width: 480,
              maxHeight: 360,
              overflow: "hidden",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sessions..."
              style={{
                padding: "12px 16px",
                border: "none",
                borderBottom: "0.5px solid #e8e8e6",
                outline: "none",
                fontSize: 14,
                fontFamily: "inherit",
                color: "#1a1a1a",
                width: "100%",
              }}
            />
            <div style={{ overflowY: "auto", flex: 1 }}>
              {searchSessions
                .filter(
                  (s) =>
                    !searchQuery ||
                    s.title
                      ?.toLowerCase()
                      .includes(searchQuery.toLowerCase())
                )
                .map((s) => (
                  <div
                    key={s.id}
                    onClick={() => {
                      window.location.href = "/doc?room=" + s.roomId;
                      setShowSearch(false);
                    }}
                    style={{
                      padding: "10px 16px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 12,
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#f5f5f3")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#1a1a1a",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        flex: 1,
                      }}
                    >
                      {s.title || "Untitled"}
                    </span>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src={
                          "https://api.dicebear.com/9.x/pixel-art/svg?seed=" +
                          encodeURIComponent(s.ownerName ?? "Demo")
                        }
                        width={16}
                        height={16}
                        style={{
                          borderRadius: "50%",
                          border: "1.5px solid #f5f5f3",
                        }}
                      />
                      <span
                        style={{
                          fontSize: 11,
                          color: "#a0a0a0",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {s.createdAt
                          ? new Date(s.createdAt).toLocaleDateString(
                              "en-US",
                              {
                                month: "short",
                                day: "numeric",
                              }
                            )
                          : "Today"}
                      </span>
                    </div>
                  </div>
                ))}
              {searchSessions.filter(
                (s) =>
                  !searchQuery ||
                  s.title
                    ?.toLowerCase()
                    .includes(searchQuery.toLowerCase())
              ).length === 0 && (
                <div
                  style={{
                    padding: "24px 16px",
                    textAlign: "center",
                    fontSize: 13,
                    color: "#a0a0a0",
                  }}
                >
                  No sessions found
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

