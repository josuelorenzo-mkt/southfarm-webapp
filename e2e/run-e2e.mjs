// SouthFarm webapp E2E — contra backend de staging (http://localhost:3102)
// Uso:  node e2e/run-e2e.mjs        (webapp servido en :3006)
import path from "node:path";
import {
  API_URL, OUT_DIR, puppeteer, sleep, test, results, printSummary,
  fail, findByText, clickByText, trackPageErrors, shot, login, goToSection,
  tokenFromPage, api, writeFakeMp4,
} from "./helpers.mjs";

const E2E_CLUSTER = "E2E Temp";
const PUB_TITLE = "E2E Pub Test";

/** Asegura estar en Activity Planner (semana) — navega desde cualquier sección. */
async function ensurePlannerWeek() {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".cc-side-nav button")].find((b) => (b.textContent || "").includes("Activity Planner"));
    if (btn && !btn.classList.contains("is-active")) btn.click();
  });
  await sleep(2500);
  // esperar la barra de vistas del planner (existe en week/day/cluster/routines)
  await page.waitForFunction(() => !!document.querySelector(".ap-segmented"), { timeout: 20000 });
  await page.evaluate(() => {
    const seg = [...document.querySelectorAll(".ap-segmented button")].find((b) => b.textContent.trim() === "Semana");
    if (seg && !seg.classList.contains("is-selected")) seg.click();
  });
  await sleep(1800);
  await page.waitForSelector(".ap-cluster-row", { timeout: 20000 });
}

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  headless: "shell",
  userDataDir: "C:/SouthFarm/source/.tmp-qa/pptr/profile-e2e",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1600,1000", "--force-device-scale-factor=1", "--hide-scrollbars"],
  defaultViewport: { width: 1600, height: 1000 },
  protocolTimeout: 120000,
});

const page = await browser.newPage();
const tracker = trackPageErrors(page);

/* ================================================================
   1. LOGIN + SHELL
   ================================================================ */
test("1. LOGIN + SHELL — login, sidebar completo, health online", async () => {
  await login(page);
  const shell = await page.evaluate(() => ({
    sidebar: !!document.querySelector(".cc-sidebar"),
    navItems: [...document.querySelectorAll(".cc-side-nav button")].map((b) => (b.textContent || "").replace(/\s+/g, " ").trim()),
    health: document.querySelector(".cc-api-health")?.textContent?.replace(/\s+/g, " ").trim() || "",
    workspace: document.querySelector(".cc-workspace-chip")?.textContent?.trim() || "",
  }));
  if (!shell.sidebar) fail("sidebar no renderizada");
  const required = ["Command center", "Crear publicación", "Device fleet", "Activity Planner", "Warmup planner", "Activity history", "Team & roles", "Settings"];
  const missing = required.filter((r) => !shell.navItems.some((n) => n.includes(r)));
  if (missing.length) fail("secciones faltantes en sidebar", missing);
  if (!shell.health.includes("API operativa")) fail("health indicator no online", shell.health);
  await shot(page, "e2e-01-shell.png");
});

/* ================================================================
   2. WEEK VIEW
   ================================================================ */
