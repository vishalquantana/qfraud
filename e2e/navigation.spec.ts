import { test, expect } from "@playwright/test";
import { loginDashboard, USERS } from "./helpers";

test.describe("Dashboard Navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginDashboard(page, USERS.admin);
  });

  test("sidebar shows navigation links", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: /main/i }).or(page.locator("nav"));
    await expect(nav.first()).toBeVisible();

    // Key navigation items should be present
    await expect(page.getByRole("link", { name: /triage/i })).toBeVisible();
  });

  test("clicking Triage navigates to triage board", async ({ page }) => {
    await page.getByRole("link", { name: /triage/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/triage/);
  });

  test("clicking Analytics navigates to analytics", async ({ page }) => {
    const analyticsLink = page.getByRole("link", { name: /analytics/i });
    if ((await analyticsLink.count()) > 0) {
      await analyticsLink.click();
      await expect(page).toHaveURL(/\/dashboard\/analytics/);
    }
  });

  test("clicking SIU Cases navigates to cases list", async ({ page }) => {
    const siuLink = page.getByRole("link", { name: /siu/i });
    if ((await siuLink.count()) > 0) {
      await siuLink.click();
      await expect(page).toHaveURL(/\/dashboard\/siu-cases/);
    }
  });

  test("clicking Audit Trail navigates to audit log", async ({ page }) => {
    const auditLink = page.getByRole("link", { name: /audit/i });
    if ((await auditLink.count()) > 0) {
      await auditLink.click();
      await expect(page).toHaveURL(/\/dashboard\/audit-trail/);
    }
  });

  test("clicking Settings navigates to config", async ({ page }) => {
    const settingsLink = page.getByRole("link", { name: /settings|config/i });
    if ((await settingsLink.count()) > 0) {
      await settingsLink.click();
      await expect(page).toHaveURL(/\/dashboard\/config/);
    }
  });

  test("active nav item is highlighted", async ({ page }) => {
    await page.goto("/dashboard/triage");
    await page.waitForLoadState("networkidle");

    // Check for aria-current on active link
    const activeLink = page.locator('[aria-current="page"]');
    expect(await activeLink.count()).toBeGreaterThanOrEqual(1);
  });

  test("header has sign out button", async ({ page }) => {
    const signOutButton = page.getByRole("button", { name: /sign out/i }).or(
      page.getByLabel(/sign out/i),
    );
    await expect(signOutButton).toBeVisible();
  });

  test("header has theme toggle", async ({ page }) => {
    const themeToggle = page
      .getByLabel(/dark mode|light mode|theme/i)
      .or(page.getByRole("button", { name: /dark|light|theme/i }));
    await expect(themeToggle).toBeVisible();
  });
});
