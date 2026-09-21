/**
 * Decode any browser-playable media container (.mp4, .webm, .mov, .m4a, .mp3,
 * .wav, .ogg …) to the 16 kHz mono PCM that Whisper and pyannote expect.
 *
 * Everything here runs on the user's machine — the media file itself never
 * leaves the browser.
 */

export const TARGET_SAMPLE_RATE = 16_000;

/** Containers the WebAudio decoder handles across Chrome / Edge / Safari / Firefox. */
export const ACCEPTED_MEDIA = [
  ".webm",
  ".mp4",
  ".m4a",
  ".mov",
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".flac",
  ".aac",
  ".mkv",
].join(",");

/** Hard stop so a huge file cannot blow the tab's memory budget. */
export const MAX_DURATION_SEC = 4 * 60 * 60;

export class MediaDecodeError extends Error {}

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor {
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (!Ctor) throw new MediaDecodeError("unsupported");
  return Ctor;
}

function downmix(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  if (channels === 1) {
    // Copy: the underlying AudioBuffer is released as soon as we return.
    return new Float32Array(buffer.getChannelData(0));
  }
  const out = new Float32Array(buffer.length);
  for (let c = 0; c < channels; c += 1) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i += 1) out[i]! += data[i]!;
  }
  for (let i = 0; i < out.length; i += 1) out[i]! /= channels;
  return out;
}

async function resampleToTarget(buffer: AudioBuffer): Promise<Float32Array> {
  const frames = Math.max(1, Math.ceil((buffer.duration * TARGET_SAMPLE_RATE) | 0) || 1);
  const offline = new OfflineAudioContext(1, frames, TARGET_SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return new Float32Array(rendered.getChannelData(0));
}

/**
 * Read a media file and return mono 16 kHz samples.
 * Throws `MediaDecodeError` with a stable code the UI turns into an i18n string.
 */
export async function decodeMediaToPcm(
  file: File,
): Promise<{ pcm: Float32Array; durationSec: number }> {
  const bytes = await file.arrayBuffer();
  const Ctor = audioContextCtor();

  // Decoding straight at 16 kHz avoids materialising 48 kHz PCM for a long meeting.
  let ctx: AudioContext;
  try {
    ctx = new Ctor({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    ctx = new Ctor();
  }

  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(bytes);
  } catch {
    throw new MediaDecodeError("decode");
  } finally {
    void ctx.close();
  }

  if (decoded.duration > MAX_DURATION_SEC) throw new MediaDecodeError("tooLong");
  if (decoded.length === 0) throw new MediaDecodeError("noAudio");

  const pcm =
    decoded.sampleRate === TARGET_SAMPLE_RATE ? downmix(decoded) : await resampleToTarget(decoded);

  return { pcm, durationSec: pcm.length / TARGET_SAMPLE_RATE };
}

export function formatDuration(totalSeconds: number) {
  const s = Math.max(0, Math.round(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export function formatBytes(bytes: number) {
  if (bytes <= 0) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1024).toFixed(1)} GB`;
}