test("2. WEEK VIEW — 3 clusters, charts, glow, tooltip, navegación", async () => {
  await ensurePlannerWeek();
  await page.waitForSelector(".ap-cluster-row", { timeout: 20000 });

  const week = await page.evaluate(() => ({
    clusters: [...document.querySelectorAll(".ap-cluster-card h3")].map((h) => h.textContent.trim()),
    charts: document.querySelectorAll(".ap-chart").length,
    glowSvgs: document.querySelectorAll(".ap-cluster-glow rect").length,
    complianceBars: document.querySelectorAll(".ap-progress-track span").length,
    nowChips: document.querySelectorAll(".ap-now-chip-text").length,
    today: [...document.querySelectorAll(".ap-chart-xlabels span")].find((s) => s.classList.contains("is-today"))?.textContent || "",
    clusterBadges: [...document.querySelectorAll(".ap-cluster-row .ap-badge")].map((b) => b.textContent.replace(/\s+/g, " ").trim()),
  }));
  if (week.clusters.length !== 3) fail("se esperaban 3 clusters", week.clusters);
  for (const c of week.clusters) if (!c.includes("Marczell")) fail("cluster inesperado", week.clusters);
  if (week.charts < 3) fail("charts SVG ausentes", week.charts);
  if (week.glowSvgs < 2) fail("glow SVG ausente en hover card", week.glowSvgs);
  if (week.complianceBars < 3) fail("barras de cumplimiento ausentes", week.complianceBars);
  if (!week.clusterBadges.some((b) => b.includes("Todo ok") || b.includes("déficit"))) fail("badge de salud de cluster ausente", week.clusterBadges);
  await shot(page, "e2e-02-week.png");

  // hover sobre el chart → tooltip con hasta 2 tareas + "+N más"
  const chartBox = await (await page.$(".ap-chart")).boundingBox();
  if (!chartBox) fail("chart sin boundingBox");
  await page.mouse.move(chartBox.x + chartBox.width * 0.5, chartBox.y + chartBox.height * 0.5);
  await sleep(600);
  const tip = await page.evaluate(() => {
    const el = document.querySelector(".ap-chart-tip.is-visible");
    if (!el) return null;
    const txt = el.textContent.replace(/\s+/g, " ").trim();
    const taskRows = el.querySelectorAll(".ap-tip-task").length;
    const more = el.querySelector(".ap-tip-more")?.textContent || "";
    return { txt, taskRows, more };
  });
  if (!tip) fail("tooltip no aparece al hover");
  if (tip.taskRows > 2) fail("tooltip muestra más de 2 tareas", tip.taskRows);
  await shot(page, "e2e-02-week-hover-tip.png");

  // navegación semana anterior / siguiente / Hoy
  const rangeText = () => page.evaluate(() => document.querySelector(".ap-week-range span")?.textContent?.trim() || "");
  const initial = await rangeText();
  await page.evaluate(() => { document.querySelector('.ap-week-range button[title="Semana anterior"]')?.click(); });
  await sleep(2000);
  const prev = await rangeText();
  await page.evaluate(() => { document.querySelector('.ap-week-range button[title="Semana siguiente"]')?.click(); });
  await sleep(2000);
  const next = await rangeText();
  await clickByText(page, "button", "Hoy");
  await sleep(2000);
  const today = await rangeText();
  if (prev === initial) fail("semana anterior no cambió el rango", { initial, prev });
  if (next === prev) fail("semana siguiente no cambió el rango", { prev, next });
  if (today !== initial) fail("Hoy no volvió al rango actual", { initial, today });
});

/* ================================================================
   3. CREAR CLUSTER (E2E Temp) + DELETE
   ================================================================ */
