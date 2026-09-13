import { io, type Socket } from "socket.io-client";
import { API_BASE } from "./config";
import { api, getToken } from "./api";

export type ChatAuthor = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

export type ChatMessage = {
  id: string;
  roomId: string;
  body: string;
  createdAt: string;
  editedAt?: string | null;
  author: ChatAuthor;
};

export type ChatNotifyPayload = ChatMessage & {
  roomName: string;
};

export type ChatPresenceUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

type AckResult<T> = { ok: true; data: T } | { ok: false; error?: string };

let socket: Socket | null = null;
const joinedRooms = new Set<string>();
let activeDiscussRoomId: string | null = null;
let chatNotifyHandler: ((payload: ChatNotifyPayload) => void) | null = null;
let chatNotifyBound = false;

function withTimeout<T>(promise: Promise<T>, ms: number, error = "TIMEOUT"): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(error)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function getChatSocket() {
  return socket;
}

/** Track which Discuss channel is open so we can suppress redundant toasts. */
export function setActiveDiscussRoom(roomId: string | null) {
  activeDiscussRoomId = roomId;
}

export function getActiveDiscussRoom() {
  return activeDiscussRoomId;
}

export function shouldSuppressChatToast(roomId: string) {
  if (typeof document === "undefined") return false;
  if (document.visibilityState !== "visible") return false;
  if (!window.location.pathname.startsWith("/discuss")) return false;
  return activeDiscussRoomId === roomId;
}

function onChatNotify(payload: ChatNotifyPayload) {
  chatNotifyHandler?.(payload);
}

function bindChatNotifyListener(s: Socket) {
  if (chatNotifyBound) return;
  s.on("chat:notify", onChatNotify);
  chatNotifyBound = true;
}

export function setChatNotifyHandler(handler: ((payload: ChatNotifyPayload) => void) | null) {
  chatNotifyHandler = handler;
  if (handler) {
    const s = connectChatSocket();
    if (s) bindChatNotifyListener(s);
  }
}

async function waitUntilConnected(s: Socket, ms = 8000): Promise<boolean> {
  if (s.connected) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      s.off("connect", onConnect);
      resolve(false);
    }, ms);
    const onConnect = () => {
      clearTimeout(timer);
      resolve(true);
    };
    s.once("connect", onConnect);
    if (!s.active) s.connect();
  });
}

export function connectChatSocket() {
  const token = getToken();
  if (!token) return null;

  if (socket) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    bindChatNotifyListener(socket);
    return socket;
  }

  socket = io(API_BASE || undefined, {
    path: "/socket.io",
    transports: ["websocket", "polling"],
    auth: { token },
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 800,
  });

  socket.on("connect", () => {
    // Server presence is per-connection; force rejoin after reconnect.
    joinedRooms.clear();
  });

  socket.on("disconnect", () => {
    joinedRooms.clear();
  });

  bindChatNotifyListener(socket);
  return socket;
}

export function disconnectChatSocket() {
  if (!socket) return;
  socket.off("chat:notify", onChatNotify);
  chatNotifyBound = false;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  joinedRooms.clear();
  activeDiscussRoomId = null;
}

export async function joinChannel(
  roomId: string,
): Promise<{ ok: boolean; users?: ChatPresenceUser[]; error?: string }> {
  const s = connectChatSocket();
  if (!s) return { ok: false, error: "NO_SOCKET" };

  const ready = await waitUntilConnected(s);
  if (!ready) return { ok: false, error: "NOT_CONNECTED" };

  try {
    const res = await withTimeout(
      new Promise<{ ok?: boolean; users?: ChatPresenceUser[]; error?: string }>((resolve) => {
        s.emit("room:join", { roomId }, (ack: { ok?: boolean; users?: ChatPresenceUser[]; error?: string } | undefined) =>
          resolve(ack ?? { ok: false, error: "NO_ACK" }),
        );
      }),
      8000,
    );
    if (res?.ok) joinedRooms.add(roomId);
    return {
      ok: Boolean(res?.ok),
      users: res?.users,
      error: res?.error,
    };
  } catch {
    return { ok: false, error: "TIMEOUT" };
  }
}

export function leaveChannel(roomId: string) {
  joinedRooms.delete(roomId);
  socket?.emit("room:leave", { roomId });
}

export async function sendChatMessage(roomId: string, body: string): Promise<AckResult<ChatMessage>> {
  const s = connectChatSocket();

  if (s && (await waitUntilConnected(s, 3000))) {
    if (!joinedRooms.has(roomId)) {
      await joinChannel(roomId);
    }

    if (joinedRooms.has(roomId)) {
      try {
        const res = await withTimeout(
          new Promise<{ ok?: boolean; data?: ChatMessage; error?: string }>((resolve) => {
            s.emit("message:send", { roomId, body }, (ack: { ok?: boolean; data?: ChatMessage; error?: string } | undefined) =>
              resolve(ack ?? { ok: false, error: "NO_ACK" }),
            );
          }),
          8000,
        );
        if (res?.ok && res.data) return { ok: true, data: res.data };
      } catch {
        // Fall through to REST
      }
    }
  }

  try {
    const data = await api<ChatMessage>(`/chat/rooms/${roomId}/messages`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return { ok: true, data };
  } catch (e) {
    const err = e as Error & { code?: string; message?: string };
    if (err?.code === "LOCKED" || err?.message === "Password required") {
      return { ok: false, error: "LOCKED" };
    }
    return { ok: false, error: e instanceof Error ? e.message : "FAILED" };
  }
}

export function emitTyping(roomId: string, typing: boolean) {
  if (!socket?.connected || !joinedRooms.has(roomId)) return;
  socket.emit("typing", { roomId, typing });
}
