import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

/** Find or create a lightweight WorkSphere user for the invitee email. */
export async function ensureUserForEmail(email: string, name?: string) {
  const normalized = email.trim().toLowerCase();
  const existing = await prisma.user.findFirst({
    where: { email: { equals: normalized, mode: "insensitive" } },
  });
  if (existing) {
    if (existing.disabled) throw new Error("This account is disabled");
    return existing;
  }
  const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);
  return prisma.user.create({
    data: {
      email: normalized,
      name: (name || normalized.split("@")[0] || "Calendar owner").slice(0, 80),
      passwordHash,
    },
  });
}