test("3. CREAR CLUSTER — modal, cuentas agrupadas, crear, aparece, delete", async () => {
  // el cluster E2E Temp debe estar limpio antes de empezar
  const existing = await api(page, "GET", "/api/clusters");
  const qa = (existing.data?.clusters || []).find((c) => c.name === E2E_CLUSTER);
  if (qa) {
    await api(page, "DELETE", `/api/clusters/${qa.id}?mode=delete`);
    await sleep(800);
    await page.reload({ waitUntil: "networkidle2" });
    await sleep(2000);
  }

  await clickByText(page, "button", "Crear cluster");
  await page.waitForSelector(".ap-modal .ap-pick-row", { timeout: 20000 });

  const modal = await page.evaluate(() => {
    const groups = [...document.querySelectorAll(".ap-pick-group")].map((g) => g.textContent.replace(/\s+/g, " ").trim());
    const rows = [...document.querySelectorAll(".ap-pick-row")];
    return {
      groups,
      total: rows.length,
      occupied: rows.filter((r) => r.classList.contains("is-occupied")).length,
      free: rows.filter((r) => !r.classList.contains("is-occupied")).length,
    };
  });
  if (!modal.groups.length) fail("cuentas no agrupadas por plataforma", modal);
  if (modal.free < 1) fail("no hay cuentas libres para crear cluster (todas ocupadas)", modal);
  await shot(page, "e2e-03-cluster-modal.png");

  // seleccionar 1-2 cuentas libres + nombre
  const picked = await page.evaluate(() => {
    const free = [...document.querySelectorAll(".ap-pick-row:not(.is-occupied)")].slice(0, 2);
    const names = free.map((r) => r.querySelector(".ap-pick-main strong")?.textContent || "");
    for (const r of free) r.click();
    return names;
  });
  if (!picked.length) fail("no se pudo seleccionar cuentas libres");
  await page.type(".ap-modal input.ap-input", E2E_CLUSTER);
  await sleep(400);
  const btnState = await page.evaluate(() => {
    const btn = [...document.querySelectorAll(".ap-modal button")].find((b) => b.textContent.includes("Crear cluster"));
    return btn ? { disabled: btn.disabled, text: btn.textContent.trim() } : null;
  });
  if (!btnState || btnState.disabled) fail("botón crear deshabilitado con datos válidos", btnState);
  await clickByText(page, ".ap-modal button", "Crear cluster", { exact: false });
  await sleep(6000); // create + generate + reload

  const after = await page.evaluate(() => ({
    modalOpen: !!document.querySelector(".ap-modal"),
    names: [...document.querySelectorAll(".ap-cluster-card h3, .ap-cluster-row h3")].map((h) => h.textContent.trim()),
  }));
  if (after.modalOpen) fail("el modal quedó abierto tras crear");
  if (!after.names.includes(E2E_CLUSTER)) fail("cluster E2E Temp no aparece en la semana", after.names);
  await shot(page, "e2e-03-cluster-created.png");

  // verificar tareas materializadas (1-2 cuentas → tareas de rutinas)
  const weekData = await page.evaluate(async (apiUrl) => {
    const r = await fetch(`${apiUrl}/api/planner/week`, { headers: { Authorization: `Bearer ${localStorage.getItem("southfarm_token")}` } });
    return r.json();
  }, API_URL);
  const created = (weekData.clusters || []).find((c) => c.name === E2E_CLUSTER);
  if (!created) fail("cluster E2E Temp no existe en la API");
  if (!created.tasks.length) fail("el cluster creado no tiene tareas en la semana", { tasks: created.tasks.length });

  // DELETE — no hay botón de borrado en la UI (documentado): cleanup vía API
  const del = await api(page, "DELETE", `/api/clusters/${created.id}?mode=delete`);
  if (del.status !== 200) fail("DELETE /api/clusters/:id?mode=delete falló", del);
  await sleep(800);
  const namesAfterDelete = await page.evaluate(async (apiUrl) => {
    const r = await fetch(`${apiUrl}/api/planner/week`, { headers: { Authorization: `Bearer ${localStorage.getItem("southfarm_token")}` } });
    return (await r.json()).clusters.map((c) => c.name);
  }, API_URL);
  if (namesAfterDelete.includes(E2E_CLUSTER)) fail("cluster E2E Temp sigue existiendo en la API tras delete", namesAfterDelete);
  await shot(page, "e2e-03-cluster-deleted.png");
});

/* ================================================================
   4. CLUSTER DETALLE
   ================================================================ */
