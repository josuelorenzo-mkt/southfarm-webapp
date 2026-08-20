"use client";

/**
 * Activity Planner — vista expandida de cluster (FE-B).
 * Porte de docs/mockups/activity-planner/cluster-detail.html con datos reales
 * de GET /api/clusters/:id + GET /api/planner/week.
 *
 * Contenido: hero con nombre editable (PATCH rename), navegación prev/next,
 * cuentas (quitar / agregar desde el resto del workspace), historial de
 * publicaciones, chart SVG de warmup 14 días, posts por día, stats
 * (views = placeholder ámbar), rutinas activas y "Publicar al cluster".
 */
import "./planner-extra.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getActiveAccessToken } from "../auth-client";
import { plannerApi, PlannerApiError } from "./api";
import {
  PLATFORM_META,
  ROUTINE_LABELS,
  ROUTINE_STATUS_LABELS,
  buenosAiresToday,
  formatBATime,
  shortDate,
  shiftDateKey,
} from "./types";
import type { ClusterAccount, ClusterDetailResponse, PlannerPlatform, Routine } from "./types";

const HISTORY_W = 640;
const HISTORY_H = 118;
const HISTORY_PAD = 8;

const PLATFORM_GLYPH: Record<PlannerPlatform, string> = {
  instagram: "IG",
  tiktok: "TT",
  youtube: "YT",
};

