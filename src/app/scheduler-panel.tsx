"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

const SCHEDULER_API = (process.env.NEXT_PUBLIC_API_URL || "https://api.southfarm.tech").replace(/\/$/, "");
const BUENOS_AIRES_TIMEZONE = "America/Argentina/Buenos_Aires";

type SchedulerPlatform = "instagram" | "tiktok" | "youtube";
type WarmupPolicyStatus = "automatic" | "cold" | "warming" | "warm";
type PlannerMode = "fixed" | "random";

interface PlannerPolicy {
  status: WarmupPolicyStatus;
  enabled: boolean;
  daily_min_seconds: number;
  daily_max_seconds: number;
  min_sessions: number;
  max_sessions: number;
  window_start: string;
  window_end: string;
  timezone: string;
}

interface PlannerMetrics {
  today_sec: number;
  last_24h_sec: number;
  last_7d_sec: number;
  last_30d_sec: number;
  last_6m_sec: number;
  last_warmup_at: string | null;
}

interface PlannerTask {
  id: number;
  task_type: string;
  platform?: SchedulerPlatform | string | null;
  source?: "automatic" | "manual" | string;
  status: string;
  scheduled_for?: string | null;
  overdue_at?: string | null;
  expires_at?: string | null;
  planned_duration_sec?: number | null;
  actual_duration_sec?: number | null;
  device_id?: number | null;
  device_key?: string | null;
  device_name?: string | null;
  social_account_id?: number | null;
  account_key?: string | null;
  params?: Record<string, unknown> | string | null;
}

interface PlannerAccount {
  id?: number | null;
  social_account_id?: number | null;
  account_key: string;
  account: string;
  username: string;
  platform: SchedulerPlatform;
  device_id?: number | null;
  device_key?: string | null;
  device_name?: string | null;
  policy: PlannerPolicy | null;
  plan_item?: {
    id: number;
    target_seconds: number;
    planned_sessions: number;
    status: string;
    plan_date: string;
  } | null;
  metrics: PlannerMetrics;
  today_target_sec: number;
  today_deficit_sec: number;
  tasks?: PlannerTask[];
}

interface PlannerNotification {
  id: number;
  type: string;
  severity: string;
  title: string;
  message: string;
  created_at: string;
  read_at?: string | null;
  payload?: Record<string, unknown> | null;
}

type SchedulerControlMode = "normal" | "manual_only" | "paused";

interface WorkspaceControlDevice {
  id: number;
  device_id: string;
  display_name: string;
  online: boolean;
  connection_status?: string;
  control_state: string;
  acknowledged: boolean;
  control_ack_at?: string | null;
  current_task?: { id: number; task_type: string; status: string } | null;
}

interface WorkspaceControl {
  workspace_id: number;
  scheduler_mode: SchedulerControlMode;
  queue_paused: boolean;
  control_version: number;
  updated_at?: string | null;
  devices: WorkspaceControlDevice[];
}

interface SchedulerPanelProps {
  token: string;
  canManage: boolean;
  onChanged?: () => void;
}

class SchedulerApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function schedulerRequest<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("Authorization", "Bearer " + token);
  const response = await fetch(SCHEDULER_API + path, { ...init, headers });
  const data: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data
      ? String((data as { error?: unknown }).error || "No se pudo completar la solicitud")
      : "No se pudo completar la solicitud";
    throw new SchedulerApiError(message, response.status);
  }
  return data as T;
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseParams(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return {};
}

function datePart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  return parts.find((part) => part.type === type)?.value || "";
}

function buenosAiresToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return datePart(parts, "year") + "-" + datePart(parts, "month") + "-" + datePart(parts, "day");
}

function toBuenosAiresInput(value: string | null | undefined): string {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const year = datePart(parts, "year");
  const month = datePart(parts, "month");
  const day = datePart(parts, "day");
  const hour = datePart(parts, "hour");
  const minute = datePart(parts, "minute");
  return year && month && day && hour && minute ? year + "-" + month + "-" + day + "T" + hour + ":" + minute : "";
}

