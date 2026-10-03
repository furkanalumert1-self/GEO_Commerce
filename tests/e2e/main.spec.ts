import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/**
 * E2E (demo modu, seed'li DB, DEMO_LOGIN=true ile `next start`):
 * audit → claim/trial → ölçüm → fırsat → Fix taslağı → onay → export; ajans müşteri izolasyonu; 3 viewport + axe.
 */
async function loginAs(page: Page, label: RegExp) {
  await page.goto("/login");
  await page.getByRole("button", { name: label }).click();
  await page.waitForURL(/\/w\//);
  const ws = page.url().match(/\/w\/([0-9a-f-]{36})/)![1]!;
  await page.goto(`/w/${ws}/overview`);
  const href = await page.locator('a[href*="/b/"]').first().getAttribute("href");
  return { ws, brand: href!.match(/\/b\/([0-9a-f-]{36})/)![1]! };
}

test("public sayfalar erişilebilir ve yatay taşma yok", async ({ page }) => {
  for (const p of ["/", "/pricing", "/audit", "/login"]) {
    await page.goto(p);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious"), p).toEqual([]);
  }
});

test("pano: 3 viewport ekran görüntüsü, axe, klavye ile menü", async ({ page }, info) => {
  const { ws, brand } = await loginAs(page, /Marka sahibi/);
  await page.goto(`/w/${ws}/b/${brand}/dashboard`);
  await expect(page.getByRole("heading", { level: 1, name: "Genel Bakış" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bugün yapabilecekleriniz" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `test-results/dashboard-${info.project.name}.png`, fullPage: true });
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).exclude(".recharts-wrapper").analyze();
  expect(axe.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  if ((page.viewportSize()?.width ?? 1440) < 1024) {
    await page.getByRole("button", { name: "Menüyü aç" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  }
});

test("audit → claim → trial onboarding", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "tek viewport yeterli");
  await page.goto("/audit");
  await page.getByLabel("Alan adı").fill("lumabakim.example");
  await page.getByRole("button", { name: /audit başlat/i }).click();
  await page.waitForURL(/\/audit\/.+/);
  await expect(page.getByText(/Hesaplanan fırsat sayısı/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Küçük örneklem/)).toBeVisible();
  const path = new URL(page.url()).pathname;
  await page.goto(`/login?next=${encodeURIComponent(path)}`);
  await page.getByRole("button", { name: /Editör/ }).click();
  await page.waitForURL(/\/audit\//);
  await page.getByRole("button", { name: /hesabıma kaydet/ }).click();
  await page.waitForURL(/\/onboarding/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kurulum");
});

test("ölçüm → fırsat → Fix taslağı → onay → export", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-1440", "tek viewport yeterli");
  const { ws, brand } = await loginAs(page, /Marka sahibi/);
  await page.goto(`/w/${ws}/b/${brand}/prompts`);
  await page.getByRole("button", { name: "Maliyeti önizle" }).click();
  await expect(page.getByText(/Planlanan:/)).toBeVisible();
  await page.getByRole("button", { name: "Onayla ve başlat" }).click();
  await expect(page.getByText(/kuyruğa alındı/)).toBeVisible();
  await page.goto(`/w/${ws}/b/${brand}/opportunities?status=new`);
  await page.locator('a[href*="/opportunities/"]').first().click();
  await expect(page.getByRole("heading", { name: "Ne oldu?" })).toBeVisible();
  await page.getByRole("button", { name: /AI ile iyileştir/ }).first().click();
  await page.waitForURL(/\/actions\//);
  // Zorunlu eksik (ör. [FİYAT]) varsa onay kapalıdır; alanlar doldurulup yeni sürüm kaydedilir.
  await expect(page.getByRole("button", { name: "Değişiklikleri onayla" })).toBeVisible();
  if (await page.getByText(/eksik bilgi var/).isVisible()) {
    await expect(page.getByRole("button", { name: "Değişiklikleri onayla" })).toBeDisabled();
    await page.getByRole("tab", { name: "Düzenle" }).click();
    for (const box of await page.locator("#pane-edit textarea, #pane-edit input").all()) {
      const v = await box.inputValue();
      if (/\[[A-ZÇĞİÖŞÜ]/.test(v)) await box.fill(v.replace(/\[[A-ZÇĞİÖŞÜ0-9 _/-]+\](?!\()/g, "₺100,00"));
    }
    await page.getByRole("button", { name: "Yeni sürüm olarak kaydet" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Taslak kaydedildi" })).toBeVisible();
    await expect(page.getByText(/eksik bilgi var/)).toBeHidden();
  }
  await page.getByRole("button", { name: "Değişiklikleri onayla" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Onaylandı" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Mağazada yayımla" })).toBeDisabled();
  await page.getByRole("tab", { name: "Teknik ayrıntılar" }).click();
  const dl = page.waitForEvent("download");
  await page.getByRole("link", { name: "MD indir" }).click();
  expect((await dl).suggestedFilename()).toMatch(/\.md$/);
});

test("ajans müşterisi yalnız kendi markasını görür", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "tek viewport yeterli");
  await loginAs(page, /Ajans müşterisi/);
  // Tek markada seçici yerine marka alanı gösterilir; çok markada yalnız yetkili marka seçeneği bulunur.
  const options = (await page.locator("#brand-switch option").allTextContents()).filter((o) => o !== "Marka seçin");
  expect(options.length).toBeLessThanOrEqual(1);
  expect(options.every((o) => o.startsWith("Mira Ev Tekstili"))).toBe(true);
  const res = await page.request.get(`/api/v1/workspaces/00000000-0000-0000-0000-000000000000/brands`);
  expect(res.status()).toBe(404);
  void request;
});
