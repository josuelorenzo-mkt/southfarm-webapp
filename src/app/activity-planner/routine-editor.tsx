"use client";

/**
 * Activity Planner — editor de rutinas con toggle de estados (FE-B).
 * Porte de docs/mockups/activity-planner/routine-editor.html con datos reales
 * de GET /api/clusters/:id/routines y PUT /api/clusters/:id/routines/:routineId.
 *
 * Ciclo de vida (sección 4.3 del plan — feedback del dueño 2026-08-19):
 * - Editar cualquier parámetro → el toggle salta solo a "Editando"
 *   (PUT con solo config; el backend fuerza editing; NO toca el plan).
 * - Click "Aprobado" → PUT {config, status:'approved'} → el backend
 *   cancela futuras no iniciadas y regenera → toast → onApplied().
 * - Click "Pausado" → PUT {status:'paused'} → inputs disabled, card atenuada.
 * - "Editando" es un estado derivado: NO se clickea (disabled).
 */
import "./planner-extra.css";
import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { getActiveAccessToken } from "../auth-client";
import { plannerApi, PlannerApiError } from "./api";
import { ROUTINE_LABELS, ROUTINE_STATUS_LABELS } from "./types";
import type { Routine, RoutineConfig, RoutineStatus, RoutineType } from "./types";

/* Parámetros por tipo de rutina: [key, label, min, max, step, unidad] */
const ROUTINE_PARAMS: Record<RoutineType, Array<{
  key: keyof RoutineConfig;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  hint: string;
}>> = {
  warmup_daily: [
    { key: "minMinutes", label: "Mínimo por cuenta / día", min: 20, max: 90, step: 5, unit: "min", hint: "El planificador reparte el total en 2–3 sesiones por cuenta." },
  ],
  scan_auto: [
    { key: "timesPerDay", label: "Frecuencia diaria", min: 1, max: 4, step: 1, unit: "veces/día", hint: "Ejemplo generado: 13:00 y 22:00 (separación de 9 h o más)." },
    { key: "minGapHours", label: "Separación mínima", min: 4, max: 16, step: 1, unit: "horas", hint: "Evita dos scans seguidos sobre el mismo teléfono." },
  ],
  publishing: [
    { key: "postsPerWeek", label: "Mínimo por cuenta / semana", min: 1, max: 7, step: 1, unit: "videos", hint: "Sin video en cola el día asignado, la tarea queda en atrasada y avisa." },
  ],
};

const ROUTINE_GLYPH: Record<RoutineType, string> = {
  warmup_daily: "◌",
  scan_auto: "◎",
  publishing: "▶",
};

const STATUS_ORDER: RoutineStatus[] = ["approved", "editing", "paused"];

function CheckIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
  );
}
function PencilIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z" /></svg>
  );
}
function PauseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5v14M15 5v14" /></svg>
  );
}

const STATUS_ICON: Record<RoutineStatus, () => React.ReactElement> = {
  approved: CheckIcon,
  editing: PencilIcon,
  paused: PauseIcon,
};

