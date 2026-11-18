import { expect, test } from "@playwright/test";
import path from "node:path";
import { go, onboard } from "./helpers";

const fixture = (f: string) => path.join(__dirname, "../tests/fixtures", f);

test("importar cuadrante: OCR local, vista previa, importación y reimportación sin duplicados", async ({ page }, info) => {
  test.setTimeout(120_000);
  const external: string[] = [];
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== "localhost" && u.protocol.startsWith("http")) { external.push(u.href); return route.abort(); }
    return route.continue();
  });
  await onboard(page);
  await go(page, "/importar/");
  await page.getByLabel("Semana o mes del cuadrante (cualquier día)").fill("2026-11-16");
  await page.locator('input[type=file]:not([capture])').setInputFiles(fixture("roster-list.png"));
  await page.getByRole("button", { name: "Analizar cuadrante" }).click();
  await expect(page.getByText("Revisa los turnos reconocidos")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Cuadrante del 16/11/2026 al 22/11/2026")).toBeVisible();
  await expect(page.getByText("6 para añadir")).toBeVisible();
  await expect(page.getByText("2 días libres")).toBeVisible();
  await expect(page.getByText(/dudosos/)).toHaveCount(0);
  await expect(page.getByText("termina al día siguiente").first()).toBeVisible();
  await page.getByRole("button", { name: /Importar 6 turno/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Importar" }).click();
  await expect(page.getByText("Importación completada")).toBeVisible();
  await expect(page.getByText(/6 turno\(s\) añadidos/)).toBeVisible();

  // segunda vez: todo ya existe
  await page.getByRole("button", { name: "Analizar cuadrante" }).or(page.getByRole("button", { name: "Volver a analizar" })).click();
  await expect(page.getByText("Revisa los turnos reconocidos")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("6 ya existen")).toBeVisible();
  await expect(page.getByRole("button", { name: /Importar 0 turno/ })).toBeDisabled();

  await go(page, "/turnos/");
  await page.getByRole("radio", { name: "Mes" }).click();
  await expect(page.getByText("20:30 – 01:00")).toBeVisible();
  expect(external, `peticiones externas: ${external.join(", ")}`).toEqual([]);
  void info;
});

test("importar: imagen ilegible no inventa turnos", async ({ page }) => {
  test.setTimeout(120_000);
  await onboard(page);
  await go(page, "/importar/");
  await page.locator('input[type=file]:not([capture])').setInputFiles(fixture("roster-blurry.png"));
  await page.getByRole("button", { name: "Analizar cuadrante" }).click();
  await expect(page.getByText(/No se han reconocido días en la imagen/)).toBeVisible({ timeout: 90_000 });
});

test("turno cobrado el mes siguiente y cierre de mes", async ({ page }) => {
  await onboard(page, { weekly: "10", hourly: "10" });
  await page.getByRole("button", { name: /Nuevo turno/ }).first().click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Fecha").first().fill("2026-10-29");
  await d.getByRole("radio", { name: "Realizado" }).click();
  await d.getByLabel("Entrada", { exact: true }).fill("09:00");
  await d.getByLabel("Salida", { exact: true }).fill("14:00");
  await d.getByRole("radio", { name: "En el mes siguiente" }).click();
  await expect(d.getByText(/el importe, con sus pluses, pasa a la nómina de noviembre/)).toBeVisible();
  await d.getByRole("button", { name: "Guardar" }).click();
  await expect(d).toBeHidden();

  await go(page, "/salario/");
  await page.getByRole("button", { name: "Mes anterior" }).click();
  await expect(page.getByRole("heading", { name: "Octubre de 2026" })).toBeVisible();
  await expect(page.getByText("Pendiente de cobro en noviembre de 2026")).toBeVisible();
  await page.getByRole("button", { name: "Cerrar mes" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cerrar mes" }).click();
  await expect(page.getByText(/Mes cerrado el/)).toBeVisible();
  await page.getByRole("button", { name: "Mes siguiente" }).click();
  await expect(page.getByText("Incluye turnos de octubre de 2026 cobrados en esta nómina")).toBeVisible();
  await expect(page.getByText("Salario por horas ordinarias (turnos de octubre)")).toBeVisible();
  await expect(page.locator("td", { hasText: /^50,00\s€$/ }).first()).toBeVisible();
});

test("asistente: responde con datos, guarda el historial y explica lo que no sabe", async ({ page }) => {
  await onboard(page, { weekly: "15", hourly: "10" });
  await page.getByRole("button", { name: /Nuevo turno/ }).first().click();
  const d = page.getByRole("dialog");
  await d.getByRole("radio", { name: "Realizado" }).click();
  await d.getByLabel("Entrada", { exact: true }).fill("08:00");
  await d.getByLabel("Salida", { exact: true }).fill("12:00");
  await d.getByRole("button", { name: "Guardar" }).click();
  await expect(d).toBeHidden();
  await go(page, "/asistente/");
  await page.getByRole("button", { name: "¿Cuánto voy a cobrar este mes?" }).click();
  await expect(page.getByText("Estimación con lo realizado hasta hoy")).toBeVisible();
  await expect(page.getByText("40,00 €").first()).toBeVisible();
  await page.getByLabel("Escribe tu pregunta").fill("¿Cuántos días de vacaciones me quedan?");
  await page.getByRole("button", { name: "Enviar pregunta" }).click();
  await expect(page.getByText(/No tienes configurados los días de vacaciones/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("¿Cuánto voy a cobrar este mes?").first()).toBeVisible();
  await expect(page.getByText(/No tienes configurados los días de vacaciones/)).toBeVisible();
});

test("importar cuadrante con formato Orquest: etiquetas negras, días libres y tramos de madrugada", async ({ page }) => {
  test.setTimeout(180_000);
  await onboard(page);
  await go(page, "/importar/");
  await page.getByLabel("Semana o mes del cuadrante (cualquier día)").fill("2026-11-18");
  await page.locator('input[type=file]:not([capture])').setInputFiles(fixture(process.env.ORQUEST_FILE ?? "orquest-1x.png"));
  await page.getByRole("button", { name: "Analizar cuadrante" }).click();
  await expect(page.getByText("Revisa los turnos reconocidos")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText("7 para añadir")).toBeVisible();
  await expect(page.getByText("2 días libres")).toBeVisible();
  await expect(page.getByText(/dudosos/)).toHaveCount(0);
  const rows = await page.locator("li").evaluateAll((els) => els.map((li) => [...li.querySelectorAll("input")].slice(0, 3).map((i) => (i as HTMLInputElement).value).join(" ")));
  expect(rows).toEqual(["2026-11-25 19:00 22:30", "2026-11-26 19:30 22:30", "2026-11-27 19:00 23:30", "2026-11-28 00:30 03:00", "2026-11-28 18:00 23:30", "2026-11-29 00:30 03:00", "2026-11-29 18:00 23:30"]);
});
