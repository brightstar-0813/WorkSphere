/**
 * Turn a speaker timeline into the audio slices Whisper actually transcribes.
 *
 * Each slice belongs to exactly one speaker, so attribution needs no timestamp
 * merging afterwards. Long stretches are cut at the quietest point near the
 * limit rather than mid-word.
 */

import type { SpeakerTurn } from "./diarization";

const SAMPLE_RATE = 16_000;
const MAX_CHUNK_SEC = 24;
const MIN_CHUNK_SEC = 0.45;
/** Same-speaker turns closer than this read as one paragraph. */
const GLUE_GAP_SEC = 0.9;
/** A little headroom so Whisper does not clip the first/last phoneme. */
const PAD_SEC = 0.18;
/** Below this RMS a slice is treated as silence — Whisper invents text there. */
const SILENCE_RMS = 0.0015;

export type SpeechChunk = { speaker: number; start: number; end: number };

function rms(pcm: Float32Array, from: number, to: number) {
  const a = Math.max(0, from);
  const b = Math.min(pcm.length, to);
  if (b <= a) return 0;
  let sum = 0;
  for (let i = a; i < b; i += 1) sum += pcm[i]! * pcm[i]!;
  return Math.sqrt(sum / (b - a));
}

/** Quietest 20 ms frame inside a sample range — the best place to cut. */
function quietestPoint(pcm: Float32Array, from: number, to: number) {
  const frame = Math.floor(0.02 * SAMPLE_RATE);
  let best = from;
  let bestEnergy = Infinity;
  for (let i = from; i + frame <= to; i += frame) {
    const energy = rms(pcm, i, i + frame);
    if (energy < bestEnergy) {
      bestEnergy = energy;
      best = i + frame / 2;
    }
  }
  return Math.round(best);
}

function splitLong(pcm: Float32Array, chunk: SpeechChunk): SpeechChunk[] {
  if (chunk.end - chunk.start <= MAX_CHUNK_SEC) return [chunk];
  const out: SpeechChunk[] = [];
  let start = chunk.start;
  while (chunk.end - start > MAX_CHUNK_SEC) {
    const searchFrom = Math.round((start + MAX_CHUNK_SEC * 0.72) * SAMPLE_RATE);
    const searchTo = Math.round((start + MAX_CHUNK_SEC) * SAMPLE_RATE);
    const cut = quietestPoint(pcm, searchFrom, Math.min(searchTo, pcm.length)) / SAMPLE_RATE;
    const end = cut > start + 1 ? cut : start + MAX_CHUNK_SEC;
    out.push({ speaker: chunk.speaker, start, end });
    start = end;
  }
  if (chunk.end - start >= MIN_CHUNK_SEC) {
    out.push({ speaker: chunk.speaker, start, end: chunk.end });
  } else if (out.length > 0) {
    out.at(-1)!.end = chunk.end;
  }
  return out;
}

/** Speaker turns → padded, length-capped, non-silent chunks. */
export function chunksFromTurns(pcm: Float32Array, turns: SpeakerTurn[]): SpeechChunk[] {
  const glued: SpeechChunk[] = [];
  for (const turn of [...turns].sort((a, b) => a.start - b.start)) {
    const prev = glued.at(-1);
    if (
      prev &&
      prev.speaker === turn.speaker &&
      turn.start - prev.end <= GLUE_GAP_SEC &&
      turn.end - prev.start <= MAX_CHUNK_SEC
    ) {
      prev.end = Math.max(prev.end, turn.end);
    } else {
      glued.push({ speaker: turn.speaker, start: turn.start, end: turn.end });
    }
  }

  const duration = pcm.length / SAMPLE_RATE;
  return glued
    .flatMap((chunk) => splitLong(pcm, chunk))
    .map((chunk) => ({
      speaker: chunk.speaker,
      start: Math.max(0, chunk.start - PAD_SEC),
      end: Math.min(duration, chunk.end + PAD_SEC),
    }))
    .filter((chunk) => chunk.end - chunk.start >= MIN_CHUNK_SEC)
    .filter(
      (chunk) =>
        rms(pcm, Math.round(chunk.start * SAMPLE_RATE), Math.round(chunk.end * SAMPLE_RATE)) >
        SILENCE_RMS,
    );
}

/**
 * Fallback when diarization is off or found nothing: cut the whole recording
 * into Whisper-sized pieces at the quietest nearby point.
 */
export function chunksBySilence(pcm: Float32Array): SpeechChunk[] {
  const duration = pcm.length / SAMPLE_RATE;
  return chunksFromTurns(pcm, [{ speaker: 0, start: 0, end: duration }]);
}
