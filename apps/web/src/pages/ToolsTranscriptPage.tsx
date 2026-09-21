import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { useTranslation } from "react-i18next";
import { api, apiList, getToken, type ListMeta } from "../api";
import { apiUrl } from "../config";
import { useAlerts } from "../alerts/AlertProvider";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { PageHeader } from "../components/PageHeader";
import { PageState } from "../components/PageState";
import { Pagination } from "../components/Pagination";
import { StatusBadge, statusTone } from "../components/StatusBadge";
import {
  ACCEPTED_MEDIA,
  MediaDecodeError,
  decodeMediaToPcm,
  formatBytes,
  formatDuration,
} from "../lib/mediaAudio";
import {
  TRANSCRIBE_LANGUAGES,
  WHISPER_MODELS,
  type TranscriptDetail,
  type TranscriptListItem,
  type TranscriptTurn,
  type WorkerRequest,
  type WorkerResponse,
  type WorkerStage,
} from "../lib/transcriptTypes";

const PAGE_SIZE = 12;
const STATUS_FILTERS = ["", "COMPLETED", "PROCESSING", "FAILED"] as const;

/** Weight of each stage in the single progress bar the user watches. */
const STAGE_WEIGHT: Record<WorkerStage, { from: number; to: number }> = {
  load: { from: 0, to: 0.15 },
  diarize: { from: 0.15, to: 0.45 },
  transcribe: { from: 0.45, to: 1 },
};

type Job = {
  id: string;
  fileName: string;
  stage: WorkerStage;
  progress: number;
  device: string;
  turns: TranscriptTurn[];
};

function titleFromFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  return (base || name).slice(0, 200);
}

/**
 * The worker is created lazily (it pulls in ~850 kB of ONNX runtime) and kept
 * for the life of the page so a second file reuses the already-loaded model.
 */
function useWorker() {
  const ref = useRef<Worker | null>(null);
  const get = useCallback(() => {
    ref.current ??= new Worker(new URL("../workers/transcribe.worker.ts", import.meta.url), {
      type: "module",
    });
    return ref.current;
  }, []);
  const stop = useCallback(() => {
    ref.current?.terminate();
    ref.current = null;
  }, []);
  return { get, stop, ref };
}

