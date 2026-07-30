"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import QRCode from "qrcode";
import { SchedulerPanel } from "./scheduler-panel";

const API = (process.env.NEXT_PUBLIC_API_URL || "https://api.southfarm.tech").replace(/\/$/, "");

type ApiHealthState = "checking" | "online" | "degraded" | "offline";

interface ApiHealth {
  state: ApiHealthState;
  status?: string;
  checkedAt: string | null;
  timestamp?: string | null;
  latencyMs?: number | null;
  uptimeSeconds?: number | null;
  database?: string | null;
  nodeVersion?: string | null;
  error?: string;
}

const INITIAL_API_HEALTH: ApiHealth = { state: "checking", checkedAt: null };

type Role = "owner" | "admin" | "operator" | "viewer";
type Platform = "instagram" | "tiktok" | "youtube";
type Page = "overview" | "fleet" | "accounts" | "history" | "team" | "settings";
type TaskMode = "warmup" | "scan";

interface User {
  id: number;
  email: string;
  name: string;
  role: Role;
  created_at?: string;
  workspace: { id: number; name: string; owner_user_id: number };
}

interface Device {
  id: number;
  user_id?: number;
  device_id: string;
  device_name: string | null;
  alias?: string | null;
  display_name?: string | null;
  android_version: string | null;
  app_version: string | null;
  last_seen_at: string | null;
  created_at: string;
  online: boolean;
  workspace_id?: number | null;
  installation_id?: string | null;
  lifecycle_status?: "active" | "revoked" | string;
  device_status?: string;
  connection_status?: "online" | "offline" | "never_seen" | string;
  current_task?: {
    id: number;
    task_type: string;
    status: string;
    params?: Record<string, unknown>;
  } | null;
}

interface DevicePairing {
  id: number;
  code: string;
  access_key: string;
  qr_payload: string;
  expires_at: string;
}

interface SocialAccount {
  id: number;
  device_id: number;
  device_key?: string;
  platform: Platform;
  username: string;
  profile_pic_url?: string;
  display_name?: string;
  source_account_name?: string;
  source_account_email?: string;
  byline?: string;
}

interface TaskRun {
  id: number;
  user_id?: number;
  device_id: number;
  task_type: string;
  status: string;
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
}