interface AccountCandidate {
  account: ClusterAccount;
  member: boolean;
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

/** Burbuja de cuenta (área de cierre) — atajo de teclado + aria. */
function Bubble({
  account,
  sizeClass,
}: {
  account: ClusterAccount;
  sizeClass?: string;
}) {
  const meta = PLATFORM_META[account.platform] || PLATFORM_META.instagram;
  const label = meta.label;
  return (
    <span
      className={`ap-bubble ap-bubble-${account.platform} ${sizeClass || ""}`}
      tabIndex={0}
      role="img"
      aria-label={`${label}: @${account.username}`}
    >
      {PLATFORM_GLYPH[account.platform] || meta.short}
    </span>
  );
}

/* ============================================================
   Warmup por cuenta (v3): mini-chart ECG por cuenta del cluster.
   Estado de color COMPUTADO POR CUENTA:
   - is-bad: sin actividad (todos 0) los últimos 5 días.
   - is-warn: sin actividad los últimos 2 días (prioridad menor que bad).
   - default: verde.
   Reusa las clases ECG de .ap-history-chart (planner-extra.css) con
   una variante mini (.ap-history-chart-mini).
   ============================================================ */

const MINI_W = 320;
const MINI_H = 48;
const MINI_T = 7;
const MINI_B = 7;
const MINI_P = 4;

function accountStateClass(series: number[]): string {
  const last5 = series.slice(-5);
  const last2 = series.slice(-2);
  if (last5.length >= 5 && last5.every((v) => !v)) return "is-bad";
  if (last2.length >= 2 && last2.every((v) => !v)) return "is-warn";
  return "";
}

function AccountWarmupMini({ series, accountId, platform, username, alias }: {
  series: number[];
  accountId: number;
  platform: PlannerPlatform;
  username: string;
  alias: string | null;
}) {
  const max = Math.max(40, ...series);
  const points = series.map((value, i) => {
    const x = MINI_P + ((MINI_W - MINI_P * 2) / Math.max(1, series.length - 1)) * i;
    const y = MINI_T + (MINI_H - MINI_T - MINI_B) - (value / max) * (MINI_H - MINI_T - MINI_B);
    return [x, y] as [number, number];
  });
  const line = smoothPath(points);
  const area = points.length > 1
    ? `${line} L${points[points.length - 1][0].toFixed(1)} ${MINI_H - MINI_B} L${points[0][0]} ${MINI_H - MINI_B} Z`
    : "";
  const targetY = MINI_T + (MINI_H - MINI_T - MINI_B) - (40 / max) * (MINI_H - MINI_T - MINI_B);
  const avg = series.length ? Math.round(series.reduce((s, v) => s + v, 0) / series.length) : 0;
  const stateClass = accountStateClass(series);
  const gradId = `ap-hg-warmup-${accountId}`;
  const meta = PLATFORM_META[platform] || PLATFORM_META.instagram;

  return (
    <div className={`ap-warmup-mini ${stateClass ? `is-${stateClass === "is-warn" ? "warn" : "bad"}` : ""}`}>
      <div className="ap-warmup-mini-head">
        <span className={`ap-bubble ap-bubble-${platform} ap-warmup-mini-bubble`} role="img" aria-label={`${meta.label}: @${username}`}>
          {PLATFORM_GLYPH[platform] || meta.short}
        </span>
        <div className="ap-warmup-mini-title">
          <strong>@{username}</strong>
          <span>{alias ? `celular ${alias} · ` : ""}{avg} min/día · últimos 14d</span>
        </div>
        {stateClass && (
          <span className={`ap-badge ${stateClass === "is-warn" ? "ap-badge-warn" : "ap-badge-bad"}`} title={stateClass === "is-warn" ? "Sin actividad de warmup en los últimos 2 días" : "Sin actividad de warmup en los últimos 5 días"}>
            <span className="ap-badge-dot" />{stateClass === "is-warn" ? "2 días sin actividad" : "5 días sin actividad"}
          </span>
        )}
      </div>
      <div className={`ap-history-chart ap-history-chart-mini ${stateClass}`}>
        <svg viewBox={`0 0 ${MINI_W} ${MINI_H}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line className="ap-wtarget" x1={MINI_P} y1={targetY} x2={MINI_W - MINI_P} y2={targetY} />
          {area && <path className="ap-warea" d={area} fill={`url(#${gradId})`} />}
          {line && <path className="ap-wline" d={line} stroke="#22c55e" />}
          {points.map((p, i) => (
            <circle
              key={i}
              className="ap-dot"
              cx={p[0].toFixed(1)}
              cy={p[1].toFixed(1)}
              r={i === points.length - 1 ? 3 : 2.2}
              fill="#22c55e"
              stroke="#09090b"
              strokeWidth="1.5"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}

export default function ClusterDetail({
  clusterId,
  onClose,
  onNavigate,
  onEditRoutines,
  onOpenPublish,
}: {
  clusterId: number;
  onClose: () => void;
  onNavigate: (clusterId: number) => void;
  onEditRoutines?: (clusterId: number) => void;
  /** Navegar al editor de rutinas posicionado en la sección de publicación (fallback: modal actual). */
  onOpenPublish?: (clusterId: number) => void;
}) {
  const [data, setData] = useState<ClusterDetailResponse | null>(null);
  /** Cuentas de todo el workspace (getWeek().clusters[].accounts) para el dropdown de agregar. */
  const [weekAccounts, setWeekAccounts] = useState<ClusterAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [selected, setSelected] = useState<number | "">("");
  const [adding, setAdding] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [title, setTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [toast, setToast] = useState("");
  const [toastMuted, setToastMuted] = useState(false);
  const toastTimer = useRef<number | null>(null);

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError("");
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      const [detail, week] = await Promise.all([
        plannerApi.getClusterDetail(token, id),
        plannerApi.getWeek(token),
      ]);
      setData(detail);
      // Dropdown de "agregar cuenta": todas las cuentas del workspace, dedup por (plataforma, username).
      const seen = new Set<string>();
      const accounts: ClusterAccount[] = [];
      week.clusters.forEach((cluster) => {
        cluster.accounts.forEach((account) => {
          const key = `${account.platform}:${account.username}`;
          if (seen.has(key)) return;
          seen.add(key);
          accounts.push(account);
        });
      });
      setWeekAccounts(accounts);
    } catch (cause) {
      setError(PlannerApiError.from(cause).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const task = window.setTimeout(() => void load(clusterId), 0);
    return () => window.clearTimeout(task);
  }, [clusterId, load]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      setRenaming(false);
      setSavingName(false);
      setAddOpen(false);
      setSelected("");
      setModalOpen(false);
      setPublishing(false);
    }, 0);
    return () => window.clearTimeout(task);
  }, [clusterId]);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const showToast = useCallback((message: string, muted = false) => {
    setToast(message);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), muted ? 2400 : 2800);
  }, []);

  const showErrorToast = useCallback((message: string) => {
    setToast(message);
    setToastMuted(true);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => { setToast(""); setToastMuted(false); }, 3400);
  }, []);

  /* Rename: click → input; Enter o blur guardan; Escape cancela */
  const savingNameRef = useRef(false);
  const commitName = useCallback(async () => {
    if (savingNameRef.current) return; // blur + Enter juntos → una sola PUT
    const input = document.getElementById("ap-cluster-name-input") as HTMLInputElement | null;
    if (!input || !data) return;
    const next = input.value.trim();
    if (!next) { showErrorToast("El nombre no puede quedar vacío."); return; }
    if (next === data.cluster.name) { setRenaming(false); return; }
    savingNameRef.current = true;
    setSavingName(true);
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      await plannerApi.renameCluster(token, data.cluster.id, next);
      setData((current) => (current ? { ...current, cluster: { ...current.cluster, name: next } } : current));
      setRenaming(false);
      showToast(`Nombre del cluster guardado: "${next}"`);
    } catch (cause) {
      showErrorToast(PlannerApiError.from(cause).message);
    } finally {
      savingNameRef.current = false;
      setSavingName(false);
    }
  }, [data, showErrorToast, showToast]);