test("4. CLUSTER DETALLE — breadcrumb, hero/cuentas/rutinas/publicaciones/tareas", async () => {
  await ensurePlannerWeek();
  await clickByText(page, ".ap-cluster-card", "Marczell Vibes", { });
  await page.waitForSelector(".ap-detail-hero", { timeout: 20000 });

  const detail = await page.evaluate(() => ({
    crumb: document.querySelector(".ap-crumb")?.textContent?.replace(/\s+/g, " ").trim() || "",
    hero: !!document.querySelector(".ap-detail-hero"),
    accounts: document.querySelectorAll(".ap-account-row").length,
    routines: document.querySelectorAll(".ap-routine-row").length,
    pubs: document.querySelectorAll(".ap-pub-row").length,
    history: document.querySelectorAll(".ap-warmup-mini, .ap-history-chart").length,
    stats: document.querySelectorAll(".ap-side-kpi").length,
  }));
  if (!detail.crumb.includes("Volver a la semana")) fail("breadcrumb '← Volver a la semana' ausente", detail.crumb);
  if (!detail.hero) fail("hero ausente");
  if (detail.accounts < 1) fail("sección cuentas vacía");
  if (detail.routines < 1) fail("rutinas inline ausentes", detail.routines);
  if (detail.history < 1) fail("chart warmup ausente");
  await shot(page, "e2e-04-cluster-detail.png");

  // volver con el breadcrumb
  await clickByText(page, ".ap-crumb button", "Volver a la semana");
  await page.waitForSelector(".ap-cluster-row", { timeout: 15000 });
  const back = await page.evaluate(() => !!document.querySelector(".ap-week-summary"));
  if (!back) fail("no volvió a la semana con el breadcrumb");
});

/* ================================================================
   5. RUTINAS — editar → EDITANDO → aprobar → restaurar
   ================================================================ */
test("5. RUTINAS — editar minMinutes 40→45 → EDITANDO; aprobar; restaurar 45→40", async () => {
  await ensurePlannerWeek();
  // entrar al detalle de Marczell Vibes y de ahí a Rutinas (o tab Rutinas)
  await clickByText(page, ".ap-cluster-card", "Marczell Vibes", { });
  await page.waitForSelector(".ap-detail-hero", { timeout: 20000 });
  await clickByText(page, ".ap-detail-nav button", "Rutinas");
  await page.waitForSelector(".ap-routine-card", { timeout: 20000 });

  // estado inicial de warmup
  const initial = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".ap-routine-card")];
    const warmup = cards.find((c) => c.querySelector("h3")?.textContent.includes("Warmup diario"));
    return {
      cardCount: cards.length,
      warmupState: warmup?.querySelector(".ap-state-toggle")?.getAttribute("data-state") || "",
      warmupMinutes: warmup?.querySelector("output")?.textContent?.trim() || "",
    };
  });
  if (initial.cardCount !== 3) fail("se esperaban 3 cards de rutina", initial.cardCount);
  if (initial.warmupState !== "approved") fail("warmup debería estar aprobado", initial.warmupState);
  await shot(page, "e2e-05-routines-initial.png");

  // mover slider minMinutes 40 → 45 (los sliders del warmup: el primero es minMinutes)
  const slideInfo = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".ap-routine-card")];
    const warmup = cards.find((c) => c.querySelector("h3")?.textContent.includes("Warmup diario"));
    const sliders = [...warmup.querySelectorAll('input[type="range"]')];
    return sliders.map((s, i) => ({ i, min: s.min, max: s.max, step: s.step, value: s.value, aria: s.getAttribute("aria-label") }));
  });
  const minSlider = slideInfo.find((s) => s.aria && s.aria.includes("Minutos mínimos")) || slideInfo[0];
  if (!minSlider) fail("slider de minMinutes no encontrado", slideInfo);
  await page.evaluate((idx) => {
    const cards = [...document.querySelectorAll(".ap-routine-card")];
    const warmup = cards.find((c) => c.querySelector("h3")?.textContent.includes("Warmup diario"));
    const sliders = [...warmup.querySelectorAll('input[type="range"]')];
    const slider = sliders[idx];
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(slider, "45");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }, minSlider.i);
  await sleep(2000); // PUT config fire-and-forget + rerender

  const editing = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".ap-routine-card")];
    const warmup = cards.find((c) => c.querySelector("h3")?.textContent.includes("Warmup diario"));
    return {
      state: warmup?.querySelector(".ap-state-toggle")?.getAttribute("data-state") || "",
      output: warmup?.querySelector("output")?.textContent?.trim() || "",
      hint: warmup?.querySelector(".ap-routine-hint")?.textContent?.replace(/\s+/g, " ").trim() || "",
    };
  });
  if (editing.state !== "editing") fail("la rutina no pasó a EDITANDO al editar", editing);
  if (!editing.output.startsWith("45")) fail("el valor mostrado no es 45", editing.output);
  await shot(page, "e2e-05-routines-editing.png");

  // aprobar → aplica + feedback
  const approveBtn = await findByText(page, ".ap-state-toggle button", "Aprobado", { exact: true });
  if (!approveBtn) fail("botón Aprobado no encontrado");
  await approveBtn.evaluate((el) => el.click());
  await sleep(4500); // PUT + regeneración
  const approved = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".ap-routine-card")];
    const warmup = cards.find((c) => c.querySelector("h3")?.textContent.includes("Warmup diario"));
    return {
      state: warmup?.querySelector(".ap-state-toggle")?.getAttribute("data-state") || "",
      toast: [...document.querySelectorAll(".ap-toast")].map((t) => t.textContent.trim()).filter(Boolean),
      notice: [...document.querySelectorAll(".ap-toast.is-visible")].map((t) => t.textContent.trim()).join(" | "),
    };
  });
  if (approved.state !== "approved") fail("la rutina no volvió a aprobado", approved);
  await shot(page, "e2e-05-routines-approved.png");

  // RESTAURAR: 45 → 40 y aprobar de nuevo
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".ap-routine-card")];
    const warmup = cards.find((c) => c.querySelector("h3")?.textContent.includes("Warmup diario"));
    const slider = [...warmup.querySelectorAll('input[type="range"]')].find((s) => s.getAttribute("aria-label")?.includes("Minutos mínimos"));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(slider, "40");
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await sleep(2000);
  const restoreBtn = await findByText(page, ".ap-state-toggle button", "Aprobado", { exact: true });
  if (!restoreBtn) fail("botón Aprobado (restore) no encontrado");
  await restoreBtn.evaluate((el) => el.click());
  await sleep(4500);
  const restored = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".ap-routine-card")];
    const warmup = cards.find((c) => c.querySelector("h3")?.textContent.includes("Warmup diario"));
    return {
      state: warmup?.querySelector(".ap-state-toggle")?.getAttribute("data-state") || "",
      output: warmup?.querySelector("output")?.textContent?.trim() || "",
    };
  });
  if (restored.state !== "approved" || !restored.output.startsWith("40")) {
    fail("la rutina no quedó restaurada a 40 min aprobada", restored);
  }
});

