import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { prisma } from "./prisma.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "worksphere-dev-secret-change-me";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  name: string;
  locale: string;
  /** IANA zone; may be missing on legacy tokens — fall back via resolveActorTimeZone */
  timeZone?: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      locale: user.locale,
      timeZone: user.timeZone,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function verifyToken(token: string): AuthUser {
  return jwt.verify(token, JWT_SECRET) as AuthUser;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  }
  try {
    req.user = verifyToken(header.slice(7));
    next();
  } catch {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } });
  }
}

/** Admin routes: re-check role in DB (JWT alone is not enough after demotion). */
export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin only" } });
  }
  try {
    const dbUser = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { role: true, disabled: true, email: true, name: true, locale: true, timeZone: true },
    });
    if (!dbUser || dbUser.disabled || dbUser.role !== "ADMIN") {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin only" } });
    }
    req.user = {
      id: req.user.id,
      email: dbUser.email,
      role: dbUser.role,
      name: dbUser.name,
      locale: dbUser.locale,
      timeZone: dbUser.timeZone,
    };
    next();
  } catch {
    return res.status(500).json({ error: { code: "INTERNAL", message: "Auth check failed" } });
  }
}

/**
 * Scope query to current user unless admin opts into another userId.
 * Admin without ?userId= still sees own rows on user routes — use /api/v1/admin/* for cross-tenant.
 */
export function ownerFilter(req: Request, queryUserId?: string): { userId: string } | Record<string, never> {
  if (req.user!.role === "ADMIN" && queryUserId) {
    return { userId: queryUserId };
  }
  return { userId: req.user!.id };
}
