import type { Request } from "express";
import { prisma } from "./prisma.js";
import { DEFAULT_TIME_ZONE, normalizeTimeZone } from "./timeZone.js";

/**
 * Resolve the timezone for period / civil-day math.
 * Prefer JWT claim for the actor; when scoping to another user (admin ?userId=), load that user's zone.
 */
export async function resolveActorTimeZone(req: Request, forUserId?: string): Promise<string> {
  const id = forUserId ?? req.user?.id;
  if (!id) return DEFAULT_TIME_ZONE;

  if (!forUserId && req.user?.timeZone) {
    return normalizeTimeZone(req.user.timeZone);
  }

  const user = await prisma.user.findUnique({
    where: { id },
    select: { timeZone: true },
  });
  return normalizeTimeZone(user?.timeZone);
}