/* ================================================================
   6. PUBLICAR AL CLUSTER (dropzone + mp4 fake)
   ================================================================ */
test("6. PUBLICAR AL CLUSTER — dropzone, mp4 fake, publicación creada", async () => {
  await ensurePlannerWeek();
  // entrar al detalle de Marczell Vibes y de ahí a Rutinas (dropzone)
  await clickByText(page, ".ap-cluster-card", "Marczell Vibes", { });
  await page.waitForSelector(".ap-detail-hero", { timeout: 20000 });
  await clickByText(page, ".ap-detail-nav button", "Rutinas");
  await page.waitForSelector("#ap-publicacion-cluster", { timeout: 20000 });
  await sleep(600);

  // fake mp4 (~200KB)
  const mp4Path = path.join(OUT_DIR, "e2e-fake-video.mp4");
  writeFakeMp4(mp4Path);

  // subir por el file input oculto del dropzone
  const input = await page.$('#ap-publicacion-cluster input[type="file"]');
  if (!input) fail("file input del dropzone no encontrado");
  await input.uploadFile(mp4Path);
  await sleep(1200);
  const uploaded = await page.evaluate(() => {
    const box = document.querySelector(".ap-uploaded");
    return box ? box.textContent.replace(/\s+/g, " ").trim() : "";
  });
  if (!uploaded.includes("e2e-fake-video.mp4")) fail("el video no quedó cargado en la dropzone", uploaded);
  await shot(page, "e2e-06-upload-ready.png");

  // título + programar
  await page.type('#ap-publicacion-cluster input[placeholder="Título del video"]', PUB_TITLE);
  await sleep(300);
  await clickByText(page, "#ap-publicacion-cluster button", "Programar publicación", { exact: false });
  await sleep(6000); // upload multipart + creación

  const pubToast = await page.evaluate(() => [...document.querySelectorAll(".ap-toast.is-visible")].map((t) => t.textContent.trim()).join(" | "));
  await shot(page, "e2e-06-published.png");

  // verificar vía API que la publicación existe
  const token = await tokenFromPage(page);
  const week = await page.evaluate(async (apiUrl) => {
    const r = await fetch(`${apiUrl}/api/planner/week`, { headers: { Authorization: `Bearer ${localStorage.getItem("southfarm_token")}` } });
    return r.json();
  }, API_URL);
  const cluster = (week.clusters || []).find((c) => c.name === "Marczell Vibes");
  if (!cluster) fail("cluster Marczell Vibes no encontrado");
  const detail = await page.evaluate(async ({ apiUrl, token, id }) => {
    const r = await fetch(`${apiUrl}/api/clusters/${id}`, { headers: { Authorization: `Bearer ${token}` } });
    return r.json();
  }, { apiUrl: API_URL, token, id: cluster.id });
  const pubs = (detail.history?.publications || []).filter((p) => (p.title || "").includes(PUB_TITLE));
  if (!pubs.length) fail("la publicación E2E Pub Test no aparece en el historial del cluster", {
    total: (detail.history?.publications || []).length,
    toast: pubToast,
  });
  await shot(page, "e2e-06-pub-visible.png");

  // la sección publicaciones del detalle la muestra
  await clickByText(page, ".ap-crumb button", "Volver a la semana");
  await sleep(2000);
});

