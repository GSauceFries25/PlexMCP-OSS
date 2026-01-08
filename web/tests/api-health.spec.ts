import { test, expect } from "@playwright/test";

/**
 * API Health Check Tests
 * These tests verify that the backend API is accessible and key endpoints respond correctly.
 * This catches issues like the 405 error we had where frontend was calling wrong endpoints.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";

test.describe("API Health Checks", () => {
  test("API root responds", async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/health`);
    // Should get a response (2xx or 404 if health endpoint doesn't exist)
    expect(response.status()).toBeLessThan(500);
  });

  test("Organizations endpoint accepts GET", async ({ request }) => {
    const response = await request.get(`${API_URL}/api/v1/organizations`);
    // Should get 401 (unauthorized) not 405 (method not allowed)
    expect([200, 401, 403]).toContain(response.status());
  });

  test("Org endpoint accepts PATCH", async ({ request }) => {
    // This was the bug we fixed - frontend was calling /organizations/:id instead of /org
    const response = await request.patch(`${API_URL}/api/v1/org`, {
      data: { name: "test" },
    });
    // Should get 401 (unauthorized) not 405 (method not allowed)
    expect([200, 401, 403]).toContain(response.status());
  });

  test("Org endpoint accepts DELETE", async ({ request }) => {
    const response = await request.delete(`${API_URL}/api/v1/org`);
    // Should get 401 (unauthorized) not 405 (method not allowed)
    expect([200, 401, 403]).toContain(response.status());
  });

  test("Invalid endpoint returns 404, not 405", async ({ request }) => {
    // This verifies that 405 means "method not allowed" not "endpoint doesn't exist"
    const response = await request.get(
      `${API_URL}/api/v1/nonexistent-endpoint-xyz`
    );
    expect(response.status()).toBe(404);
  });
});

test.describe("API Endpoint Verification", () => {
  // Tests that verify all expected endpoints exist
  const endpoints = [
    { method: "GET", path: "/api/v1/organizations" },
    { method: "POST", path: "/api/v1/organizations" },
    { method: "GET", path: "/api/v1/org" },
    { method: "PATCH", path: "/api/v1/org" },
    { method: "DELETE", path: "/api/v1/org" },
    { method: "GET", path: "/api/v1/mcps" },
    { method: "POST", path: "/api/v1/mcps" },
    { method: "GET", path: "/api/v1/api-keys" },
    { method: "POST", path: "/api/v1/api-keys" },
    { method: "GET", path: "/api/v1/domains" },
    { method: "POST", path: "/api/v1/domains" },
    { method: "GET", path: "/api/v1/addons" },
    { method: "POST", path: "/api/v1/addons/enable" },
  ];

  for (const { method, path } of endpoints) {
    test(`${method} ${path} endpoint exists (not 404/405)`, async ({
      request,
    }) => {
      let response;
      switch (method) {
        case "GET":
          response = await request.get(`${API_URL}${path}`);
          break;
        case "POST":
          response = await request.post(`${API_URL}${path}`, { data: {} });
          break;
        case "PATCH":
          response = await request.patch(`${API_URL}${path}`, { data: {} });
          break;
        case "DELETE":
          response = await request.delete(`${API_URL}${path}`);
          break;
      }
      // 401/403 means endpoint exists but requires auth - this is expected
      // 400 means endpoint exists but request was malformed - also acceptable
      // 404/405 means endpoint doesn't exist or wrong method - this is a bug
      expect([200, 201, 400, 401, 403]).toContain(response!.status());
    });
  }
});
