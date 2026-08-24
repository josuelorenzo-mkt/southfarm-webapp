"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Vista en vivo OPCIONAL por dispositivo (Device Fleet).
 *
 * Protocolo acordado con el screen bridge (LAN directa, sin auth JWT):
 *  1. GET {bridge}/api/health y GET {bridge}/api/devices → [{serial, alias, model, online}]
 *  2. WS  {bridge en ws://|wss://}/ws/stream/{serial}
 *     - Primer mensaje de TEXTO: header JSON { codec: 'h264'|'h265', description?: base64(avcC/hvcC)|null }
 *     - Resto: frames binarios H.264/H.265 en formato Annex B → WebCodecs VideoDecoder.
 * El feature es 100% opt-in: nada se conecta hasta que el operador lo pide.
 */

const AVC_CODEC_STRING = "avc1.640034";
const HEVC_CODEC_STRING = "hev1.1.6.L93.B0";
const BRIDGE_FETCH_TIMEOUT_MS = 6000;
const WS_CONNECT_TIMEOUT_MS = 8000;
// ~166 ms a 30fps: cola de decode por encima de esto se considera sobrecarga.
// No alcanza con una lectura: una ráfaga (ej. replay del GOP cacheado) supera
// el umbral instantáneamente sin ser congestión real, así que exigimos
// sobrecarga sostenida antes de descartar deltas hasta el próximo IDR.
const MAX_DECODE_QUEUE = 5;
// Lecturas consecutivas (por chunk entrante) o milisegundos sostenidos por
// encima de MAX_DECODE_QUEUE antes de armar un resync.
const BACKPRESSURE_MIN_OVERLOAD_READINGS = 2;
const BACKPRESSURE_SUSTAINED_MS = 300;
// Watchdog: sin NINGÚN mensaje del bridge durante este tiempo asumimos socket
// half-open y forzamos cierre → reconexión automática.
const WATCHDOG_STALL_MS = 8000;
// Resync armado sin output del decoder durante este tiempo (IDR perdido o
// corrupto): cerramos y reconectamos para traer un GOP fresco del cache.
const RESYNC_OUTPUT_TIMEOUT_MS = 4000;
// Reconexión automática con backoff exponencial acotado.
const RECONNECT_BASE_DELAY_MS = 500;
const RECONNECT_MAX_DELAY_MS = 5000;
// Una sesión que estuvo estable este tiempo resetea el backoff al valor base.
const RECONNECT_STABLE_SESSION_MS = 30000;
// Frames decodificados sin errores que perdonan los errores aislados previos.
const DECODE_ERRORS_DECAY_FRAMES = 60;

export interface ScreenBridgeDevice {
  serial: string;
  alias?: string | null;
  model?: string | null;
  online?: boolean;
}

interface ScreenBridgeState {
  status: "loading" | "ready" | "error";
  devices: ScreenBridgeDevice[];
  error?: string;
}

interface StreamHeader {
  codec?: string;
  description?: string | null;
}

/** Instrumentación observable vía atributos data-* en el panel (FIX diagnóstico). */
interface LiveStats {
  resyncCount: number;
  decodeErrors: number;
  lastMsgAgeMs: number;
  queueSize: number;
}

const INITIAL_LIVE_STATS: LiveStats = { resyncCount: 0, decodeErrors: 0, lastMsgAgeMs: 0, queueSize: 0 };

function bridgeBase(bridgeUrl: string): string {
  return bridgeUrl.replace(/\/$/, "");
}

function toWsUrl(bridgeUrl: string): string {
  return bridgeBase(bridgeUrl).replace(/^http/i, "ws");
}

// Token opcional del bridge (para cuando está expuesto por túnel fuera de la LAN).
// Si no está definido, el bridge queda en modo LAN abierta y no se manda nada.
const BRIDGE_TOKEN = process.env.NEXT_PUBLIC_SCREEN_BRIDGE_TOKEN || "";

function withToken(url: string): string {
  if (!BRIDGE_TOKEN) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(BRIDGE_TOKEN)}`;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function normalizeCodec(value: unknown): string | null {
  const raw = typeof value === "string" ? value.toLowerCase() : "";
  // Tolerante: si el header no trae códec asumimos H.264 (el caso más común).
  if (!raw) return AVC_CODEC_STRING;
  if (raw.includes("265") || raw.includes("hevc") || raw.startsWith("hev") || raw.startsWith("hvc")) return HEVC_CODEC_STRING;
  if (raw.includes("264") || raw.includes("avc")) return AVC_CODEC_STRING;
  return null;
}

/**
 * Detección best-effort de keyframe en Annex B, sin allocations (early-exit).
 * Devuelve null si no se puede analizar (en ese caso el llamante decide).
 */
function looksLikeKeyFrame(bytes: Uint8Array, codec: string): boolean | null {
  let sawAnyNal = false;
  let cursor = 0;
  const total = bytes.length;
  while (cursor < total - 2) {
    if (bytes[cursor] === 0 && bytes[cursor + 1] === 0 && bytes[cursor + 2] === 1) {
      const nalPos = cursor + 3;
      if (nalPos < total) {
        sawAnyNal = true;
        const firstByte = bytes[nalPos];
        if (codec === HEVC_CODEC_STRING) {
          const nalType = (firstByte >> 1) & 0x3f;
          if (nalType >= 16 && nalType <= 21) return true; // BLA / IDR / CRA
        } else if ((firstByte & 0x1f) === 5) {
          return true; // H.264 IDR
        }
      }
      cursor += 3;
    } else {
      cursor += 1;
    }
  }
  return sawAnyNal ? false : null;
}

/**
 * Hook que consulta el screen bridge (una sola vez al montar, sin polling).
 */
export function useScreenBridgeDevices(bridgeUrl: string): ScreenBridgeState {
  const [state, setState] = useState<ScreenBridgeState>({ status: "loading", devices: [] });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), BRIDGE_FETCH_TIMEOUT_MS);
    const base = bridgeBase(bridgeUrl);

    const load = async () => {
      try {
        const [healthResponse, devicesResponse] = await Promise.all([
          fetch(withToken(`${base}/api/health`), { cache: "no-store", signal: controller.signal }),
          fetch(withToken(`${base}/api/devices`), { cache: "no-store", signal: controller.signal }),
        ]);
        if (!healthResponse.ok || !devicesResponse.ok) {
          throw new Error(`El bridge respondió con error HTTP ${(devicesResponse.ok ? healthResponse : devicesResponse).status}.`);
        }
        const payload = (await devicesResponse.json().catch(() => ({}))) as { devices?: ScreenBridgeDevice[] } | ScreenBridgeDevice[];
        const list = Array.isArray(payload) ? payload : Array.isArray(payload.devices) ? payload.devices : [];
        if (!cancelled) setState({ status: "ready", devices: list.filter((item) => !!item && typeof item.serial === "string") });
      } catch (cause) {
        if (cancelled) return;
        const message = cause instanceof DOMException && cause.name === "AbortError"
          ? "Tiempo de espera agotado con el bridge."
          : cause instanceof Error
            ? cause.message
            : "No se pudo contactar el bridge de pantalla.";
        setState({ status: "error", devices: [], error: message });
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [bridgeUrl]);

  return state;
}

export function LiveViewToggle({ active, onClick }: { active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`cc-button ${active ? "cc-button-muted" : "cc-button-ghost"} cc-live-toggle`}
      onClick={onClick}
      aria-label={active ? "Detener vista en vivo" : "Ver pantalla del dispositivo"}
    >
      <span aria-hidden="true">{active ? "■" : "▶"}</span>
      {active ? "Detener" : "Ver pantalla"}
    </button>
  );
}

type LivePhase = "idle" | "connecting" | "live" | "error";

export function DeviceLiveView({ bridgeUrl, deviceAlias, onClose }: { bridgeUrl: string; deviceAlias: string; onClose: () => void }) {
  const devicesState = useScreenBridgeDevices(bridgeUrl);
  const [, setAttempt] = useState(0);
  const [serial, setSerial] = useState<string | null>(null);
  const [pickedSerial, setPickedSerial] = useState("");
  const [phase, setPhase] = useState<LivePhase>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [fps, setFps] = useState(0);
  // Sub-fase de recuperación: el bridge avisó {type:"waiting"}; mostramos estado
  // de recuperación sin cortar socket ni decoder.
  const [recovering, setRecovering] = useState(false);
  const [liveStats, setLiveStats] = useState<LiveStats>(INITIAL_LIVE_STATS);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const fpsIntervalRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const autoResolvedRef = useRef(false);
  const pendingFrameRef = useRef<VideoFrame | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  // Reconexión automática: referencia para re-lanzar startStream desde closures
  // de intentos anteriores + estado de backoff que sobrevive a cada intento.
  const startStreamRef = useRef<(targetSerial: string) => void>(() => {});
  const reconnectTimerRef = useRef<number | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const stableSessionAtRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  /** Cierra socket, decodificador y timers. Segura de llamar varias veces. */
  const teardown = useCallback(() => {
    if (connectTimeoutRef.current !== null) {
      window.clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
    if (fpsIntervalRef.current !== null) {
      window.clearInterval(fpsIntervalRef.current);
      fpsIntervalRef.current = null;
    }
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingFrameRef.current?.close();
    pendingFrameRef.current = null;
    const socket = wsRef.current;
    wsRef.current = null;
    if (socket && (socket.readyState === 0 || socket.readyState === 1)) socket.close();
    const decoder = decoderRef.current;
    decoderRef.current = null;
    if (decoder && decoder.state !== "closed") decoder.close();
    setFps(0);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      teardown();
    };
  }, [teardown]);

  /**
   * Reconexión automática ante cierres NO intencionales: backoff exponencial
   * (500ms base, tope 5s) que se resetea si la sesión previa estuvo estable.
   * Reconectar re-corre startStream completo; el bridge re-envía el GOP cache
   * al reconnectar, así que la vista vuelve sola al borde en vivo.
   */
  const scheduleReconnect = useCallback((targetSerial: string) => {
    if (!mountedRef.current) return;
    const now = performance.now();
    if (stableSessionAtRef.current !== null && now - stableSessionAtRef.current >= RECONNECT_STABLE_SESSION_MS) {
      reconnectAttemptsRef.current = 0;
    }
    stableSessionAtRef.current = null;
    const attempt = reconnectAttemptsRef.current;
    reconnectAttemptsRef.current = attempt + 1;
    const delay = Math.min(RECONNECT_BASE_DELAY_MS * 2 ** attempt, RECONNECT_MAX_DELAY_MS);
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      if (!mountedRef.current) return;
      setErrorMessage("");
      startStreamRef.current(targetSerial);
    }, delay);
    // Spinner durante el backoff (en vez de overlay de error permanente).
    setErrorMessage("");
    setPhase("connecting");
  }, []);

  const startStream = useCallback((targetSerial: string) => {
    teardown();
    setErrorMessage("");
    setRecovering(false);
    setLiveStats(INITIAL_LIVE_STATS);
    setPhase("connecting");
    stableSessionAtRef.current = null;

    if (typeof VideoDecoder !== "function" || typeof EncodedVideoChunk !== "function") {
      setPhase("error");
      setErrorMessage("Este navegador no soporta WebCodecs, necesario para la vista en vivo. Probá con Chrome o Edge actualizado.");
      return;
    }

    let decoder: VideoDecoder | null = null;
    let headerSeen = false;
    let keySeen = false;
    let decodedFrames = 0;
    let lastFpsTick = 0;
    let lastTimestamp = 0;
    let codecString = AVC_CODEC_STRING;
    let resyncPending = false;
    let resyncCount = 0;
    let decodeErrors = 0;
    let decoderConfig: VideoDecoderConfig | null = null;
    // Gracia inicial: al conectar, el bridge vuelca el GOP cacheado de golpe y
    // decodeQueueSize supera el máximo sin que sea congestión real. No evaluamos
    // backpressure hasta renderizar el primer frame posterior al keyframe inicial.
    let backpressureGrace = true;
    // Medición de sobrecarga SOSTENIDA: lecturas consecutivas por encima del
    // máximo (o milisegundos acumulados) antes de armar un resync.
    let overloadSince: number | null = null;
    let overloadReadings = 0;
    // Watchdogs: última actividad del socket y último output del decoder.
    let lastActivityAt = performance.now();
    let lastOutputAt = performance.now();

    const fail = (message: string) => {
      teardown();
      setPhase("error");
      setErrorMessage(message);
    };

    /** Render alineado a vsync: siempre gana el cuadro más fresco. */
    const render = () => {
      rafRef.current = null;
      const frame = pendingFrameRef.current;
      pendingFrameRef.current = null;
      if (!frame) return;
      const canvas = canvasRef.current;
      const ctx = (ctxRef.current ??= canvas?.getContext("2d", { alpha: false, desynchronized: true }) ?? null);
      if (canvas && ctx) {
        if (canvas.width !== frame.displayWidth) canvas.width = frame.displayWidth;
        if (canvas.height !== frame.displayHeight) canvas.height = frame.displayHeight;
        // El escalado real lo hace CSS con object-fit: contain.
        ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
      }
      frame.close();
      decodedFrames += 1;
      backpressureGrace = false; // fin de la ventana del replay del GOP cacheado
      setRecovering(false); // hay output fresco: salimos del estado de recuperación
      if (decodedFrames === 1) {
        setPhase("live");
        stableSessionAtRef.current = performance.now(); // arranque de la sesión "estable"
      }
      // Progreso saludable sostenido: los errores aislados viejos no se acumulan
      // hasta matar la vista en sesiones largas.
      if (decodedFrames % DECODE_ERRORS_DECAY_FRAMES === 0) decodeErrors = 0;
    };

    const onDecoderOutput = (frame: VideoFrame) => {
      pendingFrameRef.current?.close(); // descarta el anterior: mínima latencia de display
      pendingFrameRef.current = frame;
      lastOutputAt = performance.now();
      if (rafRef.current === null) rafRef.current = window.requestAnimationFrame(render);
    };

    const buildDecoder = () => {
      if (!decoderConfig) return;
      decoder = new VideoDecoder({
        output: onDecoderOutput,
        error: () => {
          // Un gap de deltas puede romper el decode: re-armamos y esperamos el
          // próximo IDR. Solo rendimos tras errores persistentes.
          decodeErrors += 1;
          if (decodeErrors > 5 || wsRef.current === null) {
            teardown();
            setPhase("error");
            setErrorMessage("Error de decodificación de video persistente.");
            return;
          }
          try {
            decoder?.close();
          } catch {
            /* ya estaba cerrado */
          }
          keySeen = false;
          resyncPending = false;
          overloadSince = null;
          overloadReadings = 0;
          buildDecoder();
        },
      });
      decoder.configure(decoderConfig);
      decoderRef.current = decoder;
    };

    const feed = (bytes: Uint8Array, isKey: boolean) => {
      if (!decoder || decoder.state !== "configured") return;
      if (isKey) {
        if (resyncPending) {
          try {
            decoder.reset(); // tira la cola atrasada; vuelve a "configured"
          } catch {
            /* si falla, el error handler rearma */
          }
          resyncPending = false;
        }
        overloadSince = null;
        overloadReadings = 0;
      } else {
        if (resyncPending) return; // descartando deltas hasta el próximo IDR
        const queueSize = decoder.decodeQueueSize;
        if (queueSize >= MAX_DECODE_QUEUE && !backpressureGrace) {
          const now = performance.now();
          if (overloadSince === null) {
            overloadSince = now;
            overloadReadings = 1;
          } else {
            overloadReadings += 1;
          }
          // Solo armamos resync si la sobrecarga es SOSTENIDA: una ráfaga aislada
          // se absorbe descartando algún delta suelto, sin congelar hasta el IDR.
          if (overloadReadings >= BACKPRESSURE_MIN_OVERLOAD_READINGS || now - overloadSince > BACKPRESSURE_SUSTAINED_MS) {
            resyncPending = true;
            resyncCount += 1;
            overloadSince = null;
            overloadReadings = 0;
            try {
              decoder.reset(); // drena la latencia acumulada YA, no recién en el IDR
            } catch {
              /* si falla, el error handler rearma */
            }
          }
          return; // el delta sobrante se descarta (midiendo o ya en resync)
        }
        if (queueSize < MAX_DECODE_QUEUE) {
          overloadSince = null;
          overloadReadings = 0;
        }
      }
      let timestamp = Math.round(performance.now() * 1000);
      if (timestamp <= lastTimestamp) timestamp = lastTimestamp + 1;
      lastTimestamp = timestamp;
      try {
        decoder.decode(new EncodedVideoChunk({ type: isKey ? "key" : "delta", timestamp, data: bytes }));
      } catch {
        // Carrera con el reset/rearme del resync: se recupera solo con el próximo IDR.
      }
    };

    try {
      const socket = new WebSocket(withToken(`${toWsUrl(bridgeUrl)}/ws/stream/${encodeURIComponent(targetSerial)}`));
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;

      socket.onmessage = (event: MessageEvent) => {
        lastActivityAt = performance.now(); // alimenta el watchdog de estancamiento
        const data: unknown = event.data;
        if (typeof data === "string") {
          if (headerSeen) {
            // Mensajes de control posteriores al header: errores o avisos del bridge.
            try {
              const control = JSON.parse(data) as { type?: string; message?: string };
              if (control?.type === "error") {
                fail(control.message || "El bridge reportó un error.");
              } else if (control?.type === "waiting") {
                // El bridge entró en su ciclo de recuperación del stream: pasamos a
                // sub-fase "recuperando" SIN cerrar socket ni decoder.
                setRecovering(true);
              }
            } catch {
              // Texto no-JSON: ignorar.
            }
            return;
          }
          let header: (StreamHeader & { type?: unknown; message?: unknown }) | null = null;
          try {
            header = JSON.parse(data) as StreamHeader & { type?: unknown; message?: unknown };
          } catch {
            return;
          }
          if (!header || typeof header !== "object") return;
          if (typeof header.type === "string") {
            // Control antes del header (poco común): mismos comportamientos.
            if (header.type === "error") {
              fail(typeof header.message === "string" && header.message ? header.message : "El bridge reportó un error.");
            } else if (header.type === "waiting") {
              setRecovering(true);
            }
            return;
          }
          headerSeen = true;
          const codec = normalizeCodec(header.codec);
          if (!codec) {
            fail(`Códec de video no soportado (${String(header.codec)}).`);
            return;
          }
          codecString = codec;
          try {
            const config: VideoDecoderConfig = { codec, optimizeForLatency: true };
            if (header.description) config.description = base64ToBytes(header.description);
            decoderConfig = config;
            buildDecoder();
            lastFpsTick = decodedFrames;
            fpsIntervalRef.current = window.setInterval(() => {
              setFps(decodedFrames - lastFpsTick);
              lastFpsTick = decodedFrames;
              // Instrumentación observable para pruebas automatizadas / diagnóstico.
              setLiveStats({
                resyncCount,
                decodeErrors,
                lastMsgAgeMs: Math.max(0, Math.round(performance.now() - lastActivityAt)),
                queueSize: decoder ? decoder.decodeQueueSize : 0,
              });
              const now = performance.now();
              if (now - lastActivityAt > WATCHDOG_STALL_MS) {
                // Socket half-open u origen colgado: cierre deliberado → onclose
                // dispara la reconexión automática.
                try {
                  socket.close();
                } catch {
                  /* ya cerrado */
                }
                return;
              }
              if (resyncPending && now - lastOutputAt > RESYNC_OUTPUT_TIMEOUT_MS) {
                // Resync esperando un IDR que nunca llega: la reconexión trae un
                // GOP fresco desde el cache del bridge.
                try {
                  socket.close();
                } catch {
                  /* ya cerrado */
                }
              }
            }, 1000);
          } catch (cause) {
            fail(cause instanceof Error ? cause.message : "No se pudo configurar el decodificador.");
          }
          return;
        }
        if (!(data instanceof ArrayBuffer)) return;
        if (!decoder || decoder.state !== "configured") return; // binario antes del header: ignorar
        const bytes = new Uint8Array(data);
        const keyHint = looksLikeKeyFrame(bytes, codecString);
        const isKey = keyHint === null ? !keySeen : keyHint;
        if (!keySeen) {
          // Descartamos frames hasta el primer keyframe: el decoder no puede
          // arrancar con deltas y el bridge re-envía config al reiniciar stream.
          if (!isKey) return;
          keySeen = true;
        }
        feed(bytes, isKey);
      };

      let reconnectRequested = false;
      /** Cierre NO intencional: limpiar y programar reconexión con backoff. */
      const requestReconnect = () => {
        if (reconnectRequested) return;
        reconnectRequested = true;
        if (wsRef.current !== socket) return; // cierre local intencional ya gestionado
        teardown(); // el socket ya está cerrando/cerrado; limpia timers, decoder y frame
        scheduleReconnect(targetSerial);
      };
      socket.onerror = () => requestReconnect();
      socket.onclose = () => requestReconnect();
      connectTimeoutRef.current = window.setTimeout(() => {
        // Timeout cubre solo CONNECTING: tratamos el intento como fallido y
        // reconectamos con backoff en lugar de rendir permanentemente.
        if (wsRef.current === socket && socket.readyState === 0) requestReconnect();
      }, WS_CONNECT_TIMEOUT_MS);
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "No se pudo iniciar la transmisión.");
    }
  }, [bridgeUrl, scheduleReconnect, teardown]);

  // Referencia usada por scheduleReconnect para relanzar el intento más reciente.
  useEffect(() => {
    startStreamRef.current = startStream;
  }, [startStream]);

  const onlineDevices = devicesState.status === "ready"
    ? devicesState.devices.filter((item) => item.online !== false)
    : [];
  const aliasMatches = onlineDevices.filter(
    (item) => (item.alias || "").trim().toLowerCase() === deviceAlias.trim().toLowerCase(),
  );

  // Resolución automática de serial solo si el alias matchea exactamente uno.
  useEffect(() => {
    if (autoResolvedRef.current || serial || devicesState.status !== "ready") return;
    if (aliasMatches.length !== 1) return; // 0 o >1 matches → selección manual
    // Diferido: la regla react-hooks/set-state-in-effect prohíbe setState síncrono en el body.
    const timerId = window.setTimeout(() => {
      autoResolvedRef.current = true;
      setSerial(aliasMatches[0].serial);
      startStream(aliasMatches[0].serial);
    }, 0);
    return () => window.clearTimeout(timerId);
  }, [aliasMatches, devicesState.status, serial, startStream]);

  const retry = useCallback(() => {
    teardown();
    reconnectAttemptsRef.current = 0; // reintento manual: backoff fresco
    autoResolvedRef.current = false;
    setSerial(null);
    setPickedSerial("");
    setErrorMessage("");
    setPhase("idle");
    setAttempt((value) => value + 1);
  }, [teardown]);

  const stopAndClose = useCallback(() => {
    teardown();
    onClose();
  }, [teardown, onClose]);

  /** Botón ⟳: corta la conexión actual y reconecta al instante, sin esperar backoff. */
  const forceReconnect = useCallback(() => {
    if (!serial) return;
    reconnectAttemptsRef.current = 0; // reconexión manual: backoff fresco
    startStream(serial); // startStream ya hace teardown y resetea fases
  }, [serial, startStream]);

  const confirmManualSerial = () => {
    if (!pickedSerial) return;
    setSerial(pickedSerial);
    startStream(pickedSerial);
  };

  const recoveringView = phase === "live" && recovering;

  return (
    <section
      className="cc-live-panel"
      data-phase={recoveringView ? "recovering" : phase}
      data-resync-count={liveStats.resyncCount}
      data-decode-errors={liveStats.decodeErrors}
      data-last-msg-age-ms={liveStats.lastMsgAgeMs}
      data-queue-size={liveStats.queueSize}
    >
      <div className="cc-live-head">
        <strong className="cc-live-title">Vista en vivo</strong>
        <div className="cc-live-status">
          {phase === "live" && !recoveringView && (
            <>
              <span className="cc-live-badge"><i className="cc-live-dot" aria-hidden="true" />EN VIVO</span>
              {fps > 0 && <span className="cc-live-fps">{fps} fps</span>}
            </>
          )}
          {(phase === "connecting" || recoveringView) && (
            <><span className="cc-live-spinner" aria-hidden="true" /><span>{recoveringView ? "Recuperando…" : "Conectando…"}</span></>
          )}
          {serial && (phase === "live" || phase === "connecting") && (
            <button type="button" className="cc-live-reconnect" title="Forzar reconexión" aria-label="Forzar reconexión de la vista en vivo" onClick={forceReconnect}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
            </button>
          )}
          <button type="button" className="cc-live-close" title="Cerrar vista en vivo" aria-label="Cerrar vista en vivo" onClick={stopAndClose}>×</button>
        </div>
      </div>

      <div className="cc-live-canvas-wrap">
        <canvas ref={canvasRef} className="cc-live-canvas" role="img" aria-label={`Transmisión en vivo de ${deviceAlias}`} />
        {((phase !== "live" && phase !== "connecting") || recoveringView) && (
          <div className="cc-live-placeholder">
            {phase === "error" ? "Sin señal" : recoveringView ? "Recuperando transmisión…" : "Esperando transmisión…"}
          </div>
        )}
      </div>

      {devicesState.status === "loading" && <p className="cc-live-hint">Buscando dispositivos en el bridge…</p>}

      {devicesState.status === "error" && (
        <div className="cc-live-error" role="alert">
          <span>Error: {devicesState.error}</span>
          <button type="button" className="cc-button cc-button-ghost" onClick={retry}>Reintentar</button>
        </div>
      )}

      {devicesState.status === "ready" && !serial && (
        onlineDevices.length ? (
          <div className="cc-live-pick">
            {aliasMatches.length === 0 && (
              <small>No encontramos «{deviceAlias}» entre los dispositivos del bridge. Elegí el serial manualmente:</small>
            )}
            {aliasMatches.length > 1 && (
              <small>«{deviceAlias}» coincide con varios dispositivos. Elegí el serial:</small>
            )}
            <label>
              Elegir dispositivo
              <select value={pickedSerial} onChange={(event) => setPickedSerial(event.target.value)}>
                <option value="">Elegir dispositivo…</option>
                {onlineDevices.map((item) => (
                  <option key={item.serial} value={item.serial}>
                    {item.alias || item.model || "Sin alias"} · {item.serial}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="cc-button cc-button-primary" onClick={confirmManualSerial} disabled={!pickedSerial}>
              Ver pantalla<span aria-hidden="true">→</span>
            </button>
          </div>
        ) : (
          <p className="cc-live-hint">No hay dispositivos online en el bridge.</p>
        )
      )}

      {phase === "error" && (
        <div className="cc-live-error" role="alert">
          <span>Error: {errorMessage}</span>
          <button type="button" className="cc-button cc-button-ghost" onClick={retry}>Reintentar</button>
        </div>
      )}

      {(phase === "connecting" || phase === "live") && (
        <button type="button" className="cc-button cc-button-muted cc-live-stop" onClick={stopAndClose}>
          <span aria-hidden="true">■</span>Detener
        </button>
      )}
    </section>
  );
}