interface WarmupSession {
  id: number;
  task_run_id?: number | null;
  device_id?: number | null;
  device_name?: string | null;
  account: string;
  platform: Platform;
  duration_minutes: number;
  reels_viewed: number;
  videos_viewed: number;
  shorts_viewed: number;
  likes: number;
  saves: number;
  elapsed_sec: number;
  status: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

interface ScanSession {
  id: number;
  task_run_id?: number | null;
  device_id?: number | null;
  device_name?: string | null;
  platform: Platform;
  status: string;
  accounts_found: number;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface Stats {
  totals: {
    total_sessions: number;
    completed_sessions: number;
    reels_viewed: number;
    videos_viewed: number;
    shorts_viewed: number;
    likes: number;
    saves: number;
    elapsed_sec: number;
  };
  by_platform: Array<Record<string, number | string>>;
  scans: Array<Record<string, number | string>>;
}

interface TeamMember {
  id: number;
  email: string;
  name: string;
  role: Role;
  status: string;
  joined_at?: string;
}

interface Invite {
  id: number;
  email: string | null;
  role: Role;
  expires_at: string;
  token?: string;
  accepted_at?: string | null;
}

const PLATFORMS: Array<{ id: Platform; label: string; short: string; color: string }> = [
  { id: "instagram", label: "Instagram", short: "IG", color: "#f472b6" },
  { id: "tiktok", label: "TikTok", short: "TT", color: "#67e8f9" },
  { id: "youtube", label: "YouTube Shorts", short: "YT", color: "#fb7185" },
];

const PAGES: Array<{ id: Page; label: string; glyph: string }> = [
  { id: "overview", label: "Command center", glyph: "⌂" },
  { id: "fleet", label: "Device fleet", glyph: "▣" },
  { id: "accounts", label: "Warmup planner", glyph: "◎" },
  { id: "history", label: "Activity history", glyph: "◷" },
  { id: "team", label: "Team & roles", glyph: "♙" },
  { id: "settings", label: "Settings", glyph: "⚙" },
];

class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { ...init, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(data.error || "No se pudo completar la solicitud", response.status);
  return data as T;
}

async function checkApiHealth(): Promise<ApiHealth> {
  const startedAt = performance.now();
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${API}/api/health`, {
      cache: "no-store",
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({})) as Record<string, unknown>;
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    const status = typeof data.status === "string" ? data.status : response.ok ? "ok" : "error";

    return {
      state: response.ok && status === "ok" ? "online" : "degraded",
      status,
      checkedAt: new Date().toISOString(),
      timestamp: typeof data.timestamp === "string" ? data.timestamp : null,
      latencyMs,
      uptimeSeconds: numberValue(data.uptime_seconds),
      database: typeof data.database === "string" ? data.database : null,
      nodeVersion: typeof data.node_version === "string" ? data.node_version : null,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  } catch (cause) {
    const message = cause instanceof DOMException && cause.name === "AbortError"
      ? "Tiempo de espera agotado"
      : cause instanceof Error
        ? cause.message
        : "No se pudo alcanzar la API";
    return {
      state: "offline",
      status: "offline",
      checkedAt: new Date().toISOString(),
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      error: message,
    };
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function platformInfo(value: unknown) {
  return PLATFORMS.find((platform) => platform.id === value) || PLATFORMS[0];
}

function taskPlatform(task: TaskRun): Platform {
  const paramPlatform = task.params?.platform;
  if (paramPlatform === "tiktok" || paramPlatform === "youtube" || paramPlatform === "instagram") return paramPlatform;
  if (task.task_type.includes("tiktok")) return "tiktok";
  if (task.task_type.includes("youtube")) return "youtube";
  return "instagram";
}

function relativeDate(value?: string | null): string {
  if (!value) return "sin señal";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "sin fecha";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes}m`;
  if (minutes < 1440) return `hace ${Math.floor(minutes / 60)}h`;
  return new Date(value).toLocaleDateString("es-AR", { day: "2-digit", month: "short" });
}

function fullDate(value?: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toLocaleString("es-AR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";
}

function healthLabel(health: ApiHealth): string {
  if (health.state === "online") return "API operativa";
  if (health.state === "degraded") return "API degradada";
  if (health.state === "offline") return "API sin respuesta";
  return "Verificando API";
}

function healthDetail(health: ApiHealth): string {
  if (health.state === "online") {
    return health.latencyMs === null || health.latencyMs === undefined ? "Ruta pública activa" : `${health.latencyMs} ms · ruta pública activa`;
  }
  if (health.state === "degraded") return health.database === "error" ? "Base de datos con errores" : health.error || "El backend respondió con advertencias";
  if (health.state === "offline") return health.error || "Cloudflare o el backend no responden";
  return "Comprobando navegador → Cloudflare → Windows";
}

function formatUptime(seconds?: number | null): string {
  if (!seconds || seconds < 1) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
    pending: "En cola",
    running: "En ejecución",
    paused: "Pausado",
    completed: "Completado",
    cancelled: "Cancelado",
    error: "Error",
    stopped: "Detenido",
    online: "Online",
    offline: "Offline",
    never_seen: "Nunca conectado",
    revoked: "Revocado",
  };
  return labels[status] || status;
}

function statusClass(status: string): string {
  if (status === "running" || status === "online") return "status-live";
  if (status === "completed") return "status-good";
  if (status === "pending" || status === "paused") return "status-warn";
  if (status === "error") return "status-bad";
  return "status-neutral";
}

function warmupTaskType(platform: Platform): string {
  return platform === "instagram" ? "warmup_ig" : `warmup_${platform}`;
}

function scanTaskType(platform: Platform): string {
  return `scan_${platform}`;
}

function Glyph({ children }: { children: ReactNode }) {
  return <span className="cc-glyph" aria-hidden="true">{children}</span>;
}

function StatusBadge({ status }: { status: string }) {
  return <span className={`cc-status ${statusClass(status)}`}><span className="cc-status-dot" />{statusText(status)}</span>;
}

function PlatformBadge({ platform }: { platform: Platform }) {
  const item = platformInfo(platform);
  return <span className="cc-platform" style={{ color: item.color, borderColor: `${item.color}44`, background: `${item.color}12` }}>{item.short} · {item.label}</span>;
}

function AuthPage({ onAuth }: { onAuth: (token: string, user: User) => void }) {
  const [login, setLogin] = useState(true);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError("");
    setBusy(true);
    try {
      const payload = login
        ? { email, password }
        : { email, password, name, ...(inviteToken.trim() ? { invite_token: inviteToken.trim() } : {}) };
      const result = await request<{ token: string; user: User }>(login ? "/api/auth/login" : "/api/auth/register", undefined, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      onAuth(result.token, result.user);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo iniciar sesión");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="cc-auth-shell">
      <div className="cc-auth-glow cc-auth-glow-one" />
      <div className="cc-auth-glow cc-auth-glow-two" />
      <section className="cc-auth-card">
        <div className="cc-brand-lockup cc-brand-centered">
          <div className="cc-brand-mark">SF</div>
          <div><strong>SouthFarm</strong><small>command center</small></div>
        </div>
        <div className="cc-auth-heading">
          <p className="cc-eyebrow">AGENCY OPERATIONS</p>
          <h1>{login ? "Tomá el control de tu flota." : "Sumate al workspace."}</h1>
          <p>{login ? "Monitoreá celulares, cuentas y actividad desde un solo lugar." : "Creá tu acceso o usá el código de invitación de tu equipo."}</p>
        </div>
        <div className="cc-segmented">
          <button className={login ? "is-selected" : ""} onClick={() => { setLogin(true); setError(""); }}>Ingresar</button>
          <button className={!login ? "is-selected" : ""} onClick={() => { setLogin(false); setError(""); }}>Crear cuenta</button>
        </div>
        <div className="cc-form-stack">
          {!login && <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Tu nombre" /></label>}
          <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vos@agencia.com" /></label>
          <label>Contraseña<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void submit(); }} placeholder="Mínimo 8 caracteres" /></label>
          {!login && <label>Código de invitación <span className="cc-label-hint">opcional</span><input value={inviteToken} onChange={(event) => setInviteToken(event.target.value)} placeholder="Pegá el código del owner" /></label>}
        </div>
        {error && <div className="cc-alert cc-alert-error">{error}</div>}
        <button className="cc-button cc-button-primary cc-button-wide" onClick={() => void submit()} disabled={busy}>{busy ? "Conectando…" : login ? "Entrar al centro" : "Crear acceso"}<span>→</span></button>
        <p className="cc-auth-footnote">La actividad se registra por dispositivo y workspace.</p>
      </section>
    </main>
  );
}

function ApiHealthIndicator({ health, compact = false }: { health: ApiHealth; compact?: boolean }) {
  return <div className={`cc-api-health cc-health-state-${health.state}`} title={healthDetail(health)}><span className="cc-health-dot" /><strong>{healthLabel(health)}</strong>{!compact && <><span>·</span><span>{healthDetail(health)}</span></>}</div>;
}

function Sidebar({ page, user, health, onNavigate, onLogout }: { page: Page; user: User; health: ApiHealth; onNavigate: (next: Page) => void; onLogout: () => void }) {
  return (
    <aside className="cc-sidebar">
      <div className="cc-sidebar-top">
        <div className="cc-brand-lockup"><div className="cc-brand-mark">SF</div><div><strong>SouthFarm</strong><small>command center</small></div></div>
        <div className="cc-workspace-chip"><span className="cc-online-dot" />{user.workspace.name}</div>
      </div>
      <nav className="cc-side-nav">
        <p className="cc-nav-caption">WORKSPACE</p>
        {PAGES.map((item) => (
          <button key={item.id} className={`cc-nav-item ${page === item.id ? "is-active" : ""}`} onClick={() => onNavigate(item.id)}><Glyph>{item.glyph}</Glyph><span>{item.label}</span>{item.id === "team" && (user.role === "owner" || user.role === "admin") && <b>RBAC</b>}</button>
        ))}
      </nav>
      <div className="cc-sidebar-bottom">
        <div className="cc-user-chip"><div className="cc-avatar">{user.name.charAt(0).toUpperCase()}</div><div className="cc-user-copy"><strong>{user.name}</strong><span>{user.role}</span></div><button className="cc-icon-button" title="Cerrar sesión" onClick={onLogout}>↪</button></div>
        <ApiHealthIndicator health={health} />
        <div className="cc-api-endpoint">{API.replace("https://", "")}</div>
      </div>
    </aside>
  );
}

function MobileNav({ page, onNavigate }: { page: Page; onNavigate: (next: Page) => void }) {
  const items = PAGES.slice(0, 5);
  return <nav className="cc-mobile-nav">{items.map((item) => <button key={item.id} className={page === item.id ? "is-active" : ""} onClick={() => onNavigate(item.id)}><Glyph>{item.glyph}</Glyph><span>{item.label.split(" ")[0]}</span></button>)}</nav>;
}

function Topbar({ page, user, health, lastUpdated, busy, onRefresh }: { page: Page; user: User; health: ApiHealth; lastUpdated: string; busy: boolean; onRefresh: () => void }) {
  const title = PAGES.find((item) => item.id === page)?.label || "Command center";
  return <header className="cc-topbar"><div><p className="cc-eyebrow">SOUTHFARM / {user.workspace.name.toUpperCase()}</p><h1>{title}</h1></div><div className="cc-topbar-actions"><ApiHealthIndicator health={health} compact /><span className="cc-last-sync">Actualizado {relativeDate(lastUpdated)}</span><button className="cc-button cc-button-ghost" onClick={onRefresh} disabled={busy}><Glyph>↻</Glyph>{busy ? "Sincronizando" : "Sync"}</button><div className="cc-topbar-avatar">{user.name.charAt(0).toUpperCase()}</div></div></header>;
}

function MetricCard({ label, value, detail, glyph, tone }: { label: string; value: string | number; detail: string; glyph: string; tone: string }) {
  return <article className={`cc-metric cc-tone-${tone}`}><div className="cc-metric-head"><span className="cc-metric-glyph">{glyph}</span><span>{label}</span></div><strong>{value}</strong><small>{detail}</small></article>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="cc-empty"><div className="cc-empty-mark">⌁</div><strong>{title}</strong><span>{detail}</span></div>;
}

function HealthPanel({ health }: { health: ApiHealth }) {
  return <section className={`cc-card cc-health-panel cc-health-${health.state}`}>
    <div className="cc-health-panel-heading"><div><p className="cc-eyebrow cc-eyebrow-accent">SYSTEM HEALTH</p><h3>Ruta pública del centro</h3><p>Browser → Cloudflare → Windows backend → SQLite</p></div><div className="cc-health-status"><span className="cc-health-dot" /><div><strong>{healthLabel(health)}</strong><small>{healthDetail(health)}</small></div></div></div>
    <div className="cc-health-facts"><div><span>Último check</span><strong>{health.checkedAt ? fullDate(health.checkedAt) : "—"}</strong></div><div><span>Latencia</span><strong>{health.latencyMs === null || health.latencyMs === undefined ? "—" : `${health.latencyMs} ms`}</strong></div><div><span>Base de datos</span><strong>{health.database || "—"}</strong></div><div><span>Uptime backend</span><strong>{formatUptime(health.uptimeSeconds)}</strong></div></div>
  </section>;
}

function DashboardPage({ devices, accounts, runs, sessions, scans, stats, health, onNavigate }: { devices: Device[]; accounts: SocialAccount[]; runs: TaskRun[]; sessions: WarmupSession[]; scans: ScanSession[]; stats: Stats; health: ApiHealth; onNavigate: (page: Page) => void }) {
  const online = devices.filter((device) => device.online).length;
  const activeRuns = runs.filter((run) => ["pending", "running", "paused"].includes(run.status));
  const totals = stats.totals || { total_sessions: sessions.length, reels_viewed: 0, likes: 0, saves: 0, elapsed_sec: 0, completed_sessions: 0, videos_viewed: 0, shorts_viewed: 0 };
  const platformRows = PLATFORMS.map((platform) => ({ platform, accounts: accounts.filter((account) => account.platform === platform.id).length, sessions: sessions.filter((session) => session.platform === platform.id).length }));

  return <div className="cc-page-stack">
    <section className="cc-hero"><div><p className="cc-eyebrow cc-eyebrow-accent">LIVE OPERATIONS</p><h2>Buen día. Esta es tu <em>señal de mando.</em></h2><p>Monitoreá la salud de la flota y mantené los warmups en movimiento.</p></div><div className="cc-hero-orbit"><span /><span /><span /><strong>{online}</strong><small>devices<br />online</small></div></section>
    <HealthPanel health={health} />
    <div className="cc-kpi-grid"><MetricCard label="Dispositivos online" value={`${online}/${devices.length}`} detail={online === devices.length && devices.length ? "Flota operativa" : "Revisar conexión"} glyph="◉" tone="green" /><MetricCard label="Tareas activas" value={activeRuns.length} detail={activeRuns.length ? "Comandos en curso" : "Sin tareas pendientes"} glyph="↯" tone="blue" /><MetricCard label="Warmups registrados" value={totals.total_sessions} detail={`${totals.completed_sessions || 0} completados`} glyph="◌" tone="orange" /><MetricCard label="Cuentas detectadas" value={accounts.length} detail={`${scans.length} scans registrados`} glyph="◎" tone="purple" /></div>
    <div className="cc-two-column">
      <section className="cc-card cc-card-tall"><div className="cc-card-heading"><div><p className="cc-eyebrow">COMMAND QUEUE</p><h3>Actividad en vivo</h3></div><button className="cc-link-button" onClick={() => onNavigate("fleet")}>Ver flota →</button></div>{activeRuns.length ? <div className="cc-operation-list">{activeRuns.slice(0, 5).map((run) => <OperationRow key={run.id} run={run} device={devices.find((device) => device.id === run.device_id)} />)}</div> : <EmptyState title="No hay comandos activos" detail="Lanzá un warmup o scan desde la flota." />}</section>
      <section className="cc-card cc-card-tall"><div className="cc-card-heading"><div><p className="cc-eyebrow">PLATFORM PULSE</p><h3>Distribución por red</h3></div><button className="cc-link-button" onClick={() => onNavigate("accounts")}>Cuentas →</button></div><div className="cc-platform-list">{platformRows.map(({ platform, accounts: accountCount, sessions: sessionCount }) => <div className="cc-platform-row" key={platform.id}><div className="cc-platform-row-title"><PlatformBadge platform={platform.id} /><span>{accountCount} cuentas</span></div><div className="cc-bar-track"><span style={{ width: `${Math.min(100, Math.max(8, accountCount * 16))}%`, background: platform.color }} /></div><small>{sessionCount} warmups</small></div>)}</div><div className="cc-mini-summary"><div><strong>{numberValue(totals.videos_viewed || totals.reels_viewed)}</strong><span>videos vistos</span></div><div><strong>{numberValue(totals.likes)}</strong><span>likes</span></div><div><strong>{numberValue(totals.saves)}</strong><span>saves</span></div></div></section>
    </div>
    <div className="cc-two-column">
      <section className="cc-card"><div className="cc-card-heading"><div><p className="cc-eyebrow">RECENT WARMUPS</p><h3>Última actividad</h3></div><button className="cc-link-button" onClick={() => onNavigate("history")}>Historial →</button></div>{sessions.length ? <div className="cc-compact-list">{sessions.slice(0, 5).map((session) => <div className="cc-compact-row" key={session.id}><div className="cc-row-icon" style={{ color: platformInfo(session.platform).color }}>{platformInfo(session.platform).short}</div><div className="cc-row-copy"><strong>@{session.account || "sin cuenta"}</strong><span>{platformInfo(session.platform).label} · {relativeDate(session.timestamp)}</span></div><div className="cc-row-metric"><strong>{numberValue(session.videos_viewed || session.reels_viewed)}</strong><span>videos</span></div><StatusBadge status={session.status} /></div>)}</div> : <EmptyState title="Todavía no hay warmups" detail="El historial va a aparecer acá." />}</section>
      <section className="cc-card"><div className="cc-card-heading"><div><p className="cc-eyebrow">SCAN LOG</p><h3>Últimos scans</h3></div><button className="cc-link-button" onClick={() => onNavigate("history")}>Ver todos →</button></div>{scans.length ? <div className="cc-compact-list">{scans.slice(0, 5).map((scan) => <div className="cc-compact-row" key={scan.id}><div className="cc-row-icon" style={{ color: platformInfo(scan.platform).color }}>⌕</div><div className="cc-row-copy"><strong>{platformInfo(scan.platform).label}</strong><span>{scan.device_name || "Dispositivo"} · {relativeDate(scan.completed_at || scan.created_at)}</span></div><div className="cc-row-metric"><strong>{numberValue(scan.accounts_found)}</strong><span>cuentas</span></div><StatusBadge status={scan.status} /></div>)}</div> : <EmptyState title="No hay scans registrados" detail="Los scans remotos aparecerán acá." />}</section>
    </div>
  </div>;
}

function OperationRow({ run, device }: { run: TaskRun; device?: Device }) {
  const platform = taskPlatform(run);
  const isScan = run.task_type.startsWith("scan_");
  return <div className="cc-operation-row"><div className="cc-operation-icon" style={{ color: platformInfo(platform).color }}>{isScan ? "⌕" : "↯"}</div><div className="cc-row-copy"><strong>{isScan ? "Scan" : "Warmup"} · {platformInfo(platform).label}</strong><span>{device?.device_name || device?.device_id || "Dispositivo"} · #{run.id}</span></div><StatusBadge status={run.status} /></div>;
}

function TaskLauncher({ device, accounts, activeRun, token, onChanged, canRunTasks }: { device: Device; accounts: SocialAccount[]; activeRun?: TaskRun; token: string; onChanged: () => void; canRunTasks: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<TaskMode>("warmup");
  const [platform, setPlatform] = useState<Platform>("instagram");
  const [account, setAccount] = useState("");
  const [duration, setDuration] = useState("2");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
    const platformAccounts = accounts.filter((item) => item.device_id === device.id && item.platform === platform);
  const selectedAccount = platformAccounts.find((item) => item.username === account)?.username || platformAccounts[0]?.username || "";

  const control = async (action: "pause" | "resume" | "stop") => {
    if (!activeRun) return;
    setBusy(true);
    setMessage("");
    try {
      await request(`/api/tasks/runs/${activeRun.id}/${action}`, token, { method: "PATCH" });
      onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo actualizar la tarea");
    } finally {
      setBusy(false);
    }
  };

  const launch = async () => {
    if (mode === "warmup" && !selectedAccount.trim()) { setMessage("No hay una cuenta escaneada para esta plataforma en este dispositivo."); return; }
    setBusy(true);
    setMessage("");
    try {
      const taskType = mode === "warmup" ? warmupTaskType(platform) : scanTaskType(platform);
      const params = mode === "warmup" ? { platform, account: selectedAccount.trim().replace(/^@+/, ""), duration_minutes: Number(duration) } : { platform };
      await request("/api/tasks/run", token, { method: "POST", body: JSON.stringify({ device_id: device.id, task_type: taskType, params }) });
      setOpen(false);
      setMessage("Comando enviado");
      onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo enviar el comando");
    } finally {
      setBusy(false);
    }
  };

  if (!canRunTasks) return <div className="cc-device-idle"><span>{activeRun ? "Tarea activa · solo lectura" : "Solo lectura"}</span>{activeRun && <StatusBadge status={activeRun.status} />}</div>;
  return <div className="cc-launcher"><button className={`cc-button ${activeRun ? "cc-button-muted" : "cc-button-primary"} cc-button-wide`} onClick={() => setOpen((value) => !value)} disabled={!!activeRun && activeRun.status === "running"}><span>{activeRun ? "↯" : "＋"}</span>{activeRun ? "Tarea activa" : "Lanzar comando"}<span className="cc-button-caret">{open ? "⌃" : "⌄"}</span></button>{activeRun && <div className="cc-active-controls"><div className="cc-active-summary"><StatusBadge status={activeRun.status} /><span>{activeRun.task_type.startsWith("scan_") ? "Scan" : "Warmup"} · {platformInfo(taskPlatform(activeRun)).label}</span></div><div className="cc-control-row">{activeRun.status === "paused" ? <button onClick={() => void control("resume")} disabled={busy}>Continuar</button> : <button onClick={() => void control("pause")} disabled={busy}>Pausar</button>}<button className="is-danger" onClick={() => void control("stop")} disabled={busy}>Detener</button></div></div>}{open && !activeRun && <div className="cc-launch-panel"><div className="cc-mode-toggle"><button className={mode === "warmup" ? "is-selected" : ""} onClick={() => setMode("warmup")}>Warmup</button><button className={mode === "scan" ? "is-selected" : ""} onClick={() => setMode("scan")}>Scan</button></div><label>Plataforma<select value={platform} onChange={(event) => setPlatform(event.target.value as Platform)}>{PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{mode === "warmup" && <><label>Cuenta<select value={selectedAccount} onChange={(event) => setAccount(event.target.value)} disabled={!platformAccounts.length}><option value="">{platformAccounts.length ? "Seleccionar cuenta…" : "Sin cuentas escaneadas"}</option>{platformAccounts.map((item) => <option key={item.id} value={item.username}>@{item.username}</option>)}</select>{!platformAccounts.length && <small className="cc-launch-hint">Escaneá esta plataforma en este dispositivo para habilitar el warmup.</small>}</label><label>Duración<select value={duration} onChange={(event) => setDuration(event.target.value)}><option value="2">2 minutos</option><option value="5">5 minutos</option><option value="10">10 minutos</option><option value="20">20 minutos</option></select></label></>}<button className="cc-button cc-button-primary cc-button-wide" onClick={() => void launch()} disabled={busy || (mode === "warmup" && !selectedAccount)}>{busy ? "Enviando…" : mode === "warmup" ? "Iniciar warmup" : "Iniciar scan"}<span>→</span></button></div>}{message && <p className={`cc-inline-message ${message.includes("Error") || message.includes("No se") ? "is-error" : ""}`}>{message}</p>}</div>;
}

function DevicePairingCard({ token, canManage }: { token: string; canManage: boolean }) {
  const [pairing, setPairing] = useState<DevicePairing | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!pairing) return;
    let cancelled = false;
    void QRCode.toDataURL(pairing.qr_payload, {
      width: 280,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#08110b", light: "#f5fff7" },
    }).then((value) => {
      if (!cancelled) setQrDataUrl(value);
    }).catch(() => {
      if (!cancelled) setQrDataUrl("");
    });
    return () => { cancelled = true; };
  }, [pairing]);

