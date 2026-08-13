// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicationPanel } from "./publication-panel";

const { uploadPublicationMock } = vi.hoisted(() => ({ uploadPublicationMock: vi.fn() }));
vi.mock("./auth-client", () => ({ authRequest: vi.fn(async () => ({ publications: [] })) }));
vi.mock("./publication-upload", () => ({ uploadPublication: uploadPublicationMock }));
afterEach(() => cleanup());
beforeEach(() => {
  uploadPublicationMock.mockReset();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:preview") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

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
});
