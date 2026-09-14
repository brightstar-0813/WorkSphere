import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../auth.js";
import {
  aggregateReactions,
  isAllowedChatEmoji,
  type ReactionAgg,
} from "../chatEmoji.js";
import {
  broadcastChatMessage,
  broadcastMessageReaction,
  broadcastMessageUpdated,
  broadcastRoomCleared,
  broadcastRoomDeleted,
  broadcastRoomUpdated,
} from "../realtime/chat.js";

export const chatRouter = Router();
chatRouter.use(requireAuth);

const MESSAGE_PAGE = 50;

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u0400-\u04ff\u4e00-\u9fff]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || `channel-${Date.now().toString(36)}`;
}

async function uniqueSlug(name: string, excludeId?: string) {
  let slug = slugify(name);
  let n = 0;
  while (true) {
    const existing = await prisma.chatRoom.findUnique({ where: { slug } });
    if (!existing || existing.id === excludeId) return slug;
    n += 1;
    slug = `${slugify(name)}-${n}`;
  }
}

function canManageRoom(user: Express.Request["user"], room: { createdById: string }) {
  return user!.role === "ADMIN" || room.createdById === user!.id;
}

async function userHasRoomAccess(
  user: { id: string; role: string },
  room: { id: string; createdById: string; passwordHash: string | null },
) {
  if (!room.passwordHash) return true;
  if (user.role === "ADMIN" || room.createdById === user.id) return true;
  const unlock = await prisma.chatRoomUnlock.findUnique({
    where: { roomId_userId: { roomId: room.id, userId: user.id } },
  });
  return Boolean(unlock);
}

const authorSelect = { id: true, name: true, avatarUrl: true } as const;

type MessageRow = {
  id: string;
  roomId: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  author: { id: string; name: string; avatarUrl: string | null };
};

function mapMessageDto(message: MessageRow, reactions: ReactionAgg[] = []) {
  return {
    id: message.id,
    roomId: message.roomId,
    body: message.body,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    author: message.author,
    reactions,
  };
}

async function reactionsForMessages(messageIds: string[], viewerId: string) {
  if (messageIds.length === 0) return new Map<string, ReactionAgg[]>();
  const rows = await prisma.chatMessageReaction.findMany({
    where: { messageId: { in: messageIds } },
    select: { messageId: true, emoji: true, userId: true },
  });
  const byMessage = new Map<string, Array<{ emoji: string; userId: string }>>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    list.push({ emoji: row.emoji, userId: row.userId });
    byMessage.set(row.messageId, list);
  }
  const out = new Map<string, ReactionAgg[]>();
  for (const id of messageIds) {
    out.set(id, aggregateReactions(byMessage.get(id) ?? [], viewerId));
  }
  return out;
}

async function loadMessageReactions(messageId: string, viewerId: string) {
  const rows = await prisma.chatMessageReaction.findMany({
    where: { messageId },
    select: { emoji: true, userId: true },
  });
  return aggregateReactions(rows, viewerId);
}

const roomInclude = {
  createdBy: { select: { id: true, name: true } },
  messages: {
    orderBy: { createdAt: "desc" as const },
    take: 1,
    include: { author: { select: authorSelect } },
  },
  _count: { select: { messages: true } },
};

function mapRoom(
  room: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    passwordHash: string | null;
    createdAt: Date;
    createdBy: { id: string; name: string };
    messages: Array<{
      id: string;
      body: string;
      createdAt: Date;
      author: { id: string; name: string; avatarUrl: string | null };
    }>;
    _count: { messages: number };
  },
  unlocked: boolean,
) {
  return {
    id: room.id,
    name: room.name,
    slug: room.slug,
    description: room.description,
    hasPassword: Boolean(room.passwordHash),
    unlocked,
    createdAt: room.createdAt,
    createdBy: room.createdBy,
    messageCount: room._count.messages,
    lastMessage: room.messages[0]
      ? {
          id: room.messages[0].id,
          body: room.messages[0].body,
          createdAt: room.messages[0].createdAt,
          author: room.messages[0].author,
        }
      : null,
  };
}

