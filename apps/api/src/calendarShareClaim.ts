import { prisma } from "./prisma.js";

/** Attach pending email invites to a user after register/login. */
export async function claimCalendarSharesForUser(userId: string, email: string) {
  const ownerEmail = email.trim().toLowerCase();
  await prisma.calendarShare.updateMany({
    where: {
      ownerEmail,
      OR: [{ ownerId: null }, { ownerId: { not: userId } }],
      status: { in: ["PENDING", "ACCEPTED"] },
    },
    data: { ownerId: userId },
  });
}