export function ToolsTranscriptPage() {
  const { t, i18n } = useTranslation();
  const { notify } = useAlerts();
  const { get: getWorker, stop: stopWorker } = useWorker();

  const [items, setItems] = useState<TranscriptListItem[]>([]);
  const [meta, setMeta] = useState<ListMeta | null>(null);
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TranscriptDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [modelId, setModelId] = useState<string>(WHISPER_MODELS[1].id);
  const [language, setLanguage] = useState("");
  const [diarizeOn, setDiarizeOn] = useState(true);
  const [maxSpeakers, setMaxSpeakers] = useState(6);

  const [job, setJob] = useState<Job | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const lastPushedProgress = useRef(0);

  const toastError = useCallback(
    (err: unknown) =>
      notify({
        title: t("common.error"),
        body: err instanceof Error ? err.message : String(err),
        tone: "danger",
      }),
    [notify, t],
  );

  const speakerLabel = useCallback(
    (index: number) => t("tools.transcript.speakerN", { n: index + 1 }),
    [t],
  );

  const loadList = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
      if (query.trim()) params.set("q", query.trim());
      if (statusFilter) params.set("status", statusFilter);
      const res = await apiList<TranscriptListItem[]>(`/tools/transcripts?${params}`);
      setItems(res.data);
      setMeta(res.meta);
    } catch (err) {
      setListError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [page, query, statusFilter]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!activeId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    void api<TranscriptDetail>(`/tools/transcripts/${activeId}`)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) toastError(err);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, toastError]);

  /**
   * A job only exists in this tab. If the page goes away mid-run nothing would
   * ever finish the row, so mark it failed instead of leaving it Processing
   * forever. `keepalive` lets the request outlive the unload.
   */
  const runningId = useRef<string | null>(null);
  useEffect(() => {
    const abandon = () => {
      const id = runningId.current;
      if (!id) return;
      runningId.current = null;
      const token = getToken();
      void fetch(apiUrl(`/api/v1/tools/transcripts/${id}/fail`), {
        method: "POST",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: "Cancelled before it finished" }),
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", abandon);
    return () => {
      window.removeEventListener("pagehide", abandon);
      abandon();
      stopWorker();
    };
  }, [stopWorker]);

  const cancelJob = useCallback(() => {
    stopWorker();
    const id = runningId.current;
    runningId.current = null;
    setJob(null);
    setBusy(false);
    if (id) {
      void api(`/tools/transcripts/${id}/fail`, {
        method: "POST",
        body: JSON.stringify({ message: t("tools.transcript.cancelled") }),
      })
        .catch(() => undefined)
        .finally(() => void loadList());
    }
  }, [loadList, stopWorker, t]);

  const overallProgress = useMemo(() => {
    if (!job) return 0;
    const { from, to } = STAGE_WEIGHT[job.stage];
    return Math.round((from + (to - from) * job.progress) * 100);
  }, [job]);

  const startTranscription = useCallback(
    async (file: File) => {
      if (job) return;
      setBusy(true);
      lastPushedProgress.current = 0;
      let created: TranscriptDetail | null = null;
      try {
        const { pcm, durationSec } = await decodeMediaToPcm(file);

        created = await api<TranscriptDetail>("/tools/transcripts", {
          method: "POST",
          body: JSON.stringify({
            title: titleFromFileName(file.name),
            sourceName: file.name,
            mimeType: file.type,
            sizeBytes: file.size,
            durationSec,
            language,
            modelId,
          }),
        });
        setActiveId(created.id);
        runningId.current = created.id;
        setJob({
          id: created.id,
          fileName: file.name,
          stage: "load",
          progress: 0,
          device: "",
          turns: [],
        });
        await loadList();

        const transcriptId = created.id;
        const worker = getWorker();

        const onMessage = (event: MessageEvent<WorkerResponse>) => {
          const msg = event.data;
          if (msg.jobId !== transcriptId) return;

          if (msg.type === "stage") {
            setJob((j) =>
              j ? { ...j, stage: msg.stage, progress: 0, device: msg.detail ?? j.device } : j,
            );
          } else if (msg.type === "progress") {
            setJob((j) => (j ? { ...j, stage: msg.stage, progress: msg.value } : j));
            const { from, to } = STAGE_WEIGHT[msg.stage];
            const pct = Math.round((from + (to - from) * msg.value) * 100);
            if (pct - lastPushedProgress.current >= 10) {
              lastPushedProgress.current = pct;
              void api(`/tools/transcripts/${transcriptId}/progress`, {
                method: "PATCH",
                body: JSON.stringify({ progress: pct }),
              }).catch(() => undefined);
            }
          } else if (msg.type === "partial") {
            setJob((j) => (j ? { ...j, turns: msg.turns } : j));
          } else if (msg.type === "done") {
            worker.removeEventListener("message", onMessage);
            const speakerNames: Record<string, string> = {};
            for (const turn of msg.turns) {
              if (!turn.speaker || speakerNames[turn.speaker] != null) continue;
              const index = Number.parseInt(turn.speaker.slice(1), 10) - 1;
              speakerNames[turn.speaker] = speakerLabel(Number.isFinite(index) ? index : 0);
            }
            void api<TranscriptDetail>(`/tools/transcripts/${transcriptId}/result`, {
              method: "POST",
              body: JSON.stringify({
                segments: msg.turns,
                speakerNames,
                speakerCount: msg.speakerCount,
                durationSec: msg.durationSec,
                language: msg.language,
                modelId,
              }),
            })
              .then((saved) => {
                setDetail(saved);
                notify({ title: t("tools.transcript.done"), tone: "success" });
              })
              .catch((err: unknown) =>
                toastError(err),
              )
              .finally(() => {
                runningId.current = null;
                setJob(null);
                setBusy(false);
                void loadList();
              });
          } else if (msg.type === "error") {
            worker.removeEventListener("message", onMessage);
            toastError(new Error(msg.message));
            void api(`/tools/transcripts/${transcriptId}/fail`, {
              method: "POST",
              body: JSON.stringify({ message: msg.message.slice(0, 1000) }),
            })
              .catch(() => undefined)
              .finally(() => {
                runningId.current = null;
                setJob(null);
                setBusy(false);
                void loadList();
              });
          }
        };

        worker.addEventListener("message", onMessage);
        const request: WorkerRequest = {
          type: "run",
          jobId: transcriptId,
          pcm,
          sampleRate: 16_000,
          modelId,
          language,
          diarize: diarizeOn,
          maxSpeakers,
        };
        worker.postMessage(request, [pcm.buffer]);
      } catch (err) {
        const code = err instanceof MediaDecodeError ? err.message : "";
        const message = code
          ? t(`tools.transcript.decodeError.${code}`)
          : err instanceof Error
            ? err.message
            : String(err);
        toastError(new Error(message));
        runningId.current = null;
        if (created) {
          void api(`/tools/transcripts/${created.id}/fail`, {
            method: "POST",
            body: JSON.stringify({ message: message.slice(0, 1000) }),
          }).catch(() => undefined);
        }
        setJob(null);
        setBusy(false);
        void loadList();
      }
    },
    [
      diarizeOn,
      getWorker,
      job,
      language,
      loadList,
      maxSpeakers,
      modelId,
      notify,
      speakerLabel,
      t,
    ],
  );

  const onPick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void startTranscription(file);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void startTranscription(file);
  };

  const patchDetail = useCallback(
    async (body: Record<string, unknown>) => {
      if (!detail) return;
      try {
        const saved = await api<TranscriptDetail>(`/tools/transcripts/${detail.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        setDetail(saved);
        void loadList();
      } catch (err) {
        toastError(err);
      }
    },
    [detail, loadList, notify],
  );

  const removeTranscript = useCallback(
    async (id: string) => {
      try {
        await api(`/tools/transcripts/${id}`, { method: "DELETE" });
        if (activeId === id) setActiveId(null);
        notify({ title: t("tools.transcript.deleted"), tone: "success" });
        void loadList();
      } catch (err) {
        toastError(err);
      }
    },
    [activeId, loadList, notify, t],
  );

  const displayName = useCallback(
    (speaker: string) => detail?.speakerNames?.[speaker]?.trim() || speaker,
    [detail],
  );

  const plainText = useMemo(() => {
    if (!detail?.segments) return detail?.text ?? "";
    return detail.segments
      .map((turn) => {
        const label = turn.speaker ? displayName(turn.speaker) : "";
        return label ? `${label}: ${turn.text}` : turn.text;
      })
      .join("\n\n");
  }, [detail, displayName]);

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(plainText);
      notify({ title: t("tools.transcript.copied"), tone: "success" });
    } catch {
      toastError(new Error(t("tools.transcript.copyFailed")));
    }
  };

  const download = (extension: "txt" | "md") => {
    if (!detail) return;
    const body =
      extension === "md"
        ? `# ${detail.title}\n\n${
            detail.segments
              ?.map((turn) => {
                const label = turn.speaker ? displayName(turn.speaker) : "";
                return label ? `**${label}**\n\n${turn.text}` : turn.text;
              })
              .join("\n\n") ?? detail.text
          }\n`
        : plainText;
    const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${detail.title.replace(/[\\/:*?"<>|]+/g, "-")}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const speakers = useMemo(() => {
    const seen: string[] = [];
    for (const turn of detail?.segments ?? []) {
      if (turn.speaker && !seen.includes(turn.speaker)) seen.push(turn.speaker);
    }
    return seen;
  }, [detail]);

  const formatDate = (iso: string) => {
    try {
      return new Intl.DateTimeFormat(i18n.language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(iso));
    } catch {
      return iso;
    }
  };

  return (
    <section className="itsm-page transcript-page">
      <PageHeader
        title={t("tools.transcript.title")}
        subtitle={t("tools.transcript.subtitle")}
        actions={
          <>
            <input
              ref={fileInput}
              type="file"
              accept={ACCEPTED_MEDIA}
              onChange={onPick}
              hidden
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() => fileInput.current?.click()}
            >
              {t("tools.transcript.upload")}
            </button>
          </>
        }
      />

      <div className="itsm-split transcript-split">
        <aside className="itsm-catalog panel" aria-label={t("tools.transcript.title")}>
          <div className="itsm-catalog-tools">
            <input
              type="search"
              value={query}
              placeholder={t("tools.transcript.searchPlaceholder")}
              aria-label={t("tools.transcript.searchPlaceholder")}
              onChange={(e) => {
                setPage(1);
                setQuery(e.target.value);
              }}
            />
            <select
              value={statusFilter}
              aria-label={t("tools.transcript.statusFilter")}
              onChange={(e) => {
                setPage(1);
                setStatusFilter(e.target.value as (typeof STATUS_FILTERS)[number]);
              }}
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value || "all"} value={value}>
                  {value ? t(`tools.transcript.status.${value}`) : t("tools.transcript.statusAll")}
                </option>
              ))}
            </select>
          </div>

          <PageState
            loading={loading}
            empty={!loading && items.length === 0}
            error={listError}
            emptyMessage={t("tools.transcript.emptyList")}
          />

          <div className="itsm-catalog-list">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`itsm-catalog-item${item.id === activeId ? " active" : ""}`}
                onClick={() => setActiveId(item.id)}
              >
                <span className="itsm-catalog-title">{item.title}</span>
                <span className="transcript-item-meta">
                  <StatusBadge tone={statusTone(item.status)}>
                    {t(`tools.transcript.status.${item.status}`)}
                  </StatusBadge>
                  {item.durationSec > 0 && <span>{formatDuration(item.durationSec)}</span>}
                  {item.speakerCount > 0 && (
                    <span>{t("tools.transcript.speakerCount", { count: item.speakerCount })}</span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {meta && (
            <Pagination
              page={meta.page}
              totalPages={meta.totalPages}
              total={meta.total}
              pageSize={meta.pageSize}
              disabled={loading}
              onPageChange={setPage}
            />
          )}
        </aside>

        <div className="itsm-workspace transcript-workspace">
          <section className="panel transcript-intake">
            <header className="transcript-intake-head">
              <h2>{t("tools.transcript.intakeTitle")}</h2>
              <p className="muted">{t("tools.transcript.privacyNote")}</p>
            </header>

            <div
              className={`transcript-drop${dragging ? " is-dragging" : ""}${busy ? " is-busy" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              {job ? (
                <div className="transcript-progress" role="status" aria-live="polite">
                  <p className="transcript-progress-file">{job.fileName}</p>
                  <p className="muted">
                    {t(`tools.transcript.stage.${job.stage}`)}
                    {job.stage === "load" && job.device
                      ? ` · ${t(`tools.transcript.device.${job.device}`)}`
                      : ""}
                  </p>
                  <div
                    className="transcript-bar"
                    role="progressbar"
                    aria-valuenow={overallProgress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${overallProgress}%` }} />
                  </div>
                  <p className="transcript-progress-pct">{overallProgress}%</p>
                  <button className="btn ghost" type="button" onClick={cancelJob}>
                    {t("common.cancel")}
                  </button>
                </div>
              ) : (
                <>
                  <p className="transcript-drop-lede">{t("tools.transcript.dropHere")}</p>
                  <p className="muted">{t("tools.transcript.formats")}</p>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={busy}
                  >
                    {t("tools.transcript.chooseFile")}
                  </button>
                </>
              )}
            </div>

            <div className="transcript-options">
              <label className="field">
                <span>{t("tools.transcript.model")}</span>
                <select
                  value={modelId}
                  disabled={busy}
                  onChange={(e) => setModelId(e.target.value)}
                >
                  {WHISPER_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {t(`tools.transcript.models.${m.labelKey}`)} · {m.sizeMb} MB
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>{t("tools.transcript.language")}</span>
                <select
                  value={language}
                  disabled={busy}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  {TRANSCRIBE_LANGUAGES.map((code) => (
                    <option key={code || "auto"} value={code}>
                      {code ? t(`tools.transcript.languages.${code}`) : t("tools.transcript.auto")}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field transcript-toggle">
                <span>{t("tools.transcript.detectSpeakers")}</span>
                <input
                  type="checkbox"
                  checked={diarizeOn}
                  disabled={busy}
                  onChange={(e) => setDiarizeOn(e.target.checked)}
                />
              </label>

              <label className="field">
                <span>{t("tools.transcript.maxSpeakers")}</span>
                <select
                  value={maxSpeakers}
                  disabled={busy || !diarizeOn}
                  onChange={(e) => setMaxSpeakers(Number(e.target.value))}
                >
                  {[2, 3, 4, 5, 6, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {job && job.turns.length > 0 && (
              <div className="transcript-live">
                <h3>{t("tools.transcript.livePreview")}</h3>
                {job.turns.slice(-3).map((turn, index) => (
                  <p key={`${turn.speaker}-${index}`}>
                    {turn.speaker && <strong>{turn.speaker}: </strong>}
                    {turn.text}
                  </p>
                ))}
              </div>
            )}
          </section>

          {activeId && (
            <section className="panel transcript-viewer">
              {detailLoading && <PageState loading />}

              {!detailLoading && detail && (
                <>
                  <header className="transcript-viewer-head">
                    <input
                      className="transcript-title-input"
                      value={detail.title}
                      aria-label={t("tools.transcript.renameTranscript")}
                      onChange={(e) => setDetail({ ...detail, title: e.target.value })}
                      onBlur={(e) => {
                        const next = e.target.value.trim();
                        if (next && next !== detail.title) void patchDetail({ title: next });
                      }}
                    />
                    <div className="transcript-actions">
                      <button className="btn" type="button" onClick={() => void copyTranscript()}>
                        {t("tools.transcript.copy")}
                      </button>
                      <button className="btn" type="button" onClick={() => download("txt")}>
                        {t("tools.transcript.downloadTxt")}
                      </button>
                      <button className="btn" type="button" onClick={() => download("md")}>
                        {t("tools.transcript.downloadMd")}
                      </button>
                      <button
                        className="btn ghost"
                        type="button"
                        onClick={() => setConfirmDelete(detail.id)}
                      >
                        {t("common.delete")}
                      </button>
                    </div>
                  </header>

                  <dl className="transcript-meta">
                    <div>
                      <dt>{t("tools.transcript.metaSource")}</dt>
                      <dd>{detail.sourceName || "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("tools.transcript.metaDuration")}</dt>
                      <dd>{detail.durationSec ? formatDuration(detail.durationSec) : "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("tools.transcript.metaSize")}</dt>
                      <dd>{detail.sizeBytes ? formatBytes(detail.sizeBytes) : "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("tools.transcript.metaWords")}</dt>
                      <dd>{detail.wordCount.toLocaleString(i18n.language)}</dd>
                    </div>
                    <div>
                      <dt>{t("tools.transcript.metaSpeakers")}</dt>
                      <dd>{detail.speakerCount || "—"}</dd>
                    </div>
                    <div>
                      <dt>{t("tools.transcript.metaCreated")}</dt>
                      <dd>{formatDate(detail.createdAt)}</dd>
                    </div>
                  </dl>

                  {detail.status === "FAILED" && (
                    <p className="form-error">{detail.errorMessage || t("common.error")}</p>
                  )}

                  {speakers.length > 0 && (
                    <div className="transcript-speakers">
                      <h3>{t("tools.transcript.speakersTitle")}</h3>
                      <p className="muted">{t("tools.transcript.speakersHint")}</p>
                      <div className="transcript-speaker-grid">
                        {speakers.map((speaker, index) => (
                          <label key={speaker} className="field">
                            <span>{speaker}</span>
                            <input
                              value={detail.speakerNames?.[speaker] ?? ""}
                              placeholder={speakerLabel(index)}
                              onChange={(e) =>
                                setDetail({
                                  ...detail,
                                  speakerNames: {
                                    ...(detail.speakerNames ?? {}),
                                    [speaker]: e.target.value,
                                  },
                                })
                              }
                              onBlur={() =>
                                void patchDetail({ speakerNames: detail.speakerNames ?? {} })
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  )}

                  <article className="transcript-body">
                    {(detail.segments ?? []).length === 0 && detail.status === "PROCESSING" && (
                      <p className="muted">{t("tools.transcript.stillRunning")}</p>
                    )}
                    {(detail.segments ?? []).map((turn, index) => (
                      <p key={`${turn.speaker}-${index}`} className="transcript-turn">
                        {turn.speaker && (
                          <span className={`transcript-speaker s-${turn.speaker.toLowerCase()}`}>
                            {displayName(turn.speaker)}
                          </span>
                        )}
                        <span className="transcript-text">{turn.text}</span>
                      </p>
                    ))}
                  </article>

                  <label className="field transcript-notes">
                    <span>{t("tools.transcript.notes")}</span>
                    <textarea
                      rows={3}
                      value={detail.notes}
                      onChange={(e) => setDetail({ ...detail, notes: e.target.value })}
                      onBlur={(e) => void patchDetail({ notes: e.target.value })}
                    />
                  </label>
                </>
              )}
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete != null}
        title={t("tools.transcript.deleteTitle")}
        body={t("tools.transcript.deleteMessage")}
        confirmLabel={t("common.delete")}
        danger
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          const id = confirmDelete;
          setConfirmDelete(null);
          if (id) void removeTranscript(id);
        }}
      />
    </section>
  );
}
