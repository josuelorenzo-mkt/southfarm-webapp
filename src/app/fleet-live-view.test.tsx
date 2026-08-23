// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceLiveView, LiveViewToggle } from "./fleet-live-view";

class StubVideoFrame {
  static closed = 0;
  displayWidth = 9;
  displayHeight = 19;
  close() { StubVideoFrame.closed += 1; }
}

class StubEncodedVideoChunk {
  static created: Array<{ type: string; timestamp: number }> = [];
  readonly type: string;
  readonly timestamp: number;
  constructor(init: { type: string; timestamp: number }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    StubEncodedVideoChunk.created.push({ type: init.type, timestamp: init.timestamp });
  }
}

class StubVideoDecoder {
  static instances: StubVideoDecoder[] = [];
  state = "unconfigured";
  config: Record<string, unknown> | null = null;
  lastChunk: unknown = null;
  decodeQueueSize = 0;
  resetCalls = 0;
  constructor(public init: { output: (frame: unknown) => void; error: (cause: unknown) => void }) {
    StubVideoDecoder.instances.push(this);
  }
  configure(config: Record<string, unknown>) {
    this.state = "configured";
    this.config = config;
  }
  decode(chunk: unknown) {
    this.lastChunk = chunk;
    this.init.output(new StubVideoFrame());
  }
  reset() {
    // Igual que el decoder real: tira la cola y vuelve a "configured".
    this.resetCalls += 1;
    this.lastChunk = null;
  }
  close() {
    this.state = "closed";
  }
}

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  url: string;
  binaryType = "blob";
  readyState = 0;
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
  sentData: unknown[] = [];
  send(data: unknown) {
    this.sentData.push(data);
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.onclose?.();
  }
  serverAccept() {
    this.readyState = 1;
    this.onopen?.();
  }
  serverText(text: string) {
    this.onmessage?.({ data: text });
  }
  serverBinary(buffer: ArrayBuffer) {
    this.onmessage?.({ data: buffer });
  }
}

const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>>();
let devicesPayload: Array<Record<string, unknown>> = [];

function okJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

function stubWebCodecs() {
  StubVideoDecoder.instances = [];
  StubEncodedVideoChunk.created = [];
  StubVideoFrame.closed = 0;
  vi.stubGlobal("VideoDecoder", StubVideoDecoder as unknown as typeof VideoDecoder);
  vi.stubGlobal("EncodedVideoChunk", StubEncodedVideoChunk as unknown as typeof EncodedVideoChunk);
}

function keyFrameBuffer(): ArrayBuffer {
  // Annex B con un NAL IDR (type 5): 00 00 00 01 65 ...
  return new Uint8Array([0, 0, 0, 1, 0x65, 0x88, 0x84, 0x00, 0x10, 0xff]).buffer;
}

function deltaFrameBuffer(): ArrayBuffer {
  // Annex B con un NAL no-IDR (type 1): 00 00 00 01 41 ...
  return new Uint8Array([0, 0, 0, 1, 0x41, 0x9a, 0x02, 0x05]).buffer;
}

function panelElement(): HTMLElement {
  return document.querySelector("section.cc-live-panel") as HTMLElement;
}