chatRouter.get("/rooms", async (req, res) => {
  let rooms = await prisma.chatRoom.findMany({
    orderBy: { createdAt: "asc" },
    include: roomInclude,
  });

  if (rooms.length === 0) {
    const admin = await prisma.user.findFirst({
      where: { role: "ADMIN", disabled: false },
      orderBy: { createdAt: "asc" },
    });
    const creatorId = admin?.id ?? req.user!.id;
    await prisma.chatRoom.create({
      data: {
        name: "General",
        slug: "general",
        description: "Shared channel for the whole team.",
        createdById: creatorId,
      },
    });
    rooms = await prisma.chatRoom.findMany({
      orderBy: { createdAt: "asc" },
      include: roomInclude,
    });
  }

  const unlocks = await prisma.chatRoomUnlock.findMany({
    where: {
      userId: req.user!.id,
      roomId: { in: rooms.map((r) => r.id) },
    },
    select: { roomId: true },
  });
  const unlockedIds = new Set(unlocks.map((u) => u.roomId));

  const data = rooms.map((room) => {
    const unlocked =
      !room.passwordHash ||
      req.user!.role === "ADMIN" ||
      room.createdById === req.user!.id ||
      unlockedIds.has(room.id);
    const mapped = mapRoom(room, unlocked);
    // Do not leak message previews until the channel is unlocked.
    if (!unlocked) {
      return { ...mapped, lastMessage: null, messageCount: room._count.messages };
    }
    return mapped;
  });

  return res.json({ data });
});

chatRouter.post("/rooms", async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(280).optional().nullable(),
    password: z.string().min(4).max(72).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const password = parsed.data.password?.trim() || "";
  const passwordHash = password ? await bcrypt.hash(password, 10) : null;
  const slug = await uniqueSlug(parsed.data.name);
  const data = await prisma.chatRoom.create({
    data: {
      name: parsed.data.name,
      slug,
      description: parsed.data.description ?? null,
      passwordHash,
      createdById: req.user!.id,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  if (passwordHash) {
    await prisma.chatRoomUnlock.create({
      data: { roomId: data.id, userId: req.user!.id },
    });
  }

  return res.status(201).json({
    data: {
      id: data.id,
      name: data.name,
      slug: data.slug,
      description: data.description,
      hasPassword: Boolean(passwordHash),
      unlocked: true,
      createdAt: data.createdAt,
      createdBy: data.createdBy,
      messageCount: 0,
      lastMessage: null,
    },
  });
});

chatRouter.patch("/rooms/:id", async (req, res) => {
  const room = await prisma.chatRoom.findUnique({ where: { id: req.params.id } });
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  }
  if (!canManageRoom(req.user, room)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not allowed" } });
  }

  const schema = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(280).optional().nullable(),
    /** Set a new password, or empty string / null to remove protection */
    password: z.string().max(72).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  let passwordHash: string | null | undefined = undefined;
  let passwordChanged = false;
  if (parsed.data.password !== undefined) {
    const next = (parsed.data.password ?? "").trim();
    if (!next) {
      passwordHash = null;
      passwordChanged = Boolean(room.passwordHash);
    } else if (next.length < 4) {
      return res.status(400).json({
        error: { code: "VALIDATION", message: "Password must be at least 4 characters" },
      });
    } else {
      passwordHash = await bcrypt.hash(next, 10);
      passwordChanged = true;
    }
  }

  const name = parsed.data.name?.trim();
  const slug = name ? await uniqueSlug(name, room.id) : undefined;

  const updated = await prisma.chatRoom.update({
    where: { id: room.id },
    data: {
      name,
      slug,
      description:
        parsed.data.description === undefined ? undefined : parsed.data.description,
      passwordHash,
    },
    include: roomInclude,
  });

  if (passwordChanged) {
    await prisma.chatRoomUnlock.deleteMany({ where: { roomId: room.id } });
    if (updated.passwordHash) {
      await prisma.chatRoomUnlock.create({
        data: { roomId: room.id, userId: req.user!.id },
      });
    }
  }

  const unlocked =
    !updated.passwordHash ||
    req.user!.role === "ADMIN" ||
    updated.createdById === req.user!.id ||
    Boolean(
      await prisma.chatRoomUnlock.findUnique({
        where: { roomId_userId: { roomId: updated.id, userId: req.user!.id } },
      }),
    );

  const dto = mapRoom(updated, unlocked);
  broadcastRoomUpdated({
    id: dto.id,
    name: dto.name,
    description: dto.description,
    hasPassword: dto.hasPassword,
    passwordChanged,
  });
  return res.json({ data: dto });
});

chatRouter.post("/rooms/:id/unlock", async (req, res) => {
  const room = await prisma.chatRoom.findUnique({ where: { id: req.params.id } });
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  }
  if (!room.passwordHash) {
    return res.json({ data: { unlocked: true } });
  }
  if (canManageRoom(req.user, room)) {
    await prisma.chatRoomUnlock.upsert({
      where: { roomId_userId: { roomId: room.id, userId: req.user!.id } },
      create: { roomId: room.id, userId: req.user!.id },
      update: { unlockedAt: new Date() },
    });
    return res.json({ data: { unlocked: true } });
  }

  const schema = z.object({ password: z.string().min(1).max(72) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Password required" } });
  }

  const ok = await bcrypt.compare(parsed.data.password, room.passwordHash);
  if (!ok) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Wrong password" } });
  }

  await prisma.chatRoomUnlock.upsert({
    where: { roomId_userId: { roomId: room.id, userId: req.user!.id } },
    create: { roomId: room.id, userId: req.user!.id },
    update: { unlockedAt: new Date() },
  });

  return res.json({ data: { unlocked: true } });
});

