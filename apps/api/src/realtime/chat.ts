import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { z } from "zod";
import { verifyToken, type AuthUser } from "../auth.js";
import { prisma } from "../prisma.js";

export type ChatPresenceUser = {
  id: string;
  name: string;
  avatarUrl?: string | null;
};

type SocketData = {
  user: AuthUser;
  rooms: Set<string>;
};

const authorSelect = { id: true, name: true, avatarUrl: true } as const;

/** roomId -> socketId -> presence user */
const presenceByRoom = new Map<string, Map<string, ChatPresenceUser>>();

let io: Server | null = null;

function presenceList(roomId: string): ChatPresenceUser[] {
  const map = presenceByRoom.get(roomId);
  if (!map) return [];
  const byUser = new Map<string, ChatPresenceUser>();
  for (const user of map.values()) {
    byUser.set(user.id, user);
  }
  return [...byUser.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function roomChannel(roomId: string) {
  return `room:${roomId}`;
}

function emitPresence(roomId: string) {
  io?.to(roomChannel(roomId)).emit("presence:update", {
    roomId,
    users: presenceList(roomId),
  });
}

async function loadAvatar(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { avatarUrl: true, disabled: true, name: true },
  });
  if (!user || user.disabled) return null;
  return user;
}

export function getChatIo() {
  return io;
}

export type ChatNotifyPayload = {
  id: string;
  roomId: string;
  roomName: string;
  body: string;
  createdAt: Date | string;
  editedAt?: Date | string | null;
  author: { id: string; name: string; avatarUrl?: string | null };
  reactions?: Array<{ emoji: string; count: number; reactedByMe: boolean }>;
};

export function broadcastChatMessage(message: ChatNotifyPayload) {
  const payload = {
    ...message,
    createdAt:
      typeof message.createdAt === "string" ? message.createdAt : message.createdAt.toISOString(),
    editedAt: message.editedAt
      ? typeof message.editedAt === "string"
        ? message.editedAt
        : message.editedAt.toISOString()
      : null,
    reactions: message.reactions ?? [],
  };
  io?.to(roomChannel(message.roomId)).emit("message:new", {
    id: payload.id,
    roomId: payload.roomId,
    body: payload.body,
    createdAt: payload.createdAt,
    editedAt: payload.editedAt,
    author: payload.author,
    reactions: payload.reactions,
  });
  // All authenticated sockets — powers in-app chat toasts even outside the room.
  io?.emit("chat:notify", payload);
}

export function broadcastMessageUpdated(message: {
  id: string;
  roomId: string;
  body: string;
  createdAt: Date | string;
  editedAt?: Date | string | null;
  author: { id: string; name: string; avatarUrl?: string | null };
  reactions?: Array<{ emoji: string; count: number; reactedByMe: boolean }>;
}) {
  const payload = {
    ...message,
    createdAt:
      typeof message.createdAt === "string" ? message.createdAt : message.createdAt.toISOString(),
    editedAt: message.editedAt
      ? typeof message.editedAt === "string"
        ? message.editedAt
        : message.editedAt.toISOString()
      : null,
    reactions: message.reactions,
  };
  io?.to(roomChannel(message.roomId)).emit("message:updated", payload);
}

/** Broadcast raw reaction rows so each client can recompute reactedByMe for themselves. */
export function broadcastMessageReaction(payload: {
  messageId: string;
  roomId: string;
  reactions: Array<{ emoji: string; userId: string }>;
}) {
  io?.to(roomChannel(payload.roomId)).emit("message:reaction", {
    messageId: payload.messageId,
    roomId: payload.roomId,
    reactions: payload.reactions,
  });
}

export function broadcastRoomUpdated(room: {
  id: string;
  name: string;
  description: string | null;
  hasPassword: boolean;
  passwordChanged?: boolean;
}) {
  io?.emit("room:updated", {
    id: room.id,
    name: room.name,
    description: room.description,
    hasPassword: room.hasPassword,
    passwordChanged: Boolean(room.passwordChanged),
  });
}

export function broadcastRoomCleared(roomId: string) {
  io?.emit("room:cleared", { roomId });
}

export function broadcastRoomDeleted(roomId: string) {
  io?.emit("room:deleted", { roomId });
  presenceByRoom.delete(roomId);
}

async function userCanAccessRoom(
  user: AuthUser,
  room: { id: string; createdById: string; passwordHash: string | null },
) {
  if (!room.passwordHash) return true;
  if (user.role === "ADMIN" || room.createdById === user.id) return true;
  const unlock = await prisma.chatRoomUnlock.findUnique({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
  });
  return Boolean(unlock);
}