/* ================================================================
   7. VISTA DÍA
   ================================================================ */
test("7. VISTA DÍA — chip AHORA, tareas con hora, filtros, overdue", async () => {
  await ensurePlannerWeek();
  await page.evaluate(() => { document.querySelector('.ap-segmented button:nth-child(2)')?.click(); }); // Día
  await page.waitForSelector(".ap-day-head", { timeout: 20000 });
  await sleep(1200);

  const day = await page.evaluate(() => ({
    nowChip: [...document.querySelectorAll(".ap-now-marker, .ap-now-chip-text")].map((e) => e.textContent.replace(/\s+/g, " ").trim()).join(" | "),
    tasks: [...document.querySelectorAll(".ap-task")].length,
    taskTimes: [...document.querySelectorAll(".ap-task-time strong")].map((t) => t.textContent.trim()).slice(0, 3),
    filterChips: document.querySelectorAll(".ap-filter-chip").length,
    late: [...document.querySelectorAll(".ap-task .ap-badge-warn")].map((b) => b.textContent.trim()),
    visibleLabel: document.querySelector(".ap-filter-bar span")?.textContent?.trim() || "",
  }));
  if (!day.nowChip.includes("AHORA")) fail("chip AHORA ausente en la vista día", day.nowChip);
  if (day.tasks < 1) fail("no hay tareas en la vista día");
  if (!day.taskTimes.length) fail("tareas sin hora visible");
  if (day.filterChips !== 4) fail("faltan chips de filtro", day.filterChips);
  await shot(page, "e2e-07-day.png");

  // toggle warmup → la lista se reduce
  const before = day.tasks;
  await page.evaluate(() => { document.querySelector(".ap-filter-chip.f-warmup")?.click(); });
  await sleep(800);
  const after = await page.evaluate(() => document.querySelectorAll(".ap-task").length);
  if (after >= before) fail("toggle warmup no redujo la lista", { before, after });
  await shot(page, "e2e-07-day-filters.png");

  // overdue diferenciada — CONDICIONAL: desde el fix de estabilización el
  // generate re-planifica las overdue (cancel_reason routine_overdue_replanned),
  // así que puede haber 0 en el staging. Si hay ≥1, verificar el diferenciador.
  const lateCount = await page.evaluate(() => document.querySelectorAll(".ap-task.is-late").length);
  if (lateCount > 0) {
    console.log(`  ℹ overdue diferenciadas: ${lateCount} (is-late presente)`);
  } else {
    console.log("  ℹ 0 overdue en staging (re-planificadas por el generate) — diferenciador no verificable en este run");
  }

  // volver a encender warmup para el test 8
  await page.evaluate(() => { document.querySelector(".ap-filter-chip.f-warmup")?.click(); });
  await sleep(400);
});

