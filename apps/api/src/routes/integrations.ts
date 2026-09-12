import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth } from "../auth.js";
import {
  exchangeGoogleCode,
  exchangeOutlookCode,
  googleAuthUrl,
  outlookAuthUrl,
  upsertConnection,
} from "../integrations/calendarProviders.js";
import {
  googleConfigured,
  outlookConfigured,
  signOAuthState,
  verifyOAuthState,
  webOrigin,
} from "../integrations/oauthConfig.js";
import { syncExternalCalendar } from "../integrations/calendarSyncExternal.js";
import { addIcsFeed, syncAllIcsFeeds, syncIcsFeed } from "../integrations/icsSync.js";
import { ensureUserForEmail } from "../ensureUser.js";

export const integrationsRouter = Router();

async function completeShareAcceptOAuth(
  provider: "GOOGLE" | "OUTLOOK",
  shareToken: string,
  tokens: {
    accountEmail: string;
    accessToken: string;
    refreshToken: string;
    expiresIn?: number;
    scope?: string;
  }
) {
  const share = await prisma.calendarShare.findUnique({
    where: { inviteToken: shareToken },
  });
  if (!share || share.status === "DECLINED") {
    throw new Error("Invite not found");
  }
  const oauthEmail = tokens.accountEmail.trim().toLowerCase();
  if (oauthEmail !== share.ownerEmail.toLowerCase()) {
    throw new Error(
      `Sign in with ${share.ownerEmail}. You signed in as ${tokens.accountEmail}.`
    );
  }

  const owner = await ensureUserForEmail(share.ownerEmail, tokens.accountEmail.split("@")[0]);
  const conn = await upsertConnection(owner.id, provider, tokens);
  await prisma.calendarShare.update({
    where: { id: share.id },
    data: {
      ownerId: owner.id,
      status: "ACCEPTED",
      respondedAt: new Date(),
    },
  });

  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 60);
  await syncExternalCalendar(owner.id, provider, from, to, conn.id);

  return share.inviteToken;
}

integrationsRouter.get("/calendar", requireAuth, async (req, res) => {
  const [rows, icsFeeds] = await Promise.all([
    prisma.calendarConnection.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        provider: true,
        accountEmail: true,
        scope: true,
        lastSyncAt: true,
        createdAt: true,
      },
      orderBy: [{ provider: "asc" }, { createdAt: "asc" }],
    }),
    prisma.calendarIcsFeed.findMany({
      where: { userId: req.user!.id },
      select: {
        id: true,
        url: true,
        label: true,
        color: true,
        lastSyncAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return res.json({
    data: {
      googleConfigured: googleConfigured(),
      outlookConfigured: outlookConfigured(),
      connections: rows.map((r) => ({
        id: r.id,
        provider: r.provider,
        accountEmail: r.accountEmail,
        scope: r.scope,
        canSendMail:
          r.provider === "GOOGLE"
            ? !r.scope || r.scope.toLowerCase().includes("gmail.send")
            : r.provider === "OUTLOOK"
              ? !r.scope || r.scope.toLowerCase().includes("mail.send")
              : false,
        lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      icsFeeds: icsFeeds.map((f) => ({
        ...f,
        lastSyncAt: f.lastSyncAt?.toISOString() ?? null,
        createdAt: f.createdAt.toISOString(),
      })),
    },
  });
});

integrationsRouter.post("/calendar/ics", requireAuth, async (req, res) => {
  const parsed = z
    .object({
      url: z.string().min(8),
      label: z.string().max(120).optional(),
    })
    .safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  try {
    const result = await addIcsFeed(req.user!.id, parsed.data.url, parsed.data.label);
    return res.status(201).json({
      data: {
        id: result.feed.id,
        url: result.feed.url,
        label: result.feed.label,
        color: result.feed.color,
        lastSyncAt: result.feed.lastSyncAt?.toISOString() ?? null,
        synced: result.synced,
      },
    });
  } catch (err) {
    return res.status(400).json({
      error: {
        code: "ICS_FAILED",
        message: err instanceof Error ? err.message : "Failed to add calendar URL",
      },
    });
  }
});

integrationsRouter.patch("/calendar/ics/:id", requireAuth, async (req, res) => {
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
  const feed = await prisma.calendarIcsFeed.findFirst({
    where: { id, userId: req.user!.id },
  });
  if (!feed) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "ICS feed not found" } });
  }
  const updated = await prisma.calendarIcsFeed.update({
    where: { id: feed.id },
    data: {
      ...(parsed.data.label ? { label: parsed.data.label } : {}),
      ...(parsed.data.color ? { color: parsed.data.color.toLowerCase() } : {}),
    },
  });
  return res.json({
    data: {
      id: updated.id,
      url: updated.url,
      label: updated.label,
      color: updated.color,
      lastSyncAt: updated.lastSyncAt?.toISOString() ?? null,
      createdAt: updated.createdAt.toISOString(),
    },
  });
});

integrationsRouter.delete("/calendar/ics/:id", requireAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
  const feed = await prisma.calendarIcsFeed.findFirst({
    where: { id, userId: req.user!.id },
  });
  if (!feed) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "ICS feed not found" } });
  }
  await prisma.calendarEvent.deleteMany({
    where: { userId: req.user!.id, sourceType: { in: ["OUTLOOK", "GOOGLE"] }, sourceId: feed.id },
  });
  await prisma.calendarIcsFeed.delete({ where: { id: feed.id } });
  return res.status(204).send();
});

