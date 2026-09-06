"use client";

/**
 * Vista de día del Activity Planner — porte de docs/mockups/activity-planner/day-view.html
 * con datos reales de GET /api/planner/day.
 *
 * v3→v6: timeline ABSOLUTO de 24 hs con scroll completo (00:00–24:00 BA),
 * indicador AHORA, casilleros de 5', drag  drop fino y cascada con vista previa.
 * drag & drop por tarea INDIVIDUAL con modal de confirmación.
 */
import "./planner-extra.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import QuickAddPanel from "./quick-add-panel";
import { PlatformLogo } from "./platform-logos";
import type { ClusterAccount, DayResponse, DayTask, PlannerTaskType } from "./types";

/** Día COMPLETO: 24 horas (00:00–24:00 BA) con scroll — sin ventana recortada. */
const HOURS = Array.from({ length: 24 }, (_, i) => i);
/** Fase 2.5-visual: el timeline se posiciona ABSOLUTAMENTE por minuto.
    3 px por minuto ⇒ cada hora mide 180 px; un scan de 10' (30 px) convive
    con el alto mínimo de tarjeta sin invadir el turno siguiente. */
/** Vista compacta "Día completo": alto fijo de cada carril-hora. */
const COMPACT_ROW_H = 152;
/** Aire arriba y abajo de la grilla: permite que el chip 00:00 quede
 *  CENTRADO en su línea (como todos) sin recortarse con el scroll. */
const COMPACT_PAD = 18;
const KIND_LABEL: Record<"warmup" | "scan" | "publish", string> = {
  warmup: "Warmup", scan: "Scan", publish: "Post",
};
/** Snap del drop: cada 5 minutos (los "casilleros"). */
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

function deviceColor(alias: string | null | undefined): string {
  if (!alias) return "rgba(255,255,255,.28)";
  let hash = 0;
  for (let i = 0; i < alias.length; i += 1) hash = (hash * 31 + alias.charCodeAt(i)) % 360;
  return `hsl(${hash} 70% 60%)`;
}

interface DayViewProps {
  token: string;
  date: string;
  day: DayResponse;
  canManage: boolean;
  /** Fase 2.5: si viene, la vista es la agenda de UN clúster (no del workspace). */
  clusterId?: number | null;
  clusterName?: string | null;
  /** Acciones rápidas: cuentas del clúster + device_id por cuenta. */
  clusterAccounts?: ClusterAccount[];
  workspaceAccounts?: { id: number; device_id: number }[];
  onBackToWeek: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  /** Saltar a la fecha de hoy (botón "Ahora" del header). */
  onGoToToday: () => void;
  onChanged: () => void;
}

