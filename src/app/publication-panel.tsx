"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authRequest } from "./auth-client";
import { uploadPublication } from "./publication-upload";
import type {
  PublicationAccount,
  PublicationApiError,
  PublicationDevice,
  PublicationJob,
  PublicationPlatform,
  PublicationResponse,
  PublicationsResponse,
  PublicationStatus,
} from "./publication-types";
import {
  accountsForSelection,
  countWords,
  toBuenosAiresIso,
  validateCaption,
  validateVideoFile,
} from "./publication-validation";

const API = (process.env.NEXT_PUBLIC_API_URL || "https://api.southfarm.tech").replace(/\/$/, "");
const ACTIVE_STATUSES = new Set<PublicationStatus>([
  "queued", "claimed", "preparing", "transferring", "selecting_media", "editing", "captioning",
  "ready_to_publish", "publishing", "verifying", "cancellation_requested",
]);
const PROGRESS_STATUSES = new Set<PublicationStatus>([
  "claimed", "preparing", "transferring", "selecting_media", "editing", "captioning",
  "ready_to_publish", "publishing", "verifying", "cancellation_requested",
]);
const FINAL_STATUSES = new Set<PublicationStatus>(["completed", "cancelled", "failed"]);

const PLATFORM_OPTIONS: Array<{ id: PublicationPlatform; label: string; short: string }> = [
  { id: "instagram", label: "Instagram Reels", short: "IG" },
  { id: "tiktok", label: "TikTok", short: "TT" },
  { id: "youtube", label: "YouTube Shorts", short: "YT" },
];

const STATUS_LABELS: Record<PublicationStatus, string> = {
  queued: "En cola", claimed: "Asignada", preparing: "Preparando", transferring: "Transfiriendo",
  selecting_media: "Seleccionando video", editing: "Editando", captioning: "Escribiendo caption",
  ready_to_publish: "Lista para publicar", publishing: "Publicando", verifying: "Verificando",
  cancellation_requested: "Cancelación solicitada", completed: "Completada", cancelled: "Cancelada",
  failed: "Fallida", review_required: "Requiere revisión",
};

const ERROR_MESSAGES: Record<string, string> = {
  REVIEW_REQUIRED: "Esta cuenta tiene una publicación incierta. Revisala antes de crear otra.",
  VIDEO_TOO_LARGE: "El video supera el límite de 200 MiB.",
  MEDIA_METADATA_INVALID: "No pudimos verificar duración, resolución o códecs del video.",
  UNSAFE_TRANSITION: "La publicación avanzó y esta acción ya no es segura.",
  USER_SESSION_REQUIRED: "Volvé a iniciar sesión para administrar publicaciones.",
  REQUEST_ABORTED: "La carga se interrumpió. Tus campos se conservaron para reintentar.",
};

type QueueTab = "queued" | "progress" | "review" | "final";
type ScheduleMode = "now" | "schedule";

interface VideoMeta { duration: number | null; width: number | null; height: number | null }

export interface PublicationPanelProps {
  token: string;
  devices: PublicationDevice[];
  accounts: PublicationAccount[];
  canManage: boolean;
}

function apiError(error: unknown): string {
  if (error && typeof error === "object") {
    const value = error as PublicationApiError & { message?: string };
    if (value.error_code && ERROR_MESSAGES[value.error_code]) return ERROR_MESSAGES[value.error_code];
    if (value.error) return value.error;
    if (value.message) return value.message;
  }
  return "No pudimos completar la operación. Volvé a intentarlo.";
}

