import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, Role, JobStatus, BidStatus, InterviewStatus, TxType, CalendarSourceType } from "@prisma/client";

const prisma = new PrismaClient();

/** Built-in default admin — always upserted on seed */
const DEFAULT_ADMIN = {
  email: "louis.michael9523@gmail.com",
  password: "Brightstar@0813",
  name: "BrightStar",
} as const;

async function main() {
  const userEmail = process.env.SEED_USER_EMAIL ?? "user@worksphere.local";
  const userPassword = process.env.SEED_USER_PASSWORD ?? "user123";

  const adminHash = await bcrypt.hash(DEFAULT_ADMIN.password, 10);
  const userHash = await bcrypt.hash(userPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: DEFAULT_ADMIN.email },
    update: {
      name: DEFAULT_ADMIN.name,
      passwordHash: adminHash,
      role: Role.ADMIN,
      disabled: false,
    },
    create: {
      email: DEFAULT_ADMIN.email,
      passwordHash: adminHash,
      name: DEFAULT_ADMIN.name,
      role: Role.ADMIN,
      locale: "en",
      timeZone: "Asia/Tokyo",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: userEmail },
    update: {},
    create: {
      email: userEmail,
      passwordHash: userHash,
      name: "Demo User",
      role: Role.USER,
      locale: "en",
      timeZone: "Asia/Tokyo",
    },
  });

  const existingJobs = await prisma.job.count({ where: { userId: user.id } });
  if (existingJobs === 0) {
    const job = await prisma.job.create({
      data: {
        userId: user.id,
        title: "Ship WorkSphere MVP",
        status: JobStatus.IN_PROGRESS,
        description: "Core modules for daily work management",
        dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const profile = await prisma.huntingProfile.create({
      data: {
        userId: user.id,
        name: "Default",
        label: "Demo",
        country: "United States",
      },
    });

    const bid = await prisma.huntingBid.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        company: "Acme Labs",
        roleTitle: "Full-stack Engineer",
        status: BidStatus.SHORTLISTED,
        notes: "Technical interview next week",
        appliedAt: new Date(),
      },
    });

    const interview = await prisma.huntingInterview.create({
      data: {
        userId: user.id,
        profileId: profile.id,
        bidId: bid.id,
        company: "Acme Labs",
        roleTitle: "Full-stack Engineer",
        status: InterviewStatus.SCHEDULED,
        notes: "Technical interview next week",
        scheduledAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      },
    });

    await prisma.calendarEvent.create({
      data: {
        userId: user.id,
        title: "Acme interview",
        startsAt: interview.scheduledAt!,
        sourceType: CalendarSourceType.HUNTING,
        sourceId: interview.id,
      },
    });

    await prisma.transaction.createMany({
      data: [
        {
          userId: user.id,
          type: TxType.INCOME,
          amountMinor: 250000,
          currency: "USD",
          category: "Freelance",
          occurredAt: new Date(),
          note: "Client milestone",
        },
        {
          userId: user.id,
          type: TxType.EXPENSE,
          amountMinor: 4500,
          currency: "USD",
          category: "Tools",
          occurredAt: new Date(),
          note: "Hosting",
        },
      ],
    });

    await prisma.discussion.create({
      data: {
        userId: user.id,
        title: "MVP scope check",
        body: "Confirm job handle, hunting calendar, money, discuss & report for v1.",
        linkedType: "JOB",
        linkedId: job.id,
      },
    });
  }

  const general = await prisma.chatRoom.findUnique({ where: { slug: "general" } });
  if (!general) {
    const room = await prisma.chatRoom.create({
      data: {
        name: "General",
        slug: "general",
        description: "Shared channel for the whole team — updates, questions, and wins.",
        createdById: admin.id,
      },
    });
    await prisma.chatMessage.create({
      data: {
        roomId: room.id,
        authorId: admin.id,
        body: "Welcome to Discuss. Select a channel on the left to start collaborating in real time.",
      },
    });
  }

  console.log("Seeded users:");
  console.log(`  ADMIN  ${admin.name} <${admin.email}> / ${DEFAULT_ADMIN.password}`);
  console.log(`  USER   ${user.email} / ${userPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
