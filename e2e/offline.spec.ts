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
