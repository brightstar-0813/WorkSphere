import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { api, apiList } from "../api";
import { useAuth } from "../auth";
import { mediaUrl } from "../config";
import {
  ChatMessage,
  ChatPresenceUser,
  connectChatSocket,
  emitTyping,
  joinChannel,
  leaveChannel,
  sendChatMessage,
  setActiveDiscussRoom,
} from "../chat";
import { useAlerts } from "../alerts/AlertProvider";
import { AlertBanner } from "../components/AlertBanner";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { useSearchParams } from "react-router-dom";

type ChatRoom = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  messageCount: number;
  lastMessage: {
    id: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string };
  } | null;
};

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function formatClock(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function formatDay(iso: string, locale: string) {
  try {
    return new Intl.DateTimeFormat(locale, {
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function sameDay(a: string, b: string) {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export function DiscussPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { notify } = useAlerts();
  const [searchParams, setSearchParams] = useSearchParams();
  const roomFromUrl = searchParams.get("room");
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [draft, setDraft] = useState("");
  const [newChannelOpen, setNewChannelOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [presence, setPresence] = useState<ChatPresenceUser[]>([]);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"clear" | "remove" | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeIdRef.current = activeId;
    setActiveDiscussRoom(activeId);
    return () => {
      if (activeIdRef.current === activeId) setActiveDiscussRoom(null);
    };
  }, [activeId]);

  useEffect(() => {
    if (!roomFromUrl || rooms.length === 0) return;
    if (rooms.some((r) => r.id === roomFromUrl) && activeId !== roomFromUrl) {
      setActiveId(roomFromUrl);
    }
    if (searchParams.has("room")) {
      const next = new URLSearchParams(searchParams);
      next.delete("room");
      setSearchParams(next, { replace: true });
    }
  }, [roomFromUrl, rooms, activeId, searchParams, setSearchParams]);

  const activeRoom = rooms.find((r) => r.id === activeId) ?? null;
  const canManageActive =
    Boolean(user) &&
    Boolean(activeRoom) &&
    (user!.role === "ADMIN" || activeRoom!.createdBy.id === user!.id);

  const loadRooms = useCallback(async () => {
    setLoadingRooms(true);
    try {
      const data = await api<ChatRoom[]>("/chat/rooms");
      const preferred = searchParams.get("room");
      setRooms(data);
      setActiveId((prev) => {
        if (preferred && data.some((r) => r.id === preferred)) return preferred;
        if (prev && data.some((r) => r.id === prev)) return prev;
        return data[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("discuss.error"));
    } finally {
      setLoadingRooms(false);
    }
  }, [t, searchParams]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    const socket = connectChatSocket();
    if (!socket) return;

    const onConnect = () => {
      setConnected(true);
      const roomId = activeIdRef.current;
      if (roomId) {
        void joinChannel(roomId).then((join) => {
          if (join.users && activeIdRef.current === roomId) setPresence(join.users);
        });
      }
    };
    const onDisconnect = () => setConnected(false);
    const onMessage = (msg: ChatMessage) => {
      if (msg.roomId !== activeIdRef.current) {
        setRooms((prev) =>
          prev.map((r) =>
            r.id === msg.roomId
              ? {
                  ...r,
                  messageCount: r.messageCount + 1,
                  lastMessage: {
                    id: msg.id,
                    body: msg.body,
                    createdAt: msg.createdAt,
                    author: msg.author,
                  },
                }
              : r,
          ),
        );
        return;
      }
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      setRooms((prev) =>
        prev.map((r) =>
          r.id === msg.roomId
            ? {
                ...r,
                messageCount: r.messageCount + 1,
                lastMessage: {
                  id: msg.id,
                  body: msg.body,
                  createdAt: msg.createdAt,
                  author: msg.author,
                },
              }
            : r,
        ),
      );
    };
    const onPresence = (payload: { roomId: string; users: ChatPresenceUser[] }) => {
      if (payload.roomId === activeIdRef.current) setPresence(payload.users);
    };
    const onTyping = (payload: { roomId: string; userId: string; name: string; typing: boolean }) => {
      if (payload.roomId !== activeIdRef.current || payload.userId === user?.id) return;
      setTypingNames((prev) => {
        const next = new Set(prev);
        if (payload.typing) next.add(payload.name);
        else next.delete(payload.name);
        return [...next];
      });
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      typingClearRef.current = setTimeout(() => setTypingNames([]), 2500);
    };
    const onCleared = (payload: { roomId: string }) => {
      setRooms((prev) =>
        prev.map((r) =>
          r.id === payload.roomId ? { ...r, messageCount: 0, lastMessage: null } : r,
        ),
      );
      if (payload.roomId === activeIdRef.current) {
        setMessages([]);
        setHasMore(false);
      }
    };
    const onDeleted = (payload: { roomId: string }) => {
      setRooms((prev) => {
        const next = prev.filter((r) => r.id !== payload.roomId);
        if (activeIdRef.current === payload.roomId) {
          setActiveId(next[0]?.id ?? null);
        }
        return next;
      });
      if (payload.roomId === activeIdRef.current) {
        setMessages([]);
        setPresence([]);
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message:new", onMessage);
    socket.on("presence:update", onPresence);
    socket.on("typing", onTyping);
    socket.on("room:cleared", onCleared);
    socket.on("room:deleted", onDeleted);
    setConnected(socket.connected);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message:new", onMessage);
      socket.off("presence:update", onPresence);
      socket.off("typing", onTyping);
      socket.off("room:cleared", onCleared);
      socket.off("room:deleted", onDeleted);
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    };
  }, [user?.id]);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setPresence([]);
      setTypingNames([]);
      return;
    }

    let cancelled = false;
    const roomId = activeId;

    async function load() {
      setLoadingMessages(true);
      setError(null);
      setTypingNames([]);
      try {
        const { data, meta } = await apiList<ChatMessage[]>(`/chat/rooms/${roomId}/messages?limit=50`);
        if (cancelled) return;
        setMessages(data);
        setHasMore(Boolean(meta.hasMore));
        stickBottomRef.current = true;

        const join = await joinChannel(roomId);
        if (!cancelled && join.users) setPresence(join.users);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t("discuss.error"));
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
      leaveChannel(roomId);
    };
  }, [activeId, t]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, typingNames, loadingMessages]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = distance < 64;
  }

  async function loadOlder() {
    if (!activeId || !hasMore || loadingOlder || messages.length === 0) return;
    const el = scrollerRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    const oldestId = messages[0]?.id;
    if (!oldestId) return;

    setLoadingOlder(true);
    try {
      const { data, meta } = await apiList<ChatMessage[]>(
        `/chat/rooms/${activeId}/messages?limit=50&before=${oldestId}`,
      );
      stickBottomRef.current = false;
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...data.filter((m) => !ids.has(m.id)), ...prev];
      });
      setHasMore(Boolean(meta.hasMore));
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - prevHeight;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("discuss.error"));
    } finally {
      setLoadingOlder(false);
    }
  }

  async function onCreateChannel(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    try {
      const room = await api<ChatRoom>("/chat/rooms", {
        method: "POST",
        body: JSON.stringify({ name, description: newDesc.trim() || null }),
      });
      setRooms((prev) => [...prev, { ...room, messageCount: 0, lastMessage: null }]);
      setActiveId(room.id);
      setNewName("");
      setNewDesc("");
      setNewChannelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("discuss.error"));
    }
  }

  function onDraftChange(value: string) {
    setDraft(value);
    if (!activeId) return;
    emitTyping(activeId, true);
    if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    typingIdleRef.current = setTimeout(() => {
      if (activeId) emitTyping(activeId, false);
    }, 1200);
  }

  async function onClearHistory() {
    if (!activeRoom || !canManageActive || busyAction) return;
    setBusyAction(true);
    setError(null);
    try {
      await api(`/chat/rooms/${activeRoom.id}/messages`, { method: "DELETE" });
      setMessages([]);
      setHasMore(false);
      setRooms((prev) =>
        prev.map((r) =>
          r.id === activeRoom.id ? { ...r, messageCount: 0, lastMessage: null } : r,
        ),
      );
      setConfirmAction(null);
      notify({
        title: t("discuss.toastClearedTitle"),
        body: t("discuss.toastClearedBody", { name: activeRoom.name }),
        tone: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("discuss.error"));
    } finally {
      setBusyAction(false);
    }
  }

  async function onRemoveChannel() {
    if (!activeRoom || !canManageActive || busyAction) return;
    if (rooms.length <= 1) {
      setError(t("discuss.cannotRemoveLast"));
      setConfirmAction(null);
      return;
    }
    setBusyAction(true);
    setError(null);
    const removedId = activeRoom.id;
    const removedName = activeRoom.name;
    try {
      await api(`/chat/rooms/${removedId}`, { method: "DELETE" });
      leaveChannel(removedId);
      setRooms((prev) => {
        const next = prev.filter((r) => r.id !== removedId);
        setActiveId(next[0]?.id ?? null);
        return next;
      });
      setMessages([]);
      setPresence([]);
      setConfirmAction(null);
      notify({
        title: t("discuss.toastRemovedTitle"),
        body: t("discuss.toastRemovedBody", { name: removedName }),
        tone: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("discuss.error"));
    } finally {
      setBusyAction(false);
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !activeId) return;
    setDraft("");
    setError(null);
    emitTyping(activeId, false);
    const result = await sendChatMessage(activeId, body);
    if (!result.ok) {
      setDraft(body);
      setError(t("discuss.sendFailed"));
      return;
    }
    stickBottomRef.current = true;
    setMessages((prev) => (prev.some((m) => m.id === result.data.id) ? prev : [...prev, result.data]));
  }

  return (
    <section className="page discuss-page">
      <header className="page-header discuss-header">
        <div>
          <h1>{t("discuss.heading")}</h1>
        </div>
        <div className="discuss-status" aria-live="polite">
          <span className={`discuss-dot ${connected ? "on" : "off"}`} />
          {connected ? t("discuss.live") : t("discuss.reconnecting")}
        </div>
      </header>

      {error && (
        <AlertBanner tone="danger" onDismiss={() => setError(null)}>
          {error}
        </AlertBanner>
      )}

      <div className="discuss-layout">
        <aside className="discuss-channels panel">
          <div className="discuss-channels-head">
            <h2>{t("discuss.channels")}</h2>
            <button
              type="button"
              className="btn"
              onClick={() => setNewChannelOpen((v) => !v)}
            >
              {t("discuss.newChannel")}
            </button>
          </div>

          {newChannelOpen && (
            <form className="discuss-new-channel stack" onSubmit={(e) => void onCreateChannel(e)}>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={t("discuss.channelName")}
                required
                maxLength={80}
              />
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder={t("discuss.channelDesc")}
                maxLength={280}
              />
              <button type="submit" className="btn primary">
                {t("discuss.createChannel")}
              </button>
            </form>
          )}

          {loadingRooms && <p className="muted">{t("common.loading")}</p>}
          {!loadingRooms && rooms.length === 0 && <p className="muted">{t("discuss.noChannels")}</p>}

          <ul className="discuss-channel-list">
            {rooms.map((room) => (
              <li key={room.id}>
                <button
                  type="button"
                  className={`discuss-channel-item ${room.id === activeId ? "active" : ""}`}
                  onClick={() => setActiveId(room.id)}
                >
                  <span className="discuss-channel-name">{room.name}</span>
                  <span className="muted small discuss-channel-preview">
                    {room.lastMessage
                      ? `${room.lastMessage.author.name}: ${room.lastMessage.body}`
                      : t("discuss.emptyChannel")}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="discuss-stage panel">
          {!activeRoom && (
            <div className="discuss-empty">
              <p className="muted">{t("discuss.pickChannel")}</p>
            </div>
          )}

          {activeRoom && (
            <>
              <header className="discuss-stage-head">
                <div>
                  <h2>{activeRoom.name}</h2>
                  {activeRoom.description && <p className="muted">{activeRoom.description}</p>}
                </div>
                <div className="discuss-stage-meta">
                  {canManageActive && (
                    <div className="discuss-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={busyAction || (messages.length === 0 && activeRoom.messageCount === 0)}
                        onClick={() => setConfirmAction("clear")}
                      >
                        {t("discuss.clearHistory")}
                      </button>
                      <button
                        type="button"
                        className="btn danger"
                        disabled={busyAction || rooms.length <= 1}
                        onClick={() => setConfirmAction("remove")}
                        title={rooms.length <= 1 ? t("discuss.cannotRemoveLast") : undefined}
                      >
                        {t("discuss.removeChannel")}
                      </button>
                    </div>
                  )}
                  <div className="discuss-presence" title={t("discuss.online")}>
                    {presence.slice(0, 5).map((p) => (
                      <span key={p.id} className="discuss-avatar" title={p.name}>
                        {p.avatarUrl ? (
                          <img src={mediaUrl(p.avatarUrl)} alt="" />
                        ) : (
                          initialsOf(p.name)
                        )}
                      </span>
                    ))}
                    {presence.length > 5 && (
                      <span className="discuss-avatar more">+{presence.length - 5}</span>
                    )}
                    <span className="muted small">
                      {t("discuss.onlineCount", { count: presence.length })}
                    </span>
                  </div>
                </div>
              </header>

              <div className="discuss-stream" ref={scrollerRef} onScroll={onScroll}>
                {hasMore && (
                  <button
                    type="button"
                    className="btn discuss-load-older"
                    disabled={loadingOlder}
                    onClick={() => void loadOlder()}
                  >
                    {loadingOlder ? t("common.loading") : t("discuss.loadOlder")}
                  </button>
                )}

                {loadingMessages && <p className="muted discuss-stream-status">{t("common.loading")}</p>}

                {!loadingMessages && messages.length === 0 && (
                  <p className="muted discuss-stream-status">{t("discuss.startConversation")}</p>
                )}

                {messages.map((msg, idx) => {
                  const mine = msg.author.id === user?.id;
                  const prev = messages[idx - 1];
                  const showDay = !prev || !sameDay(prev.createdAt, msg.createdAt);
                  const stack =
                    prev &&
                    prev.author.id === msg.author.id &&
                    !showDay &&
                    new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 120_000;

                  return (
                    <div key={msg.id}>
                      {showDay && (
                        <div className="discuss-day">
                          <span>{formatDay(msg.createdAt, i18n.language)}</span>
                        </div>
                      )}
                      <article
                        className={`discuss-msg ${mine ? "mine" : ""} ${stack ? "stack" : ""}`}
                      >
                        {!mine && !stack && (
                          <div className="discuss-avatar lg" aria-hidden>
                            {msg.author.avatarUrl ? (
                              <img src={mediaUrl(msg.author.avatarUrl)} alt="" />
                            ) : (
                              initialsOf(msg.author.name)
                            )}
                          </div>
                        )}
                        {!mine && stack && <div className="discuss-avatar-spacer" />}
                        <div className="discuss-bubble">
                          {!mine && !stack && (
                            <header>
                              <strong>{msg.author.name}</strong>
                              <time dateTime={msg.createdAt}>
                                {formatClock(msg.createdAt, i18n.language)}
                              </time>
                            </header>
                          )}
                          <p>{msg.body}</p>
                          {(mine || stack) && (
                            <time dateTime={msg.createdAt}>
                              {formatClock(msg.createdAt, i18n.language)}
                            </time>
                          )}
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>

              <div className="discuss-typing" aria-live="polite">
                {typingNames.length > 0
                  ? t("discuss.typing", { names: typingNames.join(", ") })
                  : "\u00a0"}
              </div>

              <form className="discuss-composer" onSubmit={(e) => void onSend(e)}>
                <input
                  value={draft}
                  onChange={(e) => onDraftChange(e.target.value)}
                  placeholder={t("discuss.placeholder")}
                  maxLength={4000}
                  aria-label={t("discuss.placeholder")}
                />
                <button type="submit" className="btn primary" disabled={!draft.trim()}>
                  {t("discuss.send")}
                </button>
              </form>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction != null && activeRoom != null}
        title={
          confirmAction === "remove"
            ? t("discuss.removeTitle")
            : t("discuss.clearTitle")
        }
        body={
          activeRoom
            ? confirmAction === "remove"
              ? t("discuss.removeConfirm", { name: activeRoom.name })
              : t("discuss.clearConfirm", { name: activeRoom.name })
            : undefined
        }
        danger={confirmAction === "remove"}
        busy={busyAction}
        confirmLabel={
          confirmAction === "remove" ? t("discuss.removeChannel") : t("discuss.clearHistory")
        }
        onConfirm={() => {
          if (confirmAction === "remove") void onRemoveChannel();
          else void onClearHistory();
        }}
        onCancel={() => {
          if (!busyAction) setConfirmAction(null);
        }}
      />
    </section>
  );
}