integrationsRouter.get("/google/start", requireAuth, (req, res) => {
  if (!googleConfigured()) {
    return res.status(503).json({
      error: {
        code: "NOT_CONFIGURED",
        message: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the API .env",
      },
    });
  }
  const state = signOAuthState({
    purpose: "connect",
    userId: req.user!.id,
    provider: "GOOGLE",
  });
  return res.json({ data: { url: googleAuthUrl(state) } });
});

integrationsRouter.get("/google/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const stateRaw = typeof req.query.state === "string" ? req.query.state : "";
  const state = verifyOAuthState(stateRaw);
  if (!code || !state || state.provider !== "GOOGLE") {
    return res.redirect(`${webOrigin()}/calendar?integration=google&status=error`);
  }
  try {
    const tokens = await exchangeGoogleCode(code);
    if (state.purpose === "share_accept" && state.shareToken) {
      const token = await completeShareAcceptOAuth("GOOGLE", state.shareToken, tokens);
      return res.redirect(`${webOrigin()}/share/${token}?status=accepted`);
    }
    if (!state.userId) {
      return res.redirect(`${webOrigin()}/calendar?integration=google&status=error`);
    }
    const conn = await upsertConnection(state.userId, "GOOGLE", tokens);
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const to = new Date();
    to.setDate(to.getDate() + 60);
    await syncExternalCalendar(state.userId, "GOOGLE", from, to, conn.id);
    return res.redirect(`${webOrigin()}/calendar?integration=google&status=connected`);
  } catch (err) {
    console.error(err);
    if (state.purpose === "share_accept" && state.shareToken) {
      const msg = err instanceof Error ? encodeURIComponent(err.message) : "error";
      return res.redirect(
        `${webOrigin()}/share/${state.shareToken}?status=error&message=${msg}`
      );
    }
    return res.redirect(`${webOrigin()}/calendar?integration=google&status=error`);
  }
});

integrationsRouter.get("/outlook/start", requireAuth, (req, res) => {
  if (!outlookConfigured()) {
    return res.status(503).json({
      error: {
        code: "NOT_CONFIGURED",
        message: "Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in the API .env",
      },
    });
  }
  const state = signOAuthState({
    purpose: "connect",
    userId: req.user!.id,
    provider: "OUTLOOK",
  });
  return res.json({ data: { url: outlookAuthUrl(state) } });
});

integrationsRouter.get("/outlook/callback", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const stateRaw = typeof req.query.state === "string" ? req.query.state : "";
  const state = verifyOAuthState(stateRaw);
  if (!code || !state || state.provider !== "OUTLOOK") {
    return res.redirect(`${webOrigin()}/calendar?integration=outlook&status=error`);
  }
  try {
    const tokens = await exchangeOutlookCode(code);
    if (state.purpose === "share_accept" && state.shareToken) {
      const token = await completeShareAcceptOAuth("OUTLOOK", state.shareToken, tokens);
      return res.redirect(`${webOrigin()}/share/${token}?status=accepted`);
    }
    if (!state.userId) {
      return res.redirect(`${webOrigin()}/calendar?integration=outlook&status=error`);
    }
    const conn = await upsertConnection(state.userId, "OUTLOOK", tokens);
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const to = new Date();
    to.setDate(to.getDate() + 60);
    await syncExternalCalendar(state.userId, "OUTLOOK", from, to, conn.id);
    return res.redirect(`${webOrigin()}/calendar?integration=outlook&status=connected`);
  } catch (err) {
    console.error(err);
    if (state.purpose === "share_accept" && state.shareToken) {
      const msg = err instanceof Error ? encodeURIComponent(err.message) : "error";
      return res.redirect(
        `${webOrigin()}/share/${state.shareToken}?status=error&message=${msg}`
      );
    }
    return res.redirect(`${webOrigin()}/calendar?integration=outlook&status=error`);
  }
});

