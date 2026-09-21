/// <reference lib="webworker" />
/**
 * In-browser transcription worker.
 *
 * Pass 1 diarizes the audio (pyannote), pass 2 runs Whisper over one slice per
 * speaker turn. Nothing is uploaded: the models are fetched from the Hugging
 * Face CDN once, cached by the browser, and every sample stays on this machine.
 */

import { env, pipeline } from "@huggingface/transformers";
import ortRuntimeUrl from "../vendor/ort/ort-wasm-simd-threaded.jsep.mjs?url";
import ortWasmUrl from "../vendor/ort/ort-wasm-simd-threaded.jsep.wasm?url";
import { diarize, type SpeakerTurn } from "../lib/diarization";
import { chunksBySilence, chunksFromTurns } from "../lib/speechChunks";
import type { TranscriptTurn, WorkerRequest, WorkerResponse } from "../lib/transcriptTypes";

const SAMPLE_RATE = 16_000;

env.allowLocalModels = false;

// transformers.js points ONNX Runtime at a jsdelivr CDN the moment it is
// imported. Override that with the copies Vite bundles from src/vendor/ort, so
// the tool still works offline or behind a firewall that blocks the CDN.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = { mjs: ortRuntimeUrl, wasm: ortWasmUrl };
}

type Transcriber = Awaited<ReturnType<typeof pipeline<"automatic-speech-recognition">>>;

const transcribers = new Map<string, Transcriber>();

function post(message: WorkerResponse) {
  self.postMessage(message);
}

async function pickDevice(): Promise<"webgpu" | "wasm"> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return "wasm";
  try {
    return (await gpu.requestAdapter()) ? "webgpu" : "wasm";
  } catch {
    return "wasm";
  }
}

async function getTranscriber(modelId: string, jobId: string): Promise<Transcriber> {
  const existing = transcribers.get(modelId);
  if (existing) return existing;

  const device = await pickDevice();
  post({ type: "stage", jobId, stage: "load", detail: device });

  const created = await pipeline("automatic-speech-recognition", modelId, {
    device,
    dtype:
      device === "webgpu"
        ? { encoder_model: "fp32", decoder_model_merged: "q4" }
        : { encoder_model: "q8", decoder_model_merged: "q8" },
    progress_callback: (item: unknown) => {
      const p = item as { status?: string; progress?: number };
      if (p.status === "progress" && typeof p.progress === "number") {
        post({ type: "progress", jobId, stage: "load", value: p.progress / 100 });
      }
    },
  });
  transcribers.set(modelId, created);
  return created;
}

/**
 * Whisper fills silence with stock phrases from its training subtitles. Drop
 * those when they are the entire output of a short slice.
 */
const HALLUCINATIONS = [
  "thank you",
  "thanks for watching",
  "thank you for watching",
  "please subscribe",
  "subscribe to my channel",
  "you",
  "bye",
  "amara.org",
  "subtitles by the amara.org community",
  "字幕由amara.org社区提供",
  "字幕",
  "ご視聴ありがとうございました",
  "続きをお楽しみに",
  "продолжение следует",
  "субтитры сделал",
];

function isHallucination(text: string, durationSec: number) {
  if (durationSec > 3) return false;
  const normalized = text.toLowerCase().replace(/[.!?,…"'’]/g, "").trim();
  return normalized.length === 0 || HALLUCINATIONS.includes(normalized);
}

/** Whisper can loop on a phrase; keep the first two repeats and drop the rest. */
function collapseRepeats(text: string) {
  const parts = text.split(/(?<=[.!?。！？])\s+/);
  const out: string[] = [];
  let run = 0;
  for (const part of parts) {
    const prev = out.at(-1);
    if (prev && prev.trim() === part.trim()) {
      run += 1;
      if (run >= 2) continue;
    } else {
      run = 0;
    }
    out.push(part);
  }
  return out.join(" ");
}

function cleanup(raw: string) {
  return collapseRepeats(raw.replace(/\s+/g, " ").trim());
}

/** Roughly how many slices make one paragraph when there are no speakers. */
const UNLABELLED_PARAGRAPH_CHUNKS = 4;

/**
 * Consecutive slices by the same speaker read as one paragraph. Without
 * speaker labels there is nothing to break on, so fall back to fixed-size
 * paragraphs rather than one wall of text.
 */
function groupTurns(pieces: { speaker: number; text: string }[], labelled: boolean) {
  const turns: TranscriptTurn[] = [];
  let sinceBreak = 0;
  for (const piece of pieces) {
    if (!piece.text) continue;
    const label = labelled ? `S${piece.speaker + 1}` : "";
    const prev = turns.at(-1);
    const canExtend =
      prev != null &&
      prev.speaker === label &&
      (labelled || sinceBreak < UNLABELLED_PARAGRAPH_CHUNKS);
    if (canExtend) {
      prev.text = `${prev.text} ${piece.text}`.trim();
      sinceBreak += 1;
    } else {
      turns.push({ speaker: label, text: piece.text });
      sinceBreak = 1;
    }
  }
  return turns;
}

async function run(req: WorkerRequest) {
  const { jobId, pcm, modelId, language, diarize: wantDiarize, maxSpeakers } = req;
  const durationSec = pcm.length / SAMPLE_RATE;

  const transcriber = await getTranscriber(modelId, jobId);

  let turns: SpeakerTurn[] = [];
  let diarized = false;
  if (wantDiarize) {
    post({ type: "stage", jobId, stage: "diarize" });
    try {
      const result = await diarize(pcm, {
        maxSpeakers,
        onProgress: (value) => post({ type: "progress", jobId, stage: "diarize", value }),
      });
      turns = result.turns;
      diarized = result.turns.length > 0;
    } catch (err) {
      // Speaker labels are a bonus — a transcript without them still ships.
      console.warn("diarization failed", err);
      turns = [];
    }
  }

  const chunks = diarized ? chunksFromTurns(pcm, turns) : chunksBySilence(pcm);

  post({ type: "stage", jobId, stage: "transcribe" });
  const pieces: { speaker: number; text: string }[] = [];

  for (let i = 0; i < chunks.length; i += 1) {
    const chunk = chunks[i]!;
    const slice = pcm.slice(
      Math.round(chunk.start * SAMPLE_RATE),
      Math.round(chunk.end * SAMPLE_RATE),
    );
    const output = (await transcriber(slice, {
      ...(language ? { language, task: "transcribe" } : {}),
      return_timestamps: false,
    })) as { text?: string } | { text?: string }[];

    const raw = Array.isArray(output) ? (output[0]?.text ?? "") : (output.text ?? "");
    const text = cleanup(raw);
    if (!isHallucination(text, chunk.end - chunk.start)) {
      pieces.push({ speaker: chunk.speaker, text });
    }

    post({ type: "progress", jobId, stage: "transcribe", value: (i + 1) / chunks.length });
    if ((i + 1) % 3 === 0 || i === chunks.length - 1) {
      post({ type: "partial", jobId, turns: groupTurns(pieces, diarized) });
    }
  }

  const finalTurns = groupTurns(pieces, diarized);
  post({
    type: "done",
    jobId,
    turns: finalTurns,
    speakerCount: diarized ? new Set(finalTurns.map((t) => t.speaker)).size : 0,
    language,
    durationSec,
    diarized,
  });
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req?.type !== "run") return;
  void run(req).catch((err: unknown) => {
    post({
      type: "error",
      jobId: req.jobId,
      message: err instanceof Error ? err.message : String(err),
    });
  });
});