/* ================================================================
   8. SYNC / REFRESH sin errores de consola
   ================================================================ */
test("8. SYNC — botón Sync y cambio de semana sin errores JS", async () => {
  const before = tracker.errors.length;

  // asegurar vista día (donde está el botón Sincronizar)
  await page.evaluate(() => {
    const seg = [...document.querySelectorAll(".ap-segmented button")].find((b) => b.textContent.trim() === "Día");
    if (seg && !seg.classList.contains("is-selected")) seg.click();
  });
  await page.waitForSelector(".ap-day-head", { timeout: 20000 });

  // botón Sync de la vista día
  await clickByText(page, "button", "Sincronizar", { exact: false });
  await sleep(2500);

  // cambiar de semana (vuelve a semana, navega, vuelve a hoy) y a día
  await page.evaluate(() => { document.querySelector('.ap-segmented button:nth-child(1)')?.click(); });
  await sleep(2000);
  await page.evaluate(() => { document.querySelector('.ap-week-range button[title="Semana anterior"]')?.click(); });
  await sleep(2500);
  await page.evaluate(() => { document.querySelector('.ap-week-range button[title="Semana siguiente"]')?.click(); });
  await sleep(2500);
  await page.evaluate(() => { document.querySelector('.ap-segmented button:nth-child(2)')?.click(); });
  await sleep(2500);

  const newErrors = tracker.errors.slice(before);
  if (newErrors.length) fail("errores JS/red durante sync y navegación", newErrors);
});

/* ================================================================
   9. REGRESIÓN VISUAL — screenshots por vista
   ================================================================ */
test("9. REGRESIÓN VISUAL — screenshots week/cluster/day/rutinas", async () => {
  await ensurePlannerWeek();
  // week (ya con datos)
  await shot(page, "e2e-09-week.png");
  // cluster
  await clickByText(page, ".ap-cluster-card", "Marczell Vibes", { });
  await page.waitForSelector(".ap-detail-hero", { timeout: 15000 });
  await shot(page, "e2e-09-cluster.png");
  // rutinas
  await clickByText(page, ".ap-detail-nav button", "Rutinas");
  await page.waitForSelector(".ap-routine-card", { timeout: 15000 });
  await shot(page, "e2e-09-routines.png");
  // día
  await page.evaluate(() => { document.querySelector('.ap-segmented button:nth-child(2)')?.click(); });
  await sleep(2500);
  await shot(page, "e2e-09-day.png");
});

/* ================================================================
   10. RESTO DE LA APP contra staging
   ================================================================ */
