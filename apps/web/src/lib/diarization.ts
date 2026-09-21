/**
 * Speaker diarization ("who spoke when") running entirely in the browser on
 * `onnx-community/pyannote-segmentation-3.0`.
 *
 * The model only sees ~10 s at a time and labels at most three *local* speakers
 * per window, so we slide a window with 50% overlap and chain the local labels
 * into stable global speakers by comparing activity in the overlapping half.
 * That keeps 2–4 speaker meetings consistent without a speaker-embedding model;
 * a long recording where someone stays silent across a window boundary can
 * still split into an extra speaker, which is why the UI lets people merge and
 * rename speakers afterwards.
 */

import {
  AutoModelForAudioFrameClassification,
  AutoProcessor,
  type PreTrainedModel,
  type Processor,
} from "@huggingface/transformers";

export const DIARIZATION_MODEL_ID = "onnx-community/pyannote-segmentation-3.0";

const SAMPLE_RATE = 16_000;
const WINDOW_SEC = 10;
const HOP_SEC = 5;
const WINDOW_SAMPLES = WINDOW_SEC * SAMPLE_RATE;
const HOP_SAMPLES = HOP_SEC * SAMPLE_RATE;

/** Activity-mask resolution used for stitching and turn building. */
const GRID_SEC = 0.05;

/** pyannote's powerset classes → the local speakers active in that class. */
const POWERSET: readonly (readonly number[])[] = [
  [], // non-speech
  [0],
  [1],
  [2],
  [0, 1],
  [0, 2],
  [1, 2],
];

const MIN_MATCH_IOU = 0.15;
const MIN_TURN_SEC = 0.4;
const MERGE_GAP_SEC = 0.35;

export type SpeakerTurn = { speaker: number; start: number; end: number };

type Segment = { id: number; start: number; end: number; confidence: number };

/**
 * `PyAnnoteProcessor` is not re-exported from the package's public types, so
 * describe the one method we need on top of the base `Processor`.
 */
type PyAnnoteProcessor = Processor & {
  post_process_speaker_diarization(logits: unknown, numSamples: number): Segment[][];
};

let cached: { model: PreTrainedModel; processor: PyAnnoteProcessor } | null = null;

export async function loadDiarizer(onProgress?: (p: unknown) => void) {
  if (cached) return cached;
  const [model, processor] = await Promise.all([
    AutoModelForAudioFrameClassification.from_pretrained(DIARIZATION_MODEL_ID, {
      progress_callback: onProgress,
    }),
    AutoProcessor.from_pretrained(DIARIZATION_MODEL_ID, { progress_callback: onProgress }),
  ]);
  cached = { model, processor: processor as PyAnnoteProcessor };
  return cached;
}

function intersectionOverUnion(a: Uint8Array, b: Uint8Array, from: number, to: number) {
  let inter = 0;
  let union = 0;
  for (let i = from; i < to; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (x && y) inter += 1;
    if (x || y) union += 1;
  }
  return union === 0 ? 0 : inter / union;
}

/** Contiguous runs of `value` in `owner`, as [start, end] second pairs. */
function runsOf(owner: Int16Array, value: number): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  let runStart = -1;
  for (let i = 0; i <= owner.length; i += 1) {
    const on = i < owner.length && owner[i] === value;
    if (on && runStart < 0) runStart = i;
    if (!on && runStart >= 0) {
      runs.push({ start: runStart * GRID_SEC, end: i * GRID_SEC });
      runStart = -1;
    }
  }
  return runs;
}

function tidyTurns(turns: SpeakerTurn[]): SpeakerTurn[] {
  const sorted = [...turns].sort((a, b) => a.start - b.start);
  const merged: SpeakerTurn[] = [];
  for (const turn of sorted) {
    const prev = merged.at(-1);
    if (prev && prev.speaker === turn.speaker && turn.start - prev.end <= MERGE_GAP_SEC) {
      prev.end = Math.max(prev.end, turn.end);
    } else {
      merged.push({ ...turn });
    }
  }
  return merged.filter((t) => t.end - t.start >= MIN_TURN_SEC);
}

/**
 * Run diarization over 16 kHz mono PCM.
 * `onProgress` receives 0..1 as windows complete.
 */
