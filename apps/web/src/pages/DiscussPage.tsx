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
  hasPassword: boolean;
  unlocked: boolean;
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

function isLockedError(err: unknown) {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; message?: string; status?: number };
  if (e.code === "LOCKED") return true;
  if (e.status === 403 && e.message === "Password required") return true;
  return false;
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
  const [newPassword, setNewPassword] = useState("");
  const [editChannelOpen, setEditChannelOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [clearPassword, setClearPassword] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [presence, setPresence] = useState<ChatPresenceUser[]>([]);
  const [typingNames, setTypingNames] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"clear" | "remove" | null>(null);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickBottomRef = useRef(true);
  const typingClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeIdRef = useRef<string | null>(null);
  const userIdRef = useRef(user?.id);
  const userRoleRef = useRef(user?.role);
  const roomsRef = useRef(rooms);
  const [atBottom, setAtBottom] = useState(true);
  const [unseenCount, setUnseenCount] = useState(0);

  userIdRef.current = user?.id;
  userRoleRef.current = user?.role;
  roomsRef.current = rooms;

  const scrollElToEnd = useCallback((behavior: ScrollBehavior = "auto") => {
    const el = scrollerRef.current;
    if (!el) return;
    const run = () => {
      if (bottomRef.current) {
        bottomRef.current.scrollIntoView({ block: "end", behavior });
      } else {
        el.scrollTo({ top: el.scrollHeight, behavior });
      }
    };
    run();
    requestAnimationFrame(() => {
      run();
      requestAnimationFrame(run);
    });
  }, []);

  const jumpToLatest = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      stickBottomRef.current = true;
      setAtBottom(true);
      setUnseenCount(0);
      scrollElToEnd(behavior);
    },
    [scrollElToEnd],
  );

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
  const needsUnlock = Boolean(activeRoom?.hasPassword && !activeRoom.unlocked);
  const activeUnlocked = activeRoom ? activeRoom.unlocked : true;

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
    setEditChannelOpen(false);
    setUnlockPassword("");
    setEditingMessageId(null);
  }, [activeId]);

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
            r.id === msg.roomId && r.unlocked
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
              : r.id === msg.roomId
                ? { ...r, messageCount: r.messageCount + 1 }
                : r,
          ),
        );
        return;
      }
      setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
      if (!stickBottomRef.current && msg.author.id !== userIdRef.current) {
        setUnseenCount((n) => n + 1);
      }
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
    const onMessageUpdated = (msg: ChatMessage) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, body: msg.body, editedAt: msg.editedAt } : m)),
      );
      setRooms((prev) =>
        prev.map((r) =>
          r.lastMessage?.id === msg.id
            ? { ...r, lastMessage: { ...r.lastMessage, body: msg.body } }
            : r,
        ),
      );
    };
    const onPresence = (payload: { roomId: string; users: ChatPresenceUser[] }) => {
      if (payload.roomId === activeIdRef.current) setPresence(payload.users);
    };
    const onTyping = (payload: { roomId: string; userId: string; name: string; typing: boolean }) => {
      if (payload.roomId !== activeIdRef.current || payload.userId === userIdRef.current) return;
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
    const onRoomUpdated = (payload: {
      id: string;
      name: string;
      description: string | null;
      hasPassword: boolean;
      passwordChanged?: boolean;
    }) => {
      setRooms((prev) =>
        prev.map((r) => {
          if (r.id !== payload.id) return r;
          const manages =
            userRoleRef.current === "ADMIN" || r.createdBy.id === userIdRef.current;
          let unlocked = r.unlocked;
          if (!payload.hasPassword) unlocked = true;
          else if (payload.passwordChanged) unlocked = Boolean(manages);
          return {
            ...r,
            name: payload.name,
            description: payload.description,
            hasPassword: payload.hasPassword,
            unlocked,
            lastMessage: unlocked ? r.lastMessage : null,
          };
        }),
      );
      if (payload.id === activeIdRef.current && payload.passwordChanged && payload.hasPassword) {
        const room = roomsRef.current.find((r) => r.id === payload.id);
        const manages =
          userRoleRef.current === "ADMIN" || room?.createdBy.id === userIdRef.current;
        if (!manages) {
          setMessages([]);
          setPresence([]);
          leaveChannel(payload.id);
        }
      }
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("message:new", onMessage);
    socket.on("message:updated", onMessageUpdated);
    socket.on("presence:update", onPresence);
    socket.on("typing", onTyping);
    socket.on("room:cleared", onCleared);
    socket.on("room:deleted", onDeleted);
    socket.on("room:updated", onRoomUpdated);
    setConnected(socket.connected);
    if (socket.connected) onConnect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("message:new", onMessage);
      socket.off("message:updated", onMessageUpdated);
      socket.off("presence:update", onPresence);
      socket.off("typing", onTyping);
      socket.off("room:cleared", onCleared);
      socket.off("room:deleted", onDeleted);
      socket.off("room:updated", onRoomUpdated);
      if (typingClearRef.current) clearTimeout(typingClearRef.current);
      if (typingIdleRef.current) clearTimeout(typingIdleRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeId) {
      setMessages([]);
      setPresence([]);
      setTypingNames([]);
      setUnseenCount(0);
      setAtBottom(true);
      return;
    }

    if (!activeUnlocked) {
      setMessages([]);
      setPresence([]);
      setHasMore(false);
      setLoadingMessages(false);
      leaveChannel(activeId);
      return;
    }

    let cancelled = false;
    const roomId = activeId;

    async function load() {
      setLoadingMessages(true);
      setError(null);
      setTypingNames([]);
      setUnseenCount(0);
      stickBottomRef.current = true;
      setAtBottom(true);
      try {
        const { data, meta } = await apiList<ChatMessage[]>(`/chat/rooms/${roomId}/messages?limit=50`);
        if (cancelled) return;
        setMessages(data);
        setHasMore(Boolean(meta.hasMore));

        const join = await joinChannel(roomId);
        if (cancelled) return;
        if (!join.ok && join.error === "LOCKED") {
          setRooms((prev) =>
            prev.map((r) => (r.id === roomId ? { ...r, unlocked: false, lastMessage: null } : r)),
          );
          setMessages([]);
          setPresence([]);
          setError(null);
          return;
        }
        if (join.users) setPresence(join.users);
      } catch (e) {
        if (cancelled) return;
        if (isLockedError(e)) {
          setRooms((prev) =>
            prev.map((r) => (r.id === roomId ? { ...r, unlocked: false, lastMessage: null } : r)),
          );
          setMessages([]);
          setPresence([]);
          setError(null);
          return;
        }
        setError(e instanceof Error ? e.message : t("discuss.error"));
      } finally {
        if (!cancelled) setLoadingMessages(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
      leaveChannel(roomId);
    };
  }, [activeId, activeUnlocked, t]);

  useLayoutEffect(() => {
    if (!stickBottomRef.current || loadingMessages || needsUnlock) return;
    scrollElToEnd("auto");
  }, [messages, typingNames, loadingMessages, activeId, needsUnlock, scrollElToEnd]);

  function onScroll() {
    const el = scrollerRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distance < 80;
    stickBottomRef.current = nearBottom;
    setAtBottom(nearBottom);
    if (nearBottom) setUnseenCount(0);
  }

  async function loadOlder() {
    if (!activeId || !hasMore || loadingOlder || messages.length === 0 || needsUnlock) return;
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
    const password = newPassword.trim();
    if (password && password.length < 4) {
      setError(t("discuss.passwordTooShort"));
      return;
    }
    try {
      const room = await api<ChatRoom>("/chat/rooms", {
        method: "POST",
        body: JSON.stringify({
          name,
          description: newDesc.trim() || null,
          password: password || null,
        }),
      });
      setRooms((prev) => [
        ...prev,
        {
          ...room,
          hasPassword: Boolean(room.hasPassword),
          unlocked: true,
          messageCount: 0,
          lastMessage: null,
        },
      ]);
      setActiveId(room.id);
      setNewName("");
      setNewDesc("");
      setNewPassword("");
      setNewChannelOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("discuss.error"));
    }
  }

  function openEditChannel() {
    if (!activeRoom) return;
    setEditName(activeRoom.name);
    setEditDesc(activeRoom.description ?? "");
    setEditPassword("");
    setClearPassword(false);
    setEditChannelOpen(true);
  }

  async function onSaveChannel(e: FormEvent) {
    e.preventDefault();
    if (!activeRoom || !canManageActive || busyAction) return;
    const name = editName.trim();
    if (!name) return;
    const password = editPassword.trim();
    if (password && password.length < 4) {
      setError(t("discuss.passwordTooShort"));
      return;
    }
    setBusyAction(true);
    setError(null);
    try {
      const body: { name: string; description: string | null; password?: string | null } = {
        name,
        description: editDesc.trim() || null,
      };
      if (clearPassword) body.password = null;
      else if (password) body.password = password;

      const room = await api<ChatRoom>(`/chat/rooms/${activeRoom.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setRooms((prev) =>
        prev.map((r) =>
          r.id === room.id
            ? {
                ...r,
                ...room,
                messageCount: r.messageCount,
                lastMessage: room.unlocked ? r.lastMessage : null,
              }
            : r,
        ),
      );
      setEditChannelOpen(false);
      notify({
        title: t("discuss.toastEditedTitle"),
        body: t("discuss.toastEditedBody", { name: room.name }),
        tone: "success",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t("discuss.error"));
    } finally {
      setBusyAction(false);
    }
  }

  async function onUnlock(e: FormEvent) {
    e.preventDefault();
    if (!activeRoom || unlockBusy) return;
    const password = unlockPassword.trim();
    if (!password) return;
    setUnlockBusy(true);
    setError(null);
    try {
      await api(`/chat/rooms/${activeRoom.id}/unlock`, {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      setRooms((prev) =>
        prev.map((r) => (r.id === activeRoom.id ? { ...r, unlocked: true } : r)),
      );
      setUnlockPassword("");
    } catch (err) {
      // Keep unlock UI visible; show wrong-password inline via banner.
      setError(err instanceof Error ? err.message : t("discuss.wrongPassword"));
    } finally {
      setUnlockBusy(false);
    }
  }

  function lockActiveRoom(roomId: string) {
    setRooms((prev) =>
      prev.map((r) => (r.id === roomId ? { ...r, unlocked: false, lastMessage: null } : r)),
    );
    setMessages([]);
    setPresence([]);
    setError(null);
    leaveChannel(roomId);
  }

  function onDraftChange(value: string) {
    setDraft(value);
    if (!activeId || needsUnlock) return;
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
    if (!body || !activeId || needsUnlock) return;
    setDraft("");
    setError(null);
    emitTyping(activeId, false);
    const result = await sendChatMessage(activeId, body);
    if (!result.ok) {
      setDraft(body);
      if (result.error === "LOCKED" || result.error === "Password required") {
        lockActiveRoom(activeId);
        return;
      }
      setError(t("discuss.sendFailed"));
      return;
    }
    stickBottomRef.current = true;
    setAtBottom(true);
    setUnseenCount(0);
    setMessages((prev) => (prev.some((m) => m.id === result.data.id) ? prev : [...prev, result.data]));
    requestAnimationFrame(() => scrollElToEnd("smooth"));
  }

  function startEditMessage(msg: ChatMessage) {
    setEditingMessageId(msg.id);
    setEditingBody(msg.body);
  }

  async function onSaveMessage(e: FormEvent) {
    e.preventDefault();
    if (!activeId || !editingMessageId) return;
    const body = editingBody.trim();
    if (!body) return;
    setBusyAction(true);
    setError(null);
    try {
      const updated = await api<ChatMessage>(
        `/chat/rooms/${activeId}/messages/${editingMessageId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ body }),
        },
      );
      setMessages((prev) =>
        prev.map((m) =>
          m.id === updated.id
            ? { ...m, body: updated.body, editedAt: updated.editedAt ?? new Date().toISOString() }
            : m,
        ),
      );
      setRooms((prev) =>
        prev.map((r) =>
          r.lastMessage?.id === updated.id
            ? { ...r, lastMessage: { ...r.lastMessage, body: updated.body } }
            : r,
        ),
      );
      setEditingMessageId(null);
      setEditingBody("");
    } catch (err) {
      if (isLockedError(err) && activeId) {
        lockActiveRoom(activeId);
        return;
      }
      setError(err instanceof Error ? err.message : t("discuss.error"));
    } finally {
      setBusyAction(false);
    }
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
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder={t("discuss.channelPassword")}
                autoComplete="new-password"
                minLength={4}
                maxLength={72}
              />
              <p className="muted small">{t("discuss.channelPasswordHint")}</p>
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
                  <span className="discuss-channel-name">
                    {room.hasPassword && (
                      <span className="discuss-lock" title={t("discuss.protected")} aria-hidden />
                    )}
                    {room.name}
                  </span>
                  <span className="muted small discuss-channel-preview">
                    {room.hasPassword && !room.unlocked
                      ? t("discuss.lockedPreview")
                      : room.lastMessage
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
                  <h2>
                    {activeRoom.hasPassword && (
                      <span className="discuss-lock" title={t("discuss.protected")} aria-hidden />
                    )}
                    {activeRoom.name}
                  </h2>
                  {activeRoom.description && <p className="muted">{activeRoom.description}</p>}
                </div>
                <div className="discuss-stage-meta">
                  {canManageActive && (
                    <div className="discuss-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={busyAction}
                        onClick={() => (editChannelOpen ? setEditChannelOpen(false) : openEditChannel())}
                      >
                        {t("discuss.editChannel")}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={
                          busyAction ||
                          needsUnlock ||
                          (messages.length === 0 && activeRoom.messageCount === 0)
                        }
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
                  {!needsUnlock && (
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
                  )}
                </div>
              </header>

              {editChannelOpen && canManageActive && (
                <form className="discuss-edit-channel stack" onSubmit={(e) => void onSaveChannel(e)}>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder={t("discuss.channelName")}
                    required
                    maxLength={80}
                  />
                  <input
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder={t("discuss.channelDesc")}
                    maxLength={280}
                  />
                  <input
                    type="password"
                    value={editPassword}
                    onChange={(e) => {
                      setEditPassword(e.target.value);
                      if (e.target.value) setClearPassword(false);
                    }}
                    placeholder={
                      activeRoom.hasPassword
                        ? t("discuss.changePassword")
                        : t("discuss.channelPassword")
                    }
                    autoComplete="new-password"
                    disabled={clearPassword}
                    maxLength={72}
                  />
                  {activeRoom.hasPassword && (
                    <label className="discuss-check">
                      <input
                        type="checkbox"
                        checked={clearPassword}
                        onChange={(e) => {
                          setClearPassword(e.target.checked);
                          if (e.target.checked) setEditPassword("");
                        }}
                      />
                      {t("discuss.removePassword")}
                    </label>
                  )}
                  <div className="discuss-actions">
                    <button type="submit" className="btn primary" disabled={busyAction}>
                      {t("common.save")}
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={busyAction}
                      onClick={() => setEditChannelOpen(false)}
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </form>
              )}

              {needsUnlock ? (
                <div className="discuss-locked" role="region" aria-label={t("discuss.protected")}>
                  <span className="discuss-lock discuss-lock-lg" aria-hidden />
                  <h3>{t("discuss.lockedPreview")}</h3>
                  <p>{t("discuss.lockedHint")}</p>
                  <form className="stack discuss-unlock" onSubmit={(e) => void onUnlock(e)}>
                    <label className="field">
                      <span>{t("discuss.unlockPassword")}</span>
                      <input
                        type="password"
                        value={unlockPassword}
                        onChange={(e) => setUnlockPassword(e.target.value)}
                        placeholder={t("discuss.unlockPassword")}
                        autoComplete="current-password"
                        autoFocus
                        required
                        maxLength={72}
                      />
                    </label>
                    <button type="submit" className="btn primary" disabled={unlockBusy || !unlockPassword.trim()}>
                      {unlockBusy ? t("common.loading") : t("discuss.unlock")}
                    </button>
                  </form>
                </div>
              ) : (
                <div className="discuss-chat">
                  <div className="discuss-stream-wrap">
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

                      {loadingMessages && (
                        <p className="muted discuss-stream-status">{t("common.loading")}</p>
                      )}

                      {!loadingMessages && messages.length === 0 && (
                        <p className="muted discuss-stream-status">{t("discuss.startConversation")}</p>
                      )}

                      {messages.map((msg, idx) => {
                        const mine = msg.author.id === user?.id;
                        const canEditMsg = mine || user?.role === "ADMIN";
                        const prev = messages[idx - 1];
                        const showDay = !prev || !sameDay(prev.createdAt, msg.createdAt);
                        const stack =
                          prev &&
                          prev.author.id === msg.author.id &&
                          !showDay &&
                          new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() <
                            120_000;
                        const isEditing = editingMessageId === msg.id;

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
                                {isEditing ? (
                                  <form
                                    className="discuss-msg-edit"
                                    onSubmit={(e) => void onSaveMessage(e)}
                                  >
                                    <textarea
                                      value={editingBody}
                                      onChange={(e) => setEditingBody(e.target.value)}
                                      maxLength={4000}
                                      rows={3}
                                      autoFocus
                                    />
                                    <div className="discuss-actions">
                                      <button
                                        type="submit"
                                        className="btn primary"
                                        disabled={busyAction || !editingBody.trim()}
                                      >
                                        {t("common.save")}
                                      </button>
                                      <button
                                        type="button"
                                        className="btn"
                                        disabled={busyAction}
                                        onClick={() => {
                                          setEditingMessageId(null);
                                          setEditingBody("");
                                        }}
                                      >
                                        {t("common.cancel")}
                                      </button>
                                    </div>
                                  </form>
                                ) : (
                                  <>
                                    <p>{msg.body}</p>
                                    <div className="discuss-msg-meta">
                                      {(mine || stack) && (
                                        <time dateTime={msg.createdAt}>
                                          {formatClock(msg.createdAt, i18n.language)}
                                        </time>
                                      )}
                                      {msg.editedAt && (
                                        <span className="muted small">{t("discuss.edited")}</span>
                                      )}
                                      {canEditMsg && (
                                        <button
                                          type="button"
                                          className="discuss-msg-edit-btn"
                                          onClick={() => startEditMessage(msg)}
                                        >
                                          {t("discuss.editMessage")}
                                        </button>
                                      )}
                                    </div>
                                  </>
                                )}
                              </div>
                            </article>
                          </div>
                        );
                      })}
                      <div ref={bottomRef} className="discuss-stream-end" aria-hidden />
                    </div>

                    {!atBottom && (
                      <button
                        type="button"
                        className="discuss-jump-latest"
                        onClick={() => jumpToLatest("smooth")}
                      >
                        {unseenCount > 0
                          ? t("discuss.newMessages", { count: unseenCount })
                          : t("discuss.jumpLatest")}
                      </button>
                    )}
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
                </div>
              )}
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