test("10. RESTO — command center, fleet, history, team, publication panel, settings", async () => {
  // Command center (métricas)
  await goToSection(page, "Command center");
  const overview = await page.evaluate(() => ({
    metrics: document.querySelectorAll(".cc-kpi-grid .cc-metric").length,
    hero: !!document.querySelector(".cc-hero"),
    healthPanel: !!document.querySelector(".cc-health-panel"),
  }));
  if (!overview.hero || overview.metrics < 4 || !overview.healthPanel) fail("command center incompleto", overview);
  await shot(page, "e2e-10-overview.png");

  // Device fleet
  await goToSection(page, "Device fleet");
  await page.waitForSelector(".cc-device-card, .cc-empty", { timeout: 20000 });
  const fleet = await page.evaluate(() => ({
    cards: document.querySelectorAll(".cc-device-card").length,
    empty: !!document.querySelector(".cc-empty"),
    names: [...document.querySelectorAll(".cc-device-card h3")].map((h) => h.textContent.trim()),
  }));
  if (fleet.cards < 1 && !fleet.empty) fail("device fleet sin contenido", fleet);
  await shot(page, "e2e-10-fleet.png");

  // Activity history
  await goToSection(page, "Activity history");
  await page.waitForSelector(".cc-history-list, .cc-empty, .cc-card", { timeout: 20000 });
  const history = await page.evaluate(() => ({
    rows: document.querySelectorAll(".cc-history-row").length,
    toolbar: !!document.querySelector(".cc-history-toolbar"),
  }));
  if (!history.toolbar) fail("activity history sin toolbar");
  await shot(page, "e2e-10-history.png");

  // Team & roles
  await goToSection(page, "Team & roles");
  await page.waitForSelector(".cc-team-row, .cc-card", { timeout: 20000 });
  const team = await page.evaluate(() => ({
    members: document.querySelectorAll(".cc-team-row").length,
    invites: !!document.querySelector(".cc-invite-result") || !!document.querySelector("button")?.textContent.includes("Generar invitación"),
  }));
  if (team.members < 1) fail("team sin miembros", team);
  await shot(page, "e2e-10-team.png");

  // Publication panel (render sin crash)
  await goToSection(page, "Crear publicación");
  await page.waitForSelector(".publication-composer, .cc-card", { timeout: 20000 });
  const pub = await page.evaluate(() => ({
    composer: !!document.querySelector(".publication-composer"),
    queue: !!document.querySelector(".publication-queue"),
  }));
  if (!pub.composer) fail("publication panel no renderizó el composer", pub);
  await shot(page, "e2e-10-publication.png");

  // Settings (render sin crash)
  await goToSection(page, "Settings");
  await page.waitForSelector(".cc-settings-card, .cc-card", { timeout: 20000 });
  await shot(page, "e2e-10-settings.png");
});

/* ================================================================
   Ejecución de la suite (en orden; un fallo no corta el resto)
   ================================================================ */
for (const t of results) {
  try {
    await t.fn();
    t.ok = true;
    console.log(`PASS  ${t.name}`);
  } catch (err) {
    t.ok = false;
    t.error = String(err && err.message ? err.message : err);
    console.log(`FAIL  ${t.name} :: ${t.error}`);
    await shot(page, `e2e-fail-${results.indexOf(t) + 1}-${t.name.slice(0, 20).replace(/[^\w]+/g, "-")}.png`).catch(() => {});
  }
}

/* ================================================================
   Cleanup final: borrar cualquier "E2E Temp" residual y tareas
   "E2E Pub Test" creadas por el test 6
   ================================================================ */
try {
  const clusters = await api(page, "GET", "/api/clusters");
  const qa = (clusters.data?.clusters || []).find((c) => c.name === E2E_CLUSTER);
  if (qa) await api(page, "DELETE", `/api/clusters/${qa.id}?mode=delete`);
  // tareas de publicación del test: se cancelan via PATCH /api/tasks/runs/:id/stop
  const runs = await api(page, "GET", "/api/tasks/runs?limit=200");
  const pubTasks = [];
  for (const r of runs.data?.runs || []) {
    if (r.task_type !== "publish_reel") continue;
    const raw = typeof r.params === "string" ? r.params : JSON.stringify(r.params || {});
    if (raw.includes(PUB_TITLE)) pubTasks.push(r.id);
  }
  for (const id of pubTasks) {
    await api(page, "PATCH", `/api/tasks/runs/${id}/stop`, {}).catch(() => {});
  }
  if (pubTasks.length) console.log(`[cleanup] canceladas ${pubTasks.length} tarea(s) E2E Pub Test`);
} catch (e) {
  console.log("[cleanup] skip:", e.message);
}

tracker.stop();
await browser.close();

// Verificación final del tracker global
const globalErrors = tracker.errors;
if (globalErrors.length) {
  console.log("\n[WARN] Errores JS/red capturados durante toda la sesión:");
  for (const e of globalErrors.slice(0, 20)) console.log(`  - [${e.type}] ${e.text.slice(0, 300)}`);
}

printSummary(`errores globales capturados: ${globalErrors.length}`);
