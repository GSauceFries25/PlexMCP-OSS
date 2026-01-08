import { test, expect } from "@playwright/test";

/**
 * Settings Page Tests
 * Tests all settings interactions to catch issues like the 405 error on organization update.
 */

test.describe("Settings Page - Unauthenticated", () => {
  test("redirects to login when not authenticated", async ({ page }) => {
    await page.goto("/dashboard/settings");
    // Should redirect to login page
    await expect(page).toHaveURL(/\/(login|auth)/);
  });
});

test.describe("Settings Page - Authenticated", () => {
  // These tests require authentication
  // You can set up auth state in a beforeEach or use stored auth

  test.skip("displays settings tabs", async ({ page }) => {
    // Skip until auth is set up
    await page.goto("/dashboard/settings");

    // Check all tabs are visible
    await expect(page.getByRole("tab", { name: /general/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /api keys/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /team/i })).toBeVisible();
    await expect(page.getByRole("tab", { name: /domains/i })).toBeVisible();
  });

  test.skip("organization name input is editable", async ({ page }) => {
    await page.goto("/dashboard/settings");

    const nameInput = page.getByLabel(/organization name/i);
    await expect(nameInput).toBeVisible();
    await expect(nameInput).toBeEnabled();
  });

  test.skip("save changes button triggers API call without 405", async ({
    page,
  }) => {
    await page.goto("/dashboard/settings");

    // Listen for network requests
    const requestPromise = page.waitForRequest(
      (req) =>
        req.url().includes("/api/v1/org") && req.method() === "PATCH"
    );
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/org") && res.request().method() === "PATCH"
    );

    // Fill in org name and save
    const nameInput = page.getByLabel(/organization name/i);
    await nameInput.fill("Test Organization");
    await page.getByRole("button", { name: /save changes/i }).click();

    // Verify the request was made to correct endpoint
    const request = await requestPromise;
    expect(request.url()).toContain("/api/v1/org");
    expect(request.method()).toBe("PATCH");

    // Verify response is not 405
    const response = await responsePromise;
    expect(response.status()).not.toBe(405);
  });
});

test.describe("Settings Page - Form Validation", () => {
  test.skip("shows error for empty organization name", async ({ page }) => {
    await page.goto("/dashboard/settings");

    const nameInput = page.getByLabel(/organization name/i);
    await nameInput.clear();
    await page.getByRole("button", { name: /save changes/i }).click();

    // Should show validation error
    await expect(page.getByText(/required|cannot be empty/i)).toBeVisible();
  });
});
