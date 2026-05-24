"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useMutation, useStorage } from "@liveblocks/react/suspense";
import { ChatPanel, type ConversationTurn } from "./ChatPanel";
import {
  PlanEditor,
  type PlanData,
  type PlanEditorHandle,
} from "./PlanEditor";
import { LiveblocksRoom } from "./LiveblocksRoom";
import { Sidebar } from "./Sidebar";

type DocWorkspaceProps = {
  userEmail: string;
  userName: string;
  userAvatar: string;
  roomId: string;
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
  sidebarCollapsed,
  onToggleSidebar,
}: DocWorkspaceProps & {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleShare = useCallback(async () => {
    const url = `${window.location.origin}/doc/shared?room=${encodeURIComponent(
      roomId
    )}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copy this link:", url);
    }
  }, [roomId]);
  const storedDocTitle = useStorage((root) => root.docTitle);
  const storedPlanJson = useStorage((root) => root.planJson);
  const storedPlanLines = useStorage((root) => root.planLines);
  const storedChatMessages = useStorage((root) => root.chatMessages);

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

  const handleFirstMessage = useCallback((_message: string) => {
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

  const initial = (userName || "U").trim().charAt(0).toUpperCase();

  return (
    <>
      <header
        style={{
          height: 44,
          flexShrink: 0,
          background: "#FFFFFF",
          borderBottom: "1px solid #EEEEEE",
          display: "flex",
          alignItems: "center",
          padding: "0 20px",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
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
              color: "#666666",
              background: "transparent",
              border: "none",
              borderRadius: 9999,
              cursor: "pointer",
              transition: "background-color 150ms ease",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#EEEEEE")
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
        </div>


        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
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
              color: isMakingPlan ? "#22c55e" : "#999999",
              lineHeight: 1,
            }}
          >
            <span
              aria-hidden
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: isMakingPlan ? "#22c55e" : "#cccccc",
                display: "inline-block",
              }}
            />
            <span>
              {isMakingPlan ? "Agent 1 is planning" : "Agent 1 listening"}
            </span>
          </div>

          {userAvatar ? (
            <img
              src={userAvatar}
              alt=""
              referrerPolicy="no-referrer"
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                objectFit: "cover",
                display: "block",
              }}
            />
          ) : (
            <span
              aria-hidden
              style={{
                width: 24,
                height: 24,
                borderRadius: "50%",
                background: "#e5e5e5",
                color: "#1a1a1a",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {initial}
            </span>
          )}

          <button
            type="button"
            onClick={handleShare}
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: "4px 12px",
              borderRadius: 9999,
              border: "1px solid #EEEEEE",
              background: "#fff",
              color: "#666",
              cursor: "pointer",
              fontFamily: "inherit",
              lineHeight: 1,
            }}
          >
            {copied ? "Copied!" : "Share"}
          </button>
        </div>
      </header>

      <div className="flex h-[calc(100vh-44px)] bg-[#F9F9F9]">
        <div className="w-2/5 bg-white border-r border-[#EEEEEE]">
          <ChatPanel
            initialMessages={storedChatMessages ?? []}
            onMessagesChange={updateChatMessages}
            onFirstMessage={handleFirstMessage}
            onAgentResponse={handleAgentResponse}
            onPlanReady={handlePlanReady}
            planReady={planReady}
          />
        </div>
        <div
          className="flex-1 bg-[#F9F9F9] overflow-y-auto"
          style={{ padding: "0 24px" }}
        >
          <div
            style={{
              margin: "40px auto",
              width: "100%",
              maxWidth: "800px",
              minHeight: "calc(100vh - 80px)",
              height: "auto",
              boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
              borderRadius: "8px",
              background: "#FFFFFF",
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
            />
          </div>
        </div>
      </div>
    </>
  );
}