  const createPairing = async () => {
    setBusy(true);
    setMessage("");
    try {
      const data = await request<{ pairing: DevicePairing }>("/api/devices/pairing-codes", token, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setPairing(data.pairing);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudo generar la vinculación");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard?.writeText(value);
    setMessage("Copiado al portapapeles");
  };

  const closePairing = () => {
    setPairing(null);
    setMessage("");
    setOpen(false);
  };

  if (canManage && !open) return <section className="cc-card cc-pairing-card cc-pairing-collapsed"><button className="cc-button cc-button-primary" onClick={() => setOpen(true)}><span><b>Vincular un celular</b><small>Generar código temporal o QR</small></span><span>＋</span></button></section>;

  return <section className="cc-card cc-pairing-card"><div className="cc-card-heading"><div><p className="cc-eyebrow cc-eyebrow-accent">SECURE ENROLLMENT</p><h3>Vincular un celular</h3><p className="cc-card-subtitle">Generá una credencial de un solo uso para registrar una nueva instalación en este workspace.</p></div><div className="cc-device-header-actions"><span className="cc-danger-mark">⌁</span>{canManage && <button className="cc-pairing-close" title="Cerrar vinculación" aria-label="Cerrar vinculación" onClick={closePairing}>×</button>}</div></div>{canManage ? <><div className="cc-pairing-actions"><button className="cc-button cc-button-primary" onClick={() => void createPairing()} disabled={busy}>{busy ? "Generando…" : pairing ? "Generar otro código" : "Generar código temporal"}<span>＋</span></button>{pairing && <span className="cc-pairing-expiry">Vence {fullDate(pairing.expires_at)}</span>}</div>{pairing && <div className="cc-pairing-result">{qrDataUrl && <div className="cc-pairing-qr"><img src={qrDataUrl} alt="QR temporal para vincular el celular" /><span>Escanealo desde SouthFarm</span></div>}<div className="cc-pairing-credentials"><div><span>CÓDIGO TEMPORAL</span><strong>{pairing.code}</strong><button className="cc-button cc-button-ghost" onClick={() => void copy(pairing.code)}>Copiar</button></div><div><span>LLAVE DE ACCESO</span><code>{pairing.access_key}</code><button className="cc-button cc-button-ghost" onClick={() => void copy(pairing.access_key)}>Copiar</button></div><small>El código y la llave se guardan con hash en el backend y solo sirven una vez.</small></div></div>}{message && <p className="cc-inline-message">{message}</p>}</> : <p className="cc-card-subtitle">Solo owner y admin pueden vincular nuevos celulares.</p>}</section>;
}

function DeviceCard({ device, accounts, activeRun, token, onChanged, canManage, canRunTasks, onRevoke }: { device: Device; accounts: SocialAccount[]; activeRun?: TaskRun; token: string; onChanged: () => void; canManage: boolean; canRunTasks: boolean; onRevoke: (id: number) => void }) {
  const deviceAccounts = accounts.filter((account) => account.device_id === device.id);
  const connectionStatus = device.connection_status || (device.online ? "online" : "offline");
  const [editingAlias, setEditingAlias] = useState(false);
  const [aliasDraft, setAliasDraft] = useState(device.alias || "");
  const [savingAlias, setSavingAlias] = useState(false);
  const [aliasError, setAliasError] = useState("");

  const saveAlias = async () => {
    setSavingAlias(true);
    setAliasError("");
    try {
      await request(`/api/devices/${device.id}`, token, {
        method: "PATCH",
        body: JSON.stringify({ alias: aliasDraft.trim() || null }),
      });
      setEditingAlias(false);
      onChanged();
    } catch (cause) {
      setAliasError(cause instanceof Error ? cause.message : "No se pudo guardar el alias");
    } finally {
      setSavingAlias(false);
    }
  };

  const displayName = device.alias || device.device_name || "Android device";
  return <article className={`cc-device-card ${device.online ? "is-online" : "is-offline"}`}><div className="cc-device-header"><div className={`cc-device-icon ${device.online ? "is-online" : ""}`}>▯</div><div className="cc-device-title"><div className="cc-device-name-row">{editingAlias ? <input className="cc-device-alias-input" value={aliasDraft} maxLength={40} autoFocus onChange={(event) => setAliasDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void saveAlias(); if (event.key === "Escape") setEditingAlias(false); }} aria-label="Alias del dispositivo" /> : <h3>{displayName}</h3>}{canManage && !editingAlias && <button className="cc-device-edit" title="Editar alias" onClick={() => { setAliasDraft(device.alias || ""); setAliasError(""); setEditingAlias(true); }}>✎</button>}<StatusBadge status={connectionStatus} /></div><span>{device.alias ? `${device.device_name || "Android device"} · ` : ""}{device.device_id}</span></div><div className="cc-device-header-actions"><button className="cc-icon-button" title="Copiar identificador" onClick={() => void navigator.clipboard?.writeText(device.device_id)}>⋯</button>{canManage && <button className="cc-icon-button cc-icon-danger" title="Revocar dispositivo" onClick={() => onRevoke(device.id)}>⌫</button>}</div></div>{editingAlias && <div className="cc-device-alias-actions"><button className="cc-button cc-button-primary" onClick={() => void saveAlias()} disabled={savingAlias}>{savingAlias ? "Guardando…" : "Guardar alias"}</button><button className="cc-button cc-button-ghost" onClick={() => setEditingAlias(false)} disabled={savingAlias}>Cancelar</button></div>}{aliasError && <p className="cc-inline-message is-error">{aliasError}</p>}<div className="cc-device-meta"><span><b>Android</b> {device.android_version || "—"}</span><span><b>App</b> {device.app_version || "—"}</span><span><b>Registro</b> #{device.id}</span><span><b>Señal</b> {relativeDate(device.last_seen_at)}</span></div><div className="cc-device-account-strip"><span>{deviceAccounts.length} cuentas vinculadas</span><div className="cc-avatar-stack">{PLATFORMS.map((platform) => <i key={platform.id} style={{ background: platform.color }} title={platform.label}>{deviceAccounts.filter((account) => account.platform === platform.id).length || "·"}</i>)}</div></div><TaskLauncher device={device} accounts={accounts} activeRun={activeRun} token={token} onChanged={onChanged} canRunTasks={canRunTasks} /></article>;
}

function FleetPage({ devices, accounts, runs, token, onChanged, canManageDevices, canRunTasks }: { devices: Device[]; accounts: SocialAccount[]; runs: TaskRun[]; token: string; onChanged: () => void; canManageDevices: boolean; canRunTasks: boolean }) {
  const revoke = async (id: number) => {
    if (!window.confirm("¿Revocar este celular? Dejará de aparecer en la flota y deberá vincularse nuevamente.")) return;
    try {
      await request(`/api/devices/${id}`, token, { method: "DELETE" });
      onChanged();
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : "No se pudo revocar el dispositivo");
    }
  };
  return <div className="cc-page-stack"><section className="cc-section-intro"><div><p className="cc-eyebrow cc-eyebrow-accent">DEVICE CONTROL</p><h2>Tu flota, a la vista.</h2><p>La conexión y la ejecución se muestran como estados independientes.</p></div><div className="cc-intro-stats"><strong>{devices.filter((device) => device.online).length}<small>online</small></strong><span>/</span><strong>{devices.length}<small>activos</small></strong></div></section><DevicePairingCard token={token} canManage={canManageDevices} />{devices.length ? <div className="cc-device-grid">{devices.map((device) => <DeviceCard key={device.id} device={device} accounts={accounts} activeRun={runs.find((run) => run.device_id === device.id && ["pending", "running", "paused"].includes(run.status))} token={token} onChanged={onChanged} canManage={canManageDevices} canRunTasks={canRunTasks} onRevoke={(id) => void revoke(id)} />)}</div> : <section className="cc-card"><EmptyState title="No hay dispositivos registrados" detail="Vinculá un Android para que aparezca acá." /></section>}</div>;
}

function AccountsInventory({ accounts, devices }: { accounts: SocialAccount[]; devices: Device[] }) {
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const [search, setSearch] = useState("");
  const visible = accounts.filter((account) => (platform === "all" || account.platform === platform) && account.username.toLowerCase().includes(search.toLowerCase()));
  return <div className="cc-page-stack"><section className="cc-section-intro"><div><p className="cc-eyebrow cc-eyebrow-accent">ACCOUNT INVENTORY</p><h2>Todas tus identidades sociales.</h2><p>La última fotografía de cuentas detectadas en los teléfonos.</p></div><div className="cc-intro-stats"><strong>{accounts.length}<small>cuentas</small></strong></div></section><section className="cc-card"><div className="cc-filter-row"><div className="cc-segmented cc-segmented-small"><button className={platform === "all" ? "is-selected" : ""} onClick={() => setPlatform("all")}>Todas</button>{PLATFORMS.map((item) => <button key={item.id} className={platform === item.id ? "is-selected" : ""} onClick={() => setPlatform(item.id)}>{item.short}</button>)}</div><input className="cc-filter-input" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar usuario…" /></div>{visible.length ? <div className="cc-account-grid">{visible.map((account) => <article className="cc-account-card" key={account.id}><div className="cc-account-avatar" style={{ color: platformInfo(account.platform).color, background: `${platformInfo(account.platform).color}15` }}>{account.username.charAt(0).toUpperCase()}</div><div className="cc-account-main"><div className="cc-account-top"><strong>@{account.username}</strong><PlatformBadge platform={account.platform} /></div><span>{account.display_name || account.byline || "Sin nombre público"}</span><small>{devices.find((device) => device.id === account.device_id)?.device_name || "Dispositivo sin nombre"}</small></div></article>)}</div> : <EmptyState title="No hay cuentas para este filtro" detail="Ejecutá un scan desde la flota para descubrirlas." />}</section></div>;
}

function AccountsPage({ accounts, devices, token, onChanged, canManage }: { accounts: SocialAccount[]; devices: Device[]; token: string; onChanged: () => void; canManage: boolean }) {
  const [cleanPlatforms, setCleanPlatforms] = useState<Platform[]>(["instagram"]);
  const [deviceScope, setDeviceScope] = useState("all");
  const [cleaning, setCleaning] = useState(false);
  const [message, setMessage] = useState("");
  const togglePlatform = (next: Platform) => setCleanPlatforms((current) => current.includes(next) ? current.filter((item) => item !== next) : [...current, next]);
  const cleanAccounts = async () => {
    if (!cleanPlatforms.length) return;
    const scopeLabel = deviceScope === "all" ? "todos los dispositivos" : "el dispositivo seleccionado";
    if (!window.confirm(`¿Limpiar las cuentas de ${cleanPlatforms.length} plataforma(s) en ${scopeLabel}? El historial no se borra.`)) return;
    setCleaning(true); setMessage("");
    try {
      const body: { platforms: Platform[]; device_id?: string } = { platforms: cleanPlatforms };
      if (deviceScope !== "all") body.device_id = deviceScope;
      const result = await request<{ total: number }>("/api/social-accounts", token, { method: "DELETE", body: JSON.stringify(body) });
      setMessage(`Se limpiaron ${result.total} registros. El historial de scans quedó preservado.`);
      onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "No se pudieron limpiar las cuentas");
    } finally {
      setCleaning(false);
    }
  };
  return <div className="cc-page-stack"><SchedulerPanel token={token} canManage={canManage} onChanged={onChanged} /><AccountsInventory accounts={accounts} devices={devices} /><section className="cc-card cc-clean-card"><div className="cc-card-heading"><div><p className="cc-eyebrow">INVENTORY RESET</p><h3>Clean accounts</h3><p className="cc-card-subtitle">Borra las cuentas escaneadas seleccionadas; no borra el historial de scans ni warmups.</p></div><span className="cc-danger-mark">⌫</span></div><div className="cc-clean-grid"><div><span className="cc-form-caption">PLATAFORMAS</span><div className="cc-clean-platforms">{PLATFORMS.map((item) => <button key={item.id} className={cleanPlatforms.includes(item.id) ? "is-selected" : ""} onClick={() => togglePlatform(item.id)}>{item.label}</button>)}<button className={cleanPlatforms.length === PLATFORMS.length ? "is-selected" : ""} onClick={() => setCleanPlatforms(PLATFORMS.map((item) => item.id))}>Todas</button></div></div><label className="cc-form-label">DISPOSITIVO<select className="cc-filter-select" value={deviceScope} onChange={(event) => setDeviceScope(event.target.value)}><option value="all">Todos los dispositivos</option>{devices.map((device) => <option key={device.device_id} value={device.device_id}>{device.device_name || device.device_id}</option>)}</select></label></div><div className="cc-clean-footer"><span>{cleanPlatforms.length ? `${cleanPlatforms.length} plataforma${cleanPlatforms.length === 1 ? "" : "s"} seleccionada${cleanPlatforms.length === 1 ? "" : "s"}` : "Seleccioná al menos una plataforma"}</span><button className="cc-button cc-button-danger" onClick={() => void cleanAccounts()} disabled={cleaning || !cleanPlatforms.length}>{cleaning ? "Limpiando…" : "Clean selected accounts"}<span>⌫</span></button></div>{message && <p className="cc-inline-message">{message}</p>}</section></div>;
}

