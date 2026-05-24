"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./ChatPanel.module.css";

type ChatAttachment =
  | {
      id: string;
      kind: "image";
      name: string;
      mediaType: string;
      previewUrl: string;
      base64: string;
    }
  | {
      id: string;
      kind: "text";
      name: string;
      content: string;
    };

type ApiContentBlock =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: { type: "base64"; media_type: string; data: string };
    };

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: ChatAttachment[];
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

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

function readAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(typeof r.result === "string" ? r.result : "");
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function buildApiContent(
  text: string,
  atts: ChatAttachment[]
): string | ApiContentBlock[] {
  const imageAtts = atts.filter(
    (a): a is Extract<ChatAttachment, { kind: "image" }> => a.kind === "image"
  );
  const textAtts = atts.filter(
    (a): a is Extract<ChatAttachment, { kind: "text" }> => a.kind === "text"
  );

  let combinedText = text;
  if (textAtts.length > 0) {
    const blocks = textAtts
      .map((a) => `[Attachment: ${a.name}]\n${a.content}`)
      .join("\n\n");
    combinedText = blocks + (text ? `\n\n${text}` : "");
  }

  if (imageAtts.length === 0) {
    return combinedText;
  }

  const result: ApiContentBlock[] = [];
  for (const img of imageAtts) {
    result.push({
      type: "image",
      source: {
        type: "base64",
        media_type: img.mediaType,
        data: img.base64,
      },
    });
  }
  if (combinedText) {
    result.push({ type: "text", text: combinedText });
  }
  return result;
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
  const [pendingAttachments, setPendingAttachments] = useState<
    ChatAttachment[]
  >([]);
  const listRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstMessageFiredRef = useRef(
    (initialMessages?.length ?? 0) > 0
  );
  const messagesSyncInitRef = useRef(true);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const removeAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.target.value = "";

      for (const file of files) {
        if (file.size > 4 * 1024 * 1024) continue;
        const id = crypto.randomUUID();

        if (file.type.startsWith("image/")) {
          try {
            const dataUrl = await readAsDataURL(file);
            const base64 = dataUrl.split(",")[1] ?? "";
            setPendingAttachments((prev) => [
              ...prev,
              {
                id,
                kind: "image",
                name: file.name,
                mediaType: file.type || "image/jpeg",
                previewUrl: dataUrl,
                base64,
              },
            ]);
          } catch {
            // skip unreadable file
          }
        } else {
          try {
            const content = await readAsText(file);
            setPendingAttachments((prev) => [
              ...prev,
              {
                id,
                kind: "text",
                name: file.name,
                content: content.slice(0, 50000),
              },
            ]);
          } catch {
            // skip unreadable file
          }
        }
      }
    },
    []
  );

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
    if ((!trimmed && pendingAttachments.length === 0) || loading) {
      return;
    }

    const attachmentsToSend = pendingAttachments;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      attachments:
        attachmentsToSend.length > 0 ? attachmentsToSend : undefined,
    };

    setInput("");
    setPendingAttachments([]);
    setLoading(true);
    setStreaming("");
    setMessages((prev) => [...prev, userMessage]);

    if (!firstMessageFiredRef.current && trimmed) {
      firstMessageFiredRef.current = true;
      onFirstMessage?.(trimmed);
    }

    const apiContent = buildApiContent(trimmed, attachmentsToSend);
    const history = [
      ...messages.map((m) => ({ role: m.role, content: m.content })),
      { role: userMessage.role, content: apiContent },
    ];

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
    pendingAttachments,
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
                {message.attachments && message.attachments.length > 0 ? (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      marginBottom: message.content ? 8 : 0,
                    }}
                  >
                    {message.attachments.map((a) =>
                      a.kind === "image" ? (
                        <img
                          key={a.id}
                          src={a.previewUrl}
                          alt={a.name}
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
                          key={a.id}
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
                          title={a.name}
                        >
                          📎 {a.name}
                        </span>
                      )
                    )}
                  </div>
                ) : null}
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
        {pendingAttachments.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              marginBottom: 8,
            }}
          >
            {pendingAttachments.map((a) => (
              <div
                key={a.id}
                style={{
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                {a.kind === "image" ? (
                  <img
                    src={a.previewUrl}
                    alt={a.name}
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
                    title={a.name}
                  >
                    📎 {a.name}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
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
            ))}
          </div>
        ) : null}
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
                if (input.trim() === "/attach") {
                  setInput("");
                  openFilePicker();
                  return;
                }
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
          <button
            type="button"
            className={styles.footerAction}
            onClick={openFilePicker}
          >
            /attach
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,.pdf,.doc,.docx,.txt,.md"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
      </div>
    </section>
  );
}
