/** Shared contract between the transcript page and the in-browser Whisper worker. */

export type TranscriptStatus = "PROCESSING" | "COMPLETED" | "FAILED";

/** One paragraph of the finished transcript. No timestamps by design. */
export type TranscriptTurn = { speaker: string; text: string };

export type TranscriptListItem = {
  id: string;
  title: string;
  sourceName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  language: string;
  modelId: string;
  status: TranscriptStatus;
  progress: number;
  errorMessage: string;
  speakerCount: number;
  wordCount: number;
  createdAt: string;
  updatedAt: string;
};

export type TranscriptDetail = TranscriptListItem & {
  userId: string;
  engine: string;
  text: string;
  segments: TranscriptTurn[] | null;
  speakerNames: Record<string, string> | null;
  notes: string;
};

export const WHISPER_MODELS = [
  { id: "onnx-community/whisper-tiny", sizeMb: 45, labelKey: "tiny" },
  { id: "onnx-community/whisper-base", sizeMb: 85, labelKey: "base" },
  { id: "onnx-community/whisper-small", sizeMb: 260, labelKey: "small" },
  { id: "onnx-community/whisper-large-v3-turbo", sizeMb: 820, labelKey: "turbo" },
] as const;

export type WhisperModelId = (typeof WHISPER_MODELS)[number]["id"];

/** Whisper language codes offered in the picker; "" means auto-detect. */
export const TRANSCRIBE_LANGUAGES = [
  "",
  "en",
  "zh",
  "ru",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt",
  "hi",
  "ar",
] as const;

export type WorkerRequest = {
  type: "run";
  jobId: string;
  pcm: Float32Array;
  sampleRate: number;
  modelId: string;
  /** Empty string = let Whisper detect the language. */
  language: string;
  diarize: boolean;
  maxSpeakers: number;
};

export type WorkerStage = "load" | "diarize" | "transcribe";

export type WorkerResponse =
  | { type: "stage"; jobId: string; stage: WorkerStage; detail?: string }
  | { type: "progress"; jobId: string; stage: WorkerStage; value: number }
  | { type: "partial"; jobId: string; turns: TranscriptTurn[] }
  | {
      type: "done";
      jobId: string;
      turns: TranscriptTurn[];
      speakerCount: number;
      language: string;
      durationSec: number;
      diarized: boolean;
    }
  | { type: "error"; jobId: string; message: string };
