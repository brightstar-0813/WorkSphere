import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../auth.js";
import { claimCalendarSharesForUser } from "../calendarShareClaim.js";
import { sendCalendarShareInvite, shareInviteUrl } from "../mail.js";
import { ensureUserForEmail } from "../ensureUser.js";
import {
  googleConfigured,
  outlookConfigured,
  signOAuthState,
} from "../integrations/oauthConfig.js";
import { googleAuthUrl, outlookAuthUrl } from "../integrations/calendarProviders.js";
import { normalizeCalendarUrl } from "../integrations/icsParse.js";
import { addIcsFeed } from "../integrations/icsSync.js";

export const calendarSharesRouter = Router();

type ShareUser = { id: string; email: string; name: string };

function mapShare(row: {
  id: string;
  status: string;
  ownerEmail: string;
  ownerId: string | null;
  inviteToken: string;
  label: string;
  color: string;
  createdAt: Date;
  respondedAt: Date | null;
  lastInvitedAt: Date | null;
  requester: ShareUser;
  owner: ShareUser | null;
}) {
  const ownerName = row.owner?.name?.trim() || "";
  return {
    id: row.id,
    status: row.status,
    ownerEmail: row.ownerEmail,
    ownerId: row.ownerId,
    label: row.label?.trim() || ownerName || row.ownerEmail,
    color: row.color || "#6366f1",
    awaitingAccept: row.status === "PENDING",
    inviteUrl: shareInviteUrl(row.inviteToken),
    createdAt: row.createdAt.toISOString(),
    respondedAt: row.respondedAt?.toISOString() ?? null,
    lastInvitedAt: row.lastInvitedAt?.toISOString() ?? null,
    requester: row.requester,
    owner: row.owner ?? {
      id: "",
      email: row.ownerEmail,
      name: ownerName || row.ownerEmail,
    },
  };
}

const shareInclude = {
  requester: { select: { id: true, email: true, name: true } },
  owner: { select: { id: true, email: true, name: true } },
} as const;

/** Public: invite preview for Accept page */
calendarSharesRouter.get("/invite/:token", async (req, res) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0]! : req.params.token;
  const row = await prisma.calendarShare.findUnique({
    where: { inviteToken: token },
    include: shareInclude,
  });
  if (!row) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invite not found" } });
  }
  return res.json({
    data: {
      status: row.status,
      ownerEmail: row.ownerEmail,
      requester: row.requester,
      googleConfigured: googleConfigured(),
      outlookConfigured: outlookConfigured(),
    },
  });
});

/** Public: decline from email link */
calendarSharesRouter.post("/invite/:token/decline", async (req, res) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0]! : req.params.token;
  const row = await prisma.calendarShare.findUnique({ where: { inviteToken: token } });
  if (!row) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invite not found" } });
  }
  if (row.status === "ACCEPTED") {
    return res.status(409).json({
      error: { code: "ALREADY_ACCEPTED", message: "This invite was already accepted" },
    });
  }
  const updated = await prisma.calendarShare.update({
    where: { id: row.id },
    data: { status: "DECLINED", respondedAt: new Date() },
    include: shareInclude,
  });
  return res.json({ data: mapShare(updated) });
});

function emailFromGoogleIcsUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const match = path.match(/\/calendar\/ical\/([^/]+)\//i);
    if (!match) return null;
    return decodeURIComponent(match[1]).trim().toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Public: accept invite by pasting a published Google/Outlook ICS URL
 * (works when server OAuth keys are not configured).
 */
calendarSharesRouter.post("/invite/:token/accept-ics", async (req, res) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0]! : req.params.token;
  const parsed = z.object({ url: z.string().min(8) }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "ICS URL required" } });
  }

  const row = await prisma.calendarShare.findUnique({ where: { inviteToken: token } });
  if (!row || row.status === "DECLINED") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invite not found" } });
  }
  if (row.status === "ACCEPTED") {
    return res.status(409).json({
      error: { code: "ALREADY_ACCEPTED", message: "This invite was already accepted" },
    });
  }

  const url = normalizeCalendarUrl(parsed.data.url);
  const googleEmail = emailFromGoogleIcsUrl(url);
  if (googleEmail && googleEmail !== row.ownerEmail.toLowerCase()) {
    return res.status(400).json({
      error: {
        code: "EMAIL_MISMATCH",
        message: `Use the Google Calendar secret ICS link for ${row.ownerEmail}`,
      },
    });
  }
  if (/\/calendar\/ical\/[^/]+\/public\/basic\.ics/i.test(url)) {
    return res.status(400).json({
      error: {
        code: "PUBLIC_ICS",
        message:
          "Public Google ICS links usually 404. Use Secret address in iCal format (private-…/basic.ics).",
      },
    });
  }

  try {
    const owner = await ensureUserForEmail(row.ownerEmail, row.ownerEmail.split("@")[0]);
    await addIcsFeed(owner.id, url, "Shared calendar");
    const updated = await prisma.calendarShare.update({
      where: { id: row.id },
      data: {
        ownerId: owner.id,
        status: "ACCEPTED",
        respondedAt: new Date(),
      },
      include: shareInclude,
    });
    return res.json({ data: mapShare(updated) });
  } catch (err) {
    return res.status(400).json({
      error: {
        code: "ICS_FAILED",
        message: err instanceof Error ? err.message : "Failed to accept with calendar URL",
      },
    });
  }
});

