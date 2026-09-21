import type { TranscriptStatus } from "@prisma/client";
import type { Request } from "express";
import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma.js";
import { ownerFilter, requireAuth } from "../auth.js";
import { listMeta, parsePagination } from "../pagination.js";

export const transcriptsRouter = Router();
transcriptsRouter.use(requireAuth);

type Turn = { speaker: string; text: string };

const segmentSchema = z.object({
  speaker: z.string().max(32),
  text: z.string().max(200_000),
});

const speakerNamesSchema = z.record(z.string().max(32), z.string().max(120));

const listSelect = {
  id: true,
  title: true,
  sourceName: true,
  mimeType: true,
  sizeBytes: true,
  durationSec: true,
  language: true,
  modelId: true,
  status: true,
  progress: true,
  errorMessage: true,
  speakerCount: true,
  wordCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * Flat copyable text rebuilt from speaker turns + current display names.
 * A turn with no speaker (diarization off) is emitted as a bare paragraph.
 */
function renderText(segments: Turn[], names: Record<string, string>) {
  return segments
    .map((s) => {
      const label = names[s.speaker]?.trim() || s.speaker.trim();
      return label ? `${label}: ${s.text}`.trim() : s.text.trim();
    })
    .join("\n\n");
}

function countWords(text: string) {
  const words = text.trim().match(/\S+/g);
  return words ? words.length : 0;
}

async function findOwned(req: Request, id: string) {
  const row = await prisma.transcript.findUnique({ where: { id } });
  if (!row) return { row: null, forbidden: false };
  if (req.user!.role !== "ADMIN" && row.userId !== req.user!.id) {
    return { row: null, forbidden: true };
  }
  return { row, forbidden: false };
}

transcriptsRouter.get("/", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const raw = typeof req.query.status === "string" ? req.query.status : "";
  const status: TranscriptStatus | null =
    raw === "PROCESSING" || raw === "COMPLETED" || raw === "FAILED" ? raw : null;
  const where = {
    ...ownerFilter(req, typeof req.query.userId === "string" ? req.query.userId : undefined),
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { sourceName: { contains: q, mode: "insensitive" as const } },
            { text: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };
  const { page, pageSize, skip, take } = parsePagination(req.query as Record<string, unknown>, {
    defaultPageSize: 20,
  });
  const [total, data] = await Promise.all([
    prisma.transcript.count({ where }),
    prisma.transcript.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
      select: listSelect,
    }),
  ]);
  return res.json({ data, meta: listMeta(total, page, pageSize) });
});

transcriptsRouter.get("/:id", async (req, res) => {
  const { row, forbidden } = await findOwned(req, req.params.id);
  if (forbidden) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  if (!row) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  return res.json({ data: row });
});

transcriptsRouter.post("/", async (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(200),
    sourceName: z.string().max(400).optional(),
    mimeType: z.string().max(120).optional(),
    sizeBytes: z.number().int().min(0).max(2_147_483_647).optional(),
    durationSec: z.number().min(0).max(360_000).optional(),
    language: z.string().max(32).optional(),
    modelId: z.string().max(120).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const data = await prisma.transcript.create({
    data: {
      userId: req.user!.id,
      title: parsed.data.title,
      sourceName: parsed.data.sourceName ?? "",
      mimeType: parsed.data.mimeType ?? "",
      sizeBytes: parsed.data.sizeBytes ?? 0,
      durationSec: parsed.data.durationSec ?? 0,
      language: parsed.data.language ?? "",
      modelId: parsed.data.modelId ?? "",
      status: "PROCESSING",
    },
  });
  return res.status(201).json({ data });
});

/** Progress heartbeat from the browser worker (0-100). */
transcriptsRouter.patch("/:id/progress", async (req, res) => {
  const schema = z.object({ progress: z.number().int().min(0).max(100) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { row, forbidden } = await findOwned(req, req.params.id);
  if (forbidden) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  if (!row) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  const data = await prisma.transcript.update({
    where: { id: row.id },
    data: { progress: parsed.data.progress },
    select: { id: true, progress: true, status: true },
  });
  return res.json({ data });
});

/** Final result handed back by the browser worker. */
transcriptsRouter.post("/:id/result", async (req, res) => {
  const schema = z.object({
    segments: z.array(segmentSchema).max(20_000),
    speakerNames: speakerNamesSchema.optional(),
    speakerCount: z.number().int().min(0).max(64).optional(),
    durationSec: z.number().min(0).max(360_000).optional(),
    language: z.string().max(32).optional(),
    modelId: z.string().max(120).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { row, forbidden } = await findOwned(req, req.params.id);
  if (forbidden) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  if (!row) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });

  const names = parsed.data.speakerNames ?? {};
  const data = await prisma.transcript.update({
    where: { id: row.id },
    data: {
      status: "COMPLETED",
      progress: 100,
      errorMessage: "",
      segments: parsed.data.segments,
      speakerNames: names,
      speakerCount:
        parsed.data.speakerCount ??
        new Set(parsed.data.segments.map((s) => s.speaker).filter(Boolean)).size,
      durationSec: parsed.data.durationSec ?? row.durationSec,
      language: parsed.data.language ?? row.language,
      modelId: parsed.data.modelId ?? row.modelId,
      text: renderText(parsed.data.segments, names),
      wordCount: countWords(parsed.data.segments.map((s) => s.text).join(" ")),
    },
  });
  return res.json({ data });
});

transcriptsRouter.post("/:id/fail", async (req, res) => {
  const schema = z.object({ message: z.string().max(1000) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { row, forbidden } = await findOwned(req, req.params.id);
  if (forbidden) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  if (!row) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  const data = await prisma.transcript.update({
    where: { id: row.id },
    data: { status: "FAILED", errorMessage: parsed.data.message },
  });
  return res.json({ data });
});

/** Rename the transcript, edit notes, rename speakers, or correct a turn. */
transcriptsRouter.patch("/:id", async (req, res) => {
  const schema = z.object({
    title: z.string().min(1).max(200).optional(),
    notes: z.string().max(20_000).optional(),
    speakerNames: speakerNamesSchema.optional(),
    segments: z.array(segmentSchema).max(20_000).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: parsed.error.message } });
  }
  const { row, forbidden } = await findOwned(req, req.params.id);
  if (forbidden) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  if (!row) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });

  const segments = parsed.data.segments ?? ((row.segments as Turn[] | null) ?? []);
  const names =
    parsed.data.speakerNames ?? ((row.speakerNames as Record<string, string> | null) ?? {});
  const touchesTranscript = parsed.data.segments != null || parsed.data.speakerNames != null;

  const data = await prisma.transcript.update({
    where: { id: row.id },
    data: {
      ...(parsed.data.title != null ? { title: parsed.data.title } : {}),
      ...(parsed.data.notes != null ? { notes: parsed.data.notes } : {}),
      ...(touchesTranscript
        ? {
            segments,
            speakerNames: names,
            speakerCount: new Set(segments.map((s) => s.speaker).filter(Boolean)).size,
            text: renderText(segments, names),
            wordCount: countWords(segments.map((s) => s.text).join(" ")),
          }
        : {}),
    },
  });
  return res.json({ data });
});

transcriptsRouter.delete("/:id", async (req, res) => {
  const { row, forbidden } = await findOwned(req, req.params.id);
  if (forbidden) return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not yours" } });
  if (!row) return res.status(404).json({ error: { code: "NOT_FOUND", message: "Not found" } });
  await prisma.transcript.delete({ where: { id: row.id } });
  return res.status(204).end();
});
