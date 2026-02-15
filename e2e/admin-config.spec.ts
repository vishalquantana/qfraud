import { test, expect } from "@playwright/test";
import { loginDashboard, USERS, expectNoErrors } from "./helpers";

test.describe("Admin Configuration", () => {
  test.beforeEach(async ({ page }) => {
    await loginDashboard(page, USERS.admin);
  });

  // ─── Config Hub ───────────────────────────────────────

  test.describe("Configuration Hub", () => {
    test("shows configuration sections", async ({ page }) => {
      await page.goto("/dashboard/config");
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        /settings|configuration/i,
      );

      // Should show links to sub-sections
      await expect(
        page
          .getByRole("link", { name: /threshold/i })
          .or(page.getByText(/threshold/i)),
      ).toBeVisible();
    });

    test("no errors on page load", async ({ page }) => {
      await page.goto("/dashboard/config");
      await page.waitForTimeout(1000);
      await expectNoErrors(page);
    });
  });

  // ─── Thresholds Configuration ─────────────────────────

  test.describe("Thresholds", () => {
    test("loads threshold configuration page", async ({ page }) => {
      await page.goto("/dashboard/config/thresholds");
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        /threshold/i,
      );
    });

    test("shows auto-approve and auto-escalate sliders", async ({ page }) => {
      await page.goto("/dashboard/config/thresholds");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Should have range inputs for thresholds
      const sliders = page.locator('input[type="range"]');
      expect(await sliders.count()).toBeGreaterThanOrEqual(2);
    });

    test("has a save button", async ({ page }) => {
      await page.goto("/dashboard/config/thresholds");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const saveButton = page.getByRole("button", { name: /save|update/i });
      await expect(saveButton).toBeVisible();
    });

    test("no errors on page load", async ({ page }) => {
      await page.goto("/dashboard/config/thresholds");
      await page.waitForTimeout(2000);
      await expectNoErrors(page);
    });
  });

  // ─── White Label Configuration ────────────────────────

  test.describe("White Label", () => {
    test("loads white label configuration page", async ({ page }) => {
      await page.goto("/dashboard/config/white-label");
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        /white.?label|branding/i,
      );
    });

    test("shows color picker inputs", async ({ page }) => {
      await page.goto("/dashboard/config/white-label");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Should have color inputs
      const colorInputs = page.locator('input[type="color"]');
      expect(await colorInputs.count()).toBeGreaterThan(0);
    });

    test("no errors on page load", async ({ page }) => {
      await page.goto("/dashboard/config/white-label");
      await page.waitForTimeout(2000);
      await expectNoErrors(page);
    });
  });

  // ─── API Keys Configuration ───────────────────────────

  test.describe("API Keys", () => {
    test("loads API keys page", async ({ page }) => {
      await page.goto("/dashboard/config/api");
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        /api/i,
      );
    });

    test("has tab navigation for keys and webhooks", async ({ page }) => {
      await page.goto("/dashboard/config/api");
      await page.waitForLoadState("networkidle");

      const tablist = page.getByRole("tablist");
      await expect(tablist).toBeVisible();

      const tabs = page.getByRole("tab");
      expect(await tabs.count()).toBeGreaterThanOrEqual(2);
    });

    test("has create new key button", async ({ page }) => {
      await page.goto("/dashboard/config/api");
      await page.waitForLoadState("networkidle");

      const createButton = page.getByRole("button", { name: /create|new.*key/i });
      await expect(createButton).toBeVisible();
    });

    test("no errors on page load", async ({ page }) => {
      await page.goto("/dashboard/config/api");
      await page.waitForTimeout(2000);
      await expectNoErrors(page);
    });
  });

  // ─── Users Management ─────────────────────────────────

  test.describe("Users", () => {
    test("loads users management page", async ({ page }) => {
      await page.goto("/dashboard/config/users");
      await page.waitForLoadState("networkidle");

      await expect(page.getByRole("heading", { level: 1 })).toContainText(
        /users/i,
      );
    });

    test("shows user table", async ({ page }) => {
      await page.goto("/dashboard/config/users");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const table = page.getByRole("table");
      await expect(table).toBeVisible();
    });

    test("has invite user button", async ({ page }) => {
      await page.goto("/dashboard/config/users");
      await page.waitForLoadState("networkidle");

      const inviteButton = page.getByRole("button", {
        name: /invite|add.*user|new.*user/i,
      });
      await expect(inviteButton).toBeVisible();
    });

    test("no errors on page load", async ({ page }) => {
      await page.goto("/dashboard/config/users");
      await page.waitForTimeout(2000);
      await expectNoErrors(page);
    });
  });
});
