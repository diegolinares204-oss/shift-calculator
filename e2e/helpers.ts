import { expect, type Page } from "@playwright/test";

export async function onboard(page: Page, opts: { weekly?: string; hourly?: string } = {}) {
  await page.goto("/");
  await expect(page.getByText("Te damos la bienvenida")).toBeVisible();
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Nombre (opcional)").fill("Prueba");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Vigente desde").fill("2026-01-01");
  await page.getByLabel("Horas semanales contratadas").fill(opts.weekly ?? "15");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByLabel("Salario bruto por hora").fill(opts.hourly ?? "10");
  await page.getByRole("button", { name: "Continuar" }).click();
  await page.getByRole("button", { name: "Empezar" }).click();
  await expect(page.getByText("Accesos rápidos")).toBeVisible();
}

export async function go(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
}