export async function diarize(
  pcm: Float32Array,
  opts: {
    maxSpeakers?: number;
    onProgress?: (value: number) => void;
    onModelProgress?: (p: unknown) => void;
  } = {},
): Promise<{ turns: SpeakerTurn[]; speakerCount: number }> {
  const maxSpeakers = Math.max(1, Math.min(12, opts.maxSpeakers ?? 6));
  const { model, processor } = await loadDiarizer(opts.onModelProgress);

  const totalGrid = Math.ceil(pcm.length / SAMPLE_RATE / GRID_SEC) + 1;
  /** One activity mask per global speaker, over the whole recording. */
  const globals: Uint8Array[] = [];

  const windowStarts: number[] = [];
  for (let s = 0; s < pcm.length; s += HOP_SAMPLES) {
    windowStarts.push(s);
    if (s + WINDOW_SAMPLES >= pcm.length) break;
  }

  let coveredGrid = 0;

  for (let w = 0; w < windowStarts.length; w += 1) {
    const startSample = windowStarts[w]!;
    const slice = pcm.subarray(startSample, Math.min(pcm.length, startSample + WINDOW_SAMPLES));
    // pyannote is trained on fixed 10 s windows — pad the tail rather than
    // feeding it a short clip it would segment unreliably.
    const windowPcm =
      slice.length === WINDOW_SAMPLES
        ? slice
        : (() => {
            const padded = new Float32Array(WINDOW_SAMPLES);
            padded.set(slice);
            return padded;
          })();

    const inputs = await processor(windowPcm);
    const { logits } = (await model(inputs)) as { logits: unknown };
    const results = processor.post_process_speaker_diarization(logits, WINDOW_SAMPLES);
    const segments = results[0] ?? [];

    const offsetGrid = Math.floor(startSample / SAMPLE_RATE / GRID_SEC);
    const windowGrid = Math.ceil(WINDOW_SEC / GRID_SEC);
    const windowEndGrid = Math.min(totalGrid, offsetGrid + windowGrid);

    // Local speakers 0..2 → activity masks aligned to the global grid.
    const locals = [0, 1, 2].map(() => new Uint8Array(totalGrid));
    let anyLocal = false;
    for (const seg of segments) {
      const members = POWERSET[seg.id] ?? [];
      if (members.length === 0) continue;
      const from = Math.min(windowEndGrid, offsetGrid + Math.floor(seg.start / GRID_SEC));
      const to = Math.min(windowEndGrid, offsetGrid + Math.ceil(seg.end / GRID_SEC));
      for (const m of members) {
        const mask = locals[m]!;
        for (let i = from; i < to; i += 1) mask[i] = 1;
        if (to > from) anyLocal = true;
      }
    }

    if (anyLocal) {
      // Match against what we already know, using only the region this window
      // shares with the ones before it.
      const matchFrom = offsetGrid;
      const matchTo = Math.min(windowEndGrid, coveredGrid);
      const taken = new Set<number>();

      const scored: { local: number; global: number; iou: number }[] = [];
      if (matchTo > matchFrom) {
        for (let l = 0; l < locals.length; l += 1) {
          for (let g = 0; g < globals.length; g += 1) {
            const iou = intersectionOverUnion(locals[l]!, globals[g]!, matchFrom, matchTo);
            if (iou >= MIN_MATCH_IOU) scored.push({ local: l, global: g, iou });
          }
        }
        scored.sort((a, b) => b.iou - a.iou);
      }

      const assignment = new Map<number, number>();
      for (const s of scored) {
        if (assignment.has(s.local) || taken.has(s.global)) continue;
        assignment.set(s.local, s.global);
        taken.add(s.global);
      }

      for (let l = 0; l < locals.length; l += 1) {
        const mask = locals[l]!;
        let active = false;
        for (let i = offsetGrid; i < windowEndGrid; i += 1) {
          if (mask[i]) {
            active = true;
            break;
          }
        }
        if (!active) continue;

        let target = assignment.get(l);
        if (target == null) {
          if (globals.length < maxSpeakers) {
            target = globals.length;
            globals.push(new Uint8Array(totalGrid));
          } else {
            // At the cap: fold into the closest existing speaker.
            let best = 0;
            let bestIou = -1;
            for (let g = 0; g < globals.length; g += 1) {
              if (taken.has(g)) continue;
              const iou = intersectionOverUnion(mask, globals[g]!, offsetGrid, windowEndGrid);
              if (iou > bestIou) {
                bestIou = iou;
                best = g;
              }
            }
            target = best;
          }
          taken.add(target);
        }
        const dest = globals[target]!;
        for (let i = offsetGrid; i < windowEndGrid; i += 1) if (mask[i]) dest[i] = 1;
      }
    }

    coveredGrid = Math.max(coveredGrid, windowEndGrid);
    opts.onProgress?.((w + 1) / windowStarts.length);
  }

  if (globals.length === 0) return { turns: [], speakerCount: 0 };

  // Overlapping speech: give each grid cell to one speaker, dominant first.
  const order = globals
    .map((mask, index) => ({ index, total: mask.reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.total - a.total)
    .filter((g) => g.total > 0);

  const owner = new Int16Array(totalGrid).fill(-1);
  for (const { index } of order) {
    const mask = globals[index]!;
    for (let i = 0; i < totalGrid; i += 1) if (mask[i] && owner[i] === -1) owner[i] = index;
  }

  // Renumber so speakers are 0..n-1 in order of first appearance.
  const renumber = new Map<number, number>();
  for (let i = 0; i < totalGrid; i += 1) {
    const v = owner[i]!;
    if (v >= 0 && !renumber.has(v)) renumber.set(v, renumber.size);
  }

  const turns: SpeakerTurn[] = [];
  for (const [original, mapped] of renumber) {
    for (const run of runsOf(owner, original)) {
      turns.push({ speaker: mapped, start: run.start, end: run.end });
    }
  }

  const tidied = tidyTurns(turns);
  return { turns: tidied, speakerCount: new Set(tidied.map((t) => t.speaker)).size };
}
