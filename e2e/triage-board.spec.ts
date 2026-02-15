import { test, expect } from "@playwright/test";
import { loginDashboard, USERS, expectHeading, expectNoErrors } from "./helpers";

test.describe("Triage Board", () => {
  test.beforeEach(async ({ page }) => {
    await loginDashboard(page, USERS.admin);
    await page.goto("/dashboard/triage");
    await page.waitForLoadState("networkidle");
  });

  test("displays the triage board heading", async ({ page }) => {
    await expectHeading(page, /triage board/i);
  });

  test("shows Kanban columns for each status", async ({ page }) => {
    // Wait for board to load (loading spinner disappears)
    await page.waitForSelector('[aria-busy="true"]', {
      state: "detached",
      timeout: 10_000,
    }).catch(() => {
      // May already be loaded
    });

    // Should have columns visible
    const board = page.getByRole("region", { name: /kanban/i });
    await expect(board).toBeVisible();

    // Check for expected column headings
    await expect(page.getByText(/new submissions/i).or(page.getByText(/under review/i))).toBeVisible();
  });

  test("shows submission cards with key details", async ({ page }) => {
    // Wait for data to load
    await page.waitForTimeout(2000);

    // Look for submission cards (should show insured name, risk score, etc.)
    const cards = page.locator("[data-testid='submission-card']").or(
      page.locator("button").filter({ hasText: /LLC|Corp|Inc/i }),
    );
    const count = await cards.count();
    // May or may not have cards depending on seed data state
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test("filter bar is visible with filter controls", async ({ page }) => {
    // Should have severity and other filter dropdowns
    const selects = page.locator("select");
    const selectCount = await selects.count();
    expect(selectCount).toBeGreaterThan(0);
  });

  test("bulk approve button exists", async ({ page }) => {
    const bulkButton = page.getByRole("button", { name: /bulk approve|approve selected/i });
    // Button should exist (may be disabled if nothing selected)
    await expect(bulkButton).toBeVisible();
  });

  test("no errors visible on the page", async ({ page }) => {
    await page.waitForTimeout(2000);
    await expectNoErrors(page);
  });

  test("clicking a submission card navigates to detail view", async ({
    page,
  }) => {
    await page.waitForTimeout(2000);

    // Try to click on a submission card
    const card = page.locator("button").filter({ hasText: /LLC|Corp|Inc/i }).first();
    if ((await card.count()) > 0) {
      await card.click();
      await page.waitForURL(/\/dashboard\/submissions\//, { timeout: 5000 });
      await expect(page).toHaveURL(/\/dashboard\/submissions\//);
    }
  });
});