chatRouter.delete("/rooms/:id", async (req, res) => {
  const room = await prisma.chatRoom.findUnique({ where: { id: req.params.id } });
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  }
  if (!canManageRoom(req.user, room)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not allowed" } });
  }

  const totalRooms = await prisma.chatRoom.count();
  if (totalRooms <= 1) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Cannot remove the last channel" },
    });
  }

  await prisma.chatRoom.delete({ where: { id: room.id } });
  broadcastRoomDeleted(room.id);
  return res.status(204).send();
});

chatRouter.delete("/rooms/:id/messages", async (req, res) => {
  const room = await prisma.chatRoom.findUnique({ where: { id: req.params.id } });
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  }
  if (!canManageRoom(req.user, room)) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not allowed" } });
  }

  await prisma.chatMessage.deleteMany({ where: { roomId: room.id } });
  await prisma.chatRoom.update({
    where: { id: room.id },
    data: { updatedAt: new Date() },
  });
  broadcastRoomCleared(room.id);
  return res.status(204).send();
});

chatRouter.get("/rooms/:id/messages", async (req, res) => {
  const room = await prisma.chatRoom.findUnique({ where: { id: req.params.id } });
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  }
  if (!(await userHasRoomAccess(req.user!, room))) {
    return res.status(403).json({ error: { code: "LOCKED", message: "Password required" } });
  }

  const limitRaw = Number(req.query.limit ?? MESSAGE_PAGE);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.floor(limitRaw), 1), 100) : MESSAGE_PAGE;
  const before = typeof req.query.before === "string" ? req.query.before : undefined;

  let beforeAt: Date | undefined;
  if (before) {
    const cursor = await prisma.chatMessage.findFirst({
      where: { id: before, roomId: room.id },
      select: { createdAt: true },
    });
    if (cursor) beforeAt = cursor.createdAt;
  }

  const rows = await prisma.chatMessage.findMany({
    where: {
      roomId: room.id,
      ...(beforeAt ? { createdAt: { lt: beforeAt } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: { author: { select: authorSelect } },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  page.reverse();

  const reactionMap = await reactionsForMessages(
    page.map((m) => m.id),
    req.user!.id,
  );

  return res.json({
    data: page.map((m) => mapMessageDto(m, reactionMap.get(m.id) ?? [])),
    meta: {
      page: 1,
      pageSize: limit,
      total: page.length,
      totalPages: 1,
      hasMore,
      nextBefore: hasMore && page.length ? page[0].id : null,
    },
  });
});

chatRouter.post("/rooms/:id/messages", async (req, res) => {
  const room = await prisma.chatRoom.findUnique({ where: { id: req.params.id } });
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  }
  if (!(await userHasRoomAccess(req.user!, room))) {
    return res.status(403).json({ error: { code: "LOCKED", message: "Password required" } });
  }

  const schema = z.object({ body: z.string().trim().min(1).max(4000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const data = await prisma.chatMessage.create({
    data: {
      roomId: room.id,
      authorId: req.user!.id,
      body: parsed.data.body,
    },
    include: { author: { select: authorSelect } },
  });

  await prisma.chatRoom.update({
    where: { id: room.id },
    data: { updatedAt: new Date() },
  });

  const dto = mapMessageDto(data, []);
  broadcastChatMessage({
    id: data.id,
    roomId: data.roomId,
    roomName: room.name,
    body: data.body,
    createdAt: data.createdAt,
    editedAt: data.editedAt,
    author: data.author,
    reactions: [],
  });

  return res.status(201).json({ data: dto });
});

chatRouter.patch("/rooms/:roomId/messages/:messageId", async (req, res) => {
  const room = await prisma.chatRoom.findUnique({ where: { id: req.params.roomId } });
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  }
  if (!(await userHasRoomAccess(req.user!, room))) {
    return res.status(403).json({ error: { code: "LOCKED", message: "Password required" } });
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.messageId },
  });
  if (!message || message.roomId !== room.id) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Message not found" } });
  }
  if (message.authorId !== req.user!.id && req.user!.role !== "ADMIN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not allowed" } });
  }

  const schema = z.object({ body: z.string().trim().min(1).max(4000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const data = await prisma.chatMessage.update({
    where: { id: message.id },
    data: { body: parsed.data.body, editedAt: new Date() },
    include: { author: { select: authorSelect } },
  });

  const reactions = await loadMessageReactions(data.id, req.user!.id);
  const dto = mapMessageDto(data, reactions);

  broadcastMessageUpdated({
    id: data.id,
    roomId: data.roomId,
    body: data.body,
    createdAt: data.createdAt,
    editedAt: data.editedAt,
    author: data.author,
    reactions,
  });

  return res.json({ data: dto });
});

chatRouter.post("/rooms/:roomId/messages/:messageId/reactions", async (req, res) => {
  const room = await prisma.chatRoom.findUnique({ where: { id: req.params.roomId } });
  if (!room) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Channel not found" } });
  }
  if (!(await userHasRoomAccess(req.user!, room))) {
    return res.status(403).json({ error: { code: "LOCKED", message: "Password required" } });
  }

  const schema = z.object({ emoji: z.string().trim().min(1).max(16) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !isAllowedChatEmoji(parsed.data.emoji)) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Unsupported emoji reaction" },
    });
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.messageId },
    select: { id: true, roomId: true },
  });
  if (!message || message.roomId !== room.id) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Message not found" } });
  }

  const emoji = parsed.data.emoji.trim();
  const existing = await prisma.chatMessageReaction.findUnique({
    where: {
      messageId_userId_emoji: {
        messageId: message.id,
        userId: req.user!.id,
        emoji,
      },
    },
  });

  if (existing) {
    await prisma.chatMessageReaction.delete({ where: { id: existing.id } });
  } else {
    await prisma.chatMessageReaction.create({
      data: {
        messageId: message.id,
        userId: req.user!.id,
        emoji,
      },
    });
  }

  // Aggregate for the acting user; clients merge reactedByMe from their own viewer id.
  const rows = await prisma.chatMessageReaction.findMany({
    where: { messageId: message.id },
    select: { emoji: true, userId: true },
  });
  const reactions = aggregateReactions(rows, req.user!.id);

  broadcastMessageReaction({
    messageId: message.id,
    roomId: room.id,
    reactions: rows,
  });

  return res.json({
    data: {
      messageId: message.id,
      roomId: room.id,
      reactions,
    },
  });
});
