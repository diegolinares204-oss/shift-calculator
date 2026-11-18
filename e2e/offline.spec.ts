/* eslint-disable @typescript-eslint/no-require-imports */
import { expect, test } from "@playwright/test";

test.use({ serviceWorkers: "allow" });

test("PWA: manifest e instalación offline mediante service worker", async ({ page, context }, info) => {
  test.skip(info.project.name !== "escritorio", "una vez basta");
  const manifest = await (await page.request.get("/manifest.webmanifest")).json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);

  await page.goto("/");
  await expect(page.getByText("Te damos la bienvenida")).toBeVisible();
  await page.getByRole("button", { name: "Configurar más tarde" }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // la página queda controlada por el service worker
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.goto("/calendario/");
  await expect(page.getByRole("heading", { name: "Calendario" })).toBeVisible();
  await page.goto("/salario/");
  await expect(page.getByRole("heading", { name: "Salario" })).toBeVisible();
  await context.setOffline(false);
});

test("importar cuadrante sin conexión tras el primer uso", async ({ page, context }, info) => {
  test.skip(info.project.name !== "escritorio", "una vez basta");
  test.setTimeout(150_000);
  await page.goto("/");
  await page.getByRole("button", { name: "Configurar más tarde" }).click();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const file = require("node:path").join(__dirname, "../tests/fixtures/roster-grid.png");
  await page.goto("/importar/");
  await page.locator('input[type=file]:not([capture])').setInputFiles(file);
  await page.getByRole("button", { name: "Analizar cuadrante" }).click();
  await expect(page.getByText("Revisa los turnos reconocidos")).toBeVisible({ timeout: 90_000 });

  await context.setOffline(true);
  await page.goto("/importar/");
  await page.getByLabel("Semana o mes del cuadrante (cualquier día)").fill("2026-11-25");
  await page.locator('input[type=file]:not([capture])').setInputFiles(file);
  await page.getByRole("button", { name: "Analizar cuadrante" }).click();
  await expect(page.getByText("Revisa los turnos reconocidos")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("5 para añadir")).toBeVisible();
  await context.setOffline(false);
});
