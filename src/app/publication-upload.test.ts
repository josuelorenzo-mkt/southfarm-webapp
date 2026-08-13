// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { uploadPublication } from "./publication-upload";

type Plan = { status?: number; body?: unknown; event?: "load" | "error" };

class FakeXhr {
  static plans: Plan[] = [];
  static instances: FakeXhr[] = [];

  status = 0;
  responseText = "";
  upload = { onprogress: null as ((event: ProgressEvent) => void) | null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  method = "";
  url = "";
  headers = new Map<string, string>();
  sentBody: Document | XMLHttpRequestBodyInit | null = null;
  aborted = false;

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }

  send(body?: Document | XMLHttpRequestBodyInit | null) {
    this.sentBody = body ?? null;
    const plan = FakeXhr.plans.shift() ?? { event: "error" as const };
    queueMicrotask(() => {
      if (this.aborted) return;
      if (plan.event === "error") {
        this.onerror?.();
        return;
      }
      this.status = plan.status ?? 200;
      this.responseText = JSON.stringify(plan.body ?? {});
      this.onload?.();
    });
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.onabort?.();
  }

  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
}

const createRequest = () => new FakeXhr() as unknown as XMLHttpRequest;
const storedValues = new Map<string, string>();

beforeAll(() => {
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      clear: () => storedValues.clear(),
      getItem: (key: string) => storedValues.get(key) ?? null,
      removeItem: (key: string) => storedValues.delete(key),
      setItem: (key: string, value: string) => storedValues.set(key, String(value)),
    },
  });
});

function formData() {
  const body = new FormData();
  body.set("platform", "instagram");
  body.set("caption", "caption breve");
  return body;
}

describe("uploadPublication", () => {
  beforeEach(() => {
    window.localStorage.clear();
    FakeXhr.plans = [];
    FakeXhr.instances = [];
  });

  it("prefers the current local token over a stale prop token", async () => {
    window.localStorage.setItem("southfarm_token", "rotated-token");
    FakeXhr.plans.push({ status: 201, body: { publication: { id: 41 } } });

    await uploadPublication({
      apiBase: "https://api.example",
      token: "stale-prop-token",
      body: formData(),
      createRequest,
    });

    expect(FakeXhr.instances[0].headers.get("Authorization")).toBe("Bearer rotated-token");
  });

  it("refreshes once after 401 and recreates the multipart request", async () => {
    window.localStorage.setItem("southfarm_token", "expired-token");
    FakeXhr.plans.push(
      { status: 401, body: { error: "expired" } },
      { status: 201, body: { publication: { id: 42 } } },
    );
    const refreshAccessToken = vi.fn(async () => {
      window.localStorage.setItem("southfarm_token", "fresh-token");
      return "fresh-token";
    });
    const progress: number[] = [];
    const body = formData();

    const pending = uploadPublication({
      apiBase: "https://api.example",
      token: "stale-prop-token",
      body,
      createRequest,
      refreshAccessToken,
      onProgress: (value) => progress.push(value),
    });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0].progress(1, 2);
    const result = await pending;

    expect(result).toEqual({ publication: { id: 42 } });
    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(FakeXhr.instances).toHaveLength(2);
    expect(FakeXhr.instances[1]).not.toBe(FakeXhr.instances[0]);
    expect(FakeXhr.instances[1].headers.get("Authorization")).toBe("Bearer fresh-token");
    expect(FakeXhr.instances.map((request) => request.sentBody)).toEqual([body, body]);
    expect((FakeXhr.instances[1].sentBody as FormData).get("caption")).toBe("caption breve");
    expect(progress).toEqual([50, 0]);
  });

  it("surfaces the original 401 when refresh fails without retrying the upload", async () => {
    FakeXhr.plans.push({ status: 401, body: { error: "Sesión vencida" } });
    const refreshAccessToken = vi.fn(async () => null);

    await expect(uploadPublication({
      apiBase: "https://api.example",
      token: "expired-token",
      body: formData(),
      createRequest,
      refreshAccessToken,
    })).rejects.toMatchObject({ status: 401, message: "Sesión vencida" });

    expect(refreshAccessToken).toHaveBeenCalledOnce();
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it.each([
    ["a non-401 response", { status: 500, body: { error: "Backend caído" } }],
    ["an ambiguous network failure", { event: "error" as const }],
  ])("does not retry %s", async (_label, plan) => {
    FakeXhr.plans.push(plan);
    const refreshAccessToken = vi.fn(async () => "unused-token");

    await expect(uploadPublication({
      apiBase: "https://api.example",
      token: "token",
      body: formData(),
      createRequest,
      refreshAccessToken,
    })).rejects.toBeInstanceOf(Error);

    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it("aborts the active XHR and never retries after unmount cancellation", async () => {
    const controller = new AbortController();
    const refreshAccessToken = vi.fn(async () => "unused-token");
    const pending = uploadPublication({
      apiBase: "https://api.example",
      token: "token",
      body: formData(),
      signal: controller.signal,
      createRequest,
      refreshAccessToken,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeXhr.instances[0].aborted).toBe(true);
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(1);
  });
});
