/**
 * Activity Planner — tipos del contrato de API v1
 * @see ../../../../docs/plans/2026-08-19-activity-planner-api.md
 * Timezone: las fechas llegan ISO UTC; el frontend muestra en America/Argentina/Buenos_Aires.
 */

export type PlannerPlatform = "instagram" | "tiktok" | "youtube";

export type PlannerTaskType =
  | "warmup_ig"
  | "warmup_tiktok"
  | "warmup_youtube"
  | "scan_instagram"
  | "scan_tiktok"
  | "scan_youtube"
  | "publish_reel";

export type PlannerTaskStatus =
  | "pending"
  | "overdue"
  | "expired"
  | "running"
  | "paused"
  | "cancelled"
  | "completed"
  | "error";

export type PlannerTaskSource = "automatic" | "manual" | string;

export type ClusterStatus = "confirmed" | "suggested";

export type ClusterHealth = "ok" | "deficit" | "paused";

export type RoutineType = "warmup_daily" | "scan_auto" | "publishing";

export type RoutineStatus = "approved" | "editing" | "paused";

/** Config según routine_type (contrato sección "Config por routine_type" + Extensiones v3).
 *  Campos v3 retrocompatibles: si faltan, el frontend usa los defaults del contrato. */
export interface RoutineConfig {
  /** v1: minutos de warmup POR CUENTA POR DÍA. */
  minMinutes?: number;
  /** v3: en cuántas sesiones se reparten los minutos (1–4). Default 2. */
  sessionsPerDay?: number;
  /** v3: separación máxima entre sesiones consecutivas en horas (1–10). Default 4. */
  maxGapHours?: number;
  timesPerDay?: number;
  minGapHours?: number;
  postsPerWeek?: number;
  /** v3: días de la semana elegidos para publicar (1=lun … 7=dom, ISO). Default [2,4]. */
  days?: number[];
}

export interface Routine {
  id: number;
  routineType: RoutineType;
  status: RoutineStatus;
  config: RoutineConfig;
}

export interface ClusterAccount {
  id: number;
  platform: PlannerPlatform;
  username: string;
  deviceAlias: string | null;
  policyStatus: string | null;
}

/** Serie de warmup POR CUENTA (extensión v3 de GET /api/clusters/:id → history). */
export interface AccountWarmup {
  accountId: number;
  username: string;
  platform: PlannerPlatform;
  /** 14 días, minutos ejecutados. */
  warmupByDay: number[];
}

export interface WeekTask {
  id: number;
  taskType: PlannerTaskType;
  status: PlannerTaskStatus;
  scheduledFor: string | null;
  durationMin: number | null;
  username: string | null;
  platform: PlannerPlatform | null;
  deviceAlias: string | null;
  source: PlannerTaskSource;
}

export interface WeekCluster {
  id: number;
  name: string;
  status: ClusterStatus;
  health: ClusterHealth;
  accounts: ClusterAccount[];
  routines: Routine[];
  /** 7 valores (lun..dom) por métrica. */
  metricSeries: {
    warmup: number[];
    posts: number[];
    views: number[];
  };
  tasks: WeekTask[];
}

export interface WeekSummary {
  tasksTotal: number;
  tasksRunning: number;
  tasksQueued: number;
  publishTotal: number;
  warmupMinutesPlanned: number;
}

export interface WeekResponse {
  weekStart: string;
  weekEnd: string;
  now: string;
  summary: WeekSummary;
  clusters: WeekCluster[];
}

export interface DayTask {
  id: number;
  taskType: PlannerTaskType;
  status: PlannerTaskStatus;
  scheduledFor: string | null;
  durationMin: number | null;
  clusterId: number | null;
  clusterName: string | null;
  username: string | null;
  platform: PlannerPlatform | null;
  deviceAlias: string | null;
  source: PlannerTaskSource;
}

export interface DayHourly {
  hour: number;
  count: number;
}

export interface DayResponse {
  date: string;
  tasks: DayTask[];
  /** 12..22 */
  hourly: DayHourly[];
}

export interface ClusterListItem {
  id: number;
  name: string;
  status: ClusterStatus;
  detectionMethod: string;
  accountCount: number;
  memberAccountIds: number[];
}

export interface ClustersResponse {
  clusters: ClusterListItem[];
}

export interface CreateClusterBody {
  name: string;
  accountIds: number[];
}

export interface ScanSuggestionsResponse {
  created: ClusterListItem[];
}

export interface ClusterHistory {
  publications: Array<{
    id: number;
    taskType: string;
    status: string;
    scheduledFor: string | null;
    username: string | null;
    platform: PlannerPlatform | null;
    title: string | null;
  }>;
  /** 14 días, minutos ejecutados. */
  warmupByDay: number[];
  /** 14 días. */
  postsByDay: number[];
  /** Warmup por cuenta (extensión v3). Opcional por retrocompatibilidad: si no
   *  viene, el detalle cae al agregado warmupByDay. */
  accountsWarmup?: AccountWarmup[];
  stats: {
    warmupMinutes30d: number;
    posts30d: number;
    views: number | null;
    publicationsTotal: number;
    postsThisWeek: number;
  };
}

export interface ClusterDetailResponse {
  cluster: WeekCluster;
  history: ClusterHistory;
  nav: {
    prevClusterId: number | null;
    nextClusterId: number | null;
  };
}

export interface RoutinesResponse {
  routines: Routine[];
}