export default function RoutineEditor({
  clusterId,
  onClose,
  onApplied,
  autoScrollToPublish = false,
  onAutoScrollDone,
}: {
  clusterId: number;
  onClose: () => void;
  onApplied: () => void;
  /** true → scroll suave a la sección "Publicación de Cluster" al montar/actualizar. */
  autoScrollToPublish?: boolean;
  /** Callback para que el padre resetee el flag one-shot. */
  onAutoScrollDone?: () => void;
}) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /** Mutaciones en vuelo por routineId (para loading por card). */
  const [busy, setBusy] = useState<Record<number, boolean>>({});
  /** Errores inline por routineId. */
  const [cardError, setCardError] = useState<Record<number, string>>({});
  const [toast, setToast] = useState("");
  const [toastMuted, setToastMuted] = useState(false);
  const [applying, setApplying] = useState<Record<number, boolean>>({});
  /** Cartel transitorio "Cambios aplicados" (2.5s). */
  const [appliedNotice, setAppliedNotice] = useState("");
  /** Formulario de publicación de cluster (C1). */
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [publishing, setPublishing] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const appliedTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      const data = await plannerApi.getRoutines(token, clusterId);
      setRoutines(data.routines || []);
    } catch (cause) {
      setError(PlannerApiError.from(cause).message);
    } finally {
      setLoading(false);
    }
  }, [clusterId]);

  useEffect(() => {
    const task = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(task);
  }, [load]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    if (appliedTimer.current !== null) window.clearTimeout(appliedTimer.current);
  }, []);

  /* C1: scroll suave a la sección de publicación cuando el padre lo pide (flag one-shot). */
  useEffect(() => {
    if (!autoScrollToPublish) return;
    const task = window.setTimeout(() => {
      document.getElementById("ap-publicacion-cluster")?.scrollIntoView({ behavior: "smooth", block: "center" });
      onAutoScrollDone?.();
    }, 0);
    return () => window.clearTimeout(task);
  }, [autoScrollToPublish, onAutoScrollDone]);

  const showToast = useCallback((message: string, muted = false) => {
    setToast(message);
    setToastMuted(muted);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), muted ? 2400 : 2800);
  }, []);

  /** Cartel "Cambios aplicados" (2.5s). El detalle secundario va después del punto. */
  const showApplied = useCallback((detail: string) => {
    setAppliedNotice(`Cambios aplicados · ${detail}`);
    if (appliedTimer.current !== null) window.clearTimeout(appliedTimer.current);
    appliedTimer.current = window.setTimeout(() => setAppliedNotice(""), 2500);
  }, []);

  const patchRoutine = useCallback(async (routineId: number, body: { config?: Partial<RoutineConfig>; status?: RoutineStatus }) => {
    setBusy((current) => ({ ...current, [routineId]: true }));
    setCardError((current) => ({ ...current, [routineId]: "" }));
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      const result = await plannerApi.putRoutine(token, clusterId, routineId, body);
      setRoutines((current) => current.map((routine) => (routine.id === routineId ? result.routine : routine)));
      return result;
    } catch (cause) {
      const message = PlannerApiError.from(cause).message;
      setCardError((current) => ({ ...current, [routineId]: message }));
      return null;
    } finally {
      setBusy((current) => ({ ...current, [routineId]: false }));
    }
  }, [clusterId]);

  /* Editar cualquier parámetro → salta solo a Editando (config; backend fuerza editing).
     La PUT es fire-and-forget para que el slider siga fluido; un error se muestra en la card. */
  const handleConfigEdit = useCallback(async (routine: Routine, nextConfig: Partial<RoutineConfig>) => {
    setRoutines((current) => current.map((r) => (r.id === routine.id
      ? { ...r, status: "editing", config: { ...r.config, ...nextConfig } }
      : r)));
    await patchRoutine(routine.id, { config: nextConfig });
  }, [patchRoutine]);

  /* Aprobado → aplicar: config + status approved → regenera → onApplied().
     Cartel "Cambios aplicados · replanificando la semana" (la frase va primero). */
  const handleApprove = useCallback(async (routine: Routine) => {
    setApplying((current) => ({ ...current, [routine.id]: true }));
    const result = await patchRoutine(routine.id, { config: routine.config, status: "approved" });
    setApplying((current) => ({ ...current, [routine.id]: false }));
    if (!result) return;
    showApplied("replanificando la semana");
    onApplied();
  }, [patchRoutine, showApplied, onApplied]);

  /* Pausado → no genera tareas; card atenuada, inputs disabled.
     Cartel "Cambios aplicados · rutina pausada". */
  const handlePause = useCallback(async (routine: Routine) => {
    const result = await patchRoutine(routine.id, { status: "paused" });
    if (!result) return;
    showApplied("rutina pausada");
  }, [patchRoutine, showApplied]);

  /* C2: "Editando" clickeable desde paused/approved → PUT status editing + inputs habilitados. */
  const handleStartEditing = useCallback(async (routine: Routine) => {
    const result = await patchRoutine(routine.id, { status: "editing" });
    if (!result) return;
    showApplied("podés editar la rutina");
  }, [patchRoutine, showApplied]);

  /* C1: publicar al cluster desde la sección del editor (mismo contrato que el modal del detalle). */
  const submitPublish = useCallback(async () => {
    const cleanUrl = videoUrl.trim();
    if (!cleanUrl) { showToast("Ingresá la URL del video.", true); return; }
    const cleanTitle = title.trim();
    if (!cleanTitle) { showToast("Ingresá el título de la publicación.", true); return; }
    setPublishing(true);
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      const scheduledFor = (scheduledDate && scheduledTime)
        ? new Date(`${scheduledDate}T${scheduledTime}:00-03:00`).toISOString()
        : undefined;
      const result = await plannerApi.publishToCluster(token, clusterId, {
        videoUrl: cleanUrl,
        title: cleanTitle,
        scheduledFor,
      });
      setVideoUrl("");
      setTitle("");
      setScheduledDate("");
      setScheduledTime("");
      showToast(`Publicación programada: ${result.created} cuenta${result.created === 1 ? "" : "s"}.`, false);
    } catch (cause) {
      showToast(PlannerApiError.from(cause).message, true);
    } finally {
      setPublishing(false);
    }
  }, [clusterId, videoUrl, title, scheduledDate, scheduledTime, showToast]);

  return (
    <div className="ap-page-stack">
      <header className="ap-detail-topbar">
        <div className="ap-crumb">
          <button className="ap-link-button" onClick={onClose}>← Volver a la semana</button>
          <span>/</span>
          <strong>Rutinas · cluster #{clusterId}</strong>
        </div>
        <div className="ap-detail-nav">
          <button className="ap-btn ap-btn-sm" onClick={onClose}>Cerrar</button>
        </div>
      </header>

      <section className="ap-week-head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
        <div>
          <p className="ap-eyebrow ap-eyebrow-accent">ROUTINE → AUTOPLAN</p>
          <h2 style={{ margin: "8px 0 6px", fontSize: "clamp(24px, 2.6vw, 32px)", lineHeight: 1.05, letterSpacing: "-0.055em" }}>
            Definí la rutina. <em style={{ color: "var(--accent)", fontStyle: "normal" }}>El sistema arma la semana.</em>
          </h2>
          <p style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            Editar un parámetro pasa la rutina a {"\u201CEditando\u201D"} (todavía no aplica). Pasá a <strong>Aprobado</strong> para que el sistema replanifique, o a <strong>Pausado</strong> para que no genere tareas.
          </p>
        </div>
        <span style={{ color: "var(--text-dim)", fontSize: 10 }}>Se aplica a la semana en curso y la siguiente</span>
      </section>

      {error && <div className="cc-alert cc-alert-error"><span>{error}<button onClick={() => setError("")}>×</button></span></div>}

      {loading && routines.length === 0 ? (
        <div className="ap-loading" aria-label="Cargando rutinas">
          <div className="ap-skeleton" />
          <div className="ap-spinner" style={{ marginTop: 8 }} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {routines.length ? routines.map((routine) => {
            const meta = ROUTINE_LABELS[routine.routineType] || { title: routine.routineType, desc: "", color: "var(--text-secondary)" };
            const params = ROUTINE_PARAMS[routine.routineType] || [];
            const paused = routine.status === "paused";
            const isBusy = Boolean(busy[routine.id]);
            const isApplying = Boolean(applying[routine.id]);
            const currentError = cardError[routine.id];

            return (
              <section
                key={routine.id}
                className={`ap-routine-card ${routine.status === "editing" ? "is-editing" : ""} ${paused ? "is-paused" : ""} ${isApplying ? "is-applying" : ""}`}
                aria-label={`Rutina ${meta.title}`}
              >
                <div className="ap-routine-card-head" style={{ color: meta.color }}>
                  <span className="ap-routine-glyph">{ROUTINE_GLYPH[routine.routineType] || "◆"}</span>
                  <div>
                    <h3>{meta.title}</h3>
                    <p>{meta.desc}</p>
                  </div>
                  <div
                    className="ap-state-toggle"
                    data-state={routine.status}
                    role="radiogroup"
                    aria-label={`Estado de la rutina ${meta.title}`}
                  >
                    <span
                      className="ap-state-toggle-thumb"
                      aria-hidden="true"
                      style={{ transform: `translateX(${STATUS_ORDER.indexOf(routine.status) * 100}%)` }}
                    />
                    {STATUS_ORDER.map((status) => {
                      const Icon = STATUS_ICON[status];
                      const selected = routine.status === status;
                      return (
                        <button
                          key={status}
                          type="button"
                          data-state={status}
                          role="radio"
                          aria-checked={selected}
                          aria-label={ROUTINE_STATUS_LABELS[status]}
                          disabled={(status === "editing" && routine.status === "editing") || isBusy || isApplying}
                          onClick={() => {
                            if (status === "editing" && routine.status !== "editing") void handleStartEditing(routine);
                            if (status === "approved") void handleApprove(routine);
                            if (status === "paused") void handlePause(routine);
                          }}
                        >
                          <Icon />
                          {ROUTINE_STATUS_LABELS[status]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="ap-routine-body">
                  <div className="ap-routine-hint" role="status">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9.5" /><path d="M12 8v5M12 16.5h.01" /></svg>
                    <span>Cambios sin aplicar — pasá a <em>Aprobado</em> para que el sistema replanifique.</span>
                  </div>

                  {isBusy && <span className="ap-saving-label" role="status">Guardando…</span>}
                  {currentError && <div className="ap-inline-error" role="alert">{currentError}</div>}

                  <div className="ap-rule-grid">
                    {params.map((param) => {
                      const value = routine.config[param.key] ?? param.min;
                      const fill = ((value - param.min) / (param.max - param.min)) * 100;
                      return (
                        <div className="ap-rule-box" key={String(param.key)}>
                          <span>{param.label}</span>
                          <div className="ap-slider-row">
                            <input
                              type="range"
                              min={param.min}
                              max={param.max}
                              step={param.step}
                              value={value}
                              disabled={paused || isBusy}
                              aria-label={`${param.label} — ${ROUTINE_STATUS_LABELS[routine.status]}`}
                              style={{ "--fill": `${fill}%` } as CSSProperties}
                              onChange={(event) => {
                                const next = Number(event.target.value);
                                void handleConfigEdit(routine, { [param.key]: next });
                              }}
                            />
                            <output>
                              {value} <small>{param.unit}</small>
                            </output>
                          </div>
                          <span className="ap-hint">{param.hint}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          }) : (
            <div className="ap-empty"><strong>Sin rutinas</strong><span>Al confirmar o crear el cluster se crean las rutinas default.</span></div>
          )}
        </div>
      )}

      {/* C1: Publicación de Cluster — mismo formulario que el modal del detalle. */}
      <section
        id="ap-publicacion-cluster"
        className="ap-card"
        aria-label="Publicación de cluster"
        style={{ borderColor: "rgba(192, 38, 211, 0.22)", scrollMarginTop: 24 }}
      >
        <div className="ap-card-heading">
          <div>
            <p className="ap-eyebrow ap-eyebrow-accent">PUBLICAR AL CLUSTER</p>
            <h3>Publicación de Cluster</h3>
            <p className="ap-card-subtitle">Programá un video para todas las cuentas del cluster ({routines.length ? "rutinas arriba" : "sin rutinas"}).</p>
          </div>
        </div>
        <div className="ap-modal-body" style={{ padding: 0, paddingTop: 4 }}>
          <label className="ap-field">
            <span>URL del video <em>— mismo video para todas las cuentas</em></span>
            <input
              className="ap-input"
              type="url"
              value={videoUrl}
              placeholder="https://…"
              onChange={(event) => setVideoUrl(event.target.value)}
            />
          </label>
          <label className="ap-field">
            <span>Título de la publicación <em>— igual para todas las cuentas</em></span>
            <input
              className="ap-input"
              value={title}
              maxLength={90}
              placeholder="Título del video"
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <div className="ap-rule-grid">
            <label className="ap-field">
              <span>Fecha <em>— opcional</em></span>
              <input
                className="ap-input"
                type="date"
                value={scheduledDate}
                onChange={(event) => setScheduledDate(event.target.value)}
              />
            </label>
            <label className="ap-field">
              <span>Hora <em>— Buenos Aires</em></span>
              <input
                className="ap-input"
                type="time"
                value={scheduledTime}
                onChange={(event) => setScheduledTime(event.target.value)}
              />
            </label>
          </div>
          <p className="ap-hint">
            Se crea una tarea <strong>por cada cuenta</strong> del cluster con el mismo video y título.
          </p>
        </div>
        <div className="ap-modal-foot" style={{ padding: "14px 0 0", borderTop: "1px solid var(--border-subtle)" }}>
          <button
            className="ap-btn ap-btn-primary ap-btn-sm"
            disabled={publishing || !videoUrl.trim() || !title.trim()}
            onClick={() => void submitPublish()}
          >
            {publishing ? "Programando…" : "Programar publicación"}
          </button>
        </div>
      </section>

      {/* Cartel "Cambios aplicados" (C2) — transitorio, desaparece solo */}
      {appliedNotice && (
        <div
          className="ap-toast is-visible"
          role="status"
          aria-live="polite"
          style={{ position: "fixed", bottom: 78, left: "50%", transform: "translateX(-50%)" }}
        >
          <span>{appliedNotice}</span>
        </div>
      )}

      <div className={`ap-toast ${toast ? "is-visible" : ""} ${toastMuted ? "is-muted" : ""}`} role="status" aria-live="polite">
        <span>{toast}</span>
      </div>
    </div>
  );
}
