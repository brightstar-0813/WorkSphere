import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../auth.js";
import {
  broadcastChatMessage,
  broadcastRoomCleared,
  broadcastRoomDeleted,
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

async function uniqueSlug(name: string) {
  let slug = slugify(name);
  let n = 0;
  while (await prisma.chatRoom.findUnique({ where: { slug } })) {
    n += 1;
    slug = `${slugify(name)}-${n}`;
  }
  return slug;
}

function canManageRoom(user: Express.Request["user"], room: { createdById: string }) {
  return user!.role === "ADMIN" || room.createdById === user!.id;
}

const authorSelect = { id: true, name: true, avatarUrl: true } as const;

chatRouter.get("/rooms", async (req, res) => {
  let rooms = await prisma.chatRoom.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      createdBy: { select: { id: true, name: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        include: { author: { select: authorSelect } },
      },
      _count: { select: { messages: true } },
    },
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
      include: {
        createdBy: { select: { id: true, name: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { author: { select: authorSelect } },
        },
        _count: { select: { messages: true } },
      },
    });
  }

  const data = rooms.map((room) => ({
    id: room.id,
    name: room.name,
    slug: room.slug,
    description: room.description,
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
  }));

  return res.json({ data });
});

chatRouter.post("/rooms", async (req, res) => {
  const schema = z.object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(280).optional().nullable(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const slug = await uniqueSlug(parsed.data.name);
  const data = await prisma.chatRoom.create({
    data: {
      name: parsed.data.name,
      slug,
      description: parsed.data.description ?? null,
      createdById: req.user!.id,
    },
    include: { createdBy: { select: { id: true, name: true } } },
  });

  return res.status(201).json({
    data: {
      ...data,
      messageCount: 0,
      lastMessage: null,
    },
  });
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

  return res.json({
    data: page,
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

  broadcastChatMessage({
    id: data.id,
    roomId: data.roomId,
    roomName: room.name,
    body: data.body,
    createdAt: data.createdAt,
    author: data.author,
  });

  return res.status(201).json({ data });
});
