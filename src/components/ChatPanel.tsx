"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./ChatPanel.module.css";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

function parseSseChunk(buffer: string) {
  const events: Record<string, unknown>[] = [];
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";

  for (const part of parts) {
    const line = part.trim();
    if (!line.startsWith("data:")) {
      continue;
    }
    try {
      events.push(JSON.parse(line.slice(5).trim()) as Record<string, unknown>);
    } catch {
      // skip malformed event
    }
  }

  return { events, rest };
}

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

type StoredMessage = { role: string; content: string };

type ChatPanelProps = {
  initialMessages?: StoredMessage[];
  onMessagesChange?: (messages: StoredMessage[]) => void;
  onFirstMessage?: (message: string) => void;
  onAgentResponse?: (text: string, conversation: ConversationTurn[]) => void;
  onPlanReady?: () => void;
  planReady?: boolean;
};

export function ChatPanel({
  initialMessages,
  onMessagesChange,
  onFirstMessage,
  onAgentResponse,
  onPlanReady,
  planReady = false,
}: ChatPanelProps = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    (initialMessages ?? [])
      .filter(
        (m): m is { role: "user" | "assistant"; content: string } =>
          (m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string"
      )
      .map((m) => ({
        id: crypto.randomUUID(),
        role: m.role,
        content: m.content,
      }))
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const firstMessageFiredRef = useRef(
    (initialMessages?.length ?? 0) > 0
  );
  const messagesSyncInitRef = useRef(true);

  useEffect(() => {
    if (messagesSyncInitRef.current) {
      messagesSyncInitRef.current = false;
      return;
    }
    onMessagesChange?.(
      messages.map(({ role, content }) => ({ role, content }))
    );
  }, [messages, onMessagesChange]);

  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, streaming, loading]);

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || loading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setInput("");
    setLoading(true);
    setStreaming("");
    setMessages((prev) => [...prev, userMessage]);

    if (!firstMessageFiredRef.current) {
      firstMessageFiredRef.current = true;
      onFirstMessage?.(trimmed);
    }

    const history = [...messages, userMessage].map((message) => ({
      role: message.role,
      content: message.content,
    }));

    try {
      const endpoint = planReady ? "/api/chat/clarify" : "/api/chat";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? `Chat failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error("No response stream");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let fullText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseChunk(buffer);
          buffer = parsed.rest;

          for (const event of parsed.events) {
            if (typeof event.error === "string") {
              throw new Error(event.error);
            }
            if (typeof event.delta === "string") {
              fullText += event.delta;
              setStreaming(fullText);
            }
          }
        }
        if (done) {
          break;
        }
      }

      const rawText = fullText.trim();
      const planReadyDetected = rawText.includes("[PLAN_READY]");
      const finalText = planReadyDetected
        ? rawText.replace(/\[PLAN_READY\]/g, "").trim()
        : rawText;
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: finalText,
      };
      setMessages((prev) => [...prev, assistantMessage]);
      setStreaming("");
      if (finalText) {
        const conversation: ConversationTurn[] = [
          ...messages,
          userMessage,
          assistantMessage,
        ].map(({ role, content }) => ({ role, content }));
        onAgentResponse?.(finalText, conversation);
      }
      if (planReadyDetected) {
        onPlanReady?.();
      }
    } catch (err) {
      const errorText = err instanceof Error ? err.message : "Chat failed";
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: errorText,
        },
      ]);
      setStreaming("");
    } finally {
      setLoading(false);
    }
  }, [
    input,
    loading,
    messages,
    onFirstMessage,
    onAgentResponse,
    onPlanReady,
    planReady,
  ]);

  return (
    <section className={styles.chatPanel}>
      <div ref={listRef} className={styles.messages}>
        <div className={styles.messageList}>
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className={styles.userMessage}>
                {message.content}
              </div>
            ) : (
              <div key={message.id} className={styles.agentRow}>
                <span className={styles.agentAvatar} aria-hidden />
                <div className={styles.assistantMessage}>{message.content}</div>
              </div>
            )
          )}
          {streaming ? (
            <div className={styles.agentRow}>
              <span className={styles.agentAvatar} aria-hidden />
              <div className={styles.assistantMessage}>{streaming}</div>
            </div>
          ) : null}
          {loading && !streaming ? (
            <div className={styles.thinkingIndicator}>
              <span>Agent 1 is thinking</span>
              <span className={styles.thinkingDots} aria-hidden>
                <span
                  className={styles.thinkingDot}
                  style={{ animationDelay: "0ms" }}
                >
                  .
                </span>
                <span
                  className={styles.thinkingDot}
                  style={{ animationDelay: "200ms" }}
                >
                  .
                </span>
                <span
                  className={styles.thinkingDot}
                  style={{ animationDelay: "400ms" }}
                >
                  .
                </span>
              </span>
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.inputRegion}>
        <div className={styles.inputWrap}>
          <span className={styles.prompt} aria-hidden>
            ›
          </span>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void sendMessage();
              }
            }}
            placeholder="describe what you want to build…"
            className={styles.textarea}
            rows={1}
            disabled={loading}
          />
        </div>

        <div className={styles.footer}>
          <span className={styles.footerHint}>enter to send</span>
          <span aria-hidden>·</span>
          <button type="button" className={styles.footerAction}>
            /attach
          </button>
        </div>
      </div>
    </section>
  );
}