/** Public: start OAuth to accept invite + link calendar */
calendarSharesRouter.get("/invite/:token/oauth/:provider", async (req, res) => {
  const token = Array.isArray(req.params.token) ? req.params.token[0]! : req.params.token;
  const providerRaw = Array.isArray(req.params.provider)
    ? req.params.provider[0]!
    : req.params.provider;
  const provider = providerRaw?.toUpperCase();
  if (provider !== "GOOGLE" && provider !== "OUTLOOK") {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Invalid provider" } });
  }

  const row = await prisma.calendarShare.findUnique({ where: { inviteToken: token } });
  if (!row || row.status === "DECLINED") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Invite not found" } });
  }

  if (provider === "GOOGLE" && !googleConfigured()) {
    return res.status(503).json({
      error: { code: "NOT_CONFIGURED", message: "Gmail OAuth is not configured on the server" },
    });
  }
  if (provider === "OUTLOOK" && !outlookConfigured()) {
    return res.status(503).json({
      error: { code: "NOT_CONFIGURED", message: "Outlook OAuth is not configured on the server" },
    });
  }

  const state = signOAuthState({
    purpose: "share_accept",
    provider,
    shareToken: token,
  });
  const url = provider === "GOOGLE" ? googleAuthUrl(state) : outlookAuthUrl(state);
  return res.json({ data: { url } });
});

calendarSharesRouter.use(requireAuth);