export default function DayView({ token, date, day, canManage, clusterId = null, clusterName = null, clusterAccounts = [], workspaceAccounts = [], onBackToWeek, onPrevDay, onNextDay, onGoToToday, onChanged }: DayViewProps) {
  const [filters, setFilters] = useState<{ warmup: boolean; scan: boolean; publish: boolean; late: boolean }>({
    warmup: true,
    scan: true,
    publish: true,
    late: false,
  });
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  /** Fase 2: choque de agenda al mover — la API devuelve 409 + próximo hueco libre. */
  const [slotConflict, setSlotConflict] = useState<{ task: DayTask; nextFreeSlot: string; requestedFor: string } | null>(null);
  /** Fase 2.5: plan de cascada calculado, esperando confirmación del usuario. */
  const [cascadePlan, setCascadePlan] = useState<{ task: DayTask; requestedFor: string; moves: CascadeMoveDto[] } | null>(null);
  /** AHORA: timestamp actualizado cada 30 s (para el indicador del timeline). */
  const [nowIso, setNowIso] = useState<string>(() => new Date().toISOString());
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const scrolledToNowRef = useRef(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pillRef = useRef<HTMLSpanElement | null>(null);
  /** Vista compacta (día completo): tarea expandida en modal. */
  const [detailTask, setDetailTask] = useState<DayTask | null>(null);
  const [detailMoveTime, setDetailMoveTime] = useState("");

  useEffect(() => {
    const interval = window.setInterval(() => setNowIso(new Date().toISOString()), NOW_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, []);

  /* Motor de animación por rAF: drive los efectos con variables CSS en el
     contenedor (--march-x, --pulse, --live-op) y shadow del pill por ref.
     Va por requestAnimationFrame a propósito: el clamp de
     prefers-reduced-motion del navegador congela las ANIMACIONES CSS, pero
     nunca el rAF — así el movimiento vive siempre, en cualquier equipo. */
  useEffect(() => {
    let raf = 0;
    const tick = (tms: number) => {
      const t = tms / 1000;
      const grid = gridRef.current;
      if (grid) {
        grid.style.setProperty("--march-x", `${(t * 28) % 20}px`);
        grid.style.setProperty("--live-op", (0.25 + 0.75 * (0.5 + 0.5 * Math.sin(t * 3.2))).toFixed(3));
        grid.style.setProperty("--pulse", `${(3.5 + 3.5 * (0.5 + 0.5 * Math.sin(t * 3.9))).toFixed(2)}px`);
      }
      const pill = pillRef.current;
      if (pill) {
        const k = 0.5 + 0.5 * Math.sin(t * 3.5);
        pill.style.boxShadow = `inset 0 0 ${(4 + 6 * k).toFixed(1)}px rgba(34, 197, 94, ${(0.35 + 0.45 * k).toFixed(3)}), 0 0 ${(2 + 4 * k).toFixed(1)}px rgba(34, 197, 94, ${(0.3 + 0.4 * k).toFixed(3)})`;
        pill.style.borderColor = `rgba(134, 239, 172, ${(0.5 + 0.45 * k).toFixed(3)})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
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

  /** Vista compacta: tareas agrupadas por hora, ordenadas por minuto. */
  const compactByHour = useMemo(() => {
    const map = new Map<number, DayTask[]>();
    for (const task of visibleTasks) {
      const minute = baMinutesOf(task.scheduledFor || "");
      const hour = Math.min(23, Math.floor(minute / 60));
      const list = map.get(hour) || [];
      list.push(task);
      map.set(hour, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => baMinutesOf(a.scheduledFor || "") - baMinutesOf(b.scheduledFor || ""));
    }
    return map;
  }, [visibleTasks]);

  const running = day.tasks.filter((task) => task.status === "running");
  const completed = day.tasks.filter((task) => task.status === "completed");
  const queued = day.tasks.filter((task) => ["pending", "paused"].includes(task.status));
  const late = day.tasks.filter((task) => task.status === "overdue" || task.status === "expired");

  /* Marcador AHORA: derivado en render — matemática directa minutos × escala px. */

  /* Auto-scroll suave a la posición actual al montar (una sola vez). */
  useEffect(() => {
    if (scrolledToNowRef.current) return;
    const task = window.setTimeout(() => {
      const timeline = timelineRef.current;
      if (!timeline) return;
      const px = COMPACT_PAD + baHourOf(nowIso) * COMPACT_ROW_H + COMPACT_ROW_H / 2;
      timeline.scrollTo({ top: Math.max(0, px - timeline.clientHeight / 2), behavior: "smooth" });
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

  /** Detalle (vista compacta): abrir ficha y mover/cancelar desde el modal. */
  const openDetail = (task: DayTask) => {
    setDetailTask(task);
    setDetailMoveTime(formatBATime(task.scheduledFor || ""));
  };
  const doDetailMove = () => {
    if (!detailTask) return;
    const task = detailTask;
    setDetailTask(null);
    performMove(task, new Date(`${baDateKeyOf(task.scheduledFor || "")}T${detailMoveTime}:00-03:00`).toISOString());
  };

  const confirmCascade = () => {
    if (!cascadePlan) return;
    const { task, requestedFor } = cascadePlan;
    setCascadePlan(null);
    void runAction(`cascada-${task.id}`, async () => {
      await plannerApi.applyCascadeMove(token, task.id, requestedFor);
    });
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
              <p className="ap-eyebrow">TIMELINE · 00:00–24:00</p>
              <h3>Agenda del día</h3>
              <p className="ap-card-subtitle">Cada bloque: hora, tipo, cluster, cuenta, celular asignado y estado.</p>
            </div>
            <span className="ap-badge ap-badge-live"><span className="ap-badge-dot" />{running.length} ejecutando</span>
          </div>
          <div className="ap-timeline-scroll" ref={timelineRef} role="region" aria-label="Agenda del día, scrolleable">
            <div
              className="ap-cgrid"
              ref={gridRef}
              style={{ height: 24 * COMPACT_ROW_H + COMPACT_PAD * 2 }}
            >
              <i className="ap-axis-line" aria-hidden="true" />
              {/* Carril de la hora EN CURSO: banda + bordes punteados animados. */}
              <div
                className="ap-c-nowrow"
                style={{ top: COMPACT_PAD + baHourOf(nowIso) * COMPACT_ROW_H, height: COMPACT_ROW_H }}
              />
              {HOURS.map((hour) => (
                <span
                  key={hour}
                  className="ap-c-hour"
                  style={{ top: COMPACT_PAD + hour * COMPACT_ROW_H }}
                >
                  {String(hour).padStart(2, "0")}:00
                </span>
              ))}
              {/* Cierre del día: línea + chip 00:00 del día siguiente. */}
              <div className="ap-c-row" style={{ top: COMPACT_PAD + 24 * COMPACT_ROW_H }} />
              <span className="ap-c-hour" style={{ top: COMPACT_PAD + 24 * COMPACT_ROW_H }}>
                00:00
              </span>
              {HOURS.map((hour) => (
                <div className="ap-c-row" key={hour} style={{ top: COMPACT_PAD + hour * COMPACT_ROW_H, height: COMPACT_ROW_H }}>
                  <div className="ap-c-lane">
                    {(compactByHour.get(hour) || []).map((task) => {
                      const kind = taskKind(task.taskType);
                      const endIso = task.durationMin != null && task.durationMin > 0
                        ? new Date(Date.parse(task.scheduledFor || "") + task.durationMin * 60e3).toISOString()
                        : null;
                      // Activa = SU VENTANA cubre el momento actual (regla
                      // única, sin importar el status: en producción una tarea
                      // en horario estaría running; en el sandbox puede quedar
                      // pending — visualmente significan lo mismo).
                      const startMin = baMinutesOf(task.scheduledFor || "");
                      const durMin = Math.max(10, Number(task.durationMin) || 45);
                      const nowMin = baMinutesOf(nowIso);
                      const isActive = ["pending", "overdue", "running"].includes(task.status)
                        && startMin <= nowMin && nowMin < startMin + durMin;
                      return (
                        <button
                          key={task.id}
                          type="button"
                          className={`ap-mini k-${kind} ${isActive ? "is-running" : ""} ${task.status === "completed" ? "is-done" : ""} ${["overdue", "expired"].includes(task.status) ? "is-late" : ""}`}
                          style={{ borderLeftColor: isActive ? "#4ade80" : deviceColor(task.deviceAlias || null) }}
                          onClick={() => { setDetailTask(task); setDetailMoveTime(formatBATime(task.scheduledFor || "")); }}
                        >
                          <span className="ap-mini-top">
                            <span className="ap-mini-left">
                              <PlatformLogo platform={task.platform} size={16} brand />
                              <span className="ap-mini-kind">
                                {isActive && <i className="ap-mini-live" />}
                                {TASK_ICONS[kind]}{KIND_LABEL[kind]}
                              </span>
                            </span>
                            <span className="ap-mini-dev">{task.deviceAlias || "—"}</span>
                          </span>
                          <div className="ap-mini-time">
                            <strong>{formatBATime(task.scheduledFor || "")}</strong>
                            {endIso && <span className="ap-mini-end">→ {formatBATime(endIso)}</span>}
                          </div>
                          <span className="ap-mini-user">@{task.username || "—"}</span>
                          <span className="ap-mini-cluster">{task.clusterName || " "}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {/* El carril de la hora EN CURSO lleva los bordes punteados
                  animados (marcan 00→59 de esa hora); el pill del gutter
                  sigue mostrando la hora exacta como reloj. */}
              <div
                className="ap-now-axis"
                style={{ top: `${COMPACT_PAD + baHourOf(nowIso) * COMPACT_ROW_H + COMPACT_ROW_H / 2}px` }}
              >
                <span className="ap-now-flag">AHORA</span>
                <span className="ap-now-time" ref={pillRef}>{baTimeOfMinutes(baMinutesOf(nowIso))}</span>
              </div>
            </div>
          </div>
        </section>

        <aside className="ap-day-side">
          <section className={`ap-card ${clusterId != null ? "ap-live-compact" : ""}`} style={{ borderColor: "rgba(34,197,94,.22)" }}>
            <div className="ap-card-heading" style={{ marginBottom: clusterId != null ? 8 : 14 }}>
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

          {clusterId != null && (
            <QuickAddPanel
              token={token}
              clusterId={clusterId}
              clusterName={clusterName || `Clúster #${clusterId}`}
              accounts={clusterAccounts}
              workspaceAccounts={workspaceAccounts}
              date={date}
              onChanged={onChanged}
            />
          )}

          <section className="ap-card">
            <div className="ap-card-heading" style={{ marginBottom: 10 }}>
              <div>
                <p className="ap-eyebrow">LOAD BY HOUR</p>
                <h3>Carga del día</h3>
                <p className="ap-card-subtitle">Tareas por hora del día completo.</p>
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
      {/* Vista compacta: ficha expandida de la tarea (click en mini-card). */}
      {detailTask && (() => {
        const kind = taskKind(detailTask.taskType);
        const endIso = detailTask.durationMin != null && detailTask.durationMin > 0
          ? new Date(Date.parse(detailTask.scheduledFor || "") + detailTask.durationMin * 60e3).toISOString()
          : null;
        return (
          <div
            className="ap-modal-overlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Detalle de la tarea #${detailTask.id}`}
            onClick={(event) => { if (event.target === event.currentTarget) setDetailTask(null); }}
          >
            <div className="ap-modal ap-detail">
              <div className="ap-modal-head">
                <div>
                  <p className="ap-eyebrow ap-eyebrow-accent">DETALLE DE TAREA · #{detailTask.id}</p>
                  <h3>{taskName(detailTask)}</h3>
                </div>
                <button className="ap-icon-btn" title="Cerrar" onClick={() => setDetailTask(null)}>×</button>
              </div>
              <div className="ap-modal-body">
                <div className="ap-detail-row"><dt>Estado</dt><dd>
                  <span className={`ap-badge ${detailTask.status === "running" ? "ap-badge-live" : ["overdue", "expired"].includes(detailTask.status) ? "ap-badge-warn" : detailTask.status === "error" ? "ap-badge-bad" : "ap-badge-neutral"}`}>
                    <span className="ap-badge-dot" />{STATUS_LABELS[detailTask.status] || detailTask.status}
                  </span>
                </dd></div>
                <div className="ap-detail-row"><dt>Tipo</dt><dd><PlatformLogo platform={detailTask.platform} size={15} brand />{TASK_ICONS[kind]} {KIND_LABEL[kind]} · {detailTask.platform ? (PLATFORM_META[detailTask.platform]?.short || detailTask.platform) : ""}</dd></div>
                <div className="ap-detail-row"><dt>Cuenta</dt><dd>@{detailTask.username || "—"}</dd></div>
                <div className="ap-detail-row"><dt>Teléfono</dt><dd style={{ color: deviceColor(detailTask.deviceAlias || null), fontWeight: 800 }}>{detailTask.deviceAlias || "—"}</dd></div>
                <div className="ap-detail-row"><dt>Clúster</dt><dd>{detailTask.clusterName || "—"}</dd></div>
                <div className="ap-detail-row"><dt>Horario</dt><dd>
                  <strong>{formatBATime(detailTask.scheduledFor || "")}{endIso ? ` → ${formatBATime(endIso)}` : ""}</strong>
                  {detailTask.durationMin != null ? ` · ${detailTask.durationMin} min` : ""}
                </dd></div>
                <div className="ap-detail-row"><dt>Origen</dt><dd>{detailTask.source === "manual" ? "Manual" : "Automática (rutina)"}</dd></div>
                <div className="ap-detail-move">
                  <input
                    type="time"
                    className="ap-qa-time"
                    value={detailMoveTime}
                    step={300}
                    aria-label="Nueva hora para mover la tarea"
                    onChange={(event) => setDetailMoveTime(event.target.value || detailMoveTime)}
                  />
                  <button
                    className="ap-btn ap-btn-sm"
                    disabled={Boolean(actionBusy)}
                    onClick={() => { const t = detailTask; setDetailTask(null); performMove(t, new Date(`${baDateKeyOf(t.scheduledFor || "")}T${detailMoveTime}:00-03:00`).toISOString()); }}
                  >
                    Mover a esa hora
                  </button>
                  <span className="ap-qa-note">si pisa otra tarea, se ofrece próximo hueco o cascada</span>
                </div>
              </div>
              <div className="ap-modal-foot">
                <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setDetailTask(null)}>Cerrar</button>
                <button
                  className="ap-btn ap-btn-danger ap-btn-sm"
                  disabled={Boolean(actionBusy)}
                  onClick={() => { const t = detailTask; setDetailTask(null); cancelTask(t); }}
                >
                  Cancelar tarea
                </button>
              </div>
            </div>
          </div>
        );
      })()}

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
              {(() => {
                const primaryMove = cascadePlan.moves.find((m) => m.task_id === cascadePlan.task.id);
                const effectiveTo = primaryMove?.to || cascadePlan.requestedFor;
                const ajustada = effectiveTo !== cascadePlan.requestedFor;
                return (
                  <>
                    <p className="ap-hint" style={{ fontSize: 12, lineHeight: 1.6 }}>
                      Metés <strong>#{cascadePlan.task.id}</strong> ({taskName(cascadePlan.task)}) a las{" "}
                      <strong>{formatBATime(effectiveTo)}</strong>
                      {ajustada ? (
                        <> <span style={{ color: "#fbbf24" }}>
                          (el casillero {formatBATime(cascadePlan.requestedFor)} rozaba el margen de la tarea
                          anterior: entra en el primer minuto libre)
                        </span></>
                      ) : null}. Las siguientes tareas pasan al horario continuo más próximo, sin pisarse
                      entre ellas:
                    </p>
                  </>
                );
              })()}
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
