"use client";

/**
 * Vista de día del Activity Planner — porte de docs/mockups/activity-planner/day-view.html
 * con datos reales de GET /api/planner/day.
 *
 * v3: timeline con scroll propio, indicador AHORA proporcional (12:00–22:00 BA,
 * clamp atenuado fuera de rango, refresco cada 30 s, auto-scroll al montar) y
 * drag & drop por tarea INDIVIDUAL con modal de confirmación.
 */
import "./planner-extra.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, DragEvent as ReactDragEvent, ReactNode } from "react";
import { plannerApi, PlannerApiError, type CascadeMoveDto } from "./api";
import {
  BUENOS_AIRES_TIMEZONE,
  PLATFORM_META,
  PUBLICATION_STATUS_LABELS,
  STATUS_LABELS,
  TASK_TYPE_META,
  formatBATime,
  publicationBadgeClass,
  shortDate,
} from "./types";
import type { DayResponse, DayTask, PlannerTaskType } from "./types";

const HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
/** Ventana 12:00–22:00 BA en minutos desde las 0:00. */
const WINDOW_START_MIN = 12 * 60;
const WINDOW_END_MIN = 22 * 60;
/** Fase 2.5-visual: el timeline se posiciona ABSOLUTAMENTE por minuto.
    2 px por minuto ⇒ cada hora mide 120 px, los casilleros de 5' miden 10 px. */
export const PX_PER_MIN = 2;
const TRACK_TOTAL_MIN = WINDOW_END_MIN - WINDOW_START_MIN;
const TRACK_HEIGHT_PX = TRACK_TOTAL_MIN * PX_PER_MIN;
/** Snap del drop: cada 5 minutos (los "casilleros"). */
const DROP_SNAP_MIN = 5;
function minuteToPx(minute: number): number {
  return (minute - WINDOW_START_MIN) * PX_PER_MIN;
}
function formatMinuteOf(dayMinute: number): string {
  const hour = Math.floor(dayMinute / 60);
  const minute = dayMinute % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
const NOW_REFRESH_MS = 30000;

const TASK_ICONS: Record<"warmup" | "scan" | "publish", ReactNode> = {
  warmup: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M4 15a8 8 0 0 1 16 0" /><path d="M12 15l3.5-3.5" /><circle cx="12" cy="15" r="1.6" /></svg>
  ),
  scan: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m20 20-4.8-4.8" /></svg>
  ),
  publish: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="3" /><path d="m10.5 9.5 5 3-5 3z" /></svg>
  ),
};

function taskKind(taskType: PlannerTaskType): "warmup" | "scan" | "publish" {
  return TASK_TYPE_META[taskType]?.kind || "warmup";
}

function taskName(task: DayTask): string {
  const kind = taskKind(task.taskType);
  if (kind === "publish") return "Publicación";
  if (kind === "scan") return `Scan ${task.platform ? (PLATFORM_META[task.platform]?.short || "") : ""}`.trim();
  return `Warmup ${task.platform ? (PLATFORM_META[task.platform]?.short || "") : ""}`.trim();
}

function baHourOf(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  return Number(parts.find((part) => part.type === "hour")?.value || 12);
}

function baDateKeyOf(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const year = parts.find((part) => part.type === "year")?.value || "";
  const month = parts.find((part) => part.type === "month")?.value || "";
  const day = parts.find((part) => part.type === "day")?.value || "";
  return `${year}-${month}-${day}`;
}

function isNowInHour(hour: number, nowIso: string): boolean {
  return baHourOf(nowIso) === hour;
}

