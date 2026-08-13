// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicationPanel } from "./publication-panel";

vi.mock("./auth-client", () => ({ authRequest: vi.fn(async () => ({ publications: [] })) }));
afterEach(() => cleanup());

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
});
