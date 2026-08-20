"use client";

/**
 * Activity Planner — editor de rutinas con toggle de estados (FE-B).
 * Porte de docs/mockups/activity-planner/routine-editor.html con datos reales
 * de GET /api/clusters/:id/routines y PUT /api/clusters/:id/routines/:routineId.
 *
 * v3 (2026-08-20): cards ricas —
 * - Warmup diario: minMinutes + sesiones por día (1–4) + separación máxima
 *   entre sesiones (1–10 h, default 4) → config {minMinutes, sessionsPerDay, maxGapHours}.
 * - Publicaciones: postsPorSemana + day-chips L M M J V S D (1=lun…7=dom, ISO)
 *   → config {postsPerWeek, days}.
 * - Scan automático sin cambios (timesPerDay + minGapHours).
 * - Publicación de cluster con dropzone de ARCHIVO (video) en vez de URL:
 *   multipart/form-data vía plannerApi.publishToClusterWithFile.
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
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { getActiveAccessToken } from "../auth-client";
import { plannerApi, PlannerApiError } from "./api";
import { ROUTINE_LABELS, ROUTINE_STATUS_LABELS } from "./types";
import type { Routine, RoutineConfig, RoutineStatus, RoutineType } from "./types";

/* ============================================================
   Constantes v3 (porte del mockup routine-editor.html)
   ============================================================ */

const ROUTINE_GLYPH: Record<RoutineType, ReactNode> = {
  warmup_daily: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15a8 8 0 0 1 16 0" /><path d="M12 15l3.5-3.5" /><circle cx="12" cy="15" r="1.6" /></svg>
  ),
  scan_auto: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></svg>
  ),
  publishing: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="m10.5 9.5 5 3-5 3z" /></svg>
  ),
};

/** Sesiones por día: 1–4, un valor exacto (no es un rango). */
const SESSION_OPTIONS: Array<{ value: number; sub: string }> = [
  { value: 1, sub: "bloque largo" },
  { value: 2, sub: "natural" },
  { value: 3, sub: "repartido" },
  { value: 4, sub: "muy activo" },
];

/** Day-chips L M M J V S D (1=lun … 7=dom, estilo ISO del contrato). */
const PUB_DAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];
const PUB_DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const PUB_DAY_SHORT = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/** Defaults del contrato (Extensiones v3 — campos nuevos retrocompatibles). */
const WARMUP_DEFAULTS = { minMinutes: 40, sessionsPerDay: 2, maxGapHours: 4 };
const SCAN_DEFAULTS = { timesPerDay: 2, minGapHours: 9 };
const PUBLISHING_DEFAULTS = { postsPerWeek: 2, days: [2, 4] as number[] };

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

const STATUS_ICON: Record<RoutineStatus, () => ReactElement> = {
  approved: CheckIcon,
  editing: PencilIcon,
  paused: PauseIcon,
};

/** "mar y jue" / "ninguno" a partir del array de días 1..7. */
function daysLabel(days: number[]): string {
  const names = days.map((day) => PUB_DAY_SHORT[(day - 1 + 7) % 7]);
  if (!names.length) return "ninguno";
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(" y ");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/* ============================================================
   Bloques de control por tipo de rutina
   ============================================================ */

function RuleBox({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="ap-rule-box">
      <span>{label}</span>
      {children}
      {hint ? <span className="ap-hint">{hint}</span> : null}
    </div>
  );
}

function SliderRow({
  value, min, max, step, unit, disabled, ariaLabel, onInput,
}: {
  value: number; min: number; max: number; step: number; unit: string;
  disabled: boolean; ariaLabel: string; onInput: (next: number) => void;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="ap-slider-row">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(event) => onInput(Number(event.target.value))}
      />
      <output>
        {value} <small>{unit}</small>
      </output>
    </div>
  );
}

/** Sesiones por día: 1–4, un valor exacto (no es un rango). */
function SessChips({ value, disabled, onSelect }: { value: number; disabled: boolean; onSelect: (n: number) => void }) {
  return (
    <div className="ap-sess-chips" role="group" aria-label="Cantidad de sesiones de warmup por día">
      {SESSION_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`ap-sess-chip ${value === option.value ? "is-on" : ""}`}
          aria-pressed={value === option.value}
          disabled={disabled}
          onClick={() => onSelect(option.value)}
        >
          {option.value}
          <small>{option.sub}</small>
        </button>
      ))}
    </div>
  );
}

