import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { requireAuth, signToken } from "../auth.js";
import { claimCalendarSharesForUser } from "../calendarShareClaim.js";
import { sendPasswordResetEmail } from "../mail.js";
import { normalizeTimeZone } from "../timeZone.js";

export const authRouter = Router();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsRoot = path.resolve(__dirname, "../../uploads");

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const passwordSchema = z.string().min(6).max(128);

function ensureUploads() {
  fs.mkdirSync(path.join(uploadsRoot, "avatars"), { recursive: true });
}

function hashResetToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function createResetToken() {
  const token = crypto.randomBytes(32).toString("hex");
  return { token, tokenHash: hashResetToken(token) };
}

function publicUser(user: {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
  name: string;
  locale: string;
  timeZone: string;
  avatarUrl: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    locale: user.locale,
    timeZone: normalizeTimeZone(user.timeZone),
    avatarUrl: user.avatarUrl,
  };
}

authRouter.post("/register", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: passwordSchema,
    name: z.string().min(1),
    locale: z.enum(["en", "zh", "ru"]).optional(),
    timeZone: z.string().min(1).max(64).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const exists = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (exists) {
    return res.status(409).json({ error: { code: "CONFLICT", message: "Email already registered" } });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      name: parsed.data.name,
      locale: parsed.data.locale ?? "en",
      timeZone: normalizeTimeZone(parsed.data.timeZone),
    },
  });
  await claimCalendarSharesForUser(user.id, user.email);

  const authUser = publicUser(user);
  return res.status(201).json({ data: { token: signToken(authUser), user: authUser } });
});

authRouter.post("/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }

  const user = await prisma.user.findFirst({
    where: { email: { equals: parsed.data.email.trim(), mode: "insensitive" } },
  });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid credentials" } });
  }
  if (user.disabled) {
    return res.status(403).json({ error: { code: "DISABLED", message: "Account disabled" } });
  }

  await claimCalendarSharesForUser(user.id, user.email);

  const authUser = publicUser(user);
  return res.json({ data: { token: signToken(authUser), user: authUser } });
});

/** Always 200 with the same message to avoid email enumeration. */
authRouter.post("/forgot-password", async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Valid email required" } });
  }

  const email = parsed.data.email.trim().toLowerCase();
  const user = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" }, disabled: false },
  });

  if (user) {
    const { token, tokenHash } = createResetToken();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: tokenHash,
        passwordResetExpires: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    await sendPasswordResetEmail({ to: user.email, name: user.name, token });
  }

  return res.json({
    data: {
      ok: true,
      message: "If that email is registered, a reset link has been sent.",
    },
  });
});

authRouter.get("/reset-password/:token", async (req, res) => {
  const raw = String(req.params.token || "");
  if (!raw || raw.length < 16) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Invalid reset link" } });
  }
  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: hashResetToken(raw),
      passwordResetExpires: { gt: new Date() },
      disabled: false,
    },
    select: { id: true, email: true },
  });
  if (!user) {
    return res.status(400).json({
      error: { code: "INVALID_TOKEN", message: "Reset link is invalid or expired" },
    });
  }
  return res.json({ data: { valid: true, email: user.email } });
});

authRouter.post("/reset-password", async (req, res) => {
  const schema = z.object({
    token: z.string().min(16),
    password: passwordSchema,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Password must be at least 6 characters" },
    });
  }

  const tokenHash = hashResetToken(parsed.data.token);
  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: tokenHash,
      passwordResetExpires: { gt: new Date() },
      disabled: false,
    },
  });
  if (!user) {
    return res.status(400).json({
      error: { code: "INVALID_TOKEN", message: "Reset link is invalid or expired" },
    });
  }

  const passwordHash = await bcrypt.hash(parsed.data.password, 10);
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });

  await claimCalendarSharesForUser(updated.id, updated.email);
  const authUser = publicUser(updated);
  return res.json({ data: { token: signToken(authUser), user: authUser } });
});

authRouter.post("/change-password", requireAuth, async (req, res) => {
  const schema = z.object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "New password must be at least 6 characters" },
    });
  }

  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user || user.disabled) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  }
  if (!(await bcrypt.compare(parsed.data.currentPassword, user.passwordHash))) {
    return res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Current password is incorrect" },
    });
  }
  if (parsed.data.currentPassword === parsed.data.newPassword) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "New password must be different" },
    });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(parsed.data.newPassword, 10),
      passwordResetToken: null,
      passwordResetExpires: null,
    },
  });

  return res.json({ data: { ok: true } });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      locale: true,
      timeZone: true,
      avatarUrl: true,
      disabled: true,
    },
  });
  if (!user || user.disabled) {
    return res.status(404).json({ error: { code: "NOT_FOUND", message: "User not found" } });
  }
  return res.json({ data: publicUser(user) });
});

authRouter.patch("/me", requireAuth, async (req, res) => {
  const schema = z.object({
    name: z.string().min(1).optional(),
    locale: z.enum(["en", "zh", "ru"]).optional(),
    timeZone: z.string().min(1).max(64).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  if (parsed.data.timeZone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: parsed.data.timeZone });
    } catch {
      return res.status(400).json({ error: { code: "VALIDATION", message: "Invalid time zone" } });
    }
  }
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: {
      name: parsed.data.name,
      locale: parsed.data.locale,
      timeZone: parsed.data.timeZone
        ? normalizeTimeZone(parsed.data.timeZone)
        : undefined,
    },
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      locale: true,
      timeZone: true,
      avatarUrl: true,
    },
  });
  return res.json({ data: publicUser(user) });
});

/** JSON body: { image: "data:image/png;base64,..." } */
authRouter.post("/me/avatar", requireAuth, async (req, res) => {
  const schema = z.object({
    image: z.string().min(32).max(2_500_000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "Invalid image payload" } });
  }

  const match = /^data:(image\/(?:png|jpeg|jpg|webp));base64,(.+)$/i.exec(parsed.data.image);
  if (!match) {
    return res.status(400).json({
      error: { code: "VALIDATION", message: "Use PNG, JPEG, or WebP data URL" },
    });
  }

  const ext = match[1]!.includes("png") ? "png" : match[1]!.includes("webp") ? "webp" : "jpg";
  ensureUploads();
  const filename = `${req.user!.id}.${ext}`;
  const filePath = path.join(uploadsRoot, "avatars", filename);
  fs.writeFileSync(filePath, Buffer.from(match[2]!, "base64"));

  const avatarUrl = `/uploads/avatars/${filename}?v=${Date.now()}`;
  const user = await prisma.user.update({
    where: { id: req.user!.id },
    data: { avatarUrl },
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      locale: true,
      timeZone: true,
      avatarUrl: true,
    },
  });
  return res.json({ data: publicUser(user) });
});

authRouter.delete("/me/avatar", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (user?.avatarUrl) {
    const base = user.avatarUrl.split("?")[0]!.replace(/^\/uploads\//, "");
    const filePath = path.join(uploadsRoot, base);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  const updated = await prisma.user.update({
    where: { id: req.user!.id },
    data: { avatarUrl: null },
    select: {
      id: true,
      email: true,
      role: true,
      name: true,
      locale: true,
      timeZone: true,
      avatarUrl: true,
    },
  });
  return res.json({ data: publicUser(updated) });
});