function HistoryPage({ sessions, scans }: { sessions: WarmupSession[]; scans: ScanSession[] }) {
  const [tab, setTab] = useState<"warmups" | "scans">("warmups");
  const [platform, setPlatform] = useState<Platform | "all">("all");
  const warmups = sessions.filter((session) => platform === "all" || session.platform === platform);
  const visibleScans = scans.filter((scan) => platform === "all" || scan.platform === platform);
  const totalVideos = sessions.reduce((sum, session) => sum + numberValue(session.videos_viewed || session.reels_viewed), 0);
  const totalLikes = sessions.reduce((sum, session) => sum + numberValue(session.likes), 0);
  return <div className="cc-page-stack"><section className="cc-section-intro"><div><p className="cc-eyebrow cc-eyebrow-accent">AUDIT TRAIL</p><h2>Todo lo que pasó, registrado.</h2><p>Historial de warmups y scans por plataforma, cuenta y dispositivo.</p></div><div className="cc-intro-stats"><strong>{totalVideos}<small>videos</small></strong><strong>{totalLikes}<small>likes</small></strong></div></section><section className="cc-card"><div className="cc-history-toolbar"><div className="cc-segmented cc-segmented-small"><button className={tab === "warmups" ? "is-selected" : ""} onClick={() => setTab("warmups")}>Warmups <b>{warmups.length}</b></button><button className={tab === "scans" ? "is-selected" : ""} onClick={() => setTab("scans")}>Scans <b>{visibleScans.length}</b></button></div><select className="cc-filter-select" value={platform} onChange={(event) => setPlatform(event.target.value as Platform | "all")}><option value="all">Todas las plataformas</option>{PLATFORMS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>{tab === "warmups" ? <HistoryWarmups sessions={warmups} /> : <HistoryScans scans={visibleScans} />}</section></div>;
}

function HistoryWarmups({ sessions }: { sessions: WarmupSession[] }) {
  if (!sessions.length) return <EmptyState title="Sin warmups todavía" detail="Cuando un teléfono termine una sesión, la vas a ver acá." />;
  return <div className="cc-history-list">{sessions.map((session) => <div className="cc-history-row" key={session.id}><div className="cc-history-symbol" style={{ color: platformInfo(session.platform).color }}>{platformInfo(session.platform).short}</div><div className="cc-history-main"><div><strong>@{session.account || "sin cuenta"}</strong><PlatformBadge platform={session.platform} /></div><span>{session.device_name || "Dispositivo"} · {fullDate(session.timestamp)}</span></div><div className="cc-history-metrics"><span><b>{numberValue(session.videos_viewed || session.reels_viewed)}</b> videos</span><span><b>{numberValue(session.likes)}</b> likes</span><span><b>{numberValue(session.saves)}</b> saves</span></div><StatusBadge status={session.status} /></div>)}</div>;
}

function HistoryScans({ scans }: { scans: ScanSession[] }) {
  if (!scans.length) return <EmptyState title="Sin scans todavía" detail="Lanzá un scan desde un dispositivo conectado." />;
  return <div className="cc-history-list">{scans.map((scan) => <div className="cc-history-row" key={scan.id}><div className="cc-history-symbol" style={{ color: platformInfo(scan.platform).color }}>⌕</div><div className="cc-history-main"><div><strong>{platformInfo(scan.platform).label}</strong><PlatformBadge platform={scan.platform} /></div><span>{scan.device_name || "Dispositivo"} · {fullDate(scan.completed_at || scan.created_at)}</span></div><div className="cc-history-metrics"><span><b>{numberValue(scan.accounts_found)}</b> cuentas</span><span><b>#{scan.id}</b> scan</span></div><StatusBadge status={scan.status} /></div>)}</div>;
}

function TeamPage({ user, token, members, onChanged }: { user: User; token: string; members: TeamMember[]; onChanged: () => void }) {
  const canManage = user.role === "owner" || user.role === "admin";
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Exclude<Role, "owner">>("operator");
  const [invite, setInvite] = useState<Invite | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const createInvite = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await request<{ invite: Invite }>("/api/team/invites", token, { method: "POST", body: JSON.stringify({ email: email.trim() || undefined, role, expires_in_days: 7 }) });
      setInvite(result.invite); setEmail("");
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "No se pudo crear la invitación"); } finally { setBusy(false); }
  };
  const changeRole = async (member: TeamMember, nextRole: Role) => {
    if (member.role === "owner" || nextRole === "owner") return;
    try { await request(`/api/team/members/${member.id}`, token, { method: "PATCH", body: JSON.stringify({ role: nextRole }) }); onChanged(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "No se pudo actualizar el rol"); }
  };
  return <div className="cc-page-stack"><section className="cc-section-intro"><div><p className="cc-eyebrow cc-eyebrow-accent">ACCESS CONTROL</p><h2>Un equipo, distintos permisos.</h2><p>Supervisá quién puede mirar, operar o administrar tu workspace.</p></div><div className="cc-intro-stats"><strong>{members.length}<small>miembros</small></strong></div></section><div className="cc-two-column cc-team-layout"><section className="cc-card"><div className="cc-card-heading"><div><p className="cc-eyebrow">WORKSPACE MEMBERS</p><h3>Miembros activos</h3></div><span className="cc-role-note">Tu rol: {user.role}</span></div><div className="cc-team-list">{members.map((member) => <div className="cc-team-row" key={member.id}><div className="cc-avatar">{member.name.charAt(0).toUpperCase()}</div><div className="cc-row-copy"><strong>{member.name}{member.id === user.id && <small> · vos</small>}</strong><span>{member.email}</span></div>{canManage && member.role !== "owner" ? <select className="cc-role-select" value={member.role} onChange={(event) => void changeRole(member, event.target.value as Role)}><option value="admin" disabled={user.role !== "owner"}>admin</option><option value="operator">operator</option><option value="viewer">viewer</option></select> : <span className={`cc-role-pill role-${member.role}`}>{member.role}</span>}<span className={`cc-member-status ${member.status !== "active" ? "is-disabled" : ""}`}>{member.status === "active" ? "activo" : "pausado"}</span></div>)}</div></section><section className="cc-card"><div className="cc-card-heading"><div><p className="cc-eyebrow">INVITATIONS</p><h3>Sumar una persona</h3></div></div>{canManage ? <><label className="cc-form-label">Email <span>opcional si compartís el código</span><input className="cc-filter-input cc-input-wide" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="equipo@agencia.com" /></label><label className="cc-form-label">Permiso<select className="cc-filter-select cc-input-wide" value={role} onChange={(event) => setRole(event.target.value as Exclude<Role, "owner">)}><option value="operator">operator · puede operar dispositivos</option><option value="viewer">viewer · solo lectura</option><option value="admin" disabled={user.role !== "owner"}>admin · gestiona el equipo</option></select></label><button className="cc-button cc-button-primary cc-button-wide" onClick={() => void createInvite()} disabled={busy}>{busy ? "Creando…" : "Generar invitación"}<span>→</span></button>{invite && <div className="cc-invite-result"><span>Código listo · vence {fullDate(invite.expires_at)}</span><code>{invite.token}</code><button className="cc-button cc-button-ghost cc-button-wide" onClick={() => void navigator.clipboard?.writeText(invite.token || "")}>Copiar código</button></div>}{message && <p className="cc-inline-message is-error">{message}</p>}</> : <EmptyState title="Vista de solo lectura" detail="Pedile al owner que te otorgue permisos de administración." />}</section></div></div>;
}

