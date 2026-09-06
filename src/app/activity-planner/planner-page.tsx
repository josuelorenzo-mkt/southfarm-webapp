"use client";

/**
 * Activity Planner — shell de la sección.
 * Header (nav de semana, regenerar, EN VIVO, ver día de hoy), resumen semanal,
 * switch de vistas 'week' | 'day' | 'cluster' | 'routines' y polling 10s.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AuthApiError } from "../auth-client";
import { plannerApi, PlannerApiError } from "./api";
import ClusterCreateModal from "./cluster-create-modal";
import ClusterDetail from "./cluster-detail";
import DayView from "./day-view";
import PlannerWeek from "./planner-week";
import RoutineEditor from "./routine-editor";
import {
  buenosAiresToday,
  currentWeekStart,
  formatBATime,
  relativeBA,
  shortDate,
  shiftDateKey,
} from "./types";
import type { DayResponse, WeekResponse } from "./types";

export type PlannerView = "week" | "day" | "cluster" | "routines";

interface PlannerPageProps {
  token: string;
  canManage: boolean;
}

export default function PlannerPage({ token, canManage }: PlannerPageProps) {
  const [view, setView] = useState<PlannerView>("week");
  const [weekStart, setWeekStart] = useState<string>(() => currentWeekStart());
  const [dayDate, setDayDate] = useState<string>(() => buenosAiresToday());
  const [clusterId, setClusterId] = useState<number | null>(null);
  /**
   * Fase 2.5: la vista DÍA tiene dos modos — completa del workspace (null) o
   * scopped a UN clúster (id). Desde la semana, clic en un día dentro de un
   * clúster abre el día de ESE clúster; el botón "Ver día de hoy"/tab "Día"
   * abre la vista general.
   */
  const [dayClusterId, setDayClusterId] = useState<number | null>(null);

  const [week, setWeek] = useState<WeekResponse | null>(null);
  const [day, setDay] = useState<DayResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);
  /** Acciones rápidas: id→device_id de todas las cuentas del workspace. */
  const [workspaceAccounts, setWorkspaceAccounts] = useState<{ id: number; device_id: number }[]>([]);
  const [lastSync, setLastSync] = useState<string>("");
  /** v6: modal "Crear cluster" (pick de cuentas scaneadas del workspace). */
  const [createOpen, setCreateOpen] = useState(false);
  /** Flag one-shot: al abrir el editor de rutinas, scrollear a la sección de publicación de cluster. */
  const [autoScrollPublish, setAutoScrollPublish] = useState(false);
  const requestSeq = useRef(0);

  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStart, i)), [weekStart]);
  const todayKey = useMemo(() => buenosAiresToday(), []);

  /* v6: accountId → cluster que ya la agrupa (deshabilita la cuenta en el picker). */
  const occupied = useMemo(() => {
    const map = new Map<number, string>();
    for (const cluster of week?.clusters ?? []) for (const account of cluster.accounts) map.set(account.id, cluster.name);
    return map;
  }, [week]);
  /* v6: nombres de cluster existentes (lowercase) para bloquear duplicados. */
  const existingNames = useMemo(
    () => new Set((week?.clusters ?? []).map((cluster) => cluster.name.trim().toLowerCase())),
    [week],
  );

  const loadWeek = useCallback(async (start: string, silent = false) => {
    const seq = ++requestSeq.current;
    setError("");
    try {
      const data = await plannerApi.getWeek(token, start);
      if (seq !== requestSeq.current) return;
      setWeek(data);
      setLastSync(new Date().toISOString());
    } catch (cause) {
      if (!(cause instanceof AuthApiError && [401, 403].includes(cause.status))) {
        setError(PlannerApiError.from(cause).message);
      }
    } finally {
      if (!silent && seq === requestSeq.current) setLoading(false);
    }
  }, [token]);

  const loadDay = useCallback(async (date: string, silent = false, scopedClusterId: number | null = null) => {
    const seq = ++requestSeq.current;
    setError("");
    try {
      const data = await plannerApi.getDay(token, date, scopedClusterId);
      if (seq !== requestSeq.current) return;
      setDay(data);
      setLastSync(new Date().toISOString());
    } catch (cause) {
      if (!(cause instanceof AuthApiError && [401, 403].includes(cause.status))) {
        setError(PlannerApiError.from(cause).message);
      }
    } finally {
      if (!silent && seq === requestSeq.current) setLoading(false);
    }
  }, [token]);

  const reloadCurrent = useCallback((silent = false) => {
    if (view === "day") void loadDay(dayDate, silent, dayClusterId);
    else void loadWeek(weekStart, silent);
  }, [view, dayDate, dayClusterId, weekStart, loadDay, loadWeek]);

  useEffect(() => {
    const task = window.setTimeout(() => {
      if (view === "day") void loadDay(dayDate, false, dayClusterId);
      else void loadWeek(weekStart);
    }, 0);
    return () => window.clearTimeout(task);
  }, [view, weekStart, dayDate, dayClusterId, loadDay, loadWeek]);

  useEffect(() => {
    const interval = window.setInterval(() => reloadCurrent(true), 10000);
    return () => window.clearInterval(interval);
  }, [reloadCurrent]);

  useEffect(() => {
    let cancelled = false;
    plannerApi.getWorkspaceAccounts(token)
      .then((data) => {
        if (cancelled) return;
        setWorkspaceAccounts((data.accounts || []).map((account) => ({
          id: Number(account.id), device_id: Number(account.device_id),
        })));
      })
      .catch(() => { /* el panel de acciones rápidas funciona sin esto (muestra vacío) */ });
    return () => { cancelled = true; };
  }, [token]);

  /* El flag de scroll es one-shot: se limpia al cambiar de cluster o al salir de la vista rutinas
     (setTimeout 0 — patrón de este Next para setState desde effects). */
  useEffect(() => {
    if (view === "routines") return;
    const task = window.setTimeout(() => setAutoScrollPublish(false), 0);
    return () => window.clearTimeout(task);
  }, [view, clusterId]);

  const navigateWeek = (delta: number) => {
    setWeekStart((current) => shiftDateKey(current, delta * 7));
    setView("week");
  };

  const navigateDay = (delta: number) => {
    setDayDate((current) => shiftDateKey(current, delta));
    // Moverse de día PRESERVA el scope: dentro del mismo clúster o general.
    setView("day");
  };

  /** openDay(dateKey, clusterId) — con clúster = vista día DE ESE clúster.
   *  También fija el clúster seleccionado: así el tab "Día clúster" sigue
   *  habilitado y conserva el clúster aunque se navegue a otra vista. */
  const openDay = (dateKey: string, scopedClusterId: number | null = null) => {
    setDayDate(dateKey);
    setDayClusterId(scopedClusterId);
    if (scopedClusterId !== null) setClusterId(scopedClusterId);
    setView("day");
  };

  /** Tabs "Día" (completa) y "Día clúster" — la segunda conserva el último clúster. */
  const openGeneralDay = () => {
    setDayClusterId(null);
    setView("day");
  };

  /** Tab "Día clúster": muestra el día del clúster más recientemente
   *  seleccionado (por clic en la semana o desde la vista cluster). */
  const openClusterDay = () => {
    const target = clusterId ?? dayClusterId;
    if (target !== null) {
      setDayClusterId(target);
      setView("day");
    }
  };

  const openCluster = (id: number) => {
    setClusterId(id);
    setView("cluster");
  };

  /** "Publicar al cluster" desde el detalle → vista rutinas con scroll a la sección de publicación. */
  const openPublishInRoutines = (id: number) => {
    setClusterId(id);
    setView("routines");
    setAutoScrollPublish(true);
  };

  const regenerateWeek = async () => {
    if (!window.confirm("¿Regenerar la semana desde las rutinas aprobadas? No duplica tareas existentes.")) return;
    setGenerating(true);
    setError("");
    try {
      await plannerApi.generateWeek(token, weekStart);
      await loadWeek(weekStart);
    } catch (cause) {
      setError(PlannerApiError.from(cause).message);
    } finally {
      setGenerating(false);
    }
  };

  /** v6: el cluster ya quedó creado; se regenera la semana para que sus tareas
   *  materialicen de inmediato y se recarga. Si la regeneración falla, el
   *  cluster sigue creado — se puede regenerar a mano después. */
  const handleClusterCreated = async () => {
    setCreateOpen(false);
    setGenerating(true);
    try {
      await plannerApi.generateWeek(token, weekStart);
    } catch {
      /* el cluster ya quedó creado; la semana se puede regenerar a mano */
    } finally {
      setGenerating(false);
    }
    await loadWeek(weekStart);
  };

  const goToToday = () => {
    const todayWeek = currentWeekStart();
    if (view === "day") {
      setDayDate(buenosAiresToday());
      void loadDay(buenosAiresToday(), false, dayClusterId);
    } else {
      setWeekStart(todayWeek);
      void loadWeek(todayWeek);
    }
  };

  // Cada extremo con SU mes: una semana que cruza de mes no puede mostrar
  // "dom 06 ago" para el 6 de septiembre.
  const weekTitle = weekStart ? `${shortDate(weekDays[0])} – ${shortDate(weekDays[6])}` : "";

  return (
    <div className="ap-planner">
      <div className="ap-page-stack">
        {/* BARRA DE MANDO — FIJA: primera sección en TODAS las vistas, con
            DOS filas de estructura idéntica (no importa el ancho ni la vista,
            las filas no se reacomodan distinto):
            fila 1 = estado vivo + navegación de fecha, TODO a la izquierda
            (semana: ‹ rango › + Ver día de hoy / día: ‹ fecha › + Ahora +
            Volver a la semana);
            fila 2 = Sincronizar (día) + tabs. */}
        <div className="ap-toolbar">
          <div className="ap-toolbar-row">
            <div className="ap-week-controls">
              <span className="ap-badge ap-badge-live"><span className="ap-badge-dot" />En vivo · {week?.now ? formatBATime(week.now) : "—"} BA</span>
              <span className="ap-last-sync" style={{ color: "var(--text-muted)", fontSize: 11 }}>Actualizado {lastSync ? relativeBA(lastSync) : "…"}</span>
              {view === "week" && (
                <>
                  <div className="ap-week-range">
                    <button title="Semana anterior" aria-label="Semana anterior" onClick={() => navigateWeek(-1)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg></button>
                    <span>{weekTitle}</span>
                    <button title="Semana siguiente" aria-label="Semana siguiente" onClick={() => navigateWeek(1)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></button>
                  </div>
                  <button className="ap-btn ap-btn-primary" onClick={() => openDay(todayKey, null)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2.5" /><path d="M3.5 9.5h17M8 3v3M16 3v3" /></svg>
                    Ver día de hoy
                  </button>
                </>
              )}
              {view === "day" && (
                <>
                  <div className="ap-week-range">
                    <button title="Día anterior" aria-label="Día anterior" onClick={() => navigateDay(-1)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg></button>
                    <span>{shortDate(dayDate)}</span>
                    <button title="Día siguiente" aria-label="Día siguiente" onClick={() => navigateDay(1)}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg></button>
                  </div>
                  <button className="ap-btn" onClick={goToToday}>Ahora</button>
                  <button className="ap-btn ap-btn-ghost" onClick={() => setView("week")}>Volver a la semana</button>
                </>
              )}
            </div>
          </div>
          <div className="ap-toolbar-row">
            {view === "day" && (
              <button className="ap-btn" onClick={() => void loadDay(dayDate, false, dayClusterId)} disabled={loading}>Sincronizar<span>↻</span></button>
            )}
            <div className="ap-segmented" style={{ minWidth: 380 }} role="tablist" aria-label="Vista del planner">
              <button className={view === "week" ? "is-selected" : ""} onClick={() => setView("week")}>All Clusters</button>
              {/* Dos entradas distintas para la vista DÍA (Fase 2.5): completa
                  del workspace vs scopped al clúster seleccionado. */}
              <button
                className={view === "day" && dayClusterId === null ? "is-selected" : ""}
                onClick={openGeneralDay}
              >
                Today activity
              </button>
              <button
                className={view === "day" && dayClusterId !== null ? "is-selected" : ""}
                disabled={clusterId === null && dayClusterId === null}
                title={clusterId === null && dayClusterId === null ? "Entrá desde All Clusters haciendo clic en un día dentro de un clúster" : undefined}
                onClick={() => clusterId !== null || dayClusterId !== null ? openClusterDay() : undefined}
              >
                By Cluster
              </button>
              <button className={view === "cluster" ? "is-selected" : ""} disabled={!clusterId} onClick={() => clusterId && setView("cluster")}>Cluster</button>
              <button className={view === "routines" ? "is-selected" : ""} disabled={!clusterId} onClick={() => clusterId && setView("routines")}>Rutinas</button>
            </div>
          </div>
        </div>

        {/* Header de la semana: título + las ACCIONES de la semana. Crear
            cluster toma el lugar que tenía "Ver día de hoy" (la navegación
            subió a la barra de mando) y regenerar es un refresh de ícono. */}
        {view === "week" && (
          <section className="ap-week-head">
            <div>
              <p className="ap-eyebrow ap-eyebrow-accent">SEMANA ACTUAL · BUENOS AIRES</p>
              <h2>La semana de todas tus <em>marcas.</em></h2>
              <p>Warmups, scans y publicaciones en una sola agenda. Pasá el mouse por el chart para ver el día a día.</p>
            </div>
            <div className="ap-week-controls">
              <button
                className="ap-btn ap-btn-primary"
                onClick={() => setCreateOpen(true)}
                disabled={!canManage}
                title={!canManage ? "Solo lectura" : undefined}
              >
                Crear cluster<span>＋</span>
              </button>
              <button
                className="ap-btn ap-btn-icon"
                onClick={() => void regenerateWeek()}
                disabled={!canManage || generating}
                title={generating ? "Regenerando…" : "Regenerar semana desde las rutinas aprobadas"}
                aria-label="Regenerar semana"
              >
                {generating ? <span className="ap-spinner" /> : "↻"}
              </button>
            </div>
          </section>
        )}

        {error && <div className="cc-alert cc-alert-error"><span>{error}<button onClick={() => setError("")}>×</button></span></div>}

        {/* Resumen semanal */}
        {view === "week" && week && (
          <section className="ap-week-summary" aria-label="Resumen de la semana">
            <article className="ap-week-metric tone-purple">
              <div className="ap-week-metric-head"><span className="ap-week-metric-glyph">▶</span><span>Publicaciones</span></div>
              <strong>{week.summary.publishTotal} <span className="ap-suffix">videos</span></strong>
              <small>esta semana · plan semanal de cada cluster</small>
            </article>
            <article className="ap-week-metric tone-blue">
              <div className="ap-week-metric-head"><span className="ap-week-metric-glyph">◔</span><span>Warmup</span></div>
              <strong>{Math.round(week.summary.warmupMinutesPlanned / 60)} <span className="ap-suffix">hs</span></strong>
              <small>planificadas · objetivo 40 min/cuenta/día</small>
            </article>
            <article className="ap-week-metric tone-green">
              <div className="ap-week-metric-head"><span className="ap-week-metric-glyph">◌</span><span>Tareas planificadas</span></div>
              <strong>{week.summary.tasksTotal}</strong>
              <small>{week.summary.tasksQueued} en cola · {week.summary.tasksRunning} en curso</small>
            </article>
            <article className="ap-week-metric tone-orange has-live-bar">
              <div className="ap-week-metric-head"><span className="ap-week-metric-glyph">⚡</span><span>Tareas en curso</span></div>
              <strong>{week.summary.tasksRunning}</strong>
              <small>ejecutándose ahora mismo</small>
            </article>
          </section>
        )}

        {/* Cuerpo según vista */}
        {view === "week" && (
          loading && !week ? (
            <div className="ap-loading" aria-label="Cargando la semana">
              <div className="ap-skeleton" />
              <div className="ap-skeleton" />
              <div className="ap-skeleton" />
              <div className="ap-spinner" style={{ marginTop: 8 }} />
            </div>
          ) : week ? (
            <PlannerWeek
              token={token}
              week={week}
              canManage={canManage}
              onOpenCluster={openCluster}
              onOpenDay={openDay}
              onChanged={() => void loadWeek(weekStart, true)}
            />
          ) : (
            <div className="ap-empty"><strong>No se pudo cargar la semana</strong><span>Revisá la conexión con la API e intentá de nuevo.</span></div>
          )
        )}

        {view === "day" && (
          loading && !day ? (
            <div className="ap-loading" aria-label="Cargando el día">
              <div className="ap-skeleton" />
              <div className="ap-spinner" style={{ marginTop: 8 }} />
            </div>
          ) : day ? (
            <DayView
              // Re-montar al cambiar de scope: el auto-scroll a AHORA vive en
              // un useEffect once-per-mount; sin key, cambiar entre el día
              // completo y el del clúster conserva el scroll viejo.
              key={dayClusterId === null ? "day-all" : `day-cluster-${dayClusterId}`}
              token={token}
              date={dayDate}
              day={day}
              clusterId={dayClusterId}
              clusterName={
                dayClusterId !== null
                  ? (week?.clusters.find((candidate) => candidate.id === dayClusterId)?.name || `Clúster #${dayClusterId}`)
                  : null
              }
              clusterAccounts={dayClusterId !== null ? (week?.clusters.find((candidate) => candidate.id === dayClusterId)?.accounts || []) : []}
              workspaceAccounts={workspaceAccounts}
              canManage={canManage}
              onChanged={() => void loadDay(dayDate, true, dayClusterId)}
            />
          ) : (
            <div className="ap-empty"><strong>No se pudo cargar el día</strong><span>Revisá la conexión con la API e intentá de nuevo.</span></div>
          )
        )}

        {view === "cluster" && clusterId != null && (
          <ClusterDetail
            clusterId={clusterId}
            onClose={() => setView("week")}
            onNavigate={(id) => setClusterId(id)}
            onEditRoutines={() => setView("routines")}
            onOpenPublish={openPublishInRoutines}
          />
        )}

        {view === "routines" && clusterId != null && (
          <RoutineEditor
            clusterId={clusterId}
            onClose={() => setView("week")}
            onApplied={() => void loadWeek(weekStart, true)}
            autoScrollToPublish={autoScrollPublish}
            onAutoScrollDone={() => setAutoScrollPublish(false)}
          />
        )}
      </div>

      {/* v6: modal "Crear cluster" — vive dentro de .ap-planner porque
          .ap-modal-overlay/.ap-modal están scoped bajo ese root. */}
      <ClusterCreateModal
        token={token}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void handleClusterCreated()}
        occupied={occupied}
        existingNames={existingNames}
      />
    </div>
  );
}
