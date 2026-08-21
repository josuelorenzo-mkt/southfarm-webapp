// E2E helpers — puppeteer-core contra Chrome headless "shell".
// Ejecutar: node run-e2e.mjs (usa :3006).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

// puppeteer-core instalado en C:/SouthFarm/source/.tmp-qa/pptr
const pptrRoot = "C:/SouthFarm/source/.tmp-qa/pptr";
const require = createRequire(import.meta.url + "/");
export const puppeteer = require(path.join(pptrRoot, "node_modules/puppeteer-core"));

export const APP_URL = process.env.E2E_APP_URL || "http://localhost:3006";
export const API_URL = process.env.E2E_API_URL || "http://localhost:3102";
export const EMAIL = process.env.E2E_EMAIL || "staging@southfarm.local";
export const PASSWORD = process.env.E2E_PASSWORD || "southfarm";
export const OUT_DIR = process.env.E2E_OUT_DIR || "C:/SouthFarm/source/.tmp-qa";

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Pasos de prueba: nombre + fn(async ctx). Reporta PASS/FAIL y sigue. */
export const results = [];
export function test(name, fn) {
  results.push({ name, fn });
}

/** Extrae el texto de un elemento (o selector) que cumple predicate. */
export function textOf(handle) {
  return handle.evaluate((el) => (el.textContent || "").trim());
}

export function fail(message, details) {
  throw new Error(message + (details !== undefined ? ` :: ${JSON.stringify(details)}` : ""));
}

/** Busca un botón por texto (normaliza espacios). */
export async function findByText(page, selector, text, { exact = false, visible = true } = {}) {
  const handle = await page.evaluateHandle(
    (sel, needle, exactMatch, onlyVisible) => {
      const nodes = [...document.querySelectorAll(sel)];
      return nodes.find((el) => {
        const t = (el.textContent || "").replace(/\s+/g, " ").trim();
        const ok = exactMatch ? t === needle : t.includes(needle);
        if (!ok) return false;
        if (!onlyVisible) return true;
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      }) || null;
    },
    selector,
    text,
    exact,
    visible,
  );
  const isNull = await handle.evaluate((el) => el === null);
  if (isNull) { await handle.dispose(); return null; }
  return handle;
}

export async function clickByText(page, selector, text, opts) {
  const btn = await findByText(page, selector, text, opts);
  if (!btn) fail(`No se encontró "${text}" en ${selector}`);
  await btn.evaluate((el) => el.click());
  await btn.dispose();
}

/** Capture de console errors + pageerror + failed requests del page (todo el tiempo de vida). */
export function trackPageErrors(page) {
  const errors = [];
  const onError = (msg) => {
    const text = msg.text();
    const loc = msg.location();
    const url = loc && loc.url ? loc.url : "";
    if (text.includes("favicon") || text.includes("net::ERR_ABORTED") || text.includes("ResizeObserver loop")) return;
    // heurística de Chrome: password fuera de <form> — no es error de la app
    if (text.includes("Password field is not contained in a form")) return;
    if (text.includes("Failed to load resource")) {
      // solo interesan 404/500 de la API, no de assets propios
      if (url.includes("localhost:3102")) errors.push({ type: "apifail", text: `${url} ${text}` });
      return;
    }
    errors.push({ type: "console", text, url });
  };
  const onPageError = (err) => errors.push({ type: "pageerror", text: String(err.message || err) });
  const onFailed = (req) => {
    const url = req.url();
    if (url.startsWith("http://localhost:3006")) return;
    errors.push({ type: "requestfailed", text: `${req.method()} ${url} -> ${req.failure()?.errorText || "?"}` });
  };
  page.on("console", onError);
  page.on("pageerror", onPageError);
  page.on("requestfailed", onFailed);
  return {
    errors,
    stop() {
      page.off("console", onError);
      page.off("pageerror", onPageError);
      page.off("requestfailed", onFailed);
    },
  };
}

/** Screenshot con nombre estable. */
export async function shot(page, name) {
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file });
  return file;
}

/** Navega a / y espera la app (login screen o shell ya logueado). */
export async function openApp(page) {
  await page.goto(`${APP_URL}/`, { waitUntil: "networkidle2", timeout: 45000 });
  await sleep(1200);
}

/** Login vía UI si hace falta (si ya hay sesión, la reutiliza). */
export async function login(page) {
  await openApp(page);
  const emailInput = await page.$('input[type="email"]');
  if (!emailInput) return; // ya logueado (localStorage persistido)
  await page.type('input[type="email"]', EMAIL);
  await page.type('input[type="password"]', PASSWORD);
  const submitted = page.waitForFunction(
    () => !document.querySelector('input[type="email"]'),
    { timeout: 20000 },
  ).catch(() => null);
  await clickByText(page, "button", "Entrar al centro");
  await submitted;
  await page.waitForFunction(() => document.querySelector(".cc-sidebar"), { timeout: 20000 });
  await sleep(1500);
}

/** Navega a una sección del sidebar por label (match parcial: los labels llevan sufijos NEW/RBAC). */
export async function goToSection(page, label) {
  try {
    await clickByText(page, ".cc-side-nav button, .cc-mobile-nav button", label, { exact: false });
  } catch {
    if (!(await isSectionActive(page, label))) throw new Error(`No se pudo navegar a "${label}"`);
  }
  await sleep(2500);
}

async function isSectionActive(page, label) {
  return page.evaluate((needle) => {
    const btn = [...document.querySelectorAll(".cc-side-nav button, .cc-mobile-nav button")]
      .find((b) => (b.textContent || "").includes(needle));
    return btn ? btn.classList.contains("is-active") : false;
  }, label);
}

/** Token desde localStorage (para llamadas API de setup/cleanup). */
export function tokenFromPage(page) {
  return page.evaluate(() => window.localStorage.getItem("southfarm_token"));
}

/** API helper con token. */
export async function api(page, method, pathname, body) {
  const token = await tokenFromPage(page);
  const res = await page.evaluate(async ({ method, pathname, body, token, apiUrl }) => {
    const init = { method, headers: { Authorization: `Bearer ${token}` } };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const r = await fetch(`${apiUrl}${pathname}`, init);
    let data = null;
    try { data = await r.json(); } catch { /* no body */ }
    return { status: r.status, data };
  }, { method, pathname, body, token, apiUrl: API_URL });
  return res;
}

/** Crea el mp4 fake (Buffer aleatorio ~200KB). */
export function writeFakeMp4(filePath) {
  const buf = Buffer.alloc(200 * 1024);
  for (let i = 0; i < buf.length; i++) buf[i] = (i * 31 + 7) & 0xff;
  // firma "ftyp" aproximada para que el frontend la acepte como video
  const magic = Buffer.from("00000018667479706d703432000000006d70343269736f6d", "hex");
  magic.copy(buf, 0);
  fs.writeFileSync(filePath, buf);
  return filePath;
}

export function printSummary(extra = "") {
  let passed = 0;
  let failed = 0;
  console.log("\n==================== RESULTADOS E2E ====================");
  for (const r of results) {
    if (r.ok) { passed++; console.log(`  PASS  ${r.name}${r.detail ? "  (" + r.detail + ")" : ""}`); }
    else { failed++; console.log(`  FAIL  ${r.name}\n        ${r.error}`); }
  }
  console.log(`------------------------------------------------------`);
  console.log(`  ${passed} passed · ${failed} failed${extra ? " · " + extra : ""}`);
  console.log("========================================================");
  if (failed > 0) process.exitCode = 1;
}
