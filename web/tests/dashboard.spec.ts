import { test, expect } from "@playwright/test";

/**
 * Dashboard Tests
 * Tests for authenticated dashboard functionality
 * Most tests are skipped until auth setup is complete
 */

test.describe("Dashboard - Sidebar Navigation", () => {
  test.skip("sidebar displays all navigation items", async ({ page }) => {
    await page.goto("/dashboard");

    // Check sidebar navigation links
    await expect(page.getByRole("link", { name: /overview/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /mcps/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /analytics/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /settings/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /billing/i })).toBeVisible();
  });

  test.skip("clicking sidebar links navigates correctly", async ({ page }) => {
    await page.goto("/dashboard");

    // Click Settings
    await page.getByRole("link", { name: /settings/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/settings/);

    // Click MCPs
    await page.getByRole("link", { name: /mcps/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/mcps/);

    // Click Billing
    await page.getByRole("link", { name: /billing/i }).click();
    await expect(page).toHaveURL(/\/dashboard\/billing/);
  });
});

test.describe("Dashboard - MCPs Page", () => {
  test.skip("MCPs page loads without error", async ({ page }) => {
    await page.goto("/dashboard/mcps");

    // Should show MCP list or empty state
    await expect(
      page.getByText(/mcp|server|no mcps|create/i).first()
    ).toBeVisible();
  });

  test.skip("create MCP button is visible", async ({ page }) => {
    await page.goto("/dashboard/mcps");

    await expect(
      page.getByRole("button", { name: /create|add|new/i })
    ).toBeVisible();
  });

  test.skip("create MCP form opens", async ({ page }) => {
    await page.goto("/dashboard/mcps");

    await page.getByRole("button", { name: /create|add|new/i }).click();

    // Should show form or dialog
    await expect(page.getByLabel(/name/i)).toBeVisible();
  });
});

test.describe("Dashboard - Billing Page", () => {
  test.skip("billing page shows current plan", async ({ page }) => {
    await page.goto("/dashboard/billing");

    // Should show plan info
    await expect(
      page.getByText(/free|pro|team|enterprise|plan/i).first()
    ).toBeVisible();
  });

  test.skip("upgrade button is visible for free tier", async ({ page }) => {
    await page.goto("/dashboard/billing");

    await expect(
      page.getByRole("button", { name: /upgrade/i })
    ).toBeVisible();
  });
});

test.describe("Dashboard - API Keys", () => {
  test.skip("API keys tab shows in settings", async ({ page }) => {
    await page.goto("/dashboard/settings");

    await expect(page.getByRole("tab", { name: /api keys/i })).toBeVisible();
  });

  test.skip("can navigate to API keys tab", async ({ page }) => {
    await page.goto("/dashboard/settings");

    await page.getByRole("tab", { name: /api keys/i }).click();

    // Should show API keys content
    await expect(page.getByText(/api key|generate|create/i).first()).toBeVisible();
  });
});

test.describe("Dashboard - Domains", () => {
  test.skip("domains tab shows in settings", async ({ page }) => {
    await page.goto("/dashboard/settings");

    await expect(page.getByRole("tab", { name: /domains/i })).toBeVisible();
  });

  test.skip("domains tab shows paywall or management", async ({ page }) => {
    await page.goto("/dashboard/settings");

    await page.getByRole("tab", { name: /domains/i }).click();

    // Should show either paywall (for non-subscribers) or domain management
    await expect(
      page.getByText(/custom domain|enable|add domain|upgrade/i).first()
    ).toBeVisible();
  });
});
