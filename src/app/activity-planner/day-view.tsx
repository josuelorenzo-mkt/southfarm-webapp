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
import type { ReactNode } from "react";
import { plannerApi, PlannerApiError } from "./api";
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

/** Progreso del AHORA dentro de la ventana 12:00–22:00 BA (0..1); fuera de rango devuelve <0 o >1. */
function nowProgress(nowIso: string): number {
  const minutes = baMinutesOf(nowIso);
  return (minutes - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN);
}

interface TaskBlockProps {
  task: DayTask;
  canManage: boolean;
  actionBusy: string;
  onCancel: (task: DayTask) => void;
  onDragStart: (task: DayTask) => void;
  onDragEnd: () => void;
}

function TaskBlock({ task, canManage, actionBusy, onCancel, onDragStart, onDragEnd }: TaskBlockProps) {
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
      data-type={kind}
      data-status={task.status}
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
  onBackToWeek: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  /** Saltar a la fecha de hoy (botón "Ahora" del header). */
  onGoToToday: () => void;
  onChanged: () => void;
}

export default function DayView({ token, date, day, canManage, onBackToWeek, onPrevDay, onNextDay, onGoToToday, onChanged }: DayViewProps) {
  const [filters, setFilters] = useState<{ warmup: boolean; scan: boolean; publish: boolean; late: boolean }>({
    warmup: true,
    scan: true,
    publish: true,
    late: false,
  });
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  /** D1: tarea arrastrada y hora bajo el cursor (indicador de drop). */
  const [dragSource, setDragSource] = useState<DayTask | null>(null);
  const [dragOverHour, setDragOverHour] = useState<number | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ task: DayTask; hour: number } | null>(null);
  /** Fase 2: hora elegida en el modal de movimiento ("HH:MM", default la hora del drop). */
  const [moveTime, setMoveTime] = useState("12:00");
  /** Fase 2: choque de agenda al mover — la API devuelve 409 + próximo hueco libre. */
  const [slotConflict, setSlotConflict] = useState<{ task: DayTask; nextFreeSlot: string } | null>(null);
  /** AHORA: timestamp actualizado cada 30 s (para el indicador del timeline). */
  const [nowIso, setNowIso] = useState<string>(() => new Date().toISOString());
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const scrolledToNowRef = useRef(false);

  useEffect(() => {
    const interval = window.setInterval(() => setNowIso(new Date().toISOString()), NOW_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  /* Auto-scroll suave a la posición actual al montar (una sola vez). */
  useEffect(() => {
    if (scrolledToNowRef.current) return;
    const task = window.setTimeout(() => {
      const timeline = timelineRef.current;
      if (!timeline) return;
      const pct = nowProgress(nowIso);
      if (pct < 0 || pct > 1) return; // fuera de la ventana 12:00–22:00: no se fuerza scroll
      timeline.scrollTo({ top: pct * (timeline.scrollHeight - timeline.clientHeight), behavior: "smooth" });
      scrolledToNowRef.current = true;
    }, 0);
    return () => window.clearTimeout(task);
  }, [nowIso]);

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

  const byHour = useMemo(() => {
    const map = new Map<number, DayTask[]>();
    HOURS.forEach((hour) => map.set(hour, []));
    visibleTasks.forEach((task) => {
      const hour = task.scheduledFor ? baHourOf(task.scheduledFor) : 12;
      const list = map.get(hour) || [];
      list.push(task);
      map.set(hour, list);
    });
    return map;
  }, [visibleTasks]);

  const running = day.tasks.filter((task) => task.status === "running");
  const completed = day.tasks.filter((task) => task.status === "completed");
  const queued = day.tasks.filter((task) => ["pending", "paused"].includes(task.status));
  const late = day.tasks.filter((task) => task.status === "overdue" || task.status === "expired");

  const loadMax = useMemo(() => {
    const counts = HOURS.map((hour) => (day.hourly.find((item) => item.hour === hour)?.count ?? 0));
    return Math.max(...counts, 1);
  }, [day.hourly]);

  /* Progreso del AHORA dentro de la ventana 12:00–22:00 (0..1), con clamp
     atenuado si está fuera de rango (pct < 0 o > 1). */
  const nowMinutes = baMinutesOf(nowIso);
  const nowProgressValue = (nowMinutes - WINDOW_START_MIN) / (WINDOW_END_MIN - WINDOW_START_MIN);
  const nowPct = Math.min(1, Math.max(0, nowProgressValue));
  const nowOutOfRange = nowProgressValue < 0 || nowProgressValue > 1;

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

  /* D1: drag & drop → confirmación con modal ap-modal (no window.confirm ni prompt). */
  const handleTaskDragStart = (task: DayTask) => {
    setDragSource(task);
    setDragOverHour(null);
  };

  const handleDrop = (hour: number) => {
    if (!dragSource) return;
    setDragOverHour(null);
    setMoveTime(`${String(hour).padStart(2, "0")}:00`);
    setConfirmTarget({ task: dragSource, hour });
  };

  const clearDrag = () => {
    setDragSource(null);
    setDragOverHour(null);
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
          setSlotConflict({ task, nextFreeSlot: apiError.nextFreeSlot });
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

  const cancelMove = () => {
    setConfirmTarget(null);
    clearDrag();
  };

  return (
    <div className="ap-page-stack">
      {error && <div className="cc-alert cc-alert-error"><span>{error}<button onClick={() => setError("")}>×</button></span></div>}

      <section className="ap-day-head">
        <div>
          <p className="ap-eyebrow ap-eyebrow-accent">CALENDARIO DEL DÍA</p>
          <h2>El día, <em>tarea por tarea.</em></h2>
          <p>12:00–22:00 de Buenos Aires · un teléfono ejecuta una tarea a la vez.</p>
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
            <div className="ap-timeline">
              {HOURS.map((hour) => {
                const hourTasks = byHour.get(hour) || [];
                const now = isNowInHour(hour, nowIso);
                const isDropTarget = dragSource != null && dragOverHour === hour;
                return (
                  <div className={`ap-hour ${now ? "is-now" : ""}`} key={hour}>
                    <span className="ap-hour-label">{String(hour).padStart(2, "0")}:00</span>
                    <div
                      className={`ap-hour-tasks ${isDropTarget ? "is-drop-target" : ""}`}
                      style={isDropTarget ? { border: "1px dashed rgba(34,197,94,.55)", borderRadius: 10, background: "rgba(34,197,94,.06)", minHeight: 40 } : undefined}
                      onDragOver={(event) => {
                        if (!dragSource) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        if (dragOverHour !== hour) setDragOverHour(hour);
                      }}
                      onDragLeave={(event) => {
                        if (event.currentTarget.contains(event.relatedTarget as Node)) return;
                        setDragOverHour((current) => (current === hour ? null : current));
                      }}
                      onDrop={(event) => {
                        if (!dragSource) return;
                        event.preventDefault();
                        handleDrop(hour);
                      }}
                    >
                      {hourTasks.length ? hourTasks.map((task) => (
                        <TaskBlock
                          key={task.id}
                          task={task}
                          canManage={canManage}
                          actionBusy={actionBusy}
                          onCancel={cancelTask}
                          onDragStart={handleTaskDragStart}
                          onDragEnd={clearDrag}
                        />
                      )) : <span style={{ color: "var(--text-dim)", fontSize: 10, padding: "6px 0" }}>— sin tareas —</span>}
                      {isDropTarget && (
                        <span style={{ color: "#22c55e", fontSize: 10, fontWeight: 600 }}>
                          Soltar acá mueve “{dragSource ? taskName(dragSource) : ""}” a las {String(hour).padStart(2, "0")}:00 · podés ajustar minutos después
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Indicador AHORA: línea vertical proporcional entre 12:00–22:00 BA,
                  con clamp atenuado si la hora actual está fuera de la ventana. */}
              <div
                className={`ap-now-marker ${nowOutOfRange ? "is-out-of-range" : ""}`}
                style={{ top: `calc(${(nowPct * 100).toFixed(2)}% - 1px)` }}
                role="status"
                aria-label={`Ahora: ${baTimeOfMinutes(nowMinutes)} Buenos Aires`}
              >
                <span>AHORA · {baTimeOfMinutes(nowMinutes)}</span>
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
    </div>
  );
}