function inputToBuenosAiresIso(value: string): string {
  if (!value) throw new Error("Elegí una fecha y hora");
  const withSeconds = value.length === 16 ? value + ":00" : value;
  const parsed = new Date(withSeconds + "-03:00");
  if (!Number.isFinite(parsed.getTime())) throw new Error("La fecha elegida no es válida");
  return parsed.toISOString();
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "Nunca";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Fecha inválida";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

function formatTime(value: string | null | undefined): string {
  if (!value) return "Sin horario";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Sin horario";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: BUENOS_AIRES_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

function formatDuration(value: unknown): string {
  const seconds = Math.max(0, Math.round(numberValue(value)));
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return minutes + " min";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? hours + " h " + remainder + " min" : hours + " h";
}

function platformLabel(platform: SchedulerPlatform | string): string {
  if (platform === "tiktok") return "TikTok";
  if (platform === "youtube") return "YouTube";
  return "Instagram";
}

function platformShort(platform: SchedulerPlatform | string): string {
  if (platform === "tiktok") return "TT";
  if (platform === "youtube") return "YT";
  return "IG";
}

function platformColor(platform: SchedulerPlatform | string): string {
  if (platform === "tiktok") return "#d8b4fe";
  if (platform === "youtube") return "#f87171";
  return "#f9a8d4";
}

function policyLabel(status: WarmupPolicyStatus): string {
  if (status === "cold") return "Cold";
  if (status === "warming") return "Warming";
  if (status === "warm") return "Warm";
  return "Automático";
}

function taskLabel(task: PlannerTask): string {
  if (task.status === "running") return "En ejecución";
  if (task.status === "overdue") return "Atrasada";
  if (task.status === "expired") return "Expirada";
  if (task.status === "completed") return "Completada";
  if (task.status === "cancelled") return "Cancelada";
  if (task.status === "error") return "Error";
  return "En cola";
}

function taskStatusClass(status: string): string {
  if (status === "running") return "is-running";
  if (status === "completed") return "is-completed";
  if (status === "overdue") return "is-overdue";
  if (status === "expired" || status === "error") return "is-error";
  if (status === "cancelled") return "is-cancelled";
  return "is-queued";
}

function warmupTaskType(platform: SchedulerPlatform): string {
  if (platform === "tiktok") return "warmup_tiktok";
  if (platform === "youtube") return "warmup_youtube";
  return "warmup_ig";
}

function taskIsWarmup(task: PlannerTask): boolean {
  return task.task_type.startsWith("warmup_");
}

function taskMatchesAccount(task: PlannerTask, account: PlannerAccount): boolean {
  if (task.account_key && task.account_key === account.account_key) return true;
  return Boolean(task.social_account_id && account.social_account_id && task.social_account_id === account.social_account_id);
}

function taskIsEditable(task: PlannerTask): boolean {
  return !["running", "completed", "error", "cancelled"].includes(task.status);
}

export function SchedulerPanel({ token, canManage, onChanged }: SchedulerPanelProps) {
  const initialDate = buenosAiresToday();
  const [date, setDate] = useState(initialDate);
  const [mode, setMode] = useState<PlannerMode>("fixed");
  const [fixedTargetMinutes, setFixedTargetMinutes] = useState(40);
  const [accounts, setAccounts] = useState<PlannerAccount[]>([]);
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [notifications, setNotifications] = useState<PlannerNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [control, setControl] = useState<WorkspaceControl | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [manualAccountKey, setManualAccountKey] = useState("");
  const [manualDateTime, setManualDateTime] = useState(initialDate + "T12:00");
  const [manualDuration, setManualDuration] = useState(20);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState("");

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const queryDate = encodeURIComponent(date);
      const [accountData, taskData, notificationData, controlData] = await Promise.all([
        schedulerRequest<{ accounts?: PlannerAccount[] }>("/api/planner/accounts?date=" + queryDate, token),
        schedulerRequest<{ tasks?: PlannerTask[] }>("/api/planner/tasks?date=" + queryDate, token),
        schedulerRequest<{ notifications?: PlannerNotification[]; unread_count?: number }>("/api/notifications?limit=30", token),
        schedulerRequest<{ control?: WorkspaceControl }>("/api/workspace/control", token),
      ]);
      setAccounts(accountData.accounts || []);
      setTasks(taskData.tasks || []);
      setNotifications(notificationData.notifications || []);
      setUnreadCount(numberValue(notificationData.unread_count));
      setControl(controlData.control || null);
    } catch (cause) {
      if (!(cause instanceof SchedulerApiError && [401, 403].includes(cause.status))) {
        setError(cause instanceof Error ? cause.message : "No se pudo cargar el planner");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [date, token]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(true), 10000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [load]);

  const accountsWithTasks = useMemo(() => accounts.map((account) => {
    const fromAccount = (account.tasks || []).filter(taskIsWarmup);
    const fromTaskList = tasks.filter((task) => taskIsWarmup(task) && taskMatchesAccount(task, account));
    const unique = new Map<number, PlannerTask>();
    [...fromAccount, ...fromTaskList].forEach((task) => unique.set(task.id, { ...task, params: parseParams(task.params) }));
    return { ...account, tasks: [...unique.values()].sort((left, right) => {
      const leftTime = left.scheduled_for ? Date.parse(left.scheduled_for) : Number.MAX_SAFE_INTEGER;
      const rightTime = right.scheduled_for ? Date.parse(right.scheduled_for) : Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime || right.id - left.id;
    }) };
  }), [accounts, tasks]);

  const orderedAccounts = useMemo(() => [...accountsWithTasks].sort((left, right) => {
    const leftWarm = left.policy?.status === "warm" ? 1 : 0;
    const rightWarm = right.policy?.status === "warm" ? 1 : 0;
    if (leftWarm !== rightWarm) return leftWarm - rightWarm;
    const deficitDifference = numberValue(right.today_deficit_sec) - numberValue(left.today_deficit_sec);
    if (deficitDifference) return deficitDifference;
    const leftLast = left.metrics.last_warmup_at ? Date.parse(left.metrics.last_warmup_at) : 0;
    const rightLast = right.metrics.last_warmup_at ? Date.parse(right.metrics.last_warmup_at) : 0;
    return leftLast - rightLast;
  }), [accountsWithTasks]);

  const manualAccounts = useMemo(() => accountsWithTasks.filter((account) => account.device_id), [accountsWithTasks]);
  const selectedManualAccount = manualAccounts.find((account) => account.account_key === manualAccountKey) || manualAccounts[0];
  const automaticAccounts = accountsWithTasks.filter((account) => account.policy?.enabled && account.policy.status !== "warm");
  const totalTarget = automaticAccounts.reduce((sum, account) => sum + numberValue(account.today_target_sec), 0);
  const totalToday = automaticAccounts.reduce((sum, account) => sum + numberValue(account.metrics.today_sec), 0);
  const queuedCount = tasks.filter((task) => ["pending", "running"].includes(task.status)).length;
  const overdueCount = tasks.filter((task) => task.status === "overdue").length;
  const completedAccounts = automaticAccounts.filter((account) => numberValue(account.metrics.today_sec) >= numberValue(account.today_target_sec)).length;

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionBusy(key);
    setError("");
    setMessage("");
    try {
      await action();
      await load(true);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la acción");
    } finally {
      setActionBusy("");
    }
  };

  const changeWorkspaceControl = (key: string, body: Record<string, unknown>, successMessage: string) => void runAction(key, async () => {
    await schedulerRequest("/api/workspace/control", token, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    setMessage(successMessage);
  });

  const pauseGeneral = () => {
    if (!window.confirm("¿Pausar todos los teléfonos? Cada teléfono saldrá de la red social y volverá a SouthFarm. Las tareas quedarán reanudables.")) return;
    void runAction("pause-general", async () => {
      await schedulerRequest("/api/workspace/control/pause-general", token, { method: "POST", body: JSON.stringify({}) });
      setMessage("Pausa general solicitada. Esperando confirmación de cada teléfono…");
    });
  };

  const resumeGeneral = () => void runAction("resume-general", async () => {
    await schedulerRequest("/api/workspace/control/resume", token, { method: "POST", body: JSON.stringify({}) });
    setMessage("Actividades reanudadas. Cada teléfono retomará su tarea pendiente.");
  });

  const generatePlan = () => void runAction("generate", async () => {
    const response = await schedulerRequest<{ created_tasks?: PlannerTask[]; skipped_warm?: number }>("/api/planner/generate", token, {
      method: "POST",
      body: JSON.stringify({
        date,
        mode,
        fixed_target_seconds: Math.round(Math.min(48, Math.max(39, fixedTargetMinutes)) * 60),
      }),
    });
    const created = response.created_tasks?.length || 0;
    const skipped = response.skipped_warm || 0;
    setMessage("Plan generado: " + created + " tareas nuevas" + (skipped ? " · " + skipped + " cuentas Warm excluidas" : ""));
  });

  const recalculatePlan = () => void runAction("recalculate", async () => {
    const response = await schedulerRequest<{ created_tasks?: PlannerTask[]; cancelled_tasks?: number }>("/api/planner/recalculate", token, {
      method: "POST",
      body: JSON.stringify({ date }),
    });
    setMessage("Plan recalculado: " + (response.created_tasks?.length || 0) + " tareas nuevas · " + (response.cancelled_tasks || 0) + " canceladas por política");
  });

  const updatePolicy = (account: PlannerAccount, status: WarmupPolicyStatus) => void runAction("policy-" + account.account_key, async () => {
    const identifier = account.social_account_id || account.id || 0;
    await schedulerRequest("/api/social-accounts/" + identifier + "/warmup-policy", token, {
      method: "PATCH",
      body: JSON.stringify({ status, account_key: account.account_key }),
    });
    await schedulerRequest("/api/planner/recalculate", token, {
      method: "POST",
      body: JSON.stringify({ date }),
    });
    setMessage("Estado de @" + account.account + " actualizado a " + policyLabel(status) + ".");
  });

  const createManualTask = () => void runAction("manual", async () => {
    if (!selectedManualAccount?.device_id) throw new Error("La cuenta elegida no tiene un teléfono asignado");
    const durationMinutes = Math.min(180, Math.max(1, Math.round(numberValue(manualDuration))));
    const body: Record<string, unknown> = {
      task_type: warmupTaskType(selectedManualAccount.platform),
      device_id: selectedManualAccount.device_id,
      scheduled_for: inputToBuenosAiresIso(manualDateTime),
      source: "manual",
      duration_seconds: durationMinutes * 60,
      params: {
        account: selectedManualAccount.account,
        platform: selectedManualAccount.platform,
        duration_minutes: durationMinutes,
        duration_seconds: durationMinutes * 60,
        account_key: selectedManualAccount.account_key,
      },
    };
    if (selectedManualAccount.social_account_id) body.social_account_id = selectedManualAccount.social_account_id;
    await schedulerRequest("/api/tasks/run", token, { method: "POST", body: JSON.stringify(body) });
    setMessage("Tarea manual agregada a la cola de @" + selectedManualAccount.account + ".");
  });

  const startEditing = (task: PlannerTask) => {
    setEditingTaskId(task.id);
    setScheduleDraft(toBuenosAiresInput(task.scheduled_for));
    setError("");
  };

  const saveSchedule = (task: PlannerTask) => void runAction("schedule-" + task.id, async () => {
    await schedulerRequest("/api/tasks/runs/" + task.id + "/schedule", token, {
      method: "PATCH",
      body: JSON.stringify({ scheduled_for: inputToBuenosAiresIso(scheduleDraft), date }),
    });
    setEditingTaskId(null);
    setScheduleDraft("");
    setMessage("Tarea #" + task.id + " movida y marcada como manual prioritaria.");
  });

  const cancelTask = (task: PlannerTask) => {
    if (!window.confirm("¿Cancelar la tarea #" + task.id + "? Esta acción no se revierte desde el panel.")) return;
    void runAction("cancel-" + task.id, async () => {
      await schedulerRequest("/api/tasks/runs/" + task.id + "/stop", token, { method: "PATCH", body: JSON.stringify({}) });
      setMessage("Tarea #" + task.id + " cancelada.");
    });
  };

  const markNotificationRead = (notification: PlannerNotification) => void runAction("notification-" + notification.id, async () => {
    await schedulerRequest("/api/notifications/" + notification.id + "/read", token, { method: "PATCH", body: JSON.stringify({}) });
  });

  const markAllNotificationsRead = () => void runAction("notifications-all", async () => {
    await schedulerRequest("/api/notifications/read-all", token, { method: "PATCH", body: JSON.stringify({}) });
  });

  return (
    <div className="cc-page-stack sf-scheduler">
      <section className="cc-section-intro sf-scheduler-intro">
        <div>
          <p className="cc-eyebrow cc-eyebrow-accent">WARMUP COMMAND CENTER</p>
          <h2>El día, cuenta por cuenta.</h2>
          <p>Planificá entre 12:00 y 22:00 de Buenos Aires y dejá que cada teléfono ejecute una tarea a la vez.</p>
        </div>
        <div className="sf-planner-summary">
          <strong>{completedAccounts}<small>cuentas OK hoy</small></strong>
          <span>/</span>
          <strong>{automaticAccounts.length}<small>en automático</small></strong>
        </div>
      </section>

      <section className="cc-card sf-control-card">
        <div className="cc-card-heading sf-control-heading">
          <div>
            <p className="cc-eyebrow cc-eyebrow-accent">FLEET EXECUTION CONTROL</p>
            <h3>Estado operativo de la flota</h3>
            <p className="cc-card-subtitle">La pausa general guarda el tiempo parcial, saca cada teléfono de la red social y deja las tareas listas para reanudar.</p>
          </div>
          <span className={"sf-control-state sf-control-state-" + (control?.scheduler_mode || "normal")}>
            {control?.scheduler_mode === "paused" ? "Pausa general" : control?.scheduler_mode === "manual_only" ? "Solo manual" : "Normal"}
          </span>
        </div>
        <div className="sf-control-actions">
          <button className={"cc-button " + (control?.scheduler_mode === "normal" && !control.queue_paused ? "cc-button-primary" : "cc-button-ghost")} onClick={() => changeWorkspaceControl("mode-normal", { scheduler_mode: "normal", queue_paused: false }, "Modo normal activado.")} disabled={!canManage || Boolean(actionBusy) || control?.scheduler_mode === "paused"}>Normal</button>
          <button className={"cc-button " + (control?.scheduler_mode === "manual_only" ? "cc-button-primary" : "cc-button-ghost")} onClick={() => changeWorkspaceControl("mode-manual", { scheduler_mode: "manual_only" }, "Modo solo manual activado. Las automáticas quedan retenidas.")} disabled={!canManage || Boolean(actionBusy) || control?.scheduler_mode === "paused"}>Solo manual</button>
          <button className={"cc-button " + (control?.queue_paused ? "cc-button-primary" : "cc-button-ghost")} onClick={() => changeWorkspaceControl("queue-pause", { queue_paused: !control?.queue_paused }, control?.queue_paused ? "Pausa de cola desactivada." : "Pausa de cola activada. Las tareas manuales siguen disponibles.")} disabled={!canManage || Boolean(actionBusy) || control?.scheduler_mode === "paused"}>{control?.queue_paused ? "Reanudar cola" : "Pausa de cola"}</button>
          {control?.scheduler_mode === "paused" ? <button className="cc-button cc-button-primary" onClick={resumeGeneral} disabled={!canManage || Boolean(actionBusy)}>{actionBusy === "resume-general" ? "Reanudando…" : "Reanudar actividades"}<span>↻</span></button> : <button className="cc-button cc-button-danger" onClick={pauseGeneral} disabled={!canManage || Boolean(actionBusy)}>{actionBusy === "pause-general" ? "Pausando…" : "Pausa general"}<span>Ⅱ</span></button>}
        </div>
        {control && <div className="sf-control-devices"><span className="cc-form-caption">CONFIRMACIÓN POR TELÉFONO · VERSIÓN {control.control_version}</span><div className="sf-control-device-list">{control.devices.length ? control.devices.map((device) => <div className="sf-control-device" key={device.id}><span className={"cc-status-dot " + (device.online ? "is-online" : "is-offline")} /><div><strong>{device.display_name}</strong><small>{device.current_task ? "Tarea #" + device.current_task.id + " · " + taskLabel(device.current_task as PlannerTask) : "Sin tarea activa"}</small></div><span className={"sf-device-control-badge sf-device-control-" + device.control_state}>{device.online ? (device.acknowledged ? (control.scheduler_mode === "paused" ? "Pausado" : "Listo") : "Aplicando…") : "Offline"}</span></div>) : <span className="sf-loading-label">No hay teléfonos vinculados.</span>}</div></div>}
      </section>

      <section className="cc-card sf-planner-toolbar">
        <div className="sf-toolbar-field">
          <span className="cc-form-caption">DÍA DEL PLAN</span>
          <input className="cc-filter-input" type="date" value={date} onChange={(event) => { const nextDate = event.target.value; setDate(nextDate); setManualDateTime(nextDate + "T12:00"); }} />
        </div>
        <div className="sf-toolbar-field sf-mode-field">
          <span className="cc-form-caption">DURACIÓN</span>
          <select className="cc-filter-select" value={mode} onChange={(event) => setMode(event.target.value as PlannerMode)}>
            <option value="fixed">MVP fijo · {fixedTargetMinutes} min</option>
            <option value="random">Aleatorio · 39–48 min</option>
          </select>
        </div>
        {mode === "fixed" && <label className="sf-toolbar-field sf-minutes-field"><span className="cc-form-caption">MINUTOS FIJOS</span><input className="cc-filter-input" type="number" min={39} max={48} value={fixedTargetMinutes} onChange={(event) => setFixedTargetMinutes(Math.min(48, Math.max(39, numberValue(event.target.value))))} /></label>}
        <div className="sf-toolbar-actions">
          <button className="cc-button cc-button-primary" onClick={generatePlan} disabled={!canManage || Boolean(actionBusy)}>{actionBusy === "generate" ? "Generando…" : "Generar plan"}<span>↯</span></button>
          <button className="cc-button cc-button-ghost" onClick={recalculatePlan} disabled={!canManage || Boolean(actionBusy)}>{actionBusy === "recalculate" ? "Recalculando…" : "Recalcular"}</button>
        </div>
      </section>

      {(error || message) && <div className={"cc-alert " + (error ? "cc-alert-error" : "sf-success-alert")}><span>{error || message}</span>{error && <button onClick={() => setError("")}>×</button>}</div>}

      <div className="sf-summary-grid">
        <article className="sf-summary-card"><span>OBJETIVO DEL DÍA</span><strong>{formatDuration(totalTarget)}</strong><small>{automaticAccounts.length} cuentas automáticas</small></article>
        <article className="sf-summary-card"><span>ACUMULADO HOY</span><strong>{formatDuration(totalToday)}</strong><small>{completedAccounts} cuentas en rango o superior</small></article>
        <article className="sf-summary-card"><span>COLA</span><strong>{queuedCount}</strong><small>pendientes o ejecutando</small></article>
        <article className={"sf-summary-card " + (overdueCount ? "has-warning" : "")}><span>OVERDUE</span><strong>{overdueCount}</strong><small>{overdueCount ? "requieren seguimiento" : "sin tareas atrasadas"}</small></article>
      </div>

      <div className="sf-planner-layout">
        <section className="cc-card sf-account-panel">
          <div className="cc-card-heading">
            <div><p className="cc-eyebrow">ACCOUNT-FIRST VIEW</p><h3>Estado de cada cuenta</h3><p className="cc-card-subtitle">El contador suma warmups manuales y automáticos completados o parciales.</p></div>
            {loading && <span className="sf-loading-label">Actualizando…</span>}
          </div>
          {orderedAccounts.length ? <div className="sf-account-list">{orderedAccounts.map((account) => {
            const policy = account.policy;
            const actual = numberValue(account.metrics.today_sec);
            const target = numberValue(account.today_target_sec);
            const progress = target ? Math.min(100, Math.round((actual / target) * 100)) : 0;
            return (
              <article className={"sf-account-row " + (policy?.status === "warm" ? "is-warm" : "")} key={account.account_key}>
                <div className="sf-account-heading">
                  <div className="sf-account-identity">
                    <div className="sf-account-avatar" style={{ color: platformColor(account.platform), background: platformColor(account.platform) + "18" }}>{platformShort(account.platform)}</div>
                    <div><strong>@{account.account}</strong><span>{platformLabel(account.platform)} · {account.device_name || account.device_key || "Sin teléfono asignado"}</span></div>
                  </div>
                  <div className="sf-account-policy">
                    <span className={"sf-policy-badge sf-policy-" + (policy?.status || "automatic")}>{policyLabel(policy?.status || "automatic")}</span>
                    <select aria-label={"Estado de warmup de @" + account.account} value={policy?.status || "automatic"} disabled={!canManage || !policy || actionBusy === "policy-" + account.account_key} onChange={(event) => updatePolicy(account, event.target.value as WarmupPolicyStatus)}>
                      <option value="automatic">Automático</option>
                      <option value="cold">Cold</option>
                      <option value="warming">Warming</option>
                      <option value="warm">Warm · excluir</option>
                    </select>
                  </div>
                </div>
                <div className="sf-account-metrics">
                  <div className="sf-today-meter">
                    <div><span>Hoy</span><strong>{formatDuration(actual)} <small>/ {formatDuration(target)}</small></strong></div>
                    <div className="sf-progress-track"><span style={{ width: progress + "%" }} /></div>
                    <small>{actual >= target ? "Objetivo alcanzado; se cancelan excedentes automáticos." : "Faltan " + formatDuration(Math.max(0, target - actual))}</small>
                  </div>
                  <div className="sf-window-metrics"><span><b>{formatDuration(account.metrics.last_24h_sec)}</b><small>24 h</small></span><span><b>{formatDuration(account.metrics.last_7d_sec)}</b><small>7 días</small></span><span><b>{formatDuration(account.metrics.last_30d_sec)}</b><small>30 días</small></span><span><b>{formatDuration(account.metrics.last_6m_sec)}</b><small>6 meses</small></span></div>
                  <div className="sf-last-warmup"><span>Último warmup</span><strong>{formatDateTime(account.metrics.last_warmup_at)}</strong></div>
                </div>
                <div className="sf-account-tasks">
                  <div className="sf-task-heading"><span>TAREAS DEL DÍA</span><small>{(account.tasks || []).length} en agenda · {policy?.min_sessions || 2}–{policy?.max_sessions || 3} sesiones objetivo</small></div>
                  {(account.tasks || []).length ? (account.tasks || []).map((task) => (
                    <div className="sf-task-row" key={task.id}>
                      <div className={"sf-task-status " + taskStatusClass(task.status)}>{task.status === "running" ? "●" : task.status === "completed" ? "✓" : "·"}</div>
                      <div className="sf-task-copy"><strong>{task.source === "manual" ? "Manual" : "Automática"} · {taskLabel(task)}</strong><span>#{task.id} · {formatTime(task.scheduled_for)} · {formatDuration(task.planned_duration_sec)}{task.device_name ? " · " + task.device_name : ""}</span></div>
                      {task.status === "overdue" && <span className="sf-overdue-note">+2 h</span>}
                      <div className="sf-task-actions">
                        {canManage && taskIsEditable(task) && <button className="cc-button cc-button-ghost" onClick={() => startEditing(task)}>Mover</button>}
                        {canManage && !["completed", "cancelled", "error"].includes(task.status) && <button className="cc-button cc-button-danger" onClick={() => cancelTask(task)}>Cancelar</button>}
                      </div>
                      {editingTaskId === task.id && <div className="sf-schedule-editor"><label>Nuevo horario BA<input type="datetime-local" value={scheduleDraft} onChange={(event) => setScheduleDraft(event.target.value)} /></label><button className="cc-button cc-button-primary" onClick={() => saveSchedule(task)} disabled={actionBusy === "schedule-" + task.id}>{actionBusy === "schedule-" + task.id ? "Guardando…" : "Guardar"}</button><button className="cc-button cc-button-ghost" onClick={() => setEditingTaskId(null)}>Cerrar</button></div>}
                    </div>
                  )) : <p className="sf-no-task">Sin tareas automáticas para este día. Si está en Warm, queda excluida del plan.</p>}
                </div>
              </article>
            );
          })}</div> : <div className="sf-empty-planner"><strong>No hay cuentas con política de warmup.</strong><span>Ejecutá un scan desde Fleet o vinculá cuentas para empezar.</span></div>}
        </section>

        <aside className="sf-side-stack">
          <section className="cc-card sf-manual-card">
            <div className="cc-card-heading"><div><p className="cc-eyebrow">MANUAL OVERRIDE</p><h3>Agregar a la cola</h3><p className="cc-card-subtitle">Las tareas manuales tienen prioridad y respetan el bloqueo de una tarea por teléfono.</p></div></div>
            {manualAccounts.length ? <><label className="cc-form-label">CUENTA<select className="cc-filter-select" value={selectedManualAccount?.account_key || manualAccountKey} onChange={(event) => setManualAccountKey(event.target.value)} disabled={!canManage || Boolean(actionBusy)}>{manualAccounts.map((account) => <option key={account.account_key} value={account.account_key}>@{account.account} · {platformShort(account.platform)} · {account.device_name || "teléfono"}</option>)}</select></label><label className="cc-form-label">FECHA Y HORA <span>Buenos Aires · se conserva overdue/36 h</span><input className="cc-filter-input" type="datetime-local" value={manualDateTime} onChange={(event) => setManualDateTime(event.target.value)} disabled={!canManage || Boolean(actionBusy)} /></label><label className="cc-form-label">DURACIÓN <span>minutos planificados</span><input className="cc-filter-input" type="number" min={1} max={180} value={manualDuration} onChange={(event) => setManualDuration(Math.min(180, Math.max(1, numberValue(event.target.value))))} disabled={!canManage || Boolean(actionBusy)} /></label><button className="cc-button cc-button-primary cc-button-wide" onClick={createManualTask} disabled={!canManage || Boolean(actionBusy) || !selectedManualAccount}>{actionBusy === "manual" ? "Agregando…" : "Programar tarea manual"}<span>→</span></button>{!canManage && <p className="sf-permission-note">Tu rol puede consultar el estado, pero no modificar la cola.</p>}</> : <div className="sf-empty-planner"><strong>Sin cuentas asignadas</strong><span>Necesitás una cuenta con teléfono para crear una tarea manual.</span></div>}
          </section>

          <section className="cc-card sf-notifications-card">
            <div className="cc-card-heading"><div><p className="cc-eyebrow">IN-PANEL NOTIFICATIONS</p><h3>Alertas del scheduler</h3></div><div className="sf-notification-heading-actions">{unreadCount > 0 && <span className="sf-unread-count">{unreadCount}</span>}{unreadCount > 0 && <button className="cc-link-button" onClick={markAllNotificationsRead} disabled={Boolean(actionBusy)}>Leer todas</button>}</div></div>
            {notifications.length ? <div className="sf-notification-list">{notifications.slice(0, 8).map((notification) => <div className={"sf-notification " + (notification.read_at ? "" : "is-unread")} key={notification.id}><div><strong>{notification.title}</strong><span>{notification.message}</span><small>{formatDateTime(notification.created_at)}</small></div>{!notification.read_at && <button className="cc-button cc-button-ghost" onClick={() => markNotificationRead(notification)} disabled={Boolean(actionBusy)}>Leer</button>}</div>)}</div> : <div className="sf-empty-planner"><strong>Sin alertas</strong><span>Acá aparecerán tareas expiradas, fallas y eventos importantes.</span></div>}
          </section>
        </aside>
      </div>
    </div>
  );
}