function SettingsPage({ user, health, onLogout }: { user: User; health: ApiHealth; onLogout: () => void }) {
  return <div className="cc-page-stack"><section className="cc-section-intro"><div><p className="cc-eyebrow cc-eyebrow-accent">WORKSPACE SETTINGS</p><h2>Configuración del centro.</h2><p>Datos de tu cuenta y del workspace actual.</p></div></section><section className="cc-card cc-settings-card"><div className="cc-settings-profile"><div className="cc-avatar cc-avatar-large">{user.name.charAt(0).toUpperCase()}</div><div><h3>{user.name}</h3><p>{user.email}</p><span className={`cc-role-pill role-${user.role}`}>{user.role}</span></div></div><div className="cc-settings-grid"><div><span>Workspace</span><strong>{user.workspace.name}</strong></div><div><span>Workspace ID</span><strong>#{user.workspace.id}</strong></div><div><span>Permiso actual</span><strong>{user.role}</strong></div><div><span>Ruta pública</span><strong className={`cc-api-value cc-health-text-${health.state}`}><span className="cc-health-dot" /> {healthLabel(health)}</strong></div></div><button className="cc-button cc-button-danger" onClick={onLogout}>Cerrar sesión</button></section></div>;
}

export default function Home() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [page, setPage] = useState<Page>("overview");
  const [devices, setDevices] = useState<Device[]>([]);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [runs, setRuns] = useState<TaskRun[]>([]);
  const [sessions, setSessions] = useState<WarmupSession[]>([]);
  const [scans, setScans] = useState<ScanSession[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [stats, setStats] = useState<Stats>({ totals: { total_sessions: 0, completed_sessions: 0, reels_viewed: 0, videos_viewed: 0, shorts_viewed: 0, likes: 0, saves: 0, elapsed_sec: 0 }, by_platform: [], scans: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [apiHealth, setApiHealth] = useState<ApiHealth>(INITIAL_API_HEALTH);
  const [ready, setReady] = useState(false);

  const logout = useCallback(() => {
    window.localStorage.removeItem("southfarm_token");
    window.localStorage.removeItem("southfarm_user");
    setToken(null); setUser(null);
  }, []);

  const refresh = useCallback(async (activeToken: string) => {
    setBusy(true); setError("");
    try {
      const [me, deviceData, accountData, runData, sessionData, scanData, statData, memberData] = await Promise.all([
        request<{ user: User }>("/api/auth/me", activeToken),
        request<{ devices: Device[] }>("/api/devices", activeToken),
        request<{ accounts: SocialAccount[] }>("/api/social-accounts?platform=all", activeToken),
        request<{ runs: TaskRun[] }>("/api/tasks/runs?limit=200", activeToken),
        request<{ sessions: WarmupSession[] }>("/api/warmup-sessions?platform=all&limit=200", activeToken),
        request<{ sessions: ScanSession[] }>("/api/scan-sessions?platform=all&limit=200", activeToken),
        request<Stats>("/api/stats/overview?platform=all", activeToken),
        request<{ members: TeamMember[] }>("/api/team/members", activeToken),
      ]);
      const nextUser = me.user;
      setUser(nextUser);
      setDevices(deviceData.devices || []);
      setAccounts(accountData.accounts || []);
      setRuns((runData.runs || []).map((run) => ({ ...run, params: parseObject(run.params), result: parseObject(run.result) })));
      setSessions(sessionData.sessions || []);
      setScans(scanData.sessions || []);
      setStats(statData);
      setMembers(memberData.members || []);
      window.localStorage.setItem("southfarm_user", JSON.stringify(nextUser));
      setLastUpdated(new Date().toISOString());
    } catch (cause) {
      if (cause instanceof ApiError && [401, 403].includes(cause.status)) logout();
      else setError(cause instanceof Error ? cause.message : "No se pudieron cargar los datos");
    } finally {
      setBusy(false);
    }
  }, [logout]);

  const handleAuth = useCallback((nextToken: string, nextUser: User) => {
    window.localStorage.setItem("southfarm_token", nextToken);
    window.localStorage.setItem("southfarm_user", JSON.stringify(nextUser));
    setToken(nextToken); setUser(nextUser); void refresh(nextToken);
  }, [refresh]);

  const restoreSession = useCallback(() => {
    const storedToken = window.localStorage.getItem("southfarm_token");
    const storedUser = parseObject(window.localStorage.getItem("southfarm_user")) as unknown as User;
    if (storedToken) {
      setToken(storedToken);
      if (storedUser?.id) setUser(storedUser);
      void refresh(storedToken);
    }
    setReady(true);
  }, [refresh]);

  useEffect(() => {
    const task = window.setTimeout(restoreSession, 0);
    return () => window.clearTimeout(task);
  }, [restoreSession]);

  useEffect(() => {
    if (!token) return;
    const interval = window.setInterval(() => void refresh(token), 10000);
    return () => window.clearInterval(interval);
  }, [token, refresh]);

  useEffect(() => {
    let active = true;
    const poll = async () => {
      const nextHealth = await checkApiHealth();
      if (active) setApiHealth(nextHealth);
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  if (!ready) return <div className="cc-loading-screen"><div className="cc-brand-mark">SF</div></div>;
  if (!token || !user) return <AuthPage onAuth={handleAuth} />;

  const pageContent = page === "overview"
    ? <DashboardPage devices={devices} accounts={accounts} runs={runs} sessions={sessions} scans={scans} stats={stats} health={apiHealth} onNavigate={setPage} />
    : page === "fleet"
      ? <FleetPage devices={devices} accounts={accounts} runs={runs} token={token} onChanged={() => void refresh(token)} canManageDevices={user.role === "owner" || user.role === "admin"} canRunTasks={user.role !== "viewer"} />
      : page === "accounts"
         ? <AccountsPage accounts={accounts} devices={devices} token={token} onChanged={() => void refresh(token)} canManage={user.role !== "viewer"} />
        : page === "history"
          ? <HistoryPage sessions={sessions} scans={scans} />
          : page === "team"
            ? <TeamPage user={user} token={token} members={members} onChanged={() => void refresh(token)} />
             : <SettingsPage user={user} health={apiHealth} onLogout={logout} />;

  return <div className="cc-app-shell"><Sidebar page={page} user={user} health={apiHealth} onNavigate={setPage} onLogout={logout} /><div className="cc-main"><Topbar page={page} user={user} health={apiHealth} lastUpdated={lastUpdated} busy={busy} onRefresh={() => void refresh(token)} /><main className="cc-content">{apiHealth.state !== "online" && apiHealth.state !== "checking" && <div className={`cc-alert cc-alert-health cc-alert-health-${apiHealth.state}`}><span><strong>{healthLabel(apiHealth)}</strong> · {healthDetail(apiHealth)}</span></div>}{error && <div className="cc-alert cc-alert-error cc-global-alert">{error}<button onClick={() => setError("")}>×</button></div>}{pageContent}</main></div><MobileNav page={page} onNavigate={setPage} /></div>;
}
