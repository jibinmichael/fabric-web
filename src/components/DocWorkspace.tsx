"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import {
  useMutation,
  useOthers,
  useSelf,
  useStorage,
  useUpdateMyPresence,
} from "@liveblocks/react/suspense";
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
import { Sidebar } from "./Sidebar";

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
      // let the agent decide whether to update a plan section.
      if (fullText && q) {
        const planSnapshot = planEditorRef.current?.getPlanText() ?? "";
        const VALID_SECTIONS: PlanSectionKey[] = [
          "problem",
          "whoIsAffected",
          "whatGoodLooksLike",
          "openQuestions",
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
              section?: string;
              newContent?: string;
            } | null;
            if (!data?.shouldUpdate) return;
            const section = VALID_SECTIONS.includes(
              data.section as PlanSectionKey
            )
              ? (data.section as PlanSectionKey)
              : null;
            if (!section || !data.newContent) return;
            planEditorRef.current?.patchSection(section, data.newContent);
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
    <div className={chatStyles.chatPanel}>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const toggleSidebar = () => setSidebarCollapsed((v) => !v);
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white">
      <Sidebar
        collapsed={sidebarCollapsed}
        currentRoomId={props.roomId}
        ownerEmail={props.userEmail}
        ownerName={props.userName}
        ownerAvatar={props.userAvatar}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <LiveblocksRoom roomId={props.roomId}>
          <DocBody
            {...props}
            sidebarCollapsed={sidebarCollapsed}
            onToggleSidebar={toggleSidebar}
          />
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
  sidebarCollapsed,
  onToggleSidebar,
}: DocWorkspaceProps & {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
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


  return (
    <div className="flex h-full bg-[#ffffff]">
      <div className="w-2/5 bg-[#ffffff] flex flex-col min-h-0">
        <div
          style={{
            height: 44,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            background: "#ffffff",
          }}
        >
          <button
            type="button"
            onClick={onToggleSidebar}
            aria-label={
              sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
            }
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            style={{
              padding: 6,
              color: "#6b6b6b",
              background: "transparent",
              border: "none",
              borderRadius: 9999,
              cursor: "pointer",
              transition: "background-color 150ms ease",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
              flexShrink: 0,
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#e8e8e6")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "transparent")
            }
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen size={14} strokeWidth={1.75} />
            ) : (
              <PanelLeftClose size={14} strokeWidth={1.75} />
            )}
          </button>
          <span
            style={{
              flex: 1,
              fontSize: 12.8,
              fontWeight: 500,
              color: "#1a1a1a",
              opacity: 0.75,
              marginLeft: 12,
              overflow: "hidden",
              whiteSpace: "nowrap",
              textOverflow: "ellipsis",
            }}
          >
            {storedDocTitle || "New session"}
          </span>
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
        style={{ padding: "0 24px", background: "#fcfdfe", boxShadow: "-1px 0 4px rgba(0, 0, 0, 0.04)" }}
      >
        <div
          style={{
            margin: "40px auto",
            width: "100%",
            maxWidth: "800px",
            minHeight: "calc(100vh - 80px)",
            height: "auto",
            border: "1px solid #e8e8e6",
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
  );
}

