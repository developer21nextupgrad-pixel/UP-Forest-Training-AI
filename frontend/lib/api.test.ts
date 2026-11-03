import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiRequest } from "@/lib/api";
import { saveAuth, type TokenResponse } from "@/lib/auth";

const user = {
  id: "field-officer-1",
  email: "officer@example.test",
  full_name: "Field Officer",
  role: "FIELD_OFFICER" as const,
  is_active: true,
  preferred_language: "en",
};

function tokenResponse(accessToken: string, refreshToken: string): TokenResponse {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "bearer",
    expires_in: 1800,
    user,
  };
}

beforeEach(() => {
  const localValues = new Map<string, string>();
  const sessionValues = new Map<string, string>();
  const storage = (values: Map<string, string>) => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("localStorage", storage(localValues));
  vi.stubGlobal("sessionStorage", storage(sessionValues));
  saveAuth(tokenResponse("current-access-token", "current-refresh-token"));
});

describe("apiRequest authentication", () => {
  it("uses the current access token and retries once with the refreshed token", async () => {
    const calls: Array<{ url: string; authorization: string | null }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const authorization = new Headers(init?.headers).get("Authorization");
      calls.push({ url, authorization });

      if (url.endsWith("/api/v1/auth/refresh")) {
        return new Response(JSON.stringify(tokenResponse("refreshed-access-token", "rotated-refresh-token")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (authorization === "Bearer current-access-token") {
        return new Response(JSON.stringify({ detail: "Invalid or expired access token" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ reports: [], total: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await apiRequest<{ reports: unknown[]; total: number }>(
      "/api/v1/field/forms/patrol",
      { headers: { Authorization: "Bearer stale-access-token" } },
    );

    expect(result.success).toBe(true);
    expect(calls).toEqual([
      {
        url: "http://localhost:8000/api/v1/field/forms/patrol",
        authorization: "Bearer current-access-token",
      },
      {
        url: "http://localhost:8000/api/v1/auth/refresh",
        authorization: null,
      },
      {
        url: "http://localhost:8000/api/v1/field/forms/patrol",
        authorization: "Bearer refreshed-access-token",
      },
    ]);
  });

  it("does not repeatedly retry a Patrol Reports request when refreshed credentials are rejected", async () => {
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/v1/auth/refresh")) {
        return new Response(JSON.stringify(tokenResponse("refreshed-access-token", "rotated-refresh-token")), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ detail: "Invalid or expired access token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await apiRequest("/api/v1/field/forms/patrol");

    expect(result.success).toBe(false);
    expect(result.status).toBe(401);
    expect(calls.filter((url) => url.endsWith("/api/v1/field/forms/patrol"))).toHaveLength(2);
    expect(calls.filter((url) => url.endsWith("/api/v1/auth/refresh"))).toHaveLength(1);
  });
});
