import { test, expect } from "@playwright/test";

/**
 * Navigation Tests
 * Verifies all major pages load without errors
 */

test.describe("Public Pages", () => {
  test("homepage loads", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/PlexMCP/i);
  });

  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("button", { name: /sign in|log in/i })).toBeVisible();
  });

  test("signup page loads", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("button", { name: /sign up|register|create/i })).toBeVisible();
  });

  test("pricing page loads", async ({ page }) => {
    await page.goto("/pricing");
    // Should show pricing tiers
    await expect(page.getByText(/free|pro|team|enterprise/i).first()).toBeVisible();
  });
});

test.describe("Protected Pages - Redirect", () => {
  test("dashboard redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/(login|auth)/);
  });

  test("settings redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page).toHaveURL(/\/(login|auth)/);
  });

  test("billing redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/dashboard/billing");
    await expect(page).toHaveURL(/\/(login|auth)/);
  });

  test("mcps page redirects to login when unauthenticated", async ({ page }) => {
    await page.goto("/dashboard/mcps");
    await expect(page).toHaveURL(/\/(login|auth)/);
  });
});

test.describe("Page Error Detection", () => {
  const pages = ["/", "/login", "/signup", "/pricing"];

  for (const path of pages) {
    test(`${path} has no console errors`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          errors.push(msg.text());
        }
      });

      await page.goto(path);
      await page.waitForLoadState("networkidle");

      // Filter out known non-critical errors
      const criticalErrors = errors.filter(
        (e) =>
          !e.includes("favicon") &&
          !e.includes("third-party") &&
          !e.includes("analytics")
      );

      expect(criticalErrors).toHaveLength(0);
    });
  }
});

test.describe("API Error Detection", () => {
  test("no 4xx/5xx errors on homepage", async ({ page }) => {
    const failedRequests: string[] = [];
    page.on("response", (response) => {
      if (response.status() >= 400) {
        failedRequests.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Filter out expected 401s for auth checks
    const unexpectedErrors = failedRequests.filter(
      (r) => !r.includes("401") && !r.includes("favicon")
    );

    expect(unexpectedErrors).toHaveLength(0);
  });
});
