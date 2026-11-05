import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { go, onboard } from "./helpers";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

test("asistente inicial, turno nocturno y persistencia tras recargar", async ({ page }) => {
  await onboard(page);
  await page.getByRole("button", { name: /Nuevo turno/ }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Entrada", { exact: true }).fill("20:30");
  await dialog.getByLabel("Salida", { exact: true }).fill("01:00");
  await expect(dialog.getByText(/Termina el día siguiente/)).toBeVisible();
  await expect(dialog.getByText("4 h 30 min").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Guardar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("20:30 – 01:00")).toBeVisible();

  await page.reload();
  await expect(page.getByText("20:30 – 01:00")).toBeVisible();
  await go(page, "/calendario/");
  await expect(page.locator("[role=gridcell] span[draggable]").first()).toContainText("20:30");
});

test("fichaje: entrada, recuperación al reabrir, descanso y salida que crea un turno realizado", async ({ page, context }) => {
  await onboard(page);
  await go(page, "/control-horario/");
  await page.getByRole("button", { name: "Fichar entrada" }).click();
  // entrada real dos horas antes (p. ej. olvidó fichar al llegar)
  const twoHoursAgo = new Date(Date.now() - 2 * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  await page.getByRole("dialog").getByRole("switch", { name: "Usar otra hora" }).click();
  await page.getByRole("dialog").getByLabel("Fecha y hora real").fill(`${twoHoursAgo.getFullYear()}-${pad(twoHoursAgo.getMonth() + 1)}-${pad(twoHoursAgo.getDate())}T${pad(twoHoursAgo.getHours())}:${pad(twoHoursAgo.getMinutes())}`);
  await page.getByRole("dialog").getByRole("button", { name: "Registrar entrada" }).click();
  await expect(page.getByText("Trabajando")).toBeVisible();

  // cerrar la pestaña y abrir otra: el fichaje sigue abierto
  await page.close();
  const p2 = await context.newPage();
  await go(p2, "/control-horario/");
  await expect(p2.getByText("Trabajando")).toBeVisible();
  await p2.getByRole("button", { name: "Descanso", exact: true }).click();
  await expect(p2.getByText("En descanso")).toBeVisible();
  await p2.getByRole("button", { name: "Fin descanso" }).click();
  await expect(p2.getByText("Trabajando")).toBeVisible();
  await p2.getByRole("button", { name: "Salida" }).click();
  await p2.getByRole("dialog").getByRole("button", { name: "Registrar salida" }).click();
  await expect(p2.getByText("Sin fichaje activo")).toBeVisible();

  await p2.getByRole("tab", { name: "Historial" }).click();
  await expect(p2.getByText("Vinculado a turno")).toBeVisible();
  await go(p2, "/turnos/");
  await expect(p2.locator("span", { hasText: /^Realizado$/ }).first()).toBeVisible();
});

test("fichaje manual corregido queda en el registro de modificaciones", async ({ page }) => {
  await onboard(page);
  await go(page, "/control-horario/#historial");
  await page.getByRole("button", { name: "Fichaje manual" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Entrada").fill(`${today()}T08:00`);
  await d.getByLabel("Salida").fill(`${today()}T14:00`);
  await d.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("6 h").first()).toBeVisible();
  await page.getByRole("button", { name: "Corregir" }).click();
  await d.getByLabel("Salida").fill(`${today()}T15:00`);
  await d.getByRole("button", { name: "Guardar" }).click();
  await expect(d.getByText("Indica el motivo de la corrección (queda registrado).")).toBeVisible();
  await d.getByLabel(/Motivo de la corrección/).fill("Salí más tarde");
  await d.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByText("7 h").first()).toBeVisible();
  await page.getByRole("button", { name: "Registro de modificaciones" }).click();
  await expect(page.getByText("Motivo: Salí más tarde")).toBeVisible();
});

test("salario estimado y bolsa de horas reflejan un turno realizado", async ({ page }) => {
  await onboard(page, { weekly: "15", hourly: "10" });
  await page.getByRole("button", { name: /Nuevo turno/ }).first().click();
  const d = page.getByRole("dialog");
  await d.getByRole("radio", { name: "Realizado" }).click();
  await d.getByLabel("Entrada", { exact: true }).fill("08:00");
  await d.getByLabel("Salida", { exact: true }).fill("12:00");
  await d.getByRole("button", { name: "Guardar" }).click();
  await expect(d).toBeHidden();
  await go(page, "/salario/");
  await expect(page.getByText("Salario por horas ordinarias")).toBeVisible();
  await expect(page.getByText("Neto no estimado", { exact: true })).toBeVisible();
  await expect(page.locator("td", { hasText: /40,00\s€/ }).first()).toBeVisible();
  await go(page, "/control-horario/#horas");
  await expect(page.getByRole("heading", { name: "Bolsa de horas" })).toBeVisible();
  await expect(page.getByText("4 h", { exact: true }).first()).toBeVisible();
});

test("copia de seguridad: exportar, borrar todo e importar", async ({ page }, info) => {
  await onboard(page);
  await page.getByRole("button", { name: /Nuevo turno/ }).first().click();
  await page.getByRole("dialog").getByLabel("Entrada", { exact: true }).fill("10:00");
  await page.getByRole("dialog").getByLabel("Salida", { exact: true }).fill("18:00");
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await go(page, "/configuracion/#backup");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar copia" }).click();
  const file = info.outputPath("copia.json");
  await (await dl).saveAs(file);
  const json = JSON.parse(readFileSync(file, "utf8"));
  expect(json.app).toBe("shift-calculator");
  expect(json.data.shifts).toHaveLength(1);

  await page.getByRole("button", { name: "Privacidad y datos" }).click();
  await page.getByRole("button", { name: "Borrar todos los datos" }).click();
  await page.getByLabel(/Escribe BORRAR/).fill("BORRAR");
  await page.getByRole("dialog").getByRole("button", { name: "Borrar todo" }).click();
  await expect(page.getByText("Te damos la bienvenida")).toBeVisible();
  await page.getByRole("button", { name: "Configurar más tarde" }).click();

  await go(page, "/configuracion/#backup");
  await page.locator("input[type=file]").setInputFiles(file);
  await expect(page.getByText("Restaurar copia")).toBeVisible();
  await page.getByRole("button", { name: "Fusionar" }).click();
  await expect(page.getByText(/Importación completada/)).toBeVisible();
  await go(page, "/turnos/");
  await expect(page.getByText("10:00 – 18:00")).toBeVisible();

  // importar de nuevo no duplica
  await go(page, "/configuracion/");
  await page.getByRole("button", { name: "Copias de seguridad" }).click();
  await page.locator("input[type=file]").setInputFiles(file);
  await page.getByRole("button", { name: "Fusionar" }).click();
  await expect(page.getByText(/0 registros añadidos/)).toBeVisible();
});

test("exportación de informes en PDF, Excel y CSV", async ({ page }) => {
  await onboard(page);
  await go(page, "/estadisticas/#exportar");
  for (const [btn, ext] of [["PDF", ".pdf"], ["Excel", ".xlsx"], ["CSV", ".csv"]] as const) {
    const dl = page.waitForEvent("download");
    await page.getByRole("button", { name: btn, exact: true }).click();
    expect((await dl).suggestedFilename()).toMatch(new RegExp(`\\${ext}$`));
  }
});

test("todas las secciones cargan sin desbordamiento horizontal ni errores", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await onboard(page);
  for (const path of ["/", "/calendario/", "/turnos/", "/control-horario/", "/salario/", "/estadisticas/", "/ausencias/", "/configuracion/"]) {
    await go(page, path);
    await expect(page.locator("h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `desbordamiento en ${path}`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});

test("navegación: inferior en móvil y lateral en escritorio", async ({ page }, info) => {
  await onboard(page);
  if (info.project.name === "movil") {
    await page.getByRole("button", { name: "Más" }).click();
    await page.getByRole("link", { name: "Vacaciones y ausencias" }).click();
    await expect(page.getByRole("heading", { name: "Vacaciones y ausencias", level: 1 })).toBeVisible();
  } else {
    await page.locator("aside").getByRole("link", { name: "Estadísticas" }).click();
    await expect(page.getByRole("heading", { name: "Estadísticas", level: 1 })).toBeVisible();
  }
});

test("vacaciones y festivos nacionales", async ({ page }) => {
  await onboard(page);
  await go(page, "/ausencias/");
  await page.getByRole("tab", { name: "Festivos" }).click();
  await page.getByRole("button", { name: /Festivos nacionales/ }).click();
  await expect(page.getByText("Natividad del Señor")).toBeVisible();
  await page.getByRole("tab", { name: "Vacaciones y ausencias" }).click();
  await page.getByRole("button", { name: "Solicitar vacaciones" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  const badge = (t: string) => page.locator("main span", { hasText: new RegExp(`^${t}$`) });
  await expect(badge("Solicitada")).toHaveCount(1);
  await page.getByRole("button", { name: "Aprobar" }).click();
  await expect(badge("Aprobada")).toHaveCount(1);
  await expect(badge("Solicitada")).toHaveCount(0);
});

test("dos trabajos: contratos separados, selector global y total combinado", async ({ page }) => {
  await onboard(page, { weekly: "15", hourly: "10" });
  // segundo trabajo
  await go(page, "/configuracion/");
  await page.getByRole("button", { name: "Trabajos" }).click();
  await page.getByRole("button", { name: "Añadir trabajo" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Nombre del trabajo").fill("Tienda");
  await d.getByLabel("Contrato vigente desde").fill("2026-01-01");
  await d.getByRole("button", { name: "Crear" }).click();
  await expect(d).toBeHidden();
  // salario del segundo trabajo: 12 €/h
  await page.getByRole("button", { name: "Salario y reglas" }).click();
  await page.getByLabel("Trabajo que estás configurando").selectOption({ label: "Tienda" });
  await page.getByLabel("Salario bruto por hora").fill("12");
  await expect(page.getByText("Guardado", { exact: true }).first()).toBeVisible();

  // un turno realizado en cada trabajo
  await go(page, "/turnos/");
  for (const [job, start, end] of [["Trabajo principal", "08:00", "10:00"], ["Tienda", "11:00", "12:00"]] as const) {
    await page.getByRole("button", { name: "Nuevo turno" }).first().click();
    const e = page.getByRole("dialog");
    await e.getByLabel("Trabajo").selectOption({ label: job });
    await e.getByRole("radio", { name: "Realizado" }).click();
    await e.getByLabel("Entrada", { exact: true }).fill(start);
    await e.getByLabel("Salida", { exact: true }).fill(end);
    await e.getByRole("button", { name: "Guardar" }).click();
    await expect(e).toBeHidden();
  }

  await go(page, "/salario/");
  await expect(page.getByText("Por trabajo")).toBeVisible();
  await expect(page.getByText(/Desglose · Tienda/)).toBeVisible();
  await expect(page.getByText("32,00 €").first()).toBeVisible(); // 2 h × 10 € + 1 h × 12 €

  // filtrar por un trabajo con el selector global
  await page.getByRole("radio", { name: "Tienda" }).click();
  await expect(page.getByText("Por trabajo")).toBeHidden();
  await expect(page.getByText("12,00 €").first()).toBeVisible();
  await go(page, "/turnos/");
  await expect(page.getByText("11:00 – 12:00")).toBeVisible();
  await expect(page.getByText("08:00 – 10:00")).toBeHidden();
});