export function attachChatRealtime(httpServer: HttpServer) {
  io = new Server(httpServer, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token =
        (typeof socket.handshake.auth?.token === "string" && socket.handshake.auth.token) ||
        (typeof socket.handshake.query?.token === "string" && socket.handshake.query.token) ||
        "";
      if (!token) {
        return next(new Error("UNAUTHORIZED"));
      }
      const payload = verifyToken(token);
      const dbUser = await loadAvatar(payload.id);
      if (!dbUser) {
        return next(new Error("UNAUTHORIZED"));
      }
      (socket.data as SocketData).user = {
        ...payload,
        name: dbUser.name || payload.name,
      };
      (socket.data as SocketData).rooms = new Set();
      next();
    } catch {
      next(new Error("UNAUTHORIZED"));
    }
  });

  io.on("connection", (socket) => {
    const data = socket.data as SocketData;
    const user = data.user;

    socket.on("room:join", async (payload: unknown, ack?: (res: unknown) => void) => {
      const parsed = z.object({ roomId: z.string().min(1) }).safeParse(payload);
      if (!parsed.success) {
        ack?.({ ok: false, error: "VALIDATION" });
        return;
      }
      const room = await prisma.chatRoom.findUnique({ where: { id: parsed.data.roomId } });
      if (!room) {
        ack?.({ ok: false, error: "NOT_FOUND" });
        return;
      }
      if (!(await userCanAccessRoom(user, room))) {
        ack?.({ ok: false, error: "LOCKED" });
        return;
      }

      const channel = roomChannel(room.id);
      await socket.join(channel);
      data.rooms.add(room.id);

      let roomPresence = presenceByRoom.get(room.id);
      if (!roomPresence) {
        roomPresence = new Map();
        presenceByRoom.set(room.id, roomPresence);
      }
      const dbUser = await loadAvatar(user.id);
      roomPresence.set(socket.id, {
        id: user.id,
        name: dbUser?.name ?? user.name,
        avatarUrl: dbUser?.avatarUrl ?? null,
      });
      emitPresence(room.id);
      ack?.({ ok: true, users: presenceList(room.id) });
    });

    socket.on("room:leave", async (payload: unknown) => {
      const parsed = z.object({ roomId: z.string().min(1) }).safeParse(payload);
      if (!parsed.success) return;
      const roomId = parsed.data.roomId;
      await socket.leave(roomChannel(roomId));
      data.rooms.delete(roomId);
      presenceByRoom.get(roomId)?.delete(socket.id);
      emitPresence(roomId);
    });

    socket.on("typing", (payload: unknown) => {
      const parsed = z
        .object({ roomId: z.string().min(1), typing: z.boolean() })
        .safeParse(payload);
      if (!parsed.success || !data.rooms.has(parsed.data.roomId)) return;
      socket.to(roomChannel(parsed.data.roomId)).emit("typing", {
        roomId: parsed.data.roomId,
        userId: user.id,
        name: user.name,
        typing: parsed.data.typing,
      });
    });

    socket.on("message:send", async (payload: unknown, ack?: (res: unknown) => void) => {
      try {
        const parsed = z
          .object({
            roomId: z.string().min(1),
            body: z.string().trim().min(1).max(4000),
          })
          .safeParse(payload);
        if (!parsed.success) {
          ack?.({ ok: false, error: "VALIDATION" });
          return;
        }

        const room = await prisma.chatRoom.findUnique({ where: { id: parsed.data.roomId } });
        if (!room) {
          ack?.({ ok: false, error: "NOT_FOUND" });
          return;
        }
        if (!(await userCanAccessRoom(user, room))) {
          ack?.({ ok: false, error: "LOCKED" });
          return;
        }

        // Auto-join if the client reconnects without re-emitting room:join.
        if (!data.rooms.has(room.id)) {
          await socket.join(roomChannel(room.id));
          data.rooms.add(room.id);
          let roomPresence = presenceByRoom.get(room.id);
          if (!roomPresence) {
            roomPresence = new Map();
            presenceByRoom.set(room.id, roomPresence);
          }
          const dbUser = await loadAvatar(user.id);
          roomPresence.set(socket.id, {
            id: user.id,
            name: dbUser?.name ?? user.name,
            avatarUrl: dbUser?.avatarUrl ?? null,
          });
          emitPresence(room.id);
        }

        const message = await prisma.chatMessage.create({
          data: {
            roomId: room.id,
            authorId: user.id,
            body: parsed.data.body,
          },
          include: { author: { select: authorSelect } },
        });

        await prisma.chatRoom.update({
          where: { id: room.id },
          data: { updatedAt: new Date() },
        });

        const dto = {
          id: message.id,
          roomId: message.roomId,
          roomName: room.name,
          body: message.body,
          createdAt: message.createdAt.toISOString(),
          editedAt: message.editedAt ? message.editedAt.toISOString() : null,
          author: message.author,
          reactions: [] as Array<{ emoji: string; count: number; reactedByMe: boolean }>,
        };
        broadcastChatMessage(dto);
        ack?.({
          ok: true,
          data: {
            id: dto.id,
            roomId: dto.roomId,
            body: dto.body,
            createdAt: dto.createdAt,
            editedAt: dto.editedAt,
            author: dto.author,
            reactions: dto.reactions,
          },
        });
      } catch (err) {
        console.error("message:send failed", err);
        ack?.({ ok: false, error: "INTERNAL" });
      }
    });

    socket.on("disconnect", () => {
      for (const roomId of data.rooms) {
        presenceByRoom.get(roomId)?.delete(socket.id);
        emitPresence(roomId);
      }
      data.rooms.clear();
    });
  });

  return io;
}
