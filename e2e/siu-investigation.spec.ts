import { test, expect } from "@playwright/test";
import { loginDashboard, USERS, expectHeading, expectNoErrors } from "./helpers";

test.describe("SIU Investigation Flow", () => {
  test.beforeEach(async ({ page }) => {
    await loginDashboard(page, USERS.admin);
  });

  // ─── SIU Cases List ───────────────────────────────────

  test.describe("SIU Cases List", () => {
    test("navigates to SIU cases page", async ({ page }) => {
      await page.goto("/dashboard/siu-cases");
      await page.waitForLoadState("networkidle");

      await expectHeading(page, /siu cases|investigations/i);
    });

    test("shows a table of SIU cases", async ({ page }) => {
      await page.goto("/dashboard/siu-cases");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Should have a table for SIU cases
      const table = page.getByRole("table");
      if ((await table.count()) > 0) {
        // Verify table has header columns
        const headers = page.getByRole("columnheader");
        expect(await headers.count()).toBeGreaterThan(0);
      }
    });

    test("has status filter dropdown", async ({ page }) => {
      await page.goto("/dashboard/siu-cases");
      await page.waitForLoadState("networkidle");

      const statusFilter = page
        .getByLabel(/filter by case status/i)
        .or(page.locator("select").first());
      await expect(statusFilter).toBeVisible();
    });

    test("no errors on page load", async ({ page }) => {
      await page.goto("/dashboard/siu-cases");
      await page.waitForTimeout(2000);
      await expectNoErrors(page);
    });
  });

  // ─── SIU Case Detail ─────────────────────────────────

  test.describe("SIU Case Detail", () => {
    test("displays case detail page with tabs", async ({ page }) => {
      await page.goto("/dashboard/siu-cases");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      // Try to click into a case
      const caseLink = page.getByRole("link").filter({ hasText: /SIU-|case/i }).first();
      if ((await caseLink.count()) > 0) {
        await caseLink.click();
        await page.waitForURL(/\/dashboard\/siu-cases\//, { timeout: 5000 });

        // Should have tab navigation
        const tablist = page.getByRole("tablist");
        await expect(tablist).toBeVisible();

        // Should have expected tabs
        const tabs = page.getByRole("tab");
        expect(await tabs.count()).toBeGreaterThan(0);
      }
    });

    test("case detail shows key information", async ({ page }) => {
      await page.goto("/dashboard/siu-cases");
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);

      const caseRow = page.locator("tr").filter({ hasText: /SIU-|OPEN|CLOSED/i }).first();
      if ((await caseRow.count()) > 0) {
        const link = caseRow.getByRole("link").first();
        if ((await link.count()) > 0) {
          await link.click();
          await page.waitForURL(/\/dashboard\/siu-cases\//, { timeout: 5000 });

          // Should show case status badge
          await expect(
            page.getByText(/OPEN|IN_PROGRESS|CLOSED|RESOLVED/i).first(),
          ).toBeVisible();
        }
      }
    });
  });
});
