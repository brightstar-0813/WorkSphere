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
  author: ChatAuthor;
};

export type ChatPresenceUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

type AckResult<T> = { ok: true; data: T } | { ok: false; error?: string };

let socket: Socket | null = null;
const joinedRooms = new Set<string>();

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

  return socket;
}

export function disconnectChatSocket() {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  joinedRooms.clear();
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
    return { ok: false, error: e instanceof Error ? e.message : "FAILED" };
  }
}

export function emitTyping(roomId: string, typing: boolean) {
  if (!socket?.connected || !joinedRooms.has(roomId)) return;
  socket.emit("typing", { roomId, typing });
}