integrationsRouter.post("/calendar/sync", requireAuth, async (req, res) => {
  const schema = z.object({
    provider: z.enum(["GOOGLE", "OUTLOOK", "ALL"]).default("ALL"),
    connectionId: z.string().optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
  });
  const parsed = schema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const from = parsed.data.from
    ? new Date(parsed.data.from)
    : new Date(Date.now() - 7 * 86400000);
  const to = parsed.data.to
    ? new Date(parsed.data.to)
    : new Date(Date.now() + 60 * 86400000);

  const results: Record<string, number> = {};

  if (parsed.data.connectionId) {
    const conn = await prisma.calendarConnection.findFirst({
      where: { id: parsed.data.connectionId, userId: req.user!.id },
    });
    if (!conn) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
    }
    results[conn.id] = await syncExternalCalendar(
      req.user!.id,
      conn.provider,
      from,
      to,
      conn.id
    );
  } else {
    const providers =
      parsed.data.provider === "ALL"
        ? (["GOOGLE", "OUTLOOK"] as const)
        : ([parsed.data.provider] as const);

    for (const provider of providers) {
      const count = await prisma.calendarConnection.count({
        where: { userId: req.user!.id, provider },
      });
      if (!count) continue;
      results[provider] = await syncExternalCalendar(req.user!.id, provider, from, to);
    }

    if (parsed.data.provider === "ALL" || parsed.data.provider === "OUTLOOK") {
      const ics = await syncAllIcsFeeds(req.user!.id, from, to);
      Object.assign(
        results,
        Object.fromEntries(Object.entries(ics).map(([k, v]) => [`ICS:${k}`, v]))
      );
    }
  }

  return res.json({ data: { synced: results } });
});

integrationsRouter.post("/calendar/ics/:id/sync", requireAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
  const from =
    typeof req.body?.from === "string"
      ? new Date(req.body.from)
      : new Date(Date.now() - 7 * 86400000);
  const to =
    typeof req.body?.to === "string"
      ? new Date(req.body.to)
      : new Date(Date.now() + 60 * 86400000);
  try {
    const synced = await syncIcsFeed(req.user!.id, id, from, to);
    return res.json({ data: { synced } });
  } catch (err) {
    return res.status(400).json({
      error: {
        code: "ICS_SYNC_FAILED",
        message: err instanceof Error ? err.message : "ICS sync failed",
      },
    });
  }
});

/** Disconnect one OAuth account (keeps other Gmail/Outlook accounts) */
integrationsRouter.delete("/calendar/connection/:id", requireAuth, async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
  const conn = await prisma.calendarConnection.findFirst({
    where: { id, userId: req.user!.id },
  });
  if (!conn) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Connection not found" } });
  }

  await prisma.calendarEvent.deleteMany({
    where: {
      userId: req.user!.id,
      sourceType: conn.provider,
      OR: [
        { sourceId: conn.id },
        { externalId: { startsWith: `${conn.id}:` } },
      ],
    },
  });
  await prisma.calendarConnection.delete({ where: { id: conn.id } });
  return res.status(204).send();
});

/** Legacy: remove all accounts for a provider */
integrationsRouter.delete("/calendar/:provider", requireAuth, async (req, res) => {
  const raw = req.params.provider;
  const provider = (Array.isArray(raw) ? raw[0] : raw)?.toUpperCase();
  if (provider === "CONNECTION" || provider === "ICS") {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  }
  if (provider !== "GOOGLE" && provider !== "OUTLOOK") {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Invalid provider" } });
  }

  const conns = await prisma.calendarConnection.findMany({
    where: { userId: req.user!.id, provider },
    select: { id: true },
  });
  const connIds = conns.map((c) => c.id);

  await prisma.calendarConnection.deleteMany({
    where: { userId: req.user!.id, provider },
  });

  if (connIds.length > 0) {
    await prisma.calendarEvent.deleteMany({
      where: {
        userId: req.user!.id,
        sourceType: provider,
        OR: [
          { sourceId: { in: connIds } },
          // Legacy OAuth rows without sourceId (pre multi-account)
          { sourceId: null },
        ],
      },
    });
  }

  return res.status(204).send();
});