  /* Quitar cuenta con confirm */
  const removeAccount = useCallback(async (account: ClusterAccount) => {
    if (!data) return;
    if (!window.confirm(`¿Quitar @${account.username} del cluster? No se borra de la flota; deja de recibir la rutina.`)) return;
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      await plannerApi.removeMember(token, data.cluster.id, account.id);
      setData((current) => (current
        ? { ...current, cluster: { ...current.cluster, accounts: current.cluster.accounts.filter((a) => a.id !== account.id) } }
        : current));
      showToast(`Cuenta sacada del cluster. La rutina se replanifica al aprobar.`);
    } catch (cause) {
      showErrorToast(PlannerApiError.from(cause).message);
    }
  }, [data, showErrorToast, showToast]);

  /* Agregar cuentas (dropdown de no-miembros de la semana + workspace) */
  const addSelected = useCallback(async () => {
    if (!data || selected === "") return;
    setAdding(true);
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      const memberIds = new Set(data.cluster.accounts.map((a) => a.id));
      const ids = [selected].filter((id) => !memberIds.has(id));
      if (!ids.length) { setAddOpen(false); setSelected(""); return; }
      await plannerApi.addMembers(token, data.cluster.id, ids);
      setData((current) => (current
        ? {
            ...current,
            cluster: {
              ...current.cluster,
              accounts: current.cluster.accounts.concat(
                weekAccounts.filter((c) => ids.includes(c.id) && !current.cluster.accounts.some((a) => a.id === c.id)),
              ),
            },
          }
        : current));
      setAddOpen(false);
      setSelected("");
      showToast(`Cuenta agregada al cluster.`);
    } catch (cause) {
      showErrorToast(PlannerApiError.from(cause).message);
    } finally {
      setAdding(false);
    }
  }, [data, weekAccounts, selected, showErrorToast, showToast]);

  /* Publicar al cluster */
  const submitPublish = useCallback(async () => {
    if (!data) return;
    const cleanUrl = videoUrl.trim();
    if (!cleanUrl) { showErrorToast("Ingresá la URL del video."); return; }
    const cleanTitle = title.trim();
    if (!cleanTitle) { showErrorToast("Ingresá el título de la publicación."); return; }
    setPublishing(true);
    try {
      const token = getActiveAccessToken();
      if (!token) throw new Error("Sesión no disponible");
      const scheduledFor = (scheduledDate && scheduledTime)
        ? new Date(`${scheduledDate}T${scheduledTime}:00-03:00`).toISOString()
        : undefined;
      const result = await plannerApi.publishToCluster(token, data.cluster.id, {
        videoUrl: cleanUrl,
        title: cleanTitle,
        scheduledFor,
      });
      setModalOpen(false);
      setVideoUrl("");
      setTitle("");
      setScheduledDate("");
      setScheduledTime("");
      showToast(`Publicación programada: ${result.created} cuenta${result.created === 1 ? "" : "s"} del cluster.`);
    } catch (cause) {
      showErrorToast(PlannerApiError.from(cause).message);
    } finally {
      setPublishing(false);
    }
  }, [data, videoUrl, title, scheduledDate, scheduledTime, showErrorToast, showToast]);

  const candidates: AccountCandidate[] = useMemo(() => {
    if (!data) return [];
    const memberIds = new Set(data.cluster.accounts.map((a) => a.id));
    return weekAccounts.map((account) => ({ account, member: memberIds.has(account.id) }));
  }, [data, weekAccounts]);

  const addOptions = useMemo(() => candidates.filter((c) => !c.member), [candidates]);

  // Fechas del chart histórico — hooks SIEMPRE antes de los early returns (Rules of Hooks).
  const historyData = data?.history;
  const historyStart = useMemo(() => {
    if (!historyData?.warmupByDay?.length) return "";
    return shiftDateKey(buenosAiresToday(), -(historyData.warmupByDay.length - 1));
  }, [historyData]);

  const labelDates = useMemo(() => {
    if (!historyStart) return [];
    return Array.from({ length: historyData?.warmupByDay?.length || 0 }, (_, i) => shiftDateKey(historyStart, i));
  }, [historyStart, historyData]);

  const todayKey = useMemo(() => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Argentina/Buenos_Aires",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")?.value || "";
    const month = parts.find((p) => p.type === "month")?.value || "";
    const day = parts.find((p) => p.type === "day")?.value || "";
    return `${year}-${month}-${day}`;
  }, []);

  if (loading && !data) {
    return (
      <div className="ap-page-stack">
        <div className="ap-detail-topbar">
          <div className="ap-crumb">
            <button className="ap-link-button" onClick={onClose}>← Volver a la semana</button>
            <span>/</span>
            <strong>Cluster #{clusterId}</strong>
          </div>
          <div className="ap-detail-nav">
            <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={onClose}>Cerrar</button>
          </div>
        </div>
        <div className="ap-loading" aria-label="Cargando el detalle del cluster">
          <div className="ap-skeleton" />
          <div className="ap-spinner" style={{ marginTop: 8 }} />
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="ap-page-stack">
        <div className="ap-detail-topbar">
          <div className="ap-crumb">
            <button className="ap-link-button" onClick={onClose}>← Volver a la semana</button>
            <span>/</span>
            <strong>Cluster #{clusterId}</strong>
          </div>
          <div className="ap-detail-nav">
            <button className="ap-btn ap-btn-sm" onClick={onClose}>Cerrar</button>
          </div>
        </div>
        <div className="ap-empty">
          <strong>No se pudo cargar el cluster</strong>
          <span>{error}</span>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const cluster = data.cluster;
  const history = data.history;
  const nav = data.nav;
  const name = cluster.name || `Cluster #${clusterId}`;

  const warmupByDay = history?.warmupByDay || [];
  const postsByDay = history?.postsByDay || [];
  const posts30d = history?.stats?.posts30d ?? 0;
  const warmupMinutes30d = history?.stats?.warmupMinutes30d ?? 0;
  const publicationsTotal = history?.stats?.publicationsTotal ?? 0;
  const postsThisWeek = history?.stats?.postsThisWeek ?? 0;
  const views = history?.stats?.views ?? null;

  /* Estado de actividad del chart de warmup (último elemento = hoy):
     - sin warmup los últimos 2 días → is-warn
     - sin warmup los últimos 5 días → is-bad (prioridad).
     Cálculo plano (no es hook): va después del early return de datos. */
  let historyStateClass = "";
  const warmupLast5 = warmupByDay.slice(-5);
  const warmupLast2 = warmupByDay.slice(-2);
  if (warmupLast5.length >= 5 && warmupLast5.every((v) => !v)) historyStateClass = "is-bad";
  else if (warmupLast2.length >= 2 && warmupLast2.every((v) => !v)) historyStateClass = "is-warn";

  const maxWarmup = Math.max(60, ...warmupByDay);
  const warmupPoints = warmupByDay.map((value, i) => {
    const x = HISTORY_PAD + ((HISTORY_W - HISTORY_PAD * 2) / Math.max(1, warmupByDay.length - 1)) * i;
    const y = 12 + (HISTORY_H - 12 - 14) - (value / maxWarmup) * (HISTORY_H - 12 - 14);
    return [x, y] as [number, number];
  });
  const warmupLine = smoothPath(warmupPoints);
  const warmupArea = warmupPoints.length > 1
    ? `${warmupLine} L${warmupPoints[warmupPoints.length - 1][0].toFixed(1)} ${HISTORY_H - 14} L${warmupPoints[0][0]} ${HISTORY_H - 14} Z`
    : "";
  const targetY = 12 + (HISTORY_H - 12 - 14) - (40 / maxWarmup) * (HISTORY_H - 12 - 14);
  const targetX1 = HISTORY_PAD;
  const targetX2 = HISTORY_W - HISTORY_PAD;
  const postsMax = Math.max(3, ...postsByDay);

  const activeRoutines = cluster.routines.filter((routine) => routine.status !== "paused");
  const pausedCount = cluster.routines.length - activeRoutines.length;

  return (
    <div className="ap-page-stack">
      {/* Barra con navegación propia del detalle */}
      <header className="ap-detail-topbar">
        <div className="ap-crumb">
          <button className="ap-link-button" onClick={onClose}>← Volver a la semana</button>
          <span>/</span>
          <strong>{name}</strong>
        </div>
        <div className="ap-detail-nav">
          <button
            className="ap-btn ap-btn-ghost ap-btn-sm"
            title="Cluster anterior"
            disabled={loading || nav.prevClusterId == null}
            onClick={() => nav.prevClusterId != null && onNavigate(nav.prevClusterId)}
          >
            ‹ Anterior
          </button>
          <button
            className="ap-btn ap-btn-ghost ap-btn-sm"
            title="Cluster siguiente"
            disabled={loading || nav.nextClusterId == null}
            onClick={() => nav.nextClusterId != null && onNavigate(nav.nextClusterId)}
          >
            Siguiente ›
          </button>
          {onEditRoutines ? (
            <button
              className="ap-btn ap-btn-ghost ap-btn-sm"
              title="Editar rutinas de este cluster"
              onClick={() => onEditRoutines(cluster.id)}
            >
              Rutinas
            </button>
          ) : (
            <button
              className="ap-btn ap-btn-ghost ap-btn-sm"
              disabled
              title="El editor de rutinas se habilita desde la vista semana → pestaña Rutinas"
            >
              Rutinas
            </button>
          )}
          <button className="ap-btn ap-btn-sm" onClick={onClose}>Cerrar</button>
        </div>
      </header>

      {/* Hero editable */}
      <section className="ap-detail-hero">
        <div className="ap-hero-copy">
          <p className="ap-eyebrow ap-eyebrow-accent">CLUSTER · DETALLE</p>
          <div className="ap-hero-name-row">
            {renaming ? (
              <div className="ap-name-edit">
                <input
                  id="ap-cluster-name-input"
                  defaultValue={name}
                  maxLength={48}
                  aria-label="Nombre del cluster"
                  autoFocus
                  onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); void commitName(); }
                    if (event.key === "Escape") setRenaming(false);
                  }}
                  onBlur={() => { if (savingName) return; void commitName(); }}
                />
                <button
                  className="ap-icon-btn"
                  title="Guardar nombre"
                  disabled={savingName}
                  onClick={() => void commitName()}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m5 13 4 4L19 7" /></svg>
                </button>
              </div>
            ) : (
              <button
                className="ap-hero-name"
                title="Hacé click para renombrar el cluster"
                onClick={() => setRenaming(true)}
              >
                {name}
              </button>
            )}
            <span className="ap-badge ap-badge-live"><span className="ap-badge-dot" />Todo ok</span>
            {savingName && <span className="ap-saving-label">Guardando…</span>}
          </div>
          <p>
            {cluster.accounts.length} cuenta{cluster.accounts.length === 1 ? "" : "s"} en el cluster ·{" "}
            {activeRoutines.length} rutina{activeRoutines.length === 1 ? "" : "s"} activa{activeRoutines.length === 1 ? "" : "s"}
            {pausedCount > 0 ? ` · ${pausedCount} pausada${pausedCount === 1 ? "" : "s"}` : ""} · ventana 12:00–22:00 BA
          </p>
        </div>
        <div className="ap-hero-stats">
          <div className="ap-hero-stat"><strong>{publicationsTotal}</strong><span>Publicaciones totales</span></div>
          <div className="ap-hero-stat">
            <strong title={views == null ? "Próximamente" : undefined}>
              {views ?? "—"}
              {views == null && <small className="ap-hero-stat-soon" style={{ display: "block", color: "#fbbf24", fontSize: 8, fontWeight: 800, letterSpacing: "0.08em", marginTop: 4, textTransform: "uppercase" }}>próximamente</small>}
            </strong>
            <span>Vistos totales</span>
          </div>
          <div className="ap-hero-stat"><strong>{postsThisWeek}</strong><span>Posts esta semana</span></div>
        </div>
      </section>

      <div className="ap-detail-grid">
        {/* ============ Columna principal ============ */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
          {/* Cuentas */}
          <section className="ap-card">
            <div className="ap-card-heading">
              <div>
                <p className="ap-eyebrow">ACCOUNTS IN CLUSTER</p>
                <h3>Cuentas del cluster</h3>
                <p className="ap-card-subtitle">Burbuja grande por plataforma. Sacá una cuenta para excluirla de la rutina sin borrarla de la flota.</p>
              </div>
              <span style={{ color: "var(--text-dim)", fontSize: 10 }}>{cluster.accounts.length} activa{cluster.accounts.length === 1 ? "" : "s"}</span>
            </div>
            <div className="ap-account-list">
              {cluster.accounts.length ? cluster.accounts.map((account) => {
                const meta = PLATFORM_META[account.platform] || PLATFORM_META.instagram;
                return (
                  <div className="ap-account-row" key={account.id}>
                    <Bubble account={account} sizeClass="ap-bubble-lg" />
                    <div className="ap-account-main">
                      <div className="ap-account-top">
                        <strong>@{account.username}</strong>
                        <span className={`ap-pill ap-pill-${account.platform}`}>{meta.label}</span>
                      </div>
                      <span>Cuenta de la marca{account.deviceAlias ? ` · celular ${account.deviceAlias}` : ""}</span>
                      <small>Política: {account.policyStatus || "automática"}</small>
                    </div>
                    <div className="ap-account-state">
                      <button
                        className="ap-icon-btn"
                        title="Quitar del cluster"
                        aria-label={`Quitar @${account.username} del cluster`}
                        onClick={() => void removeAccount(account)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14" /></svg>
                      </button>
                    </div>
                  </div>
                );
              }) : (
                <div className="ap-empty"><strong>Sin cuentas asignadas</strong><span>Agregá cuentas de la flota para que reciban la rutina del cluster.</span></div>
              )}
            </div>
            {!addOpen ? (
              <button className="ap-account-add" onClick={() => setAddOpen(true)} style={{ marginTop: 10 }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                Agregar cuenta al cluster
              </button>
            ) : (
              <div className="ap-add-panel">
                <div className="ap-add-panel-row">
                  <label className="ap-field" style={{ flex: 1, minWidth: 220 }}>
                    <span>Cuenta de la flota <em>— no miembro del cluster</em></span>
                    <select
                      className="ap-select"
                      value={selected}
                      onChange={(event) => setSelected(event.target.value === "" ? "" : Number(event.target.value))}
                    >
                      <option value="">Seleccioná una cuenta…</option>
                      {addOptions.map(({ account }) => {
                        const meta = PLATFORM_META[account.platform] || PLATFORM_META.instagram;
                        return (
                          <option key={account.id} value={account.id}>
                            @{account.username} · {meta.label}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                  <button
                    className="ap-btn ap-btn-primary ap-btn-sm"
                    disabled={selected === "" || adding}
                    onClick={() => void addSelected()}
                  >
                    {adding ? "Agregando…" : "Agregar"}
                  </button>
                  <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setAddOpen(false)}>Cancelar</button>
                </div>
                {!addOptions.length && (
                  <p className="ap-hint" style={{ marginTop: 8 }}>
                    No hay cuentas sin asignar en el workspace.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* Publicaciones */}
          <section className="ap-card">
            <div className="ap-card-heading">
              <div>
                <p className="ap-eyebrow">PUBLISH HISTORY</p>
                <h3>Historial de publicaciones</h3>
                <p className="ap-card-subtitle">Últimos videos publicados por las cuentas del cluster.</p>
              </div>
            </div>
            <div className="ap-pub-list">
              {history?.publications?.length ? history.publications.map((pub) => {
                const platform = pub.platform || "instagram";
                const meta = PLATFORM_META[platform] || PLATFORM_META.instagram;
                const thumbClass = `t-${platform}`;
                const titleText = pub.title || "Sin título";
                return (
                  <div className="ap-pub-row" key={pub.id}>
                    <div className={`ap-pub-thumb ${thumbClass}`} aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg>
                      <span>·</span>
                    </div>
                    <div className="ap-pub-main">
                      <strong>{titleText}</strong>
                      <span>@{pub.username || "—"} · {meta.label}</span>
                      <small>{pub.scheduledFor ? `${shortDate(pub.scheduledFor.slice(0, 10))} · ${formatBATime(pub.scheduledFor)}` : "fecha sin asignar"}</small>
                    </div>
                    <div className="ap-pub-metric">
                      <span className={`ap-badge ${pub.status === "completed" ? "ap-badge-live" : pub.status === "cancelled" || pub.status === "error" ? "ap-badge-bad" : "ap-badge-neutral"}`}>
                        <span className="ap-badge-dot" />{pub.status}
                      </span>
                    </div>
                  </div>
                );
              }) : (
                <div className="ap-empty"><strong>Sin publicaciones todavía</strong><span>Las publicaciones programadas y completadas de este cluster van a aparecer acá.</span></div>
              )}
            </div>
          </section>

          {/* Warmup histórico 14 días — por cuenta (v3), con fallback al agregado */}
          <section className="ap-card">
            <div className="ap-card-heading">
              <div>
                <p className="ap-eyebrow">WARMUP HISTORY · ÚLTIMOS 14 DÍAS</p>
                <h3>Warmup por cuenta</h3>
                <p className="ap-card-subtitle">Minutos ejecutados por día y por cuenta · línea de objetivo: 40 min/cuenta/día.</p>
              </div>
            </div>
            {history?.accountsWarmup?.length ? (
              <div className="ap-warmup-mini-grid">
                {history.accountsWarmup.map((entry) => {
                  const account = cluster.accounts.find((acc) => acc.id === entry.accountId);
                  return (
                    <AccountWarmupMini
                      key={entry.accountId}
                      series={entry.warmupByDay || []}
                      accountId={entry.accountId}
                      platform={entry.platform}
                      username={entry.username}
                      alias={account?.deviceAlias ?? null}
                    />
                  );
                })}
              </div>
            ) : (
              /* Fallback retrocompatible: el agregado del cluster (v1). */
              <>
                <div className={`ap-history-chart ${historyStateClass}`}>
                  <svg viewBox={`0 0 ${HISTORY_W} ${HISTORY_H}`} preserveAspectRatio="none" aria-hidden="true">
                    <defs>
                      <linearGradient id="ap-hg-warmup" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#22c55e" stopOpacity="0.3" />
                        <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    <line className="ap-wtarget" x1={targetX1} y1={targetY} x2={targetX2} y2={targetY} />
                    {warmupArea && <path className="ap-warea" d={warmupArea} fill="url(#ap-hg-warmup)" />}
                    {warmupLine && <path className="ap-wline" d={warmupLine} stroke="#22c55e" />}
                    {warmupPoints.map((p, i) => (
                      <circle
                        key={i}
                        className="ap-dot"
                        cx={p[0].toFixed(1)}
                        cy={p[1].toFixed(1)}
                        r={i === warmupPoints.length - 1 ? 3.4 : 2.4}
                        fill="#22c55e"
                        stroke="#09090b"
                        strokeWidth="1.5"
                      />
                    ))}
                  </svg>
                </div>
                <div className="ap-history-labels">
                  {labelDates.map((dateKey) => (
                    <span key={dateKey} className={dateKey === todayKey ? "is-today" : ""}>
                      {dateKey === todayKey ? "hoy" : shortDate(dateKey).slice(0, 6)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {/* ============ Columna lateral ============ */}
        <aside className="ap-side-stack">
          {/* Estadísticas / views placeholder */}
          <section className="ap-card">
            <div className="ap-card-heading">
              <div>
                <p className="ap-eyebrow">STATS</p>
                <h3>Estadísticas</h3>
              </div>
            </div>
            <div className="ap-views-ph">
              <span className="ap-views-ph-mark">
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3" /></svg>
              </span>
              <strong>Views trackeadas — próximamente</strong>
              <span>Cuando el tracking de views esté activo, vas a ver el rendimiento orgánico de cada video del cluster, por plataforma, sin salir de acá.</span>
            </div>
            <div className="ap-side-kpis" style={{ marginTop: 14 }}>
              <div className="ap-side-kpi">
                <span>Warmup 30d</span>
                <strong>{Math.round(warmupMinutes30d / 60)} <small style={{ fontSize: 12 }}>hs</small></strong>
                <small>{warmupByDay.length ? `${Math.round(warmupByDay.reduce((s, v) => s + v, 0) / warmupByDay.length)} min/día · últimos 14d` : "sin histórico"}</small>
              </div>
              <div className="ap-side-kpi">
                <span>Posts 30d</span>
                <strong>{posts30d}</strong>
                <small>{postsByDay.length ? `${postsByDay.reduce((s, v) => s + v, 0)} en los últimos 14d` : "sin histórico"}</small>
              </div>
              <div className="ap-side-kpi">
                <span>Views</span>
                <strong>{views ?? "—"}</strong>
                <small>tracking próximamente</small>
              </div>
              <div className="ap-side-kpi">
                <span>Posts por día</span>
                <strong>{Math.max(0, postsMax)}</strong>
                <small>pico últimos 14d</small>
              </div>
            </div>
          </section>

          {/* Rutinas activas */}
          <section className="ap-card">
            <div className="ap-card-heading">
              <div>
                <p className="ap-eyebrow">ACTIVE ROUTINES</p>
                <h3>Rutinas activas</h3>
              </div>
              {onEditRoutines ? (
                <button className="ap-link-button" onClick={() => onEditRoutines(cluster.id)}>Editar →</button>
              ) : (
                <span
                  className="ap-link-button"
                  style={{ cursor: "not-allowed", color: "var(--text-dim)", position: "relative" }}
                  title="El editor de rutinas se habilita desde la vista semana → pestaña Rutinas"
                >
                  Editar →
                </span>
              )}
            </div>
            <div className="ap-routine-list">
              {cluster.routines.length ? cluster.routines.map((routine: Routine) => {
                const meta = ROUTINE_LABELS[routine.routineType] || { title: routine.routineType, desc: "", color: "var(--text-secondary)" };
                return (
                  <div className="ap-routine-row" key={routine.id} style={{ color: meta.color }}>
                    <span className="ap-routine-icon">◆</span>
                    <div className="ap-routine-main">
                      <strong>{meta.title}</strong>
                      <span>{meta.desc}</span>
                    </div>
                    <span className={`ap-badge ${routine.status === "approved" ? "ap-badge-live" : routine.status === "paused" ? "ap-badge-neutral" : "ap-badge-warn"}`}>
                      <span className="ap-badge-dot" />{ROUTINE_STATUS_LABELS[routine.status] || routine.status}
                    </span>
                  </div>
                );
              }) : (
                <div className="ap-empty"><strong>Sin rutinas</strong><span>Al confirmar o crear el cluster se crean las rutinas default.</span></div>
              )}
            </div>
            <button className="ap-btn ap-btn-primary" style={{ width: "100%", marginTop: 14 }} onClick={() => (onOpenPublish ? onOpenPublish(cluster.id) : setModalOpen(true))}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
              Publicar al cluster
            </button>
          </section>
        </aside>
      </div>

      {/* Modal: publicar al cluster */}
      {modalOpen && (
        <div
          className="ap-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="Publicar al cluster"
          onClick={(event) => { if (event.target === event.currentTarget) setModalOpen(false); }}
        >
          <div className="ap-modal">
            <div className="ap-modal-head">
              <div>
                <p className="ap-eyebrow ap-eyebrow-accent">PUBLICAR AL CLUSTER</p>
                <h3>Publicación de cluster</h3>
              </div>
              <button className="ap-icon-btn" title="Cerrar" onClick={() => setModalOpen(false)}>×</button>
            </div>
            <div className="ap-modal-body">
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
                Se crea una tarea <strong>por cada cuenta</strong> del cluster ({cluster.accounts.length} cuenta{cluster.accounts.length === 1 ? "" : "s"}) con el mismo video y título.
              </p>
            </div>
            <div className="ap-modal-foot">
              <button className="ap-btn ap-btn-ghost ap-btn-sm" onClick={() => setModalOpen(false)}>Cancelar</button>
              <button
                className="ap-btn ap-btn-primary ap-btn-sm"
                disabled={publishing || !videoUrl.trim() || !title.trim()}
                onClick={() => void submitPublish()}
              >
                {publishing ? "Programando…" : "Programar publicación"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      <div className={`ap-toast ${toast ? "is-visible" : ""} ${toastMuted ? "is-muted" : ""}`} role="status" aria-live="polite">
        <span>{toast}</span>
      </div>
    </div>
  );
}