function dateTime(value: string): string {
  return new Date(value).toLocaleString("es-AR", {
    timeZone: "America/Argentina/Buenos_Aires", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

function bytes(value: number): string {
  return value >= 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MiB` : `${Math.ceil(value / 1024)} KiB`;
}

function defaultSchedule(): { date: string; time: string } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(Date.now() + 60 * 60 * 1000)).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function filterJobs(jobs: PublicationJob[], tab: QueueTab): PublicationJob[] {
  if (tab === "queued") return jobs.filter((job) => job.status === "queued");
  if (tab === "progress") return jobs.filter((job) => PROGRESS_STATUSES.has(job.status));
  if (tab === "review") return jobs.filter((job) => job.status === "review_required");
  return jobs.filter((job) => FINAL_STATUSES.has(job.status));
}

export function PublicationPanel({ token, devices, accounts, canManage }: PublicationPanelProps) {
  const [initialSchedule] = useState(defaultSchedule);
  const [platform, setPlatform] = useState<PublicationPlatform>("instagram");
  const [deviceId, setDeviceId] = useState<number | null>(null);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const [videoMeta, setVideoMeta] = useState<VideoMeta>({ duration: null, width: null, height: null });
  const [caption, setCaption] = useState("");
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>("now");
  const [scheduleDate, setScheduleDate] = useState(initialSchedule.date);
  const [scheduleTime, setScheduleTime] = useState(initialSchedule.time);
  const [scheduleError, setScheduleError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [jobs, setJobs] = useState<PublicationJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [tab, setTab] = useState<QueueTab>("queued");
  const [selectedJob, setSelectedJob] = useState<PublicationJob | null>(null);
  const [rescheduleId, setRescheduleId] = useState<number | null>(null);
  const [actionBusy, setActionBusy] = useState<number | null>(null);
  const uploadController = useRef<AbortController | null>(null);

  const selectedDevice = devices.find((device) => device.id === deviceId) || null;
  const matchingAccounts = useMemo(() => accountsForSelection(accounts, deviceId, platform), [accounts, deviceId, platform]);
  const captionError = validateCaption(caption, platform);
  const wordCount = countWords(caption);

  const loadJobs = useCallback(async (quiet = false) => {
    if (!quiet) setLoadingJobs(true);
    try {
      const response = await authRequest<PublicationsResponse>(API, "/api/publications", token);
      setJobs(response.publications || []);
    } catch (cause) {
      if (!quiet) setError(apiError(cause));
    } finally {
      if (!quiet) setLoadingJobs(false);
    }
  }, [token]);

  useEffect(() => {
    const task = window.setTimeout(() => void loadJobs(), 0);
    return () => window.clearTimeout(task);
  }, [loadJobs]);
  useEffect(() => {
    if (!jobs.some((job) => ACTIVE_STATUSES.has(job.status))) return;
    const timer = window.setInterval(() => void loadJobs(true), 5000);
    return () => window.clearInterval(timer);
  }, [jobs, loadJobs]);
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);
  useEffect(() => () => {
    uploadController.current?.abort();
    uploadController.current = null;
  }, []);
  useEffect(() => {
    if (!selectedJob) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedJob(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selectedJob]);

  function choosePlatform(next: PublicationPlatform) {
    setPlatform(next);
    setAccountId(null);
    setError("");
  }

  function chooseDevice(value: string) {
    setDeviceId(value ? Number(value) : null);
    setAccountId(null);
  }

  function chooseFile(next: File | null) {
    if (!next) return;
    const validation = validateVideoFile(next);
    setFileError(validation || "");
    if (validation) return;
    setFile(next);
    setPreviewUrl(URL.createObjectURL(next));
    setVideoMeta({ duration: null, width: null, height: null });
  }

  function scheduledFor(forceScheduled = false): string | null {
    if (!forceScheduled && scheduleMode === "now") return new Date().toISOString();
    try {
      const value = toBuenosAiresIso(scheduleDate, scheduleTime);
      setScheduleError("");
      return value;
    } catch (cause) {
      setScheduleError(cause instanceof Error ? cause.message : "Horario inválido.");
      return null;
    }
  }

  const formReady = canManage && Boolean(file && deviceId && accountId && !captionError && !fileError && !submitting);

  async function submit() {
    if (!formReady || !file || !deviceId || !accountId) return;
    const schedule = scheduledFor();
    if (!schedule) return;
    setSubmitting(true); setUploadProgress(0); setError(""); setNotice("");
    const body = new FormData();
    body.set("video", file); body.set("platform", platform); body.set("device_id", String(deviceId));
    body.set("social_account_id", String(accountId)); body.set("caption", caption.trim().replace(/\s+/g, " "));
    body.set("scheduled_for", schedule);
    const controller = new AbortController();
    uploadController.current = controller;
    try {
      const payload = await uploadPublication({
        apiBase: API,
        token,
        body,
        signal: controller.signal,
        onProgress: setUploadProgress,
      });
      if (controller.signal.aborted) return;
      setNotice(`Publicación #${payload.publication.id} creada y en cola.`);
      setJobs((current) => [payload.publication, ...current.filter((job) => job.id !== payload.publication.id)]);
      setTab("queued"); setFile(null); setPreviewUrl(""); setCaption(""); setUploadProgress(100);
    } catch (cause) {
      if (!controller.signal.aborted) setError(apiError(cause));
    } finally {
      if (uploadController.current === controller) {
        uploadController.current = null;
        if (!controller.signal.aborted) setSubmitting(false);
      }
    }
  }

  async function openDetail(id: number) {
    setActionBusy(id); setError("");
    try {
      const response = await authRequest<PublicationResponse>(API, `/api/publications/${id}`, token);
      setSelectedJob(response.publication);
    } catch (cause) { setError(apiError(cause)); }
    finally { setActionBusy(null); }
  }

  async function mutateJob(id: number, path: string, init: RequestInit) {
    setActionBusy(id); setError("");
    try {
      const response = await authRequest<PublicationResponse>(API, path, token, init);
      setJobs((current) => current.map((job) => job.id === id ? response.publication : job));
      if (selectedJob?.id === id) setSelectedJob(response.publication);
      setRescheduleId(null);
    } catch (cause) { setError(apiError(cause)); }
    finally { setActionBusy(null); }
  }

  const visibleJobs = filterJobs(jobs, tab);

  return (
    <div className="cc-page-stack publication-page">
      <section className="cc-section-intro publication-intro">
        <div><p className="cc-eyebrow cc-eyebrow-accent">PUBLICACIÓN SEMIORGÁNICA</p><h2>Crear publicación</h2><p>Elegí el teléfono y la cuenta exactos. SouthFarm publicará y verificará el resultado de forma observable.</p></div>
        <div className="publication-timezone"><span>Zona horaria</span><strong>Buenos Aires · UTC−3</strong></div>
      </section>

      {!canManage && <div className="cc-alert publication-readonly" role="status">Modo solo lectura: tu rol puede consultar la cola, pero no crear, cancelar ni reprogramar publicaciones.</div>}
      {notice && <div className="cc-alert sf-success-alert" role="status" aria-live="polite">{notice}</div>}
      {error && <div className="cc-alert cc-alert-error" role="alert">{error}</div>}

      <div className="publication-layout">
        <section className="cc-card publication-composer" aria-labelledby="publication-composer-title">
          <div className="cc-card-heading"><div><p className="cc-eyebrow">NUEVA PUBLICACIÓN</p><h3 id="publication-composer-title">Prepará el video</h3></div><span className="publication-step">01 · Composer</span></div>

          <fieldset className="publication-platforms" disabled={!canManage}>
            <legend>Plataforma</legend>
            <div>{PLATFORM_OPTIONS.map((item) => <button key={item.id} type="button" className={platform === item.id ? "is-selected" : ""} aria-pressed={platform === item.id} onClick={() => choosePlatform(item.id)}><span>{item.short}</span><strong>{item.label}</strong></button>)}</div>
          </fieldset>

          <div className="publication-field-grid">
            <label htmlFor="publication-device">Teléfono<select id="publication-device" value={deviceId || ""} disabled={!canManage} onChange={(event) => chooseDevice(event.target.value)}><option value="">Seleccioná un teléfono</option>{devices.filter((device) => device.lifecycle_status !== "revoked").map((device) => <option key={device.id} value={device.id}>{device.display_name || device.alias || device.device_name || device.device_id} · {device.online ? "online" : "offline"}</option>)}</select></label>
            <label htmlFor="publication-account">Cuenta exacta<select id="publication-account" value={accountId || ""} disabled={!canManage || !deviceId} onChange={(event) => setAccountId(event.target.value ? Number(event.target.value) : null)}><option value="">{deviceId ? "Seleccioná una cuenta" : "Primero elegí un teléfono"}</option>{matchingAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name ? `${account.display_name} · ` : ""}@{account.username}</option>)}</select></label>
          </div>
          {selectedDevice && <div className={`publication-availability ${selectedDevice.online && !selectedDevice.current_task ? "is-ready" : "is-warn"}`} role="status"><span className="cc-status-dot" /><div><strong>{selectedDevice.online ? selectedDevice.current_task ? "Teléfono ocupado" : "Teléfono disponible" : "Teléfono sin conexión"}</strong><small>{selectedDevice.online ? selectedDevice.current_task ? `Está ejecutando ${selectedDevice.current_task.task_type}. Podés programar y quedará en cola.` : "El worker confirmará disponibilidad ADB antes de publicar." : "Podés programar ahora; el trabajo esperará conexión y autorización ADB."}</small></div></div>}

          <label className={`publication-dropzone ${fileError ? "has-error" : ""}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); chooseFile(event.dataTransfer.files[0] || null); }}>
            <input type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" disabled={!canManage} onChange={(event) => chooseFile(event.target.files?.[0] || null)} />
            <span className="publication-drop-icon" aria-hidden="true">↥</span><strong>{file ? file.name : "Arrastrá el video o elegilo desde el equipo"}</strong><small>MP4, MOV o WebM · máximo 200 MiB</small>
          </label>
          {fileError && <p className="publication-field-error" role="alert">{fileError}</p>}
          {file && <div className="publication-preview">
            <video src={previewUrl} muted controls preload="metadata" onLoadedMetadata={(event) => setVideoMeta({ duration: event.currentTarget.duration, width: event.currentTarget.videoWidth, height: event.currentTarget.videoHeight })} />
            <div><span>Archivo</span><strong>{file.name}</strong><dl><div><dt>Tamaño</dt><dd>{bytes(file.size)}</dd></div><div><dt>Duración</dt><dd>{videoMeta.duration ? `${videoMeta.duration.toFixed(1)} s` : "Leyendo…"}</dd></div><div><dt>Resolución</dt><dd>{videoMeta.width ? `${videoMeta.width}×${videoMeta.height}` : "Leyendo…"}</dd></div></dl>{videoMeta.width && videoMeta.height && Math.abs(videoMeta.width / videoMeta.height - 9 / 16) > .04 && <p>La relación no es 9:16; la plataforma podría recortar el video.</p>}</div>
          </div>}

          <label className="publication-caption" htmlFor="publication-caption">Caption<textarea id="publication-caption" rows={3} maxLength={platform === "youtube" ? 101 : undefined} value={caption} disabled={!canManage} onChange={(event) => setCaption(event.target.value)} aria-describedby="publication-caption-count publication-caption-error" placeholder="Hasta diez palabras" /><span id="publication-caption-count">{wordCount}/10 palabras{platform === "youtube" ? ` · ${caption.trim().length}/100 caracteres` : ""}</span></label>
          {caption && captionError && <p id="publication-caption-error" className="publication-field-error" role="alert">{captionError}</p>}

          <fieldset className="publication-schedule" disabled={!canManage}>
            <legend>Momento de publicación</legend>
            <div className="cc-segmented"><button type="button" className={scheduleMode === "now" ? "is-selected" : ""} aria-pressed={scheduleMode === "now"} onClick={() => setScheduleMode("now")}>Ahora</button><button type="button" className={scheduleMode === "schedule" ? "is-selected" : ""} aria-pressed={scheduleMode === "schedule"} onClick={() => setScheduleMode("schedule")}>Programar</button></div>
            {scheduleMode === "schedule" && <div className="publication-schedule-fields"><label>Fecha<input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></label><label>Hora<input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label><span>America/Argentina/Buenos_Aires</span></div>}
          </fieldset>
          {scheduleError && <p className="publication-field-error" role="alert">{scheduleError}</p>}

          <div className="publication-summary"><div><span>Destino</span><strong>{selectedDevice ? selectedDevice.display_name || selectedDevice.alias || selectedDevice.device_name || selectedDevice.device_id : "Sin teléfono"}</strong><small>{matchingAccounts.find((account) => account.id === accountId)?.username ? `@${matchingAccounts.find((account) => account.id === accountId)?.username}` : "Sin cuenta"}</small></div><div><span>Acción</span><strong>{scheduleMode === "now" ? "Publicar ahora" : "Programar"}</strong><small>{scheduleMode === "schedule" ? `${scheduleDate} · ${scheduleTime} ART` : "Se encolará inmediatamente"}</small></div></div>
          {submitting && <div className="publication-upload" role="status" aria-live="polite"><div><span>Cargando video</span><strong>{uploadProgress}%</strong></div><progress max="100" value={uploadProgress}>{uploadProgress}%</progress></div>}
          <button type="button" className="cc-button cc-button-primary cc-button-wide publication-submit" disabled={!formReady} onClick={() => void submit()}>{submitting ? "Cargando…" : scheduleMode === "now" ? "Publicar ahora" : "Programar publicación"}<span>→</span></button>
        </section>

        <section className="cc-card publication-queue" aria-labelledby="publication-queue-title">
          <div className="cc-card-heading"><div><p className="cc-eyebrow">COLA E HISTORIAL</p><h3 id="publication-queue-title">Publicaciones</h3></div><button type="button" className="cc-button cc-button-ghost" onClick={() => void loadJobs()} disabled={loadingJobs}>↻ Actualizar</button></div>
          <div className="publication-tabs" role="tablist" aria-label="Estados de publicaciones">{([ ["queued", "En cola"], ["progress", "En progreso"], ["review", "Revisión"], ["final", "Finalizadas"] ] as Array<[QueueTab, string]>).map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "is-selected" : ""} onClick={() => setTab(id)}>{label}<span>{filterJobs(jobs, id).length}</span></button>)}</div>
          {loadingJobs ? <p className="publication-loading">Cargando publicaciones…</p> : visibleJobs.length === 0 ? <div className="cc-empty"><div className="cc-empty-mark">⌁</div><strong>No hay publicaciones en esta vista</strong><span>Los nuevos trabajos aparecerán acá.</span></div> : <div className="publication-job-list">{visibleJobs.map((job) => {
            const account = accounts.find((item) => item.id === job.social_account_id);
            const device = devices.find((item) => item.id === job.device_id);
            const canCancel = canManage && !job.final_action_at && !["completed", "cancelled", "failed", "review_required", "cancellation_requested"].includes(job.status);
            const canReschedule = canManage && job.status === "queued";
            return <article key={job.id} className={`publication-job status-${job.status}`}><button type="button" className="publication-job-main" onClick={() => void openDetail(job.id)} disabled={actionBusy === job.id}><span className="publication-job-platform">{PLATFORM_OPTIONS.find((item) => item.id === job.platform)?.short}</span><span className="publication-job-copy"><strong>@{account?.username || `cuenta ${job.social_account_id}`}</strong><small>{device?.display_name || device?.alias || device?.device_name || device?.device_id || `teléfono ${job.device_id}`} · {dateTime(job.scheduled_for)}</small></span><span className="publication-job-status"><strong>{STATUS_LABELS[job.status]}</strong><small>{job.progress_percent}%</small></span></button>{PROGRESS_STATUSES.has(job.status) && <progress max="100" value={job.progress_percent}>{job.progress_percent}%</progress>}<div className="publication-job-actions">{canReschedule && <button type="button" className="cc-button cc-button-ghost" onClick={() => setRescheduleId(job.id)}>Reprogramar</button>}{canCancel && <button type="button" className="cc-button cc-button-danger" onClick={() => void mutateJob(job.id, `/api/publications/${job.id}/cancel`, { method: "POST" })}>Cancelar</button>}<button type="button" className="cc-button cc-button-ghost" onClick={() => void openDetail(job.id)}>Ver detalle</button></div>{rescheduleId === job.id && <div className="publication-reschedule"><label>Nueva fecha<input type="date" value={scheduleDate} onChange={(event) => setScheduleDate(event.target.value)} /></label><label>Nueva hora<input type="time" value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label><button type="button" className="cc-button cc-button-primary" onClick={() => { const iso = scheduledFor(true); if (iso) void mutateJob(job.id, `/api/publications/${job.id}/schedule`, { method: "PATCH", body: JSON.stringify({ scheduled_for: iso }) }); }}>Guardar</button></div>}</article>;
          })}</div>}
        </section>
      </div>

      {selectedJob && <div className="publication-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedJob(null); }}><section className="publication-detail" role="dialog" aria-modal="true" aria-labelledby="publication-detail-title"><div className="publication-detail-head"><div><p className="cc-eyebrow">PUBLICACIÓN #{selectedJob.id}</p><h3 id="publication-detail-title">{STATUS_LABELS[selectedJob.status]}</h3></div><button autoFocus type="button" className="cc-icon-button" aria-label="Cerrar detalle" onClick={() => setSelectedJob(null)}>×</button></div><div className="publication-detail-facts"><div><span>Cuenta</span><strong>@{accounts.find((account) => account.id === selectedJob.social_account_id)?.username || selectedJob.social_account_id}</strong></div><div><span>Programada</span><strong>{dateTime(selectedJob.scheduled_for)}</strong></div><div><span>Progreso</span><strong>{selectedJob.progress_percent}%</strong></div><div><span>Intentos</span><strong>{selectedJob.attempt_count}</strong></div></div>{selectedJob.error_code && <div className="cc-alert cc-alert-error"><strong>{selectedJob.error_code}</strong><br />{ERROR_MESSAGES[selectedJob.error_code] || selectedJob.error_message || "Requiere intervención del operador."}</div>}<div className="publication-timeline"><h4>Timeline observable</h4>{selectedJob.events?.length ? selectedJob.events.map((event) => <div key={event.id}><span className="publication-timeline-dot" /><div><strong>{event.to_status ? STATUS_LABELS[event.to_status] : event.current_step || "Evento"}</strong><small>{dateTime(event.created_at)} · {event.actor_type || "sistema"}</small>{event.message && <p>{event.message}</p>}</div></div>) : <p>El backend todavía no registró eventos adicionales.</p>}</div></section></div>}
    </div>
  );
}
