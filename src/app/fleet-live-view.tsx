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
// ~166 ms a 30fps: si la cola de decode supera esto, se descartan deltas hasta
// el próximo IDR y se resetea el decoder para volver al borde en vivo.
const MAX_DECODE_QUEUE = 5;

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

function bridgeBase(bridgeUrl: string): string {
  return bridgeUrl.replace(/\/$/, "");
}

function toWsUrl(bridgeUrl: string): string {
  return bridgeBase(bridgeUrl).replace(/^http/i, "ws");
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
          fetch(`${base}/api/health`, { cache: "no-store", signal: controller.signal }),
          fetch(`${base}/api/devices`, { cache: "no-store", signal: controller.signal }),
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

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const decoderRef = useRef<VideoDecoder | null>(null);
  const fpsIntervalRef = useRef<number | null>(null);
  const connectTimeoutRef = useRef<number | null>(null);
  const autoResolvedRef = useRef(false);
  const pendingFrameRef = useRef<VideoFrame | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

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

  useEffect(() => () => teardown(), [teardown]);

  const startStream = useCallback((targetSerial: string) => {
    teardown();
    setErrorMessage("");
    setPhase("connecting");

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
    let decodeErrors = 0;
    let decoderConfig: VideoDecoderConfig | null = null;

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
      if (decodedFrames === 1) setPhase("live");
    };

    const onDecoderOutput = (frame: VideoFrame) => {
      pendingFrameRef.current?.close(); // descarta el anterior: mínima latencia de display
      pendingFrameRef.current = frame;
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
          buildDecoder();
        },
      });
      decoder.configure(decoderConfig);
      decoderRef.current = decoder;
    };

    const feed = (bytes: Uint8Array, isKey: boolean) => {
      if (!decoder || decoder.state !== "configured") return;
      // Backpressure: si la cola de decode crece, descartamos deltas hasta el
      // próximo IDR y reseteamos para volver al borde en vivo sin acumular latencia.
      if (!isKey && decoder.decodeQueueSize >= MAX_DECODE_QUEUE) {
        resyncPending = true;
        return;
      }
      if (isKey && resyncPending) {
        try {
          decoder.reset(); // tira la cola atrasada; vuelve a "configured"
        } catch {
          /* si falla, el error handler rearma */
        }
        resyncPending = false;
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
      const socket = new WebSocket(`${toWsUrl(bridgeUrl)}/ws/stream/${encodeURIComponent(targetSerial)}`);
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;

      socket.onmessage = (event: MessageEvent) => {
        const data: unknown = event.data;
        if (typeof data === "string") {
          if (headerSeen) {
            // Mensajes de control posteriores al header: ej. errores reportados por el bridge.
            try {
              const control = JSON.parse(data) as { type?: string; message?: string };
              if (control?.type === "error") fail(control.message || "El bridge reportó un error.");
            } catch {
              // Texto no-JSON: ignorar.
            }
            return;
          }
          let header: StreamHeader | null = null;
          try {
            header = JSON.parse(data) as StreamHeader;
          } catch {
            return;
          }
          if (!header || typeof header !== "object") return;
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

      socket.onerror = () => {
        if (wsRef.current === socket) fail("No se pudo conectar con el bridge de pantalla.");
      };
      socket.onclose = () => {
        if (wsRef.current !== socket) return; // cierre local intencional ya gestionado
        wsRef.current = null;
        if (decoder && decoder.state !== "closed") decoder.close();
        fail("La conexión con el bridge de pantalla se cerró.");
      };
      connectTimeoutRef.current = window.setTimeout(() => {
        if (wsRef.current === socket && socket.readyState === 0) fail("Tiempo de espera agotado con el bridge de pantalla.");
      }, WS_CONNECT_TIMEOUT_MS);
    } catch (cause) {
      fail(cause instanceof Error ? cause.message : "No se pudo iniciar la transmisión.");
    }
  }, [bridgeUrl, teardown]);

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

  const confirmManualSerial = () => {
    if (!pickedSerial) return;
    setSerial(pickedSerial);
    startStream(pickedSerial);
  };

  return (
    <section className="cc-live-panel">
      <div className="cc-live-head">
        <strong className="cc-live-title">Vista en vivo</strong>
        <div className="cc-live-status">
          {phase === "live" && (
            <>
              <span className="cc-live-badge"><i className="cc-live-dot" aria-hidden="true" />EN VIVO</span>
              {fps > 0 && <span className="cc-live-fps">{fps} fps</span>}
            </>
          )}
          {phase === "connecting" && (
            <><span className="cc-live-spinner" aria-hidden="true" /><span>Conectando…</span></>
          )}
          <button type="button" className="cc-live-close" title="Cerrar vista en vivo" aria-label="Cerrar vista en vivo" onClick={stopAndClose}>×</button>
        </div>
      </div>

      <div className="cc-live-canvas-wrap">
        <canvas ref={canvasRef} className="cc-live-canvas" role="img" aria-label={`Transmisión en vivo de ${deviceAlias}`} />
        {phase !== "live" && phase !== "connecting" && (
          <div className="cc-live-placeholder">{phase === "error" ? "Sin señal" : "Esperando transmisión…"}</div>
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
