"use client";

/**
 * Vista semanal del Activity Planner — porte de docs/mockups/activity-planner/planner-week.html
 * con datos reales de GET /api/planner/week.
 */
import { useMemo, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { plannerApi, PlannerApiError } from "./api";
import {
  BUENOS_AIRES_TIMEZONE,
  PLATFORM_META,
  PUBLICATION_STATUS_LABELS,
  STATUS_LABELS,
  TASK_TYPE_META,
  buenosAiresToday,
  formatBATime,
  publicationBadgeClass,
  shortDate,
  shortWeekday,
  shiftDateKey,
  taskKind,
} from "./types";
import type { PublicationItem, WeekCluster, WeekResponse, WeekTask } from "./types";

const CHART_W = 1000;
const CHART_H = 118;
const PAD_X = 26;
const TOP = 16;
const BOTTOM = 14;
const INNER_W = CHART_W - PAD_X * 2;
const INNER_H = CHART_H - TOP - BOTTOM;

type MetricKey = "warmup" | "posts" | "views";

const METRICS: Record<MetricKey, { label: string; unit: string; color: string }> = {
  warmup: { label: "Warmup", unit: "min", color: "#22c55e" },
  posts: { label: "Posts", unit: "videos", color: "#c026d3" },
  views: { label: "Views", unit: "K", color: "#f59e0b" },
};

const KIND_LABEL: Record<"warmup" | "scan" | "publish", string> = {
  warmup: "Warmup",
  scan: "Scan",
  publish: "Publish",
};

/** Máximo de filas de tareas en el tooltip del chart; el resto se resume en "+N más". */
const MAX_TIP_TASKS = 2;
/** Altura máxima estimada del tooltip (header + fila de métrica + hasta
    MAX_TIP_TASKS tareas + fila "+N más" + paddings). Se usa para decidir el
    flip vertical antes de que el DOM tenga el tooltip renderizado. */
const TIP_MAX_H = 226;

interface DayTaskInfo {
  task: WeekTask;
  dayIdx: number;
  kind: "warmup" | "scan" | "publish";
  late: boolean;
}

function dayIndexFromDateKey(dateKey: string, weekStart: string): number {
  const [y1, m1, d1] = weekStart.split("-").map(Number);
  const [y2, m2, d2] = dateKey.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86400000);
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

function smoothPath(points: Array<[number, number]>): string {
  if (points.length < 2) return "";
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C${c1x.toFixed(1)} ${c1y.toFixed(1)},${c2x.toFixed(1)} ${c2y.toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

function niceMax(metric: MetricKey, series: number[]): number {
  const max = Math.max(...series) || 1;
  if (metric === "posts") return Math.max(3, Math.ceil(max / 2) * 2);
  if (metric === "views") return Math.max(5, Math.ceil(max / 5) * 5);
  return Math.max(10, Math.ceil(max / 10) * 10);
}

interface ChartProps {
  cluster: WeekCluster;
  metric: MetricKey;
  todayIndex: number;
  nowRatio: number | null;
  weekDays: string[];
  dayTasks: DayTaskInfo[];
  onOpenDay: (dateKey: string) => void;
  onMoveTask: (task: WeekTask) => void;
  onCancelTask: (task: WeekTask) => void;
  canManage: boolean;
}

function Chart({ cluster, metric, todayIndex, nowRatio, weekDays, dayTasks, onOpenDay, onMoveTask, onCancelTask, canManage }: ChartProps) {
  /** Día bajo el cursor (por X) — liquid glass por proximidad:
      día = is-active, anterior = is-near-left, siguiente = is-near-right. */
  const [hoverDay, setHoverDay] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; dayIdx: number; flip: boolean } | null>(null);

  const series = useMemo(() => cluster.metricSeries[metric] || [], [cluster.metricSeries, metric]);
  const max = niceMax(metric, series);
  const lineColor = METRICS[metric].color;

  const pts = useMemo(() => series.map((value, i) => {
    const x = PAD_X + (INNER_W / 6) * i;
    const y = TOP + INNER_H - (value / max) * INNER_H;
    return [x, y] as [number, number];
  }), [series, max]);

  const pastCount = todayIndex >= 0 ? Math.min(todayIndex + 1, 7) : 7;
  const solidPts = pts.slice(0, pastCount);
  const futurePts = pts.slice(Math.max(0, pastCount - 1));

  const linePath = smoothPath(solidPts);
  const futurePath = smoothPath(futurePts);
  const areaPath = linePath
    + ` L${pts[pts.length - 1][0].toFixed(1)} ${TOP + INNER_H} L${pts[0][0]} ${TOP + INNER_H} Z`;
  const pastX = todayIndex >= 0 && nowRatio !== null
    ? PAD_X + (INNER_W / 6) * todayIndex + (INNER_W / 6) * nowRatio
    : null;

  const events = useMemo(() => dayTasks.map((info) => ({
    ...info,
    x: PAD_X + (INNER_W / 6) * info.dayIdx + (INNER_W / 6) * (0.3 + (info.dayIdx % 3) * 0.2),
    y: TOP + 10 + (info.dayIdx % 3) * 9,
  })), [dayTasks]);

  const handleMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(0.999, Math.max(0, (event.clientX - rect.left) / rect.width));
    const dayIdx = Math.min(6, Math.max(0, Math.round(((ratio * CHART_W) - PAD_X) / (INNER_W / 6) - 0.5)));
    const tipX = Math.min(rect.width - 210, Math.max(0, ratio * rect.width - 74));
    // Flip vertical: si el tooltip tocaría el borde inferior del viewport,
    // se posiciona por encima del cursor (el chart mide 118px; el tooltip
    // cae 6px abajo, así que con 132px de margen alcanza en cualquier caso).
    const flip = rect.bottom + 6 + TIP_MAX_H > window.innerHeight;
    setHoverDay(dayIdx);
    setTip({ x: tipX, dayIdx, flip });
  };

  const tipDay = tip ? dayTasks.filter((info) => info.dayIdx === tip.dayIdx) : [];

  /** Clase de proximidad al día activo: is-active (día bajo el cursor),
      is-near-left (día anterior: ilumina su borde derecho),
      is-near-right (día siguiente: ilumina su borde izquierdo) / sin clase. */
  const glassClass = (i: number): string => {
    if (hoverDay == null) return "";
    if (hoverDay === i) return "is-active";
    if (hoverDay - i === 1) return "is-near-left";
    if (i - hoverDay === 1) return "is-near-right";
    return "";
  };

  return (
    <div
      className={`ap-chart ${hoverDay != null ? "is-hover" : ""}`}
      onMouseLeave={() => { setHoverDay(null); setTip(null); }}
      onMouseMove={handleMove}
    >
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} preserveAspectRatio="none" aria-hidden="true">
        <defs>
          <linearGradient id={`lg-area-${cluster.id}-${metric}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.22" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
          <linearGradient id="apSpecGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.10)" />
            <stop offset="55%" stopColor="rgba(255,255,255,0.02)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
          {/* v4 — luz de borde de los vecinos del día activo: nace fuerte en la
              arista que mira al día bajo el cursor y se desvanece hacia el
              centro de la tarjeta (efecto "luz que se derrama"). */}
          <linearGradient id="apEdgeRightGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(190, 242, 205, 0)" />
            <stop offset="55%" stopColor="rgba(190, 242, 205, 0.1)" />
            <stop offset="100%" stopColor="rgba(190, 242, 205, 0.34)" />
          </linearGradient>
          <linearGradient id="apEdgeLeftGrad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="rgba(190, 242, 205, 0.34)" />
            <stop offset="45%" stopColor="rgba(190, 242, 205, 0.1)" />
            <stop offset="100%" stopColor="rgba(190, 242, 205, 0)" />
          </linearGradient>
        </defs>

        {/* Columnas liquid glass (click → día) */}
        {weekDays.map((dateKey, i) => {
          const x0 = PAD_X + (INNER_W / 6) * i - (INNER_W / 6 / 2);
          const w = INNER_W / 6;
          const gap = 7;
          return (
            <g
              key={dateKey}
              className={`ap-glass-col ${glassClass(i)}`}
              style={{ transitionDelay: `${i * 45}ms` }}
              onClick={() => onOpenDay(dateKey)}
              role="button"
              aria-label={`Ver día ${shortDate(dateKey)}`}
              cursor="pointer"
            >
              <rect className="ap-glass-body" x={x0 + gap} y={TOP - 6} width={w - gap * 2} height={INNER_H + 12} rx={9} />
              <rect className="ap-glass-spec" x={x0 + gap + 2} y={TOP - 6} width={w - gap * 2 - 4} height={INNER_H * 0.22 + 8} rx={7} />
              {/* v4 — borde que se ilumina cuando el día es vecino del activo:
                  is-near-left prende el costado derecho, is-near-right el izquierdo */}
              <rect
                className="ap-glass-edge"
                x={x0 + gap}
                y={TOP - 6}
                width={Math.max(1, w - gap * 2) * 0.42}
                height={INNER_H + 12}
                rx={9}
                fill="url(#apEdgeRightGrad)"
              />
              <rect
                className="ap-glass-edge ap-glass-edge-left"
                x={x0 + w - gap - Math.max(1, w - gap * 2) * 0.42}
                y={TOP - 6}
                width={Math.max(1, w - gap * 2) * 0.42}
                height={INNER_H + 12}
                rx={9}
                fill="url(#apEdgeLeftGrad)"
              />
              <line className="ap-glass-sep" x1={x0 + w / 2} y1={TOP - 6} x2={x0 + w / 2} y2={TOP + INNER_H + 6} />
            </g>
          );
        })}

        {/* Sombra del pasado */}
        {pastCount < 7 && pastCount > 0 && (
          <rect
            className="ap-past-shade"
            x={PAD_X}
            y={TOP - 8}
            width={((INNER_W / 6) * pastCount)}
            height={INNER_H + 14}
            rx={8}
          />
        )}

        <path className="ap-area" d={areaPath} fill={`url(#lg-area-${cluster.id}-${metric})`} />
        <path className="ap-line" d={linePath} stroke={lineColor} />
        {futurePath && <path className="ap-line-ghost" d={futurePath} stroke={lineColor} />}

        {/* Dots por día */}
        {pts.map((p, i) => (
          <circle
            key={i}
            className="ap-dot"
            cx={p[0].toFixed(1)}
            cy={p[1].toFixed(1)}
            r={i === todayIndex ? 4.2 : 3}
            fill={lineColor}
            stroke={i === todayIndex ? "#bbf7d0" : undefined}
            strokeWidth={i === todayIndex ? 1.6 : undefined}
          />
        ))}

        {/* Marcadores de tareas por tipo */}
        {events.map((info) => (
          <g
            key={info.task.id}
            className="ap-ev"
            style={{ color: TASK_TYPE_META[info.task.taskType]?.color || "#22c55e" }}
            transform={`translate(${info.x},${info.y})`}
          >
            <circle r={info.late ? 4.4 : 3.4} fill="currentColor" />
            <circle r={(info.late ? 4.4 : 3.4) + 4} fill="none" stroke="currentColor" strokeOpacity="0.25" />
          </g>
        ))}

        {/* Now line */}
        {pastX !== null && (
          <>
            <line className="ap-now-line ap-now-anim" x1={pastX} y1={TOP - 8} x2={pastX} y2={TOP + INNER_H + 6} />
            <circle className="ap-now-dot" cx={pastX} cy={TOP - 8} r={2.6} />
            <rect className="ap-now-chip" x={pastX + 5} y={TOP - 14} width={56} height={16} rx={8} />
            <text className="ap-now-chip-text" x={pastX + 33} y={TOP - 3} textAnchor="middle">AHORA</text>
          </>
        )}
      </svg>

      {/* Tooltip del día */}
      <div
        className={`ap-chart-tip ${tip ? "is-visible" : ""} ${tip?.flip ? "is-flip" : ""}`}
        style={tip ? { left: tip.x, top: tip.flip ? "auto" : 6, bottom: tip.flip ? 6 : "auto" } : undefined}
      >
        {tip && (
          <>
            <h5>{weekDays[tip.dayIdx] ? shortDate(weekDays[tip.dayIdx]) : ""} <span>· {cluster.name}</span></h5>
            <ul>
              <li>
                <i style={{ background: lineColor }} />
                {METRICS[metric].label}
                <em>{series[tip.dayIdx] ?? 0}{metric === "warmup" ? " min" : metric === "posts" ? "" : "K"}</em>
              </li>
              {tipDay.length ? tipDay.slice(0, MAX_TIP_TASKS).map((info) => (
                <li key={info.task.id} className="ap-tip-task">
                  <i style={{ background: TASK_TYPE_META[info.task.taskType]?.color || "#22c55e" }} />
                  <span>{KIND_LABEL[info.kind]} · #{info.task.id} · {formatBATime(info.task.scheduledFor)}</span>
                  <em className={info.late ? "ap-tip-late" : ""}>{info.late ? "atrasada" : STATUS_LABELS[info.task.status]}</em>
                  {canManage && (["pending", "overdue", "paused", "expired"].includes(info.task.status)) && (
                    <span className="ap-tip-actions">
                      <button onClick={() => onMoveTask(info.task)}>Mover</button>
                      <button onClick={() => onCancelTask(info.task)}>Cancelar</button>
                    </span>
                  )}
                </li>
              )) : <li><i style={{ background: lineColor }} />Sin tareas <em>—</em></li>}
              {tipDay.length > MAX_TIP_TASKS && (
                <li className="ap-tip-more">+{tipDay.length - MAX_TIP_TASKS} más</li>
              )}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

interface RowProps {
  cluster: WeekCluster;
  weekStart: string;
  weekDays: string[];
  todayIndex: number;
  nowRatio: number | null;
  canManage: boolean;
  actionBusy: string;
  onOpenCluster: (id: number) => void;
  onOpenDay: (dateKey: string) => void;
  onConfirmCluster: (id: number) => void;
  onRejectCluster: (id: number) => void;
  onMoveTask: (task: WeekTask) => void;
  onCancelTask: (task: WeekTask) => void;
}

function ClusterRow({ cluster, weekStart, weekDays, todayIndex, nowRatio, canManage, actionBusy, onOpenCluster, onOpenDay, onConfirmCluster, onRejectCluster, onMoveTask, onCancelTask }: RowProps) {
  const [metric, setMetric] = useState<MetricKey>("warmup");

  const dayTasks: DayTaskInfo[] = useMemo(() => cluster.tasks
    .filter((task) => task.status !== "cancelled")
    .map((task) => {
    const dateKey = task.scheduledFor ? baDateKeyOf(task.scheduledFor) : "";
    return {
      task,
      dayIdx: dateKey ? Math.min(6, Math.max(0, dayIndexFromDateKey(dateKey, weekStart))) : 0,
      kind: taskKind(task.taskType),
      late: task.status === "overdue" || task.status === "expired",
    };
  }), [cluster.tasks, weekStart]);

  /** Cola única: publicaciones del cluster dentro de la semana, agrupadas por
   *  día (misma mecánica que dayTasks). Las canceladas no se muestran. */
  const dayPublications: Array<{ publication: PublicationItem; dayIdx: number }> = useMemo(() => (cluster.publications || [])
    .filter((publication) => publication.status !== "cancelled")
    .map((publication) => {
      const dateKey = publication.scheduledFor ? baDateKeyOf(publication.scheduledFor) : "";
      return {
        publication,
        dayIdx: dateKey ? Math.min(6, Math.max(0, dayIndexFromDateKey(dateKey, weekStart))) : 0,
      };
    }), [cluster.publications, weekStart]);

  const publicationsHTML: ReactNode = dayPublications.length ? (
    <div className="ap-pubs">
      <div className="ap-pubs-head">
        <span>Publicaciones de la semana <strong>({dayPublications.length})</strong></span>
        <span style={{ color: "var(--text-dim)", fontSize: 9 }}>cola única · publication_jobs</span>
      </div>
      <div className="ap-pubs-list">
        {weekDays.map((dateKey, i) => {
          const list = dayPublications.filter((info) => info.dayIdx === i);
          if (!list.length) return null;
          return (
            <div className="ap-pubs-day" key={dateKey}>
              <span className="ap-pubs-day-label">{shortWeekday(dateKey)}</span>
              <div className="ap-pubs-day-items">
                {list.map(({ publication }) => (
                  <span className="ap-pub" key={publication.id}>
                    <strong>{formatBATime(publication.scheduledFor)}</strong>
                    {publication.platform && (
                      <span className={`ap-pill ap-pill-${publication.platform}`}>{(PLATFORM_META[publication.platform] || PLATFORM_META.instagram).short}</span>
                    )}
                    <span className="ap-pub-account">@{publication.account || "—"}</span>
                    <em className="ap-pub-title">{publication.title || "— definir contenido —"}</em>
                    <span className={`ap-badge ${publicationBadgeClass(publication.status)}`}>
                      <span className="ap-badge-dot" />{PUBLICATION_STATUS_LABELS[publication.status] || publication.status}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  ) : null;

  const activeRoutines = cluster.routines.filter((routine) => routine.status !== "paused").length;
  const sub = cluster.status === "suggested"
    ? `detectado automáticamente · ${cluster.accounts.length} cuentas matcheadas`
    : `${cluster.accounts.length} cuentas · ${activeRoutines} rutina${activeRoutines === 1 ? "" : "s"} activa${activeRoutines === 1 ? "" : "s"}`;

  const statusBadge: ReactNode = cluster.status === "suggested"
    ? <span className="ap-badge ap-badge-suggest"><span className="ap-badge-dot" />Sugerido — confirmar</span>
    : cluster.health === "deficit"
      ? <span className="ap-badge ap-badge-warn"><span className="ap-badge-dot" />Con déficit</span>
      : cluster.health === "paused"
        ? <span className="ap-badge ap-badge-neutral"><span className="ap-badge-dot" />Pausado</span>
        : <span className="ap-badge ap-badge-live"><span className="ap-badge-dot" />Todo ok</span>;

  // Cumplimiento: minutos ejecutados (antes de hoy) vs. plan total de la semana
  const warmup = cluster.metricSeries.warmup || [];
  const executed = todayIndex >= 0 ? warmup.slice(0, todayIndex).reduce((sum, v) => sum + v, 0) : warmup.reduce((sum, v) => sum + v, 0);
  const planned = todayIndex >= 0 ? warmup.slice(todayIndex).reduce((sum, v) => sum + v, 0) : 0;
  const total = executed + planned;
  const compliance = total > 0 ? Math.round((executed / total) * 100) : 0;

  const complianceHTML: ReactNode = cluster.status === "suggested"
    ? <div className="ap-compliance"><div><span>Rutina propuesta</span><strong>Warmup 40 min · scan ×2 · posts ×2</strong></div></div>
    : cluster.health === "paused"
      ? <div className="ap-compliance"><div><span>Semana</span><strong>Rutina en pausa</strong></div></div>
      : (
        <div className={`ap-compliance ${cluster.health === "deficit" ? "is-warn" : ""}`}>
          <div><span>Cumplimiento semanal</span><strong>{compliance}% · {cluster.health === "deficit" ? "con déficit · reponer" : "objetivo en curso"}</strong></div>
          <div className="ap-progress-track"><span style={{ width: `${Math.max(2, Math.min(100, compliance))}%` }} /></div>
        </div>
      );

  const todayTaskCount = todayIndex >= 0 ? dayTasks.filter((info) => info.dayIdx === todayIndex).length : 0;
  const hint = todayIndex >= 0
    ? `${shortDate(weekDays[todayIndex])} · ${todayTaskCount} tarea${todayTaskCount === 1 ? "" : "s"}`
    : `${cluster.tasks.length} tareas en la semana`;

  return (
    <article
      className={`ap-cluster-row ${cluster.status === "suggested" ? "is-suggested" : ""} ${cluster.health === "deficit" ? "is-deficit" : ""} ${cluster.health === "paused" ? "is-paused" : ""}`}
    >
      {/* v5.1 — glow de borde en hover: SVG de trazo perimetral, correcto por
          construcción (nada se pinta en el interior). Dos rects sin fill con
          pathLength 100 y rx 13.5 (= border-radius 15 de la card − inset
          1.5): la luz orbita a distancia constante también en las esquinas.
          Cabeza nítida (ap-glow-line, dash "3 97") + cola difusa
          (ap-glow-soft, dash "12 88") desfasadas 12 unidades: la cola queda
          siempre detrás de la cabeza en sentido horario. Sin viewBox
          (user units = px) y con width/height del rect en CSS (SVG2
          geometry, Chromium): el inset de 1.5px y el rx quedan parejos en
          cualquier aspect ratio de la card — con preserveAspectRatio="none"
          el inset se escalaba por ancho y alto por separado y el trazo se
          despegaba del borde. */}
      <svg className="ap-cluster-glow" aria-hidden="true" focusable="false">
        <rect className="ap-glow-soft" x="1.5" y="1.5" rx="13.5" pathLength="100" vectorEffect="non-scaling-stroke" />
        <rect className="ap-glow-line" x="1.5" y="1.5" rx="13.5" pathLength="100" vectorEffect="non-scaling-stroke" />
      </svg>
      <div
        className="ap-cluster-card"
        tabIndex={0}
        role="button"
        aria-label={`Abrir detalle de ${cluster.name}`}
        onClick={() => onOpenCluster(cluster.id)}
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onOpenCluster(cluster.id); } }}
      >
        <div className="ap-cluster-id">
          <div><h3>{cluster.name}</h3><span>{sub}</span></div>
          {statusBadge}
        </div>
        <div className="ap-bubbles">
          {cluster.accounts.length ? cluster.accounts.map((account) => {
            const meta = PLATFORM_META[account.platform] || PLATFORM_META.instagram;
            return (
              <span className="ap-bubble-wrap" key={account.id}>
                <span
                  className={`ap-bubble ap-bubble-${account.platform}`}
                  tabIndex={0}
                  role="img"
                  aria-label={`${meta.label}: @${account.username}`}
                >{meta.short}</span>
                <span className="ap-bubble-tip">@{account.username}<em>{meta.label}{account.deviceAlias ? ` · celular ${account.deviceAlias}` : ""}</em></span>
              </span>
            );
          }) : <span className="ap-cluster-hint" style={{ marginLeft: 0 }}>Sin cuentas asignadas</span>}
        </div>
        <div className="ap-cluster-meta"><span className="ap-cluster-hint">{hint}</span></div>
        {complianceHTML}
        {publicationsHTML}
        {cluster.status === "suggested" && (
          <div className="ap-suggest-actions">
            <button
              className="ap-btn ap-btn-primary ap-btn-sm"
              disabled={!canManage || Boolean(actionBusy)}
              onClick={(event) => { event.stopPropagation(); onConfirmCluster(cluster.id); }}
            >{actionBusy === `confirm-${cluster.id}` ? "Confirmando…" : "Confirmar cluster"}</button>
            <button
              className="ap-btn ap-btn-sm"
              disabled={!canManage || Boolean(actionBusy)}
              onClick={(event) => { event.stopPropagation(); onRejectCluster(cluster.id); }}
            >Descartar</button>
          </div>
        )}
        <div className="ap-cluster-foot">
          <span className="ap-link-button">Abrir detalle →</span>
          <span style={{ color: "var(--text-dim)", fontSize: 9 }}>Enter / click</span>
        </div>
      </div>

      <div className="ap-chart-cell">
        <div className="ap-chart-toolbar">
          <div className="ap-metric-select" role="tablist" aria-label="Métrica del chart">
            <button className="is-disabled" title="Disponible próximamente" disabled>Views</button>
            <button className={metric === "posts" ? "is-selected" : ""} onClick={() => setMetric("posts")}>Posts</button>
            <button className={metric === "warmup" ? "is-selected" : ""} onClick={() => setMetric("warmup")}>Warmup</button>
          </div>
          <div className="ap-chart-legend">
            <span className="ap-legend-item" style={{ color: "#4ade80" }}><i />Warmup</span>
            <span className="ap-legend-item" style={{ color: "#93c5fd" }}><i />Scan</span>
            <span className="ap-legend-item" style={{ color: "#e879f9" }}><i />Publish</span>
            <span className="ap-legend-item" style={{ color: "#86efac" }}><i style={{ borderRadius: "50%" }} />Ahora</span>
          </div>
        </div>
        <Chart
          cluster={cluster}
          metric={metric}
          todayIndex={todayIndex}
          nowRatio={nowRatio}
          weekDays={weekDays}
          dayTasks={dayTasks}
          onOpenDay={onOpenDay}
          onMoveTask={onMoveTask}
          onCancelTask={onCancelTask}
          canManage={canManage}
        />
        <div className="ap-chart-xlabels">
          {weekDays.map((dateKey, i) => (
            <span key={dateKey} className={i === todayIndex ? "is-today" : ""}>{shortWeekday(dateKey)}</span>
          ))}
        </div>
      </div>
    </article>
  );
}

interface PlannerWeekProps {
  token: string;
  week: WeekResponse;
  canManage: boolean;
  onOpenCluster: (id: number) => void;
  onOpenDay: (dateKey: string) => void;
  onChanged: () => void;
}

export default function PlannerWeek({ token, week, canManage, onOpenCluster, onOpenDay, onChanged }: PlannerWeekProps) {
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDateKey(week.weekStart, i)), [week.weekStart]);
  const todayKey = useMemo(() => buenosAiresToday(), []);
  const todayIndex = useMemo(() => {
    const idx = dayIndexFromDateKey(todayKey, week.weekStart);
    return idx >= 0 && idx < 7 ? idx : -1;
  }, [todayKey, week.weekStart]);

  const nowRatio = useMemo(() => {
    if (todayIndex < 0) return null;
    const hour = baHourOf(week.now);
    return Math.min(1, Math.max(0, (hour - 12) / 10));
  }, [todayIndex, week.now]);

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

  const confirmCluster = (id: number) => void runAction(`confirm-${id}`, async () => {
    await plannerApi.confirmCluster(token, id);
  });

  const rejectCluster = (id: number) => {
    if (!window.confirm(`¿Descartar el cluster sugerido #${id}?`)) return;
    void runAction(`reject-${id}`, async () => {
      await plannerApi.rejectCluster(token, id);
    });
  };

  const cancelTask = (task: WeekTask) => {
    if (!window.confirm(`¿Cancelar la tarea #${task.id}? Esta acción no se revierte desde el panel.`)) return;
    void runAction(`stop-${task.id}`, async () => {
      await plannerApi.stopTask(token, task.id);
    });
  };

  const moveTask = (task: WeekTask) => {
    const current = formatBATime(task.scheduledFor);
    const input = window.prompt(`Nuevo horario (HH:MM) en Buenos Aires para la tarea #${task.id}. Actual: ${current}`, current);
    if (!input) return;
    const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
    if (!match) { setError("Formato de horario inválido. Usá HH:MM (ej. 18:30)."); return; }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) { setError("Horario fuera de rango."); return; }
    const dateKey = task.scheduledFor ? baDateKeyOf(task.scheduledFor) : todayKey;
    const scheduledFor = new Date(`${dateKey}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`).toISOString();
    void runAction(`move-${task.id}`, async () => {
      await plannerApi.rescheduleTask(token, task.id, scheduledFor);
    });
  };

  return (
    <div className="ap-page-stack">
      {error && <div className="cc-alert cc-alert-error"><span>{error}<button onClick={() => setError("")}>×</button></span></div>}
      <section className="ap-cluster-stack" aria-label="Clusters de la semana">
        {week.clusters.length ? week.clusters.map((cluster) => (
          <ClusterRow
            key={cluster.id}
            cluster={cluster}
            weekStart={week.weekStart}
            weekDays={weekDays}
            todayIndex={todayIndex}
            nowRatio={nowRatio}
            canManage={canManage}
            actionBusy={actionBusy}
            onOpenCluster={onOpenCluster}
            onOpenDay={onOpenDay}
            onConfirmCluster={confirmCluster}
            onRejectCluster={rejectCluster}
            onMoveTask={moveTask}
            onCancelTask={cancelTask}
          />
        )) : <div className="ap-empty"><strong>No hay clusters en el workspace</strong><span>Escaneá sugerencias o creá un cluster para arrancar la planificación semanal.</span></div>}
      </section>
      {actionBusy && <p className="ap-loading-label" style={{ color: "var(--text-muted)", fontSize: 10 }}>Actualizando…</p>}
    </div>
  );
}