/** Day-chips de publicación: selección múltiple, 1=lun … 7=dom. */
function DayChips({ selected, disabled, onToggle }: { selected: number[]; disabled: boolean; onToggle: (day: number) => void }) {
  return (
    <div className="ap-days-row" role="group" aria-label="Días de publicación">
      {PUB_DAY_LABELS.map((label, index) => {
        const day = index + 1;
        const on = selected.includes(day);
        return (
          <button
            key={day}
            type="button"
            className={`ap-day-chip ${on ? "is-on" : ""}`}
            aria-pressed={on}
            aria-label={PUB_DAY_NAMES[index]}
            title={PUB_DAY_NAMES[index]}
            disabled={disabled}
            onClick={() => onToggle(day)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/* ============================================================
   Editor principal
   ============================================================ */

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
  /** Formulario de publicación de cluster (C1): archivo + título + fecha/hora opcional. */
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
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

  /* C1: aceptar archivo desde la dropzone (drag & drop o file input). */
  const acceptFile = useCallback((file: File | null | undefined) => {
    if (!file) { showToast("No se pudo leer el archivo.", true); return; }
    if (!file.type.startsWith("video/")) { showToast("El archivo tiene que ser un video (MP4, MOV…).", true); return; }
    setVideoFile(file);
    const mb = (file.size / (1024 * 1024)).toFixed(1).replace(".", ",");
    showToast(`Video cargado: ${file.name} · ${mb} MB`);
  }, [showToast]);

  /* C1: publicar al cluster con archivo (v3 — multipart/form-data). */
  const submitPublish = useCallback(async () => {
    if (!videoFile) { showToast("Elegí el video para publicar.", true); return; }
    const cleanTitle = title.trim();
    if (!cleanTitle) { showToast("Ingresá el título de la publicación.", true); return; }
    setPublishing(true);
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      const scheduledFor = (scheduledDate && scheduledTime)
        ? new Date(`${scheduledDate}T${scheduledTime}:00-03:00`).toISOString()
        : undefined;
      const result = await plannerApi.publishToClusterWithFile(token, clusterId, {
        file: videoFile,
        title: cleanTitle,
        scheduledFor,
      });
      setVideoFile(null);
      setTitle("");
      setScheduledDate("");
      setScheduledTime("");
      showToast(`Publicación programada: ${result.created} cuenta${result.created === 1 ? "" : "s"}.`, false);
    } catch (cause) {
      showToast(PlannerApiError.from(cause).message, true);
    } finally {
      setPublishing(false);
    }
  }, [clusterId, videoFile, title, scheduledDate, scheduledTime, showToast]);

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
            const paused = routine.status === "paused";
            const isBusy = Boolean(busy[routine.id]);
            const isApplying = Boolean(applying[routine.id]);
            const currentError = cardError[routine.id];
            const controlsDisabled = paused || isBusy || isApplying;

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

                  {routine.routineType === "warmup_daily" && (() => {
                    const config = routine.config;
                    const minMinutes = config.minMinutes ?? WARMUP_DEFAULTS.minMinutes;
                    const sessionsPerDay = config.sessionsPerDay ?? WARMUP_DEFAULTS.sessionsPerDay;
                    const maxGapHours = config.maxGapHours ?? WARMUP_DEFAULTS.maxGapHours;
                    return (
                      <>
                        <div className="ap-rule-grid">
                          <RuleBox label="Mínimo por cuenta / día" hint="El planificador reparte estos minutos en las sesiones de abajo.">
                            <SliderRow
                              value={minMinutes}
                              min={20}
                              max={90}
                              step={5}
                              unit="min"
                              disabled={controlsDisabled}
                              ariaLabel="Minutos mínimos de warmup por cuenta por día"
                              onInput={(next) => void handleConfigEdit(routine, { minMinutes: next })}
                            />
                          </RuleBox>
                          <RuleBox label="Separación máxima entre sesiones" hint={<>Si puede, el sistema deja menos de <strong>{maxGapHours} h</strong> entre sesión y sesión (mínimo 30 min).</>}>
                            <SliderRow
                              value={maxGapHours}
                              min={1}
                              max={10}
                              step={1}
                              unit="horas"
                              disabled={controlsDisabled}
                              ariaLabel="Separación máxima entre sesiones de warmup en horas"
                              onInput={(next) => void handleConfigEdit(routine, { maxGapHours: next })}
                            />
                          </RuleBox>
                        </div>
                        <RuleBox label={<>Sesiones por día <em style={{ fontStyle: "normal", color: "var(--text-dim)" }}>— ¿en cuántas se reparten los minutos?</em></>} hint="Más sesiones = bloques más cortos, actividad más repartida y natural.">
                          <SessChips
                            value={sessionsPerDay}
                            disabled={controlsDisabled}
                            onSelect={(next) => { if (next !== sessionsPerDay) void handleConfigEdit(routine, { sessionsPerDay: next }); }}
                          />
                        </RuleBox>
                        <p className="ap-rule-summary" role="status">
                          <span>{minMinutes} min en {sessionsPerDay} sesión{sessionsPerDay === 1 ? "" : "es"} · gap máx {maxGapHours} h</span>
                        </p>
                      </>
                    );
                  })()}

                  {routine.routineType === "scan_auto" && (() => {
                    const config = routine.config;
                    const timesPerDay = config.timesPerDay ?? SCAN_DEFAULTS.timesPerDay;
                    const minGapHours = config.minGapHours ?? SCAN_DEFAULTS.minGapHours;
                    return (
                      <div className="ap-rule-grid">
                        <RuleBox label="Frecuencia diaria" hint="Ejemplo generado: 13:00 y 22:00 (separación de 9 h o más).">
                          <SliderRow
                            value={timesPerDay}
                            min={1}
                            max={4}
                            step={1}
                            unit="veces/día"
                            disabled={controlsDisabled}
                            ariaLabel="Cantidad de scans por día"
                            onInput={(next) => void handleConfigEdit(routine, { timesPerDay: next })}
                          />
                        </RuleBox>
                        <RuleBox label="Separación mínima" hint="Evita dos scans seguidos sobre el mismo teléfono.">
                          <SliderRow
                            value={minGapHours}
                            min={4}
                            max={16}
                            step={1}
                            unit="horas"
                            disabled={controlsDisabled}
                            ariaLabel="Separación mínima entre scans en horas"
                            onInput={(next) => void handleConfigEdit(routine, { minGapHours: next })}
                          />
                        </RuleBox>
                      </div>
                    );
                  })()}

                  {routine.routineType === "publishing" && (() => {
                    const config = routine.config;
                    const postsPerWeek = config.postsPerWeek ?? PUBLISHING_DEFAULTS.postsPerWeek;
                    const days = (config.days && config.days.length ? config.days : PUBLISHING_DEFAULTS.days);
                    return (
                      <div className="ap-rule-grid">
                        <RuleBox label="Posts por cuenta / semana" hint="Si hay menos días elegidos que posts, el sistema rota los días.">
                          <SliderRow
                            value={postsPerWeek}
                            min={1}
                            max={7}
                            step={1}
                            unit="videos"
                            disabled={controlsDisabled}
                            ariaLabel="Cantidad de videos por cuenta por semana"
                            onInput={(next) => void handleConfigEdit(routine, { postsPerWeek: next })}
                          />
                        </RuleBox>
                        <RuleBox label="Días de publicación" hint={<>Los posts caen en los días elegidos (ahora: <strong>{daysLabel(days)}</strong> · 16:00 BA).</>}>
                          <DayChips
                            selected={days}
                            disabled={controlsDisabled}
                            onToggle={(day) => {
                              const next = days.includes(day)
                                ? days.filter((d) => d !== day)
                                : [...days, day].sort((a, b) => a - b);
                              void handleConfigEdit(routine, { days: next });
                            }}
                          />
                        </RuleBox>
                      </div>
                    );
                  })()}
                </div>
              </section>
            );
          }) : (
            <div className="ap-empty"><strong>Sin rutinas</strong><span>Al confirmar o crear el cluster se crean las rutinas default.</span></div>
          )}
        </div>
      )}

      {/* C1: Publicación de Cluster — dropzone de archivo (v3) en vez de URL. */}
      <section
        id="ap-publicacion-cluster"
        className="ap-card ap-cluster-pub"
        aria-label="Publicación de cluster"
        style={{ scrollMarginTop: 24 }}
      >
        <div className="ap-card-heading">
          <div>
            <p className="ap-eyebrow ap-eyebrow-accent">PUBLICAR AL CLUSTER</p>
            <h3>Publicación de Cluster</h3>
            <p className="ap-card-subtitle">Un mismo video + título publicado en todas las cuentas del cluster a la hora que elijas.</p>
          </div>
        </div>
        <div className="ap-modal-body" style={{ padding: 0, paddingTop: 4 }}>
          <div aria-live="polite">
            {videoFile ? (
              <div className="ap-uploaded">
                <div className="ap-up-thumb">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
                  <span>VIDEO</span>
                </div>
                <div className="ap-up-main">
                  <strong>{videoFile.name}</strong>
                  <span>{(videoFile.size / (1024 * 1024)).toFixed(1).replace(".", ",")} MB · listo para subir</span>
                  <small>Se sube una vez y se publica en todas las cuentas del cluster</small>
                </div>
                <button
                  type="button"
                  className="ap-up-remove"
                  aria-label="Quitar archivo cargado"
                  title="Quitar archivo"
                  onClick={() => {
                    setVideoFile(null);
                    showToast("Video quitado — la publicación quedó sin archivo.", true);
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                </button>
              </div>
            ) : (
              <div
                className={`ap-dropzone ${dragOver ? "is-over" : ""}`}
                role="button"
                tabIndex={0}
                aria-label="Subir video para la publicación de cluster"
                onClick={() => fileInputRef.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
                onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
                onDragEnter={(event) => { event.preventDefault(); setDragOver(true); }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                  setDragOver(false);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragOver(false);
                  acceptFile(event.dataTransfer.files?.[0]);
                }}
              >
                <span className="ap-drop-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 15V4M7.5 8.5 12 4l4.5 4.5" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></svg>
                </span>
                <strong>Arrastrá el video acá o hacé click para elegirlo del dispositivo</strong>
                <small>Video (MP4, MOV…) · se sube una vez y se publica en todas las cuentas del cluster</small>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="video/*"
                  style={{ display: "none" }}
                  aria-hidden="true"
                  tabIndex={-1}
                  onChange={(event) => {
                    acceptFile(event.target.files?.[0] ?? null);
                    event.target.value = "";
                  }}
                />
              </div>
            )}
          </div>
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
            disabled={publishing || !videoFile || !title.trim()}
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