export interface PutRoutineBody {
  config?: Partial<RoutineConfig>;
  status?: RoutineStatus;
}

export interface PutRoutineResponse {
  routine: Routine;
  regenerated: boolean;
}

export interface GenerateWeekResponse {
  created: number;
  cancelled: number;
  weekStart: string;
}

export interface PublishToClusterBody {
  videoUrl: string;
  title: string;
  scheduledFor?: string;
}

/** Publicación v3: multipart/form-data con archivo (video) + título (+ fecha opcional). */
export interface PublishToClusterFileBody {
  file: File;
  title: string;
  scheduledFor?: string;
}

export interface PublishToClusterResponse {
  created: number;
  /** v3: id del asset subido (el body JSON legacy no lo trae). */
  assetId?: string;
}

/* ============================================================
   Utilidades de fecha (America/Argentina/Buenos_Aires)
   ============================================================ */

export const BUENOS_AIRES_TIMEZONE = "America/Argentina/Buenos_Aires";

export function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value || "";
}

/** Date key YYYY-MM-DD de HOY en Buenos Aires. */
export function buenosAiresToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${datePart(parts, "year")}-${datePart(parts, "month")}-${datePart(parts, "day")}`;
}

/** Date key YYYY-MM-DD del lunes de la semana (en BA) que contiene `value`. */
export function mondayOf(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const year = Number(datePart(parts, "year"));
  const month = Number(datePart(parts, "month"));
  const day = Number(datePart(parts, "day"));
  const local = new Date(year, month - 1, day, 12);
  const weekday = local.getDay(); // 0 = domingo
  const offset = weekday === 0 ? -6 : 1 - weekday;
  local.setDate(local.getDate() + offset);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Lunes de la semana actual en BA. */
export function currentWeekStart(): string {
  return mondayOf(new Date());
}

/** Suma `days` días a un date key YYYY-MM-DD (sin salir de BA: se interpreta a mediodía local). */
export function shiftDateKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const local = new Date(year, month - 1, day, 12);
  local.setDate(local.getDate() + days);
  const y = local.getFullYear();
  const m = String(local.getMonth() + 1).padStart(2, "0");
  const d = String(local.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const WEEKDAYS_ES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** "lun 17" a partir de un date key. */
export function shortWeekday(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const local = new Date(year, month - 1, day, 12);
  return `${WEEKDAYS_ES[local.getDay()]} ${day}`;
}

/** "mié 19 ago" a partir de un date key. */
export function shortDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const local = new Date(year, month - 1, day, 12);
  const months = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  return `${WEEKDAYS_ES[local.getDay()]} ${day} ${months[local.getMonth()]}`;
}

/** Hora "HH:mm" en BA de un ISO UTC. */
export function formatBATime(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

/** "Hace Xm" en español a partir de un ISO UTC. */
export function relativeBA(value: string | null | undefined): string {
  if (!value) return "sin señal";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "fecha inválida";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes}m`;
  if (minutes < 1440) return `hace ${Math.floor(minutes / 60)}h`;
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    day: "2-digit",
    month: "short",
  }).format(new Date(value));
}

/* ============================================================
   Utilidades de dominio
   ============================================================ */

export const TASK_TYPE_META: Record<PlannerTaskType, { kind: "warmup" | "scan" | "publish"; label: string; color: string }> = {
  warmup_ig: { kind: "warmup", label: "Warmup IG", color: "#22c55e" },
  warmup_tiktok: { kind: "warmup", label: "Warmup TT", color: "#22c55e" },
  warmup_youtube: { kind: "warmup", label: "Warmup YT", color: "#22c55e" },
  scan_instagram: { kind: "scan", label: "Scan IG", color: "#3b82f6" },
  scan_tiktok: { kind: "scan", label: "Scan TT", color: "#3b82f6" },
  scan_youtube: { kind: "scan", label: "Scan YT", color: "#3b82f6" },
  publish_reel: { kind: "publish", label: "Publicación", color: "#c026d3" },
};

export function taskKind(taskType: PlannerTaskType): "warmup" | "scan" | "publish" {
  return TASK_TYPE_META[taskType]?.kind || "warmup";
}

export const PLATFORM_META: Record<PlannerPlatform, { label: string; short: string; color: string }> = {
  instagram: { label: "Instagram", short: "IG", color: "#f472b6" },
  tiktok: { label: "TikTok", short: "TT", color: "#67e8f9" },
  youtube: { label: "YouTube", short: "YT", color: "#fb7185" },
};

export const STATUS_LABELS: Record<PlannerTaskStatus, string> = {
  pending: "En cola",
  overdue: "Atrasada",
  expired: "Expirada",
  running: "Ejecutando",
  paused: "Pausada",
  cancelled: "Cancelada",
  completed: "Completada",
  error: "Error",
};

export const ROUTINE_LABELS: Record<RoutineType, { title: string; desc: string; color: string }> = {
  warmup_daily: {
    title: "Warmup diario",
    desc: "Mínimo 40 min por cuenta · todos los días",
    color: "#4ade80",
  },
  scan_auto: {
    title: "Scan automático",
    desc: "2 veces por día · separación mínima 9 h",
    color: "#93c5fd",
  },
  publishing: {
    title: "Publicaciones",
    desc: "Mínimo 2 videos/semana por cuenta",
    color: "#e879f9",
  },
};

export const ROUTINE_STATUS_LABELS: Record<RoutineStatus, string> = {
  approved: "Aprobado",
  editing: "Editando",
  paused: "Pausado",
};