calendarSharesRouter.get("/", async (req, res) => {
  const userId = req.user!.id;
  await claimCalendarSharesForUser(userId, req.user!.email);

  const myEmail = req.user!.email.trim().toLowerCase();
  const [incoming, outgoing] = await Promise.all([
    prisma.calendarShare.findMany({
      where: {
        OR: [{ ownerId: userId }, { ownerEmail: myEmail }],
      },
      include: shareInclude,
      orderBy: { createdAt: "desc" },
    }),
    prisma.calendarShare.findMany({
      where: { requesterId: userId },
      include: shareInclude,
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return res.json({
    data: {
      incoming: incoming.map(mapShare),
      outgoing: outgoing.map(mapShare),
    },
  });
});

calendarSharesRouter.post("/", async (req, res) => {
  const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const ownerEmail = parsed.data.email.trim().toLowerCase();
  if (ownerEmail === req.user!.email.toLowerCase()) {
    return res.status(400).json({
      error: { code: "INVALID", message: "Cannot request access to your own calendar" },
    });
  }

  const owner = await prisma.user.findFirst({
    where: { email: { equals: ownerEmail, mode: "insensitive" }, disabled: false },
  });

  const existing = await prisma.calendarShare.findUnique({
    where: {
      requesterId_ownerEmail: { requesterId: req.user!.id, ownerEmail },
    },
  });

  if (existing?.status === "ACCEPTED" && existing.ownerId) {
    return res.status(409).json({
      error: { code: "ALREADY_SHARED", message: "You already have access to this calendar" },
    });
  }

  const row = await prisma.calendarShare.upsert({
    where: {
      requesterId_ownerEmail: { requesterId: req.user!.id, ownerEmail },
    },
    create: {
      requesterId: req.user!.id,
      ownerEmail,
      ownerId: owner?.id ?? null,
      status: "PENDING",
      lastInvitedAt: new Date(),
    },
    update: {
      status: "PENDING",
      respondedAt: null,
      ownerId: owner?.id ?? null,
      ownerEmail,
      lastInvitedAt: new Date(),
    },
    include: shareInclude,
  });

  const mail = await sendCalendarShareInvite({
    to: ownerEmail,
    requesterName: req.user!.name,
    requesterEmail: req.user!.email,
    inviteToken: row.inviteToken,
    fromUserId: req.user!.id,
  });

  return res.status(201).json({
    data: {
      ...mapShare(row),
      emailSent: mail.sent,
      emailMethod: mail.method,
      emailFailReason: mail.failReason ?? null,
      inviteUrl: mail.inviteUrl,
    },
  });
});

calendarSharesRouter.post("/:id/resend", async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
  const row = await prisma.calendarShare.findUnique({
    where: { id },
    include: shareInclude,
  });
  if (!row || row.requesterId !== req.user!.id) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Share not found" } });
  }
  if (row.status === "ACCEPTED") {
    return res.status(409).json({
      error: { code: "ALREADY_ACCEPTED", message: "Already accepted" },
    });
  }

  const updated = await prisma.calendarShare.update({
    where: { id: row.id },
    data: { status: "PENDING", respondedAt: null, lastInvitedAt: new Date() },
    include: shareInclude,
  });

  const mail = await sendCalendarShareInvite({
    to: updated.ownerEmail,
    requesterName: req.user!.name,
    requesterEmail: req.user!.email,
    inviteToken: updated.inviteToken,
    fromUserId: req.user!.id,
  });

  return res.json({
    data: {
      ...mapShare(updated),
      emailSent: mail.sent,
      emailMethod: mail.method,
      emailFailReason: mail.failReason ?? null,
      inviteUrl: mail.inviteUrl,
    },
  });
});

calendarSharesRouter.post("/:id/accept", async (req, res) => {
  await claimCalendarSharesForUser(req.user!.id, req.user!.email);
  const row = await prisma.calendarShare.findUnique({
    where: { id: Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id },
    include: shareInclude,
  });
  if (!row || row.ownerId !== req.user!.id) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Share request not found" } });
  }
  const updated = await prisma.calendarShare.update({
    where: { id: row.id },
    data: { status: "ACCEPTED", respondedAt: new Date(), ownerId: req.user!.id },
    include: shareInclude,
  });
  return res.json({ data: mapShare(updated) });
});

calendarSharesRouter.post("/:id/decline", async (req, res) => {
  await claimCalendarSharesForUser(req.user!.id, req.user!.email);
  const row = await prisma.calendarShare.findUnique({
    where: { id: Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id },
    include: shareInclude,
  });
  if (!row || row.ownerId !== req.user!.id) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Share request not found" } });
  }
  const updated = await prisma.calendarShare.update({
    where: { id: row.id },
    data: { status: "DECLINED", respondedAt: new Date(), ownerId: req.user!.id },
    include: shareInclude,
  });
  return res.json({ data: mapShare(updated) });
});

calendarSharesRouter.delete("/:id", async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
  const row = await prisma.calendarShare.findUnique({ where: { id } });
  if (!row) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Share not found" } });
  }
  const isRequester = row.requesterId === req.user!.id;
  const isOwner =
    row.ownerId === req.user!.id ||
    row.ownerEmail === req.user!.email.trim().toLowerCase();
  if (!isRequester && !isOwner) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not allowed" } });
  }
  await prisma.calendarShare.delete({ where: { id: row.id } });
  return res.status(204).send();
});

calendarSharesRouter.patch("/:id", async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
  const parsed = z
    .object({
      label: z.string().trim().min(1).max(120).optional(),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  if (!parsed.data.label && !parsed.data.color) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Provide label and/or color" },
    });
  }
  const row = await prisma.calendarShare.findUnique({ where: { id }, include: shareInclude });
  if (!row || row.requesterId !== req.user!.id) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Share not found" } });
  }
  const updated = await prisma.calendarShare.update({
    where: { id: row.id },
    data: {
      ...(parsed.data.label ? { label: parsed.data.label } : {}),
      ...(parsed.data.color ? { color: parsed.data.color.toLowerCase() } : {}),
    },
    include: shareInclude,
  });
  return res.json({ data: mapShare(updated) });
});