/** Minutos del día en BA (0–1439) de un ISO UTC. */
function baMinutesOf(iso: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

/** "HH:mm" en BA a partir de minutos del día. */
function baTimeOfMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Posición px del marcador AHORA sobre el track absoluto: matemática directa
 * (minutos transcurridos × escala). Fuera de 12–22 BA devuelve null (oculto).
 */
function nowMarkerTopPx(nowIso: string): { px: number; outOfRange: boolean } {
  const minutes = baMinutesOf(nowIso);
  if (minutes < WINDOW_START_MIN) return { px: 0, outOfRange: true };
  if (minutes >= WINDOW_END_MIN) return { px: TRACK_HEIGHT_PX, outOfRange: true };
  return { px: minuteToPx(minutes), outOfRange: false };
}

interface LaidOutTask {
  task: DayTask;
  startMin: number;
  durMin: number;
  lane: number;
  lanes: number;
}

/**
 * Layout por carriles para tareas ABSOLUTAS: la esquina SUPERIOR de cada
 * tarjeta se apoya en su minuto de inicio sobre la regla; las que se enciman
 * en el tiempo (teléfonos distintos) comparten el ancho en columnas.
 */
function layOutTasks(tasks: DayTask[]): LaidOutTask[] {
  const items = tasks
    .map((task) => ({
      task,
      startMin: baMinutesOf(task.scheduledFor || ""),
      durMin: Math.max(15, Number(task.durationMin) || 45),
    }))
    .filter((item) => item.startMin >= WINDOW_START_MIN && item.startMin < WINDOW_END_MIN)
    .sort((a, b) => a.startMin - b.startMin || b.durMin - a.durMin);
  const laneEnds: number[] = [];
  const assignments: number[] = [];
  for (const item of items) {
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = item.startMin + item.durMin;
    assignments.push(lane);
  }
  const totalLanes = Math.max(1, laneEnds.length);
  return items.map((item, index) => ({ ...item, lane: assignments[index], lanes: totalLanes }));
}

interface TaskBlockProps {
  task: DayTask;
  canManage: boolean;
  actionBusy: string;
  onCancel: (task: DayTask) => void;
  onDragStart: (task: DayTask) => void;
  onDragEnd: () => void;
  /** Posicionamiento absoluto sobre el track (top = minuto de inicio). */
  layoutStyle?: React.CSSProperties;
}

/** Color estable por teléfono: al mirar la franja horaria se distingue de un
    vistazo si dos tarjetas de la misma hora son de teléfonos DISTINTOS. */
function deviceColor(alias: string | null | undefined): string {
  if (!alias) return "rgba(255,255,255,.28)";
  let hash = 0;
  for (let i = 0; i < alias.length; i += 1) hash = (hash * 31 + alias.charCodeAt(i)) % 360;
  return `hsl(${hash} 70% 60%)`;
}

function TaskBlock({ task, canManage, actionBusy, onCancel, onDragStart, onDragEnd, layoutStyle }: TaskBlockProps) {
  const kind = taskKind(task.taskType);
  const stateClass = task.status === "running"
    ? "is-running"
    : task.status === "completed"
      ? "is-done"
      : task.status === "overdue" || task.status === "expired"
        ? "is-late"
        : task.status === "error"
          ? "is-error"
          : "";
  const platform = task.platform ? (PLATFORM_META[task.platform] || PLATFORM_META.instagram) : null;
  const editable = ["pending", "overdue", "paused", "expired"].includes(task.status);

  return (
    <div
      className={`ap-task t-${kind} ${stateClass}`}
      style={{ ...layoutStyle, borderLeft: `3px solid ${deviceColor(task.deviceAlias || null)}` }}
      data-type={kind}
      data-status={task.status}
      title={task.deviceAlias ? `Teléfono ${task.deviceAlias}` : undefined}
      draggable={canManage && editable && !actionBusy}
      onDragStart={(event) => {
        onDragStart(task);
        event.currentTarget.classList.add("is-dragging");
        event.dataTransfer.effectAllowed = "move";
        try { event.dataTransfer.setData("text/plain", String(task.id)); } catch { /* IE/edge quirks */ }
      }}
      onDragEnd={(event) => {
        event.currentTarget.classList.remove("is-dragging");
        onDragEnd();
      }}
    >
      <div className="ap-task-time">
        <strong>{formatBATime(task.scheduledFor)}</strong>
        <small>{task.taskType}{task.source === "manual" ? " · manual" : ""}</small>
      </div>
      <div className="ap-task-icon">{TASK_ICONS[kind]}</div>
      <div className="ap-task-main">
        <div>
          <strong>{taskName(task)}</strong>
          {platform && <span className={`ap-pill ap-pill-${task.platform}`} style={{ marginLeft: 2 }}>{platform.short}</span>}
          {task.status === "running" && <span className="ap-badge ap-badge-live" style={{ marginLeft: 2 }}><span className="ap-badge-dot" />Ejecutando</span>}
        </div>
        <span>
          {task.clusterName || `Cluster #${task.clusterId ?? "—"}`}
          {task.username ? <> · <b>@{task.username}</b></> : null}
          {task.deviceAlias ? <> · celular <b>{task.deviceAlias}</b></> : null}
          {task.durationMin != null ? <> · {task.durationMin} min</> : null}
        </span>
      </div>
      <div className="ap-task-right">
        {task.status !== "running" && (
          <span className={`ap-badge ${task.status === "completed" ? "ap-badge-live" : task.status === "overdue" || task.status === "expired" ? "ap-badge-warn" : task.status === "error" ? "ap-badge-bad" : "ap-badge-neutral"}`}>
            <span className="ap-badge-dot" />{STATUS_LABELS[task.status] || task.status}
          </span>
        )}
        {canManage && editable && (
          <div className="ap-task-actions">
            <button className="ap-btn ap-btn-danger ap-btn-sm" disabled={Boolean(actionBusy)} onClick={() => onCancel(task)}>Cancelar</button>
          </div>
        )}
      </div>
    </div>
  );
}

interface DayViewProps {
  token: string;
  date: string;
  day: DayResponse;
  canManage: boolean;
  /** Fase 2.5: si viene, la vista es la agenda de UN clúster (no del workspace). */
  clusterId?: number | null;
  clusterName?: string | null;
  onBackToWeek: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  /** Saltar a la fecha de hoy (botón "Ahora" del header). */
  onGoToToday: () => void;
  onChanged: () => void;
}

export default function DayView({ token, date, day, canManage, clusterId = null, clusterName = null, onBackToWeek, onPrevDay, onNextDay, onGoToToday, onChanged }: DayViewProps) {
  const [filters, setFilters] = useState<{ warmup: boolean; scan: boolean; publish: boolean; late: boolean }>({
    warmup: true,
    scan: true,
    publish: true,
    late: false,
  });
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  /** D1/Fase 2.5-visual: tarea arrastrada y casillero (cada 5') bajo el cursor. */
  const [dragSource, setDragSource] = useState<DayTask | null>(null);
  const [dragSnapMin, setDragSnapMin] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ task: DayTask; minute: number } | null>(null);
  /** Fase 2: hora elegida en el modal de movimiento ("HH:MM", default la del drop). */
  const [moveTime, setMoveTime] = useState("12:00");
  /** Fase 2: choque de agenda al mover — la API devuelve 409 + próximo hueco libre. */
  const [slotConflict, setSlotConflict] = useState<{ task: DayTask; nextFreeSlot: string; requestedFor: string } | null>(null);
  /** Fase 2.5: plan de cascada calculado, esperando confirmación del usuario. */
  const [cascadePlan, setCascadePlan] = useState<{ task: DayTask; requestedFor: string; moves: CascadeMoveDto[] } | null>(null);
  /** AHORA: timestamp actualizado cada 30 s (para el indicador del timeline). */
  const [nowIso, setNowIso] = useState<string>(() => new Date().toISOString());
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const scrolledToNowRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => setNowIso(new Date().toISOString()), NOW_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  const toggleFilter = (key: "warmup" | "scan" | "publish" | "late") => {
    setFilters((current) => ({ ...current, [key]: !current[key] }));
  };

  const visibleTasks = useMemo(() => day.tasks
    .filter((task) => {
      if (task.status === "cancelled") return false;
      const kind = taskKind(task.taskType);
      if (!filters[kind]) return false;
      if (filters.late && !["overdue", "expired"].includes(task.status)) return false;
      return true;
    })
    .sort((a, b) => {
      const aTime = a.scheduledFor ? Date.parse(a.scheduledFor) : Number.MAX_SAFE_INTEGER;
      const bTime = b.scheduledFor ? Date.parse(b.scheduledFor) : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    }), [day.tasks, filters]);

  /** Layout absoluto con carriles para encimadas entre teléfonos distintos. */
  const laidOutTasks = useMemo(() => layOutTasks(visibleTasks), [visibleTasks]);

  const running = day.tasks.filter((task) => task.status === "running");
  const completed = day.tasks.filter((task) => task.status === "completed");
  const queued = day.tasks.filter((task) => ["pending", "paused"].includes(task.status));
  const late = day.tasks.filter((task) => task.status === "overdue" || task.status === "expired");

  /* Marcador AHORA: derivado en render — matemática directa minutos × escala px.
     Fuera de la ventana 12–22 queda ANCLADO al borde correspondiente, atenuado,
     para seguir dando referencia del momento del día. */
  const nowMarkerState = nowMarkerTopPx(nowIso);

  /* Auto-scroll suave a la posición actual al montar (una sola vez). */
  useEffect(() => {
    if (scrolledToNowRef.current) return;
    const task = window.setTimeout(() => {
      const timeline = timelineRef.current;
      if (!timeline) return;
      const marker = nowMarkerTopPx(nowIso);
      if (marker.outOfRange) return; // fuera de la ventana 12:00–22:00: no se fuerza scroll
      const px = marker.px;
      timeline.scrollTo({ top: Math.max(0, px - timeline.clientHeight / 3), behavior: "smooth" });
      scrolledToNowRef.current = true;
    }, 0);
    return () => window.clearTimeout(task);
  }, [nowIso]);

  const loadMax = useMemo(() => {
    const counts = HOURS.map((hour) => (day.hourly.find((item) => item.hour === hour)?.count ?? 0));
    return Math.max(...counts, 1);
  }, [day.hourly]);


  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionBusy(key);
    setError("");
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError(PlannerApiError.from(cause).message);
    } finally {
      setActionBusy("");
    }
  };

  const cancelTask = (task: DayTask) => {
    if (!window.confirm(`¿Cancelar la tarea #${task.id}? Esta acción no se revierte desde el panel.`)) return;
    void runAction(`stop-${task.id}`, async () => {
      await plannerApi.stopTask(token, task.id);
    });
  };

  /* D1/Fase 2.5-visual: drag & drop sobre el TRACK absoluto — el cursor cae en
     un casillero de 5' (snap), la regla muestra la hora destino en amarillo y
     el drop abre el modal de confirmación con ese horario pre-cargado. */
  const handleTaskDragStart = (task: DayTask) => {
    setDragSource(task);
    setDragSnapMin(null);
  };

  /** Minuto (múltiplo de 5') correspondiente a una coordenada Y del track. */
  const snapMinuteAt = (clientY: number): number | null => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    const rawMinute = WINDOW_START_MIN + ((clientY - rect.top) / PX_PER_MIN);
    const snapped = Math.round(rawMinute / DROP_SNAP_MIN) * DROP_SNAP_MIN;
    return Math.min(WINDOW_END_MIN, Math.max(WINDOW_START_MIN, snapped));
  };

  const handleTrackDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragSource) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const minute = snapMinuteAt(event.clientY);
    if (minute !== null && minute !== dragSnapMin) setDragSnapMin(minute);
  };

  const handleTrackDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    // Solo limpiar cuando el cursor sale del track entero (no al cruzar hijos).
    if (event.currentTarget.contains(event.relatedTarget as Node)) return;
    setDragSnapMin(null);
  };

  const handleTrackDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!dragSource) return;
    event.preventDefault();
    const task = dragSource;
    const minute = dragSnapMin ?? snapMinuteAt(event.clientY);
    setDragSource(null);
    setDragSnapMin(null);
    if (!task || minute === null) return;
    setMoveTime(formatMinuteOf(minute));
    setConfirmTarget({ task, minute });
  };

  const clearDrag = () => {
    setDragSource(null);
    setDragSnapMin(null);
  };

  /* Fase 2: el movimiento valida contra la agenda del teléfono en el backend
     (reserveSlot 'reject'). Si el horario choca, el 409 trae next_free_slot y
     se ofrece mover al hueco sugerido en lugar de fallar genéricamente. */
  const performMove = (task: DayTask, scheduledFor: string) => {
    void runAction(`move-${task.id}`, async () => {
      try {
        await plannerApi.rescheduleTask(token, task.id, scheduledFor);
      } catch (cause) {
        const apiError = PlannerApiError.from(cause);
        if (apiError.slotConflict && apiError.nextFreeSlot) {
          setConfirmTarget(null);
          clearDrag();
          const requestedFor = typeof apiError.data?.requested_scheduled_for === "string"
            ? apiError.data.requested_scheduled_for
            : scheduledFor;
          setSlotConflict({ task, nextFreeSlot: apiError.nextFreeSlot, requestedFor });
          return;
        }
        throw cause;
      }
    });
  };

  const confirmMove = (task: DayTask, time: string) => {
    setConfirmTarget(null);
    clearDrag();
    const base = task.scheduledFor ? baDateKeyOf(task.scheduledFor) : date;
    const scheduledFor = new Date(`${base}T${time}:00-03:00`).toISOString();
    performMove(task, scheduledFor);
  };

  const acceptSuggestedSlot = () => {
    if (!slotConflict) return;
    const { task, nextFreeSlot } = slotConflict;
    setSlotConflict(null);
    performMove(task, nextFreeSlot);
  };

  /* Fase 2.5: pedirle al backend el plan de recorrido en cascada y mostrarlo
     para confirmación. El backend recalcula y aplica todo-o-nado al confirmar. */
  const openCascadePreview = async () => {
    if (!slotConflict) return;
    const { task, requestedFor } = slotConflict;
    setActionBusy(`cascade-${task.id}`);
    setError("");
    try {
      const plan = await plannerApi.previewCascadeMove(token, task.id, requestedFor);
      if (plan.ok && plan.moves && plan.moves.length > 0) {
        setSlotConflict(null);
        setCascadePlan({ task, requestedFor, moves: plan.moves });
      } else if (plan.ok && (!plan.moves || plan.moves.length === 0)) {
        setError("El horario ya quedó libre; volvé a intentar mover la tarea.");
        setSlotConflict(null);
      } else {
        setError(plan.detail || "No hay forma de acomodar la cola para ese horario.");
      }
    } catch (cause) {
      setError(PlannerApiError.from(cause).message);
    } finally {
      setActionBusy("");
    }
  };

  const confirmCascade = () => {
    if (!cascadePlan) return;
    const { task, requestedFor } = cascadePlan;
    setCascadePlan(null);
    void runAction(`cascada-${task.id}`, async () => {
      await plannerApi.applyCascadeMove(token, task.id, requestedFor);
    });
  };

  const cancelMove = () => {
    setConfirmTarget(null);
    clearDrag();
  };

  return (
    <div className="ap-page-stack">
      {error && <div className="cc-alert cc-alert-error"><span>{error}<button onClick={() => setError("")}>×</button></span></div>}

      <section className="ap-day-head">
        <div>
          {clusterName ? (
            <>
              <p className="ap-eyebrow ap-eyebrow-accent">AGENDA DEL CLÚSTER · BUENOS AIRES</p>
              <h2>{clusterName}: <em>su día, tarea por tarea.</em></h2>
              <p>Solo las actividades de este clúster · los demás clústeres no molestan acá.</p>
            </>
          ) : (
            <>
              <p className="ap-eyebrow ap-eyebrow-accent">CALENDARIO DEL DÍA</p>
              <h2>El día, <em>tarea por tarea.</em></h2>
              <p>Todos los clústeres juntos · un teléfono ejecuta una tarea a la vez.</p>
            </>
          )}
        </div>
        <div className="ap-day-controls">
          <div className="ap-week-range">
            <button title="Día anterior" aria-label="Día anterior" onClick={onPrevDay}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg></button>
            <span>{shortDate(date)}</span>
            <button title="Día siguiente" aria-label="Día siguiente" onClick={onNextDay}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></button>
          </div>
          <button className="ap-btn" onClick={onGoToToday}>Ahora</button>
          <button className="ap-btn ap-btn-ghost" onClick={onBackToWeek}>Volver a la semana</button>
        </div>
      </section>

      <section className="ap-card ap-filter-bar">
        <div className="ap-filter-chips" role="group" aria-label="Filtrar por tipo de tarea">
          <button className={`ap-filter-chip f-warmup ${filters.warmup ? "is-on" : ""}`} aria-pressed={filters.warmup} onClick={() => toggleFilter("warmup")}><i />Warmup</button>
          <button className={`ap-filter-chip f-scan ${filters.scan ? "is-on" : ""}`} aria-pressed={filters.scan} onClick={() => toggleFilter("scan")}><i />Scan</button>
          <button className={`ap-filter-chip f-publish ${filters.publish ? "is-on" : ""}`} aria-pressed={filters.publish} onClick={() => toggleFilter("publish")}><i />Publish</button>
          <button className={`ap-filter-chip ${filters.late ? "is-on" : ""}`} aria-pressed={filters.late} onClick={() => toggleFilter("late")}>Solo atrasadas</button>
        </div>
        <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{visibleTasks.length} de {day.tasks.length} tareas visibles</span>
      </section>

      {/* Cola única: publicaciones del día (publication_jobs). Solo se muestra
          si el día tiene publicaciones. */}
      {day.publications.length ? (
        <section className="ap-card">
          <div className="ap-card-heading">
            <div>
              <p className="ap-eyebrow ap-eyebrow-accent">COLA ÚNICA · PUBLICACIONES</p>
              <h3>Publicaciones del día</h3>
              <p className="ap-card-subtitle">La cola de publicación por cluster (publication_jobs): hora, plataforma, cuenta y estado.</p>
            </div>
            <span className="ap-badge ap-badge-neutral">{day.publications.length} publicación{day.publications.length === 1 ? "" : "es"}</span>
          </div>
          <div className="ap-pubs-list">
            {day.publications.map((publication) => (
              <div className="ap-pub" key={publication.id}>
                <strong>{formatBATime(publication.scheduledFor)}</strong>
                {publication.platform && (
                  <span className={`ap-pill ap-pill-${publication.platform}`}>{(PLATFORM_META[publication.platform] || PLATFORM_META.instagram).short}</span>
                )}
                <span className="ap-pub-account">@{publication.account || "—"}</span>
                {publication.clusterName || publication.clusterId != null ? (
                  <span className="ap-pub-cluster">{publication.clusterName || `Cluster #${publication.clusterId}`}</span>
                ) : null}
                <em className="ap-pub-title">{publication.title || "— definir contenido —"}</em>
                <span className={`ap-badge ${publicationBadgeClass(publication.status)}`}>
                  <span className="ap-badge-dot" />{PUBLICATION_STATUS_LABELS[publication.status] || publication.status}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <div className="ap-day-layout">
        <section className="ap-card">
          <div className="ap-card-heading">
            <div>
              <p className="ap-eyebrow">TIMELINE · 12:00–22:00</p>
              <h3>Agenda del día</h3>
              <p className="ap-card-subtitle">Cada bloque: hora, tipo, cluster, cuenta, celular asignado y estado.</p>
            </div>
            <span className="ap-badge ap-badge-live"><span className="ap-badge-dot" />{running.length} ejecutando</span>
          </div>
          <div className="ap-timeline-scroll" ref={timelineRef} role="region" aria-label="Timeline del día, scrolleable">
            <div className="ap-day-track-wrap">
              {/* REGLA: columna propia a la IZQUIERDA del track — los rótulos
                  de hora viven acá y ninguna tarjeta puede taparlos. Ticks
                  menores cada 15'; los casilleros de 5' son las franjas del track. */}
              <div className="ap-day-axis" style={{ height: TRACK_HEIGHT_PX }} aria-hidden="true">
                {HOURS.map((hour) => (
                  <span
                    key={hour}
                    className={`ap-day-axis-hour ${hour === HOURS[0] ? "is-first" : ""}`}
                    style={{ top: minuteToPx(hour * 60) }}
                  >
                    {String(hour).padStart(2, "0")}:00
                  </span>
                ))}
                {Array.from({ length: Math.floor(TRACK_TOTAL_MIN / 15) }, (_, i) => 15 * (i + 1))
                  .filter((m) => m % 60 !== 0 && m < TRACK_TOTAL_MIN)
                  .map((m) => (
                    <i key={m} className="ap-day-axis-minor" style={{ top: minuteToPx(WINDOW_START_MIN + m) }} />
                  ))}
              </div>
              <div
                ref={trackRef}
                className={`ap-track ${dragSource ? "is-dragging" : ""}`}
                style={{ height: TRACK_HEIGHT_PX }}
                onDragOver={handleTrackDragOver}
                onDragLeave={handleTrackDragLeave}
                onDrop={handleTrackDrop}
              >
              {/* Gridlines horarias dentro del track (sin rótulos: viven en la axis). */}
              {HOURS.map((hour) => (
                <div className="ap-hour-gridline" key={hour} style={{ top: minuteToPx(hour * 60) }} />
              ))}

              {/* Casilleros de 5 minutos SIEMPRE visibles (suaves); al arrastrar
                  se intensifican y la franja bajo el cursor se ilumina. */}
              <div className="ap-slot-overlay" aria-hidden="true" />
              {dragSource && dragSnapMin !== null && (
                <>
                  <div
                    className="ap-drop-band"
                    style={{ top: minuteToPx(dragSnapMin), height: DROP_SNAP_MIN * PX_PER_MIN }}
                  />
                  <div className="ap-drop-guide" style={{ top: minuteToPx(dragSnapMin) }} />
                  <div className="ap-drag-badge" style={{ top: minuteToPx(dragSnapMin) }} role="status">
                    <span>{formatMinuteOf(dragSnapMin)}</span>
                  </div>
                </>
              )}

              {/* Tareas: top = minuto de inicio (esquina superior apoyada en la regla). */}
              {laidOutTasks.map(({ task, startMin, durMin, lane, lanes }) => (
                <TaskBlock
                  key={task.id}
                  task={task}
                  canManage={canManage}
                  actionBusy={actionBusy}
                  onCancel={cancelTask}
                  onDragStart={handleTaskDragStart}
                  onDragEnd={clearDrag}
                  layoutStyle={{
                    position: "absolute",
                    top: minuteToPx(startMin),
                    height: Math.max(44, durMin * PX_PER_MIN - 4),
                    left: `calc(${(lane / lanes) * 100}% + 3px)`,
                    width: `calc(${100 / lanes}% - 8px)`,
                    zIndex: 2 + lane,
                  }}
                />
              ))}

              {/* Indicador AHORA sobre la escala real del track. */}
              <div
                className={`ap-now-marker ${nowMarkerState.outOfRange ? "is-out-of-range" : ""}`}
                style={{ top: `${Math.max(0, Math.min(TRACK_HEIGHT_PX, nowMarkerState.px) - 1)}px` }}
                role="status"
                aria-label={`Ahora: ${baTimeOfMinutes(baMinutesOf(nowIso))} Buenos Aires`}
              >
                <span>AHORA · {baTimeOfMinutes(baMinutesOf(nowIso))}</span>
              </div>
              </div>
            </div>
          </div>
        </section>

        <aside className="ap-day-side">
          <section className="ap-card" style={{ borderColor: "rgba(34,197,94,.22)" }}>
            <div className="ap-card-heading" style={{ marginBottom: 14 }}>
              <div>
                <p className="ap-eyebrow ap-eyebrow-accent">LIVE</p>
                <h3>Ejecutándose ahora</h3>
              </div>
            </div>
            <div className="ap-live-list">
              {running.length ? running.map((task) => (
                <div className="ap-live-row" key={task.id}>
                  <span className="ap-live-dot" />
                  <div className="ap-live-main">
                    <strong>{taskName(task)} · {task.clusterName || `#${task.clusterId ?? "—"}`}</strong>
                    <span>@{task.username || "—"} · {task.platform ? PLATFORM_META[task.platform]?.short : ""} · {task.deviceAlias || "—"}{task.durationMin != null ? ` · ${task.durationMin} min` : ""}</span>
                  </div>
                  <div className="ap-live-prog"><strong>●</strong><small>#{task.id}</small></div>
                </div>
              )) : <div className="ap-empty" style={{ padding: "18px 14px" }}><strong>Nada en ejecución</strong><span>Las tareas que corran ahora aparecen acá con pulso en vivo.</span></div>}
            </div>
          </section>

          <section className="ap-card">
            <div className="ap-card-heading" style={{ marginBottom: 10 }}>
              <div>
                <p className="ap-eyebrow">LOAD BY HOUR</p>
                <h3>Carga del día</h3>
                <p className="ap-card-subtitle">Tareas por hora en la ventana 12:00–22:00.</p>
              </div>
            </div>
            <div className="ap-load-strip">
              {HOURS.map((hour) => {
                const count = day.hourly.find((item) => item.hour === hour)?.count ?? 0;
                const peak = count === loadMax && count > 0;
                const pct = count > 0 ? 8 + (count / loadMax) * 66 : 4;
                const now = nowIso ? isNowInHour(hour, nowIso) : false;
                return (
                  <div className={`ap-load-bar ${peak ? "is-peak" : ""} ${now ? "is-now" : ""}`} key={hour} title={`${count} tareas a las ${hour}:00`}>
                    <div style={{ height: `${pct}%` }} />
                    <span>{hour}</span>
                  </div>
                );
              })}
            </div>
            <div className="ap-load-facts">
              <div className="ap-load-fact"><span>Total del día</span><strong>{day.tasks.length} <small>tareas</small></strong></div>
              <div className="ap-load-fact"><span>Completadas</span><strong>{completed.length} <small>{day.tasks.length ? `${Math.round((completed.length / day.tasks.length) * 100)}%` : "—"}</small></strong></div>
              <div className="ap-load-fact"><span>En cola</span><strong>{queued.length}</strong></div>
              <div className="ap-load-fact"><span>Atrasadas</span><strong style={{ color: late.length ? "#fbbf24" : undefined }}>{late.length}</strong></div>
            </div>
          </section>
        </aside>
      </div>

      {/* D1: modal de confirmación de movimiento por drag & drop */}
      {confirmTarget && (
        <div
          className="ap-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar movimiento de tarea"
          onClick={(event) => { if (event.target === event.currentTarget) cancelMove(); }}
        >
          <div className="ap-modal">
            <div className="ap-modal-head">
              <div>
                <p className="ap-eyebrow ap-eyebrow-accent">REAGENDAR TAREA</p>
                <h3>Mover tarea</h3>
              </div>
              <button className="ap-icon-btn" title="Cancelar" onClick={cancelMove}>×</button>
            </div>
            <div className="ap-modal-body">
              <p className="ap-hint" style={{ fontSize: 12, lineHeight: 1.6 }}>
                Movés la tarea <strong>#{confirmTarget.task.id}</strong> ({taskName(confirmTarget.task)}) de{" "}
                <strong>{formatBATime(confirmTarget.task.scheduledFor)}</strong> a:
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <input
                  type="time"
                  value={moveTime}
                  min="00:00"
                  max="23:59"
                  step={300}
                  aria-label="Nueva hora de la tarea"
                  onChange={(event) => setMoveTime(event.target.value || moveTime)}
                  style={{
                    background: "rgba(255,255,255,.05)",
                    border: "1px solid rgba(255,255,255,.14)",
                    borderRadius: 8,
                    color: "var(--text, #fff)",
                    padding: "7px 10px",
                    fontSize: 13,
                  }}
                />
                <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
                  El teléfono valida que el horario esté libre; si choca, te ofrecemos el próximo hueco.
                </span>
              </div>
            </div>
            <div className="ap-modal-foot">
              <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={cancelMove}>Cancelar</button>
              <button
                className="ap-btn ap-btn-primary ap-btn-sm"
                disabled={Boolean(actionBusy) || !/^\d{2}:\d{2}$/.test(moveTime)}
                onClick={() => confirmMove(confirmTarget.task, moveTime)}
              >
                {actionBusy ? "Moviendo…" : "Mover tarea"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fase 2: la API rechazó el movimiento por solape (409 + next_free_slot). */}
      {slotConflict && (
        <div
          className="ap-modal-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-label="Conflicto de agenda"
          onClick={(event) => { if (event.target === event.currentTarget) setSlotConflict(null); }}
        >
          <div className="ap-modal">
            <div className="ap-modal-head">
              <div>
                <p className="ap-eyebrow ap-eyebrow-accent">TELÉFONO OCUPADO</p>
                <h3>Ese horario ya está reservado</h3>
              </div>
              <button className="ap-icon-btn" title="Cerrar" onClick={() => setSlotConflict(null)}>×</button>
            </div>
            <div className="ap-modal-body">
              <p className="ap-hint" style={{ fontSize: 12, lineHeight: 1.6 }}>
                La tarea <strong>#{slotConflict.task.id}</strong> ({taskName(slotConflict.task)}) no puede moverse a las{" "}
                <strong>{formatBATime(slotConflict.task.scheduledFor)}</strong> porque se encima con otra tarea
                del mismo teléfono (cada tarea reserva su ventana con margen).
              </p>
            </div>
            <div className="ap-modal-foot">
              <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setSlotConflict(null)}>Dejar como está</button>
              <button
                className="ap-btn ap-btn-sm"
                disabled={Boolean(actionBusy)}
                onClick={() => void openCascadePreview()}
                style={{ border: "1px solid rgba(255,255,255,.22)" }}
              >
                {actionBusy === `cascade-${slotConflict.task.id}` ? "Calculando…" : "Meterla acá y recorrer las demás"}
              </button>
              <button
                className="ap-btn ap-btn-primary ap-btn-sm"
                disabled={Boolean(actionBusy)}
                onClick={acceptSuggestedSlot}
              >
                {actionBusy ? "Moviendo…" : `Mover al próximo hueco · ${formatBATime(slotConflict.nextFreeSlot)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fase 2.5: confirmación del recorrido en cascada con la lista exacta
          de tareas que se van a mover y sus horarios nuevos. */}
      {cascadePlan && (
        <div
          className="ap-modal-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirmar recorrido en cascada"
          onClick={(event) => { if (event.target === event.currentTarget) setCascadePlan(null); }}
        >
          <div className="ap-modal">
            <div className="ap-modal-head">
              <div>
                <p className="ap-eyebrow ap-eyebrow-accent">RECORRIDO EN CASCADA</p>
                <h3>Se acomodarán {cascadePlan.moves.length} tarea{cascadePlan.moves.length === 1 ? "" : "s"}</h3>
              </div>
              <button className="ap-icon-btn" title="Cerrar" onClick={() => setCascadePlan(null)}>×</button>
            </div>
            <div className="ap-modal-body">
              <p className="ap-hint" style={{ fontSize: 12, lineHeight: 1.6 }}>
                Metés <strong>#{cascadePlan.task.id}</strong> ({taskName(cascadePlan.task)}) a las{" "}
                <strong>{formatBATime(cascadePlan.requestedFor)}</strong>. Las siguientes tareas pasan al
                horario continuo más próximo, sin pisarse entre ellas:
              </p>
              <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
                {cascadePlan.moves.map((move) => {
                  const original = day.tasks.find((candidate) => candidate.id === move.task_id);
                  return (
                    <li key={move.task_id} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      background: "rgba(255,255,255,.04)", borderRadius: 8, padding: "7px 10px", fontSize: 12,
                    }}>
                      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>#{move.task_id}</span>
                      <strong style={{ minWidth: 130 }}>
                        {formatBATime(move.from || "")} → {formatBATime(move.to)}
                      </strong>
                      <span>{original ? taskName(original) : (move.task_type || "tarea")}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
            <div className="ap-modal-foot">
              <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setCascadePlan(null)}>Cancelar</button>
              <button
                className="ap-btn ap-btn-primary ap-btn-sm"
                disabled={Boolean(actionBusy)}
                onClick={confirmCascade}
              >
                {actionBusy ? "Aplicando…" : "Confirmar cascada"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
