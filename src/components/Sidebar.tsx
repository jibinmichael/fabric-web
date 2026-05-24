"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";

type SessionRecord = {
  id: string;
  title: string;
  roomId: string;
  createdAt: number;
  ownerId: string;
  ownerName: string;
  ownerAvatar: string;
};

type ContextMenu = {
  x: number;
  y: number;
  sessionId: string;
};

const SYSTEM_FONT =
  'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

function formatRelativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function Sidebar({
  collapsed,
  currentRoomId,
  ownerEmail,
  ownerName,
  ownerAvatar,
}: {
  collapsed: boolean;
  currentRoomId: string;
  ownerEmail: string;
  ownerName: string;
  ownerAvatar: string;
}) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [creating, setCreating] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { sessions?: SessionRecord[] };
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!contextMenu) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest("[data-session-menu]")) return;
      setContextMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleNew = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "",
          ownerEmail,
          ownerName,
          ownerAvatar,
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as { session?: SessionRecord };
      if (data.session?.roomId) {
        window.location.href = `/doc?room=${encodeURIComponent(
          data.session.roomId
        )}`;
      }
    } finally {
      setCreating(false);
    }
  }, [creating, ownerEmail, ownerName, ownerAvatar]);

  const startRename = useCallback((s: SessionRecord) => {
    setContextMenu(null);
    setRenamingId(s.id);
    setRenameDraft(s.title);
  }, []);

  const commitRename = useCallback(async () => {
    const id = renamingId;
    if (!id) return;
    const title = renameDraft.trim();
    setRenamingId(null);
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, title } : s))
    );
    try {
      await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
    } catch {
      // ignore; optimistic update kept
    }
  }, [renamingId, renameDraft]);

  const cancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameDraft("");
  }, []);

  const handleDelete = useCallback(
    async (s: SessionRecord) => {
      setContextMenu(null);
      const confirmed = window.confirm(
        `Delete session "${s.title || "Untitled"}"? This cannot be undone.`
      );
      if (!confirmed) return;
      setSessions((prev) => prev.filter((x) => x.id !== s.id));
      try {
        await fetch(`/api/sessions/${encodeURIComponent(s.id)}`, {
          method: "DELETE",
        });
      } catch {
        // ignore
      }
      if (s.roomId === currentRoomId) {
        window.location.href = "/doc";
      }
    },
    [currentRoomId]
  );

  const activeSessionId =
    sessions.find((s) => s.roomId === currentRoomId)?.id ?? null;

  return (
    <aside
      style={{
        display: "flex",
        flexDirection: "column",
        flexShrink: 0,
        width: collapsed ? 44 : 240,
        height: "100%",
        boxSizing: "border-box",
        backgroundColor: "#FFFFFF",
        borderRight: "1px solid #EEEEEE",
        boxShadow: "1px 0 4px rgba(0, 0, 0, 0.04)",
        padding: collapsed ? "8px 0" : 12,
        overflow: "hidden",
        transition: "width 200ms ease-out, padding 200ms ease-out",
        fontFamily: SYSTEM_FONT,
        color: "#1A1A1A",
        position: "relative",
        zIndex: 5,
      }}
    >
      {collapsed ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            paddingTop: 4,
          }}
        >
          <button
            type="button"
            onClick={() => void handleNew()}
            disabled={creating}
            title="New session"
            aria-label="New session"
            style={{
              width: 22,
              height: 22,
              color: "#FFFFFF",
              background: "#2563EB",
              border: "none",
              borderRadius: 9999,
              cursor: creating ? "default" : "pointer",
              opacity: creating ? 0.5 : 1,
              transition: "background-color 150ms ease",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: SYSTEM_FONT,
              padding: 0,
              lineHeight: 0,
            }}
            onMouseEnter={(e) => {
              if (!creating)
                e.currentTarget.style.backgroundColor = "#1D4ED8";
            }}
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "#2563EB")
            }
          >
            <Plus size={12} strokeWidth={2.25} aria-hidden />
          </button>
        </div>
      ) : (
        <>
          <div
            style={{
              borderBottom: "1px solid #EEEEEE",
              paddingBottom: 12,
            }}
          >
            <button
              type="button"
              onClick={() => void handleNew()}
              disabled={creating}
              style={{
                width: "100%",
                background: "transparent",
                color: "#2563EB",
                padding: "8px 12px",
                fontSize: 13,
                fontWeight: 500,
                textAlign: "left",
                border: "none",
                borderRadius: 6,
                cursor: creating ? "default" : "pointer",
                opacity: creating ? 0.5 : 1,
                transition: "background-color 150ms ease",
                fontFamily: SYSTEM_FONT,
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
              }}
              onMouseEnter={(e) => {
                if (!creating)
                  e.currentTarget.style.backgroundColor = "#F5F5F5";
              }}
              onMouseLeave={(e) =>
                (e.currentTarget.style.backgroundColor = "transparent")
              }
            >
              <Plus size={14} strokeWidth={1.75} aria-hidden />
              <span>New session</span>
            </button>
          </div>
          <div
            style={{
              marginTop: 12,
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
            }}
          >
            {sessions.map((s) => {
              const isActive = s.id === activeSessionId;
              const isRenaming = renamingId === s.id;
              return (
                <div
                  key={s.id}
                  className="sidebar-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    width: "100%",
                    minWidth: 0,
                    padding: 4,
                    borderRadius: 6,
                    backgroundColor: isActive ? "#EEEEEE" : "transparent",
                    transition: "background-color 120ms ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive)
                      e.currentTarget.style.backgroundColor = "#F5F5F5";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isActive
                      ? "#EEEEEE"
                      : "transparent";
                  }}
                >
                  {isRenaming ? (
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      maxLength={80}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitRename();
                        }
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      onBlur={() => void commitRename()}
                      style={{
                        boxSizing: "border-box",
                        height: 28,
                        width: "100%",
                        minWidth: 0,
                        border: "1px solid #DDDDDD",
                        borderRadius: 4,
                        padding: "0 8px",
                        fontSize: 13,
                        fontFamily: SYSTEM_FONT,
                        color: "#1A1A1A",
                        background: "#FFFFFF",
                        outline: "none",
                      }}
                    />
                  ) : (
                    <>
                      <a
                        href={`/doc?room=${encodeURIComponent(s.roomId)}`}
                        title={`Last updated: ${formatRelativeTime(
                          s.createdAt
                        )}`}
                        style={{
                          display: "block",
                          flex: 1,
                          minWidth: 0,
                          padding: "4px",
                          borderRadius: 4,
                          textDecoration: "none",
                          color: "inherit",
                          cursor: "pointer",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 500,
                            color: "#1A1A1A",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {s.title || "Untitled"}
                        </div>
                        <div
                          style={{
                            fontSize: 11,
                            fontWeight: 400,
                            color: "#999999",
                            marginTop: 2,
                          }}
                        >
                          {formatRelativeTime(s.createdAt)}
                        </div>
                      </a>
                      <button
                        type="button"
                        aria-label="Session actions"
                        className="sidebar-more"
                        style={{
                          flexShrink: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          padding: 4,
                          minWidth: 24,
                          minHeight: 24,
                          color: "#999999",
                          background: "transparent",
                          border: "none",
                          borderRadius: 4,
                          cursor: "pointer",
                          opacity: isActive ? 1 : 0,
                          transition:
                            "opacity 120ms ease, background-color 120ms ease, color 120ms ease",
                          fontFamily: SYSTEM_FONT,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.backgroundColor = "#EEEEEE";
                          e.currentTarget.style.color = "#1A1A1A";
                          e.currentTarget.style.opacity = "1";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.backgroundColor = "transparent";
                          e.currentTarget.style.color = "#999999";
                          e.currentTarget.style.opacity = isActive ? "1" : "0";
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const r = e.currentTarget.getBoundingClientRect();
                          const menuWidth = 140;
                          setContextMenu({
                            x: Math.max(8, r.right - menuWidth),
                            y: r.bottom + 4,
                            sessionId: s.id,
                          });
                        }}
                      >
                        <MoreHorizontal size={14} strokeWidth={2} aria-hidden />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {contextMenu ? (
        <div
          data-session-menu
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            width: 140,
            background: "#FFFFFF",
            border: "1px solid #EEEEEE",
            borderRadius: 6,
            boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
            padding: 4,
            zIndex: 60,
            fontFamily: SYSTEM_FONT,
          }}
        >
          {(() => {
            const s = sessions.find((x) => x.id === contextMenu.sessionId);
            if (!s) return null;
            return (
              <>
                <button
                  type="button"
                  onClick={() => startRename(s)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 13,
                    color: "#1A1A1A",
                    background: "transparent",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontFamily: SYSTEM_FONT,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "#F5F5F5")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  Rename
                </button>
                <button
                  type="button"
                  onClick={() => void handleDelete(s)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "6px 10px",
                    fontSize: 13,
                    color: "#dc2626",
                    background: "transparent",
                    border: "none",
                    borderRadius: 4,
                    cursor: "pointer",
                    fontFamily: SYSTEM_FONT,
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.backgroundColor = "#FEF2F2")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.backgroundColor = "transparent")
                  }
                >
                  Delete
                </button>
              </>
            );
          })()}
        </div>
      ) : null}

      <style
        dangerouslySetInnerHTML={{
          __html: `
            .sidebar-row:hover .sidebar-more { opacity: 1 !important; }
          `,
        }}
      />
    </aside>
  );
}
