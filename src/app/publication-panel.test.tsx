// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationPanel } from "./publication-panel";

const { authRequestMock, uploadPublicationMock, resolvePublicationReviewMock } = vi.hoisted(() => ({
  authRequestMock: vi.fn(),
  uploadPublicationMock: vi.fn(),
  resolvePublicationReviewMock: vi.fn(),
}));
vi.mock("./auth-client", () => ({ authRequest: authRequestMock }));
vi.mock("./publication-upload", () => ({ uploadPublication: uploadPublicationMock }));
vi.mock("./publication-review", () => ({ resolvePublicationReview: resolvePublicationReviewMock }));
afterEach(() => cleanup());
beforeEach(() => {
  authRequestMock.mockReset();
  authRequestMock.mockResolvedValue({ publications: [] });
  uploadPublicationMock.mockReset();
  resolvePublicationReviewMock.mockReset();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

function reviewJob(id: number, extra: Record<string, unknown> = {}) {
  return {
    id, workspace_id: 1, device_id: 7, social_account_id: 1, platform: "instagram" as const,
    caption: "caption breve", word_count: 2, scheduled_for: "2026-08-13T12:00:00.000Z",
    status: "review_required" as const, current_step: "verifying", progress_percent: 100, attempt_count: 1,
    final_action_at: null, published_at: null, verified_at: null, remote_post_identity: null,
    error_code: null, error_message: null, cancel_requested_at: null,
    created_at: "2026-08-13T12:00:00.000Z", updated_at: "2026-08-13T12:00:00.000Z", completed_at: null,
    ...extra,
  };
}

async function openReviewTab() {
  const tabs = await screen.findAllByRole("tab");
  fireEvent.click(tabs[2]);
  await waitFor(() => expect(screen.queryByText(/cargando publicaciones/i)).toBeNull());
}

const devices = [
  { id: 7, device_id: "phone-7", device_name: "POCO C71", online: true, current_task: null },
  { id: 8, device_id: "phone-8", device_name: "Moto G", online: false, current_task: null },
];
const accounts = [
  { id: 1, device_id: 7, platform: "instagram" as const, username: "cuenta.exacta" },
  { id: 2, device_id: 8, platform: "instagram" as const, username: "otra.cuenta" },
  { id: 3, device_id: 7, platform: "youtube" as const, username: "canal.exacto" },
];

describe("PublicationPanel", () => {
  it("renders an accessible composer and filters accounts by exact device and platform", () => {
    render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage />);
    expect(screen.getByRole("heading", { name: "Crear publicación" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "7" } });
    expect(screen.getByRole("option", { name: /@cuenta\.exacta/ })).toBeTruthy();
    expect(screen.queryByRole("option", { name: /@otra\.cuenta/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /YouTube Shorts/ }));
    expect(screen.getByRole("option", { name: /@canal\.exacto/ })).toBeTruthy();
    expect(screen.getByText("0/10 palabras · 0/100 caracteres")).toBeTruthy();
  });

  it("keeps viewer access read-only", () => {
    render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage={false} />);
    expect(screen.getByText(/solo lectura/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Publicar ahora/ })).toHaveProperty("disabled", true);
  });

  it("shows actionable recovery when the queue receives an unavailable account failure", async () => {
    authRequestMock.mockResolvedValue({
      publications: [{
        id: 42, workspace_id: 1, device_id: 7, social_account_id: 1, platform: "instagram",
        caption: "caption breve", word_count: 2, scheduled_for: "2026-08-13T12:00:00.000Z",
        status: "failed", current_step: "selecting_account", progress_percent: 20, attempt_count: 1,
        final_action_at: null, published_at: null, verified_at: null, remote_post_identity: null,
        error_code: "ACCOUNT_UNAVAILABLE", error_message: "Account unavailable", cancel_requested_at: null,
        created_at: "2026-08-13T12:00:00.000Z", updated_at: "2026-08-13T12:00:00.000Z", completed_at: null,
      }],
    });

    render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage />);
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Cuenta exacta"), { target: { value: "1" } });

    expect((await screen.findByRole("alert")).textContent).toBe(
      "La cuenta seleccionada ya no está disponible en este teléfono. Volvé a escanear sus cuentas o elegí otra cuenta disponible.",
    );
    expect((screen.getByLabelText("Teléfono") as HTMLSelectElement).value).toBe("7");
    expect((screen.getByLabelText("Cuenta exacta") as HTMLSelectElement).value).toBe("1");
  });

  it("keeps the open detail timeline when a queue refresh returns a job without events", async () => {
    const job = {
      id: 43, workspace_id: 1, device_id: 7, social_account_id: 1, platform: "instagram" as const,
      caption: "caption breve", word_count: 2, scheduled_for: "2026-08-13T12:00:00.000Z",
      status: "queued" as const, current_step: "queued", progress_percent: 0, attempt_count: 0,
      final_action_at: null, published_at: null, verified_at: null, remote_post_identity: null,
      error_code: null, error_message: null, cancel_requested_at: null,
      created_at: "2026-08-13T12:00:00.000Z", updated_at: "2026-08-13T12:00:00.000Z", completed_at: null,
    };
    authRequestMock
      .mockResolvedValueOnce({ publications: [job] })
      .mockResolvedValueOnce({ publication: { ...job, events: [{
        id: 9, from_status: null, to_status: "queued", current_step: "queued", message: "Trabajo creado",
        actor_type: "system", created_at: "2026-08-13T12:00:00.000Z", payload: null,
      }] } })
      .mockResolvedValueOnce({ publications: [job] });

    render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver detalle" }));
    expect(await screen.findByText("Trabajo creado")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Actualizar/ }));

    await waitFor(() => expect(authRequestMock).toHaveBeenCalledTimes(3));
    expect(screen.getByText("Trabajo creado")).toBeTruthy();
  });

  it("aborts an active upload when the panel unmounts", async () => {
    let uploadSignal: AbortSignal | undefined;
    uploadPublicationMock.mockImplementation(({ signal }: { signal?: AbortSignal }) => {
      uploadSignal = signal;
      return new Promise((_resolve, reject) => signal?.addEventListener(
        "abort",
        () => reject(new DOMException("cancelled", "AbortError")),
        { once: true },
      ));
    });
    const view = render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage />);
    fireEvent.change(screen.getByLabelText("Teléfono"), { target: { value: "7" } });
    fireEvent.change(screen.getByLabelText("Cuenta exacta"), { target: { value: "1" } });
    fireEvent.change(screen.getByRole("textbox", { name: /Caption/ }), { target: { value: "caption breve" } });
    const input = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["video"], "clip.mp4", { type: "video/mp4" })] } });
    fireEvent.click(screen.getByRole("button", { name: /Publicar ahora/ }));
    await waitFor(() => expect(uploadPublicationMock).toHaveBeenCalledOnce());

    view.unmount();

    expect(uploadSignal?.aborted).toBe(true);
  });

  it("shows review actions and worker evidence only for jobs in review_required", async () => {
    authRequestMock.mockResolvedValue({
      publications: [
        reviewJob(51, { result: "Publish response: { media_id: 1234 }" }),
        reviewJob(52, { status: "queued" as const, current_step: "queued", progress_percent: 0, attempt_count: 0 }),
      ],
    });

    render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage />);
    await openReviewTab();

    expect(screen.getByText("Evidencia del worker")).toBeTruthy();
    expect(screen.getByText("Publish response: { media_id: 1234 }")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Confirmar publicación/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /Marcar como fallida/ })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole("tab")[0]);
    await waitFor(() => expect(screen.queryByText("Evidencia del worker")).toBeNull());
    expect(screen.queryByRole("button", { name: /Confirmar publicación/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Marcar como fallida/ })).toBeNull();
  });

  it("confirms a review after explicit confirmation and refreshes the queue", async () => {
    const review = reviewJob(53);
    const completed = reviewJob(53, { status: "completed" as const, current_step: "completed", completed_at: "2026-08-13T12:05:00.000Z" });
    authRequestMock
      .mockResolvedValueOnce({ publications: [review] })
      .mockResolvedValueOnce({ publications: [completed] });
    resolvePublicationReviewMock.mockResolvedValue({ publication: completed });

    render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage />);
    await openReviewTab();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar publicación" }));
    expect(await screen.findByRole("heading", { name: "¿Confirmar publicación?" })).toBeTruthy();
    expect(screen.getByText(/no se puede deshacer/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sí, confirmar" }));

    await waitFor(() => expect(resolvePublicationReviewMock).toHaveBeenCalledWith({
      apiBase: expect.stringMatching(/^https?:\/\//), token: "token", id: 53, action: "confirm",
    }));
    await waitFor(() => expect(screen.getByText(/Publicación #53 confirmada/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Confirmar publicación" })).toBeNull();
    expect(authRequestMock.mock.calls.some((call) => call[1] === "/api/publications")).toBe(true);
  });

  it("dismisses a review after warning and refreshes the queue", async () => {
    const review = reviewJob(54);
    const failed = reviewJob(54, { status: "failed" as const, current_step: "failed", error_code: "REVIEW_DISMISSED" });
    authRequestMock
      .mockResolvedValueOnce({ publications: [review] })
      .mockResolvedValueOnce({ publications: [failed] });
    resolvePublicationReviewMock.mockResolvedValue({ publication: failed });

    render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage />);
    await openReviewTab();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como fallida" }));
    expect(await screen.findByRole("heading", { name: "¿Marcar como fallida?" })).toBeTruthy();
    expect(screen.getByText(/pudo haber salido de verdad/)).toBeTruthy();
    expect(screen.getByText(/no se puede deshacer/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sí, marcar como fallida" }));

    await waitFor(() => expect(resolvePublicationReviewMock).toHaveBeenCalledWith({
      apiBase: expect.stringMatching(/^https?:\/\//), token: "token", id: 54, action: "dismiss",
    }));
    await waitFor(() => expect(screen.getByText(/Publicación #54 marcada como fallida/)).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Marcar como fallida" })).toBeNull();
  });

  it("shows a visible error when the review resolution fails", async () => {
    authRequestMock.mockResolvedValue({ publications: [reviewJob(55)] });
    resolvePublicationReviewMock.mockRejectedValue(new Error("No se pudo resolver la revisión"));

    render(<PublicationPanel token="token" devices={devices} accounts={accounts} canManage />);
    await openReviewTab();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar publicación" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sí, confirmar" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("No se pudo resolver la revisión"));
    expect(screen.queryByRole("heading", { name: "¿Confirmar publicación?" })).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar publicación" })).toBeTruthy();
  });
});