beforeEach(() => {
  MockWebSocket.instances = [];
  devicesPayload = [
    { serial: "SER-1", alias: "Poco Uno", model: "POCO X6", online: true },
    { serial: "SER-2", alias: "Moto Dos", model: "Moto G", online: true },
  ];
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/api/health")) return okJson({ status: "ok" });
    if (url.endsWith("/api/devices")) return okJson(devicesPayload);
    throw new Error(`ruta inesperada: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", MockWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Lleva la vista hasta EN VIVO y devuelve el socket usado. */
async function goLive(alias = "Poco Uno") {
  stubWebCodecs();
  render(<DeviceLiveView bridgeUrl="http://localhost:8100" deviceAlias={alias} onClose={vi.fn()} />);
  await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
  const socket = MockWebSocket.instances[0];
  await act(async () => {
    socket.serverAccept();
    socket.serverText(JSON.stringify({ codec: "h264", description: null }));
    socket.serverBinary(keyFrameBuffer());
  });
  expect(await screen.findByText("EN VIVO")).toBeTruthy();
  return socket;
}

describe("Vista en vivo de Device Fleet", () => {
  it('el toggle alterna entre "Ver pantalla" y "Detener" y emite el click', () => {
    const onClick = vi.fn();
    const view = render(<LiveViewToggle active={false} onClick={onClick} />);
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-label")).toBe("Ver pantalla del dispositivo");
    expect(toggle.textContent).toContain("Ver pantalla");

    fireEvent.click(toggle);
    expect(onClick).toHaveBeenCalledTimes(1);

    view.rerender(<LiveViewToggle active onClick={onClick} />);
    expect(screen.getByRole("button").textContent).toContain("Detener");
    expect(screen.getByRole("button").getAttribute("aria-label")).toBe("Detener vista en vivo");
  });

  it("muestra el estado de error cuando el bridge no responde y permite reintentar", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<DeviceLiveView bridgeUrl="http://localhost:8100" deviceAlias="Poco Uno" onClose={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Error:");
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeTruthy();
    expect(MockWebSocket.instances).toHaveLength(0); // nunca abre stream sin bridge
  });

  it("sin WebCodecs muestra el error antes de abrir el WebSocket", async () => {
    vi.stubGlobal("VideoDecoder", undefined);
    render(<DeviceLiveView bridgeUrl="http://localhost:8100" deviceAlias="Poco Uno" onClose={vi.fn()} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("WebCodecs");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("WebCodecs"));
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("resuelve el serial por alias único, configura el decoder y entra en vivo", async () => {
    stubWebCodecs();
    const onClose = vi.fn();
    render(<DeviceLiveView bridgeUrl="http://localhost:8100/" deviceAlias="Poco Uno" onClose={onClose} />);

    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    expect(socket.url).toBe("ws://localhost:8100/ws/stream/SER-1");
    expect(socket.binaryType).toBe("arraybuffer");

    await act(async () => {
      socket.serverAccept();
      socket.serverText(JSON.stringify({ codec: "h264", description: null }));
    });

    expect(StubVideoDecoder.instances).toHaveLength(1);
    expect(StubVideoDecoder.instances[0].config).toMatchObject({ codec: "avc1.640034", optimizeForLatency: true });

    await act(async () => {
      socket.serverBinary(keyFrameBuffer());
    });

    expect(await screen.findByText("EN VIVO")).toBeTruthy();
    expect(StubEncodedVideoChunk.created[0]?.type).toBe("key");
    expect(StubVideoFrame.closed).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar vista en vivo" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(socket.closed).toBe(true);
    expect(StubVideoDecoder.instances[0].state).toBe("closed");
  });

  it("pide elegir el serial manualmente cuando el alias coincide con varios dispositivos", async () => {
    stubWebCodecs();
    devicesPayload = [
      { serial: "SER-A", alias: "Granja Norte", model: "POCO X6", online: true },
      { serial: "SER-B", alias: "Granja Norte", model: "Moto G", online: true },
      { serial: "SER-C", alias: "Otra finca", model: "Galaxy A", online: false },
    ];
    render(<DeviceLiveView bridgeUrl="http://localhost:8100" deviceAlias="Granja Norte" onClose={vi.fn()} />);

    const select = (await screen.findByLabelText("Elegir dispositivo")) as HTMLSelectElement;
    expect(select.value).toBe("");
    // Solo los online entran en la lista
    expect(screen.getByRole("option", { name: /SER-A/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /SER-B/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /SER-C/ })).toBeNull();

    fireEvent.change(select, { target: { value: "SER-B" } });
    fireEvent.click(screen.getByRole("button", { name: /Ver pantalla/ }));

    await waitFor(() => {
      expect(MockWebSocket.instances.map((socket) => socket.url)).toEqual(["ws://localhost:8100/ws/stream/SER-B"]);
    });
    expect(await screen.findByText("Conectando…")).toBeTruthy();
  });

  it("la ráfaga inicial del GOP cacheado no dispara descarte ni reset del decoder", async () => {
    stubWebCodecs();
    render(<DeviceLiveView bridgeUrl="http://localhost:8100" deviceAlias="Poco Uno" onClose={vi.fn()} />);
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
    const socket = MockWebSocket.instances[0];
    await act(async () => {
      socket.serverAccept();
      socket.serverText(JSON.stringify({ codec: "h264", description: null }));
    });
    const decoder = StubVideoDecoder.instances[0];
    decoder.decodeQueueSize = 5; // cola llena instantánea, como en el replay real del cache
    await act(async () => {
      socket.serverBinary(keyFrameBuffer());
      for (let i = 0; i < 12; i += 1) socket.serverBinary(deltaFrameBuffer()); // ráfaga del GOP
    });
    expect(decoder.resetCalls).toBe(0); // gracia inicial: nada se reseteó
    const types = StubEncodedVideoChunk.created.map((chunk) => chunk.type);
    expect(types[0]).toBe("key");
    expect(types.filter((type) => type === "delta")).toHaveLength(12); // ningún delta descartado
    expect(await screen.findByText("EN VIVO")).toBeTruthy();
  });

  it("descarta deltas solo ante sobrecarga sostenida y vuelve con el próximo IDR", async () => {
    const socket = await goLive(); // al terminar goLive ya se renderizó un frame: gracia levantada
    const decoder = StubVideoDecoder.instances[0];
    decoder.decodeQueueSize = 5;
    await act(async () => {
      socket.serverBinary(deltaFrameBuffer()); // lectura 1: se mide, aún no arma resync
    });
    expect(decoder.resetCalls).toBe(0);
    await act(async () => {
      socket.serverBinary(deltaFrameBuffer()); // lectura 2 consecutiva: resync armado + reset inmediato
    });
    expect(decoder.resetCalls).toBe(1);
    await act(async () => {
      socket.serverBinary(deltaFrameBuffer()); // en resync: delta descartado sin crear chunk
    });
    const totalAntesDelIdr = StubEncodedVideoChunk.created.length;
    await act(async () => {
      socket.serverBinary(keyFrameBuffer()); // IDR cierra el resync y se alimenta
    });
    const created = StubEncodedVideoChunk.created;
    expect(created.length).toBe(totalAntesDelIdr + 1);
    expect(created[created.length - 1].type).toBe("key");
  });

  it("reconecta automáticamente cuando el WebSocket se cierra sin intención", async () => {
    const socket = await goLive();
    await act(async () => {
      socket.close(); // cierre remoto simulado (no intencional)
    });
    expect(await screen.findByText("Conectando…")).toBeTruthy(); // spinner, no overlay permanente
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2), { timeout: 4000 });
    const secondSocket = MockWebSocket.instances[1];
    expect(secondSocket.url).toBe("ws://localhost:8100/ws/stream/SER-1"); // misma fuente
    expect(secondSocket).not.toBe(socket);
    await act(async () => {
      secondSocket.serverAccept();
      secondSocket.serverText(JSON.stringify({ codec: "h264", description: null }));
      secondSocket.serverBinary(keyFrameBuffer());
    });
    expect(await screen.findByText("EN VIVO")).toBeTruthy();
    expect(screen.queryByText(/Sin señal/i)).toBeNull();
  });

  it("watchdog: sin mensajes del bridge por más de 8s cierra y reconecta solo", { timeout: 20000 }, async () => {
    await goLive();
    // Sin enviar nada, dejamos correr el reloj real hasta superar WATCHDOG_STALL_MS.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 8600));
    });
    await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2), { timeout: 4000 });
    expect(MockWebSocket.instances[1].url).toBe("ws://localhost:8100/ws/stream/SER-1");
    expect(screen.queryByText(/Sin señal/i)).toBeNull();
  });

  it('maneja {type:"waiting"} como recuperación sin cortar la conexión y expone data-*', async () => {
    const socket = await goLive();
    const panel = panelElement();
    expect(panel.getAttribute("data-phase")).toBe("live");

    await act(async () => {
      socket.serverText(JSON.stringify({ type: "waiting" })); // bridge entrando a su ciclo de recuperación
    });
    expect(screen.getByText("Recuperando transmisión…")).toBeTruthy();
    expect(socket.closed).toBe(false); // la conexión NO se corta
    expect(StubVideoDecoder.instances[0].state).toBe("configured"); // decoder intacto
    expect(panel.getAttribute("data-phase")).toBe("recovering");

    await act(async () => {
      socket.serverBinary(keyFrameBuffer()); // el stream vuelve
    });
    expect(await screen.findByText("EN VIVO")).toBeTruthy();
    expect(panel.getAttribute("data-phase")).toBe("live");
    // Instrumentación completa visible tras el tick del interval de stats.
    await waitFor(() => {
      expect(panel.getAttribute("data-resync-count")).not.toBeNull();
      expect(panel.getAttribute("data-decode-errors")).not.toBeNull();
      expect(panel.getAttribute("data-queue-size")).not.toBeNull();
      expect(panel.getAttribute("data-last-msg-age-ms")).not.toBeNull();
    });
  });
});
