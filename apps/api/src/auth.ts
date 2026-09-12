import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";

const JWT_SECRET = process.env.JWT_SECRET ?? "worksphere-dev-secret-change-me";

export type AuthUser = {
  id: string;
  email: string;
  role: Role;
  name: string;
  locale: string;
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
    { id: user.id, email: user.email, role: user.role, name: user.name, locale: user.locale },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing token" } });
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as AuthUser;
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Invalid token" } });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.user || req.user.role !== "ADMIN") {
    return res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin only" } });
  }
  next();
}

/** Scope query to current user unless admin opts into another userId */
export function ownerFilter(req: Request, queryUserId?: string): { userId: string } | Record<string, never> {
  if (req.user!.role === "ADMIN" && queryUserId) {
    return { userId: queryUserId };
  }
  return { userId: req.user!.id };
}
