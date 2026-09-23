import type { ApiResponse } from "@/types/api";
import {
  clearAuth,
  getAccessToken,
  getRefreshToken,
  notifyAuthExpired,
  isRememberedSession,
  saveAuth,
  type TokenResponse,
} from "@/lib/auth";

const DEFAULT_API_URL = "http://localhost:8000";

export function getApiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export function apiUrl(path: string): string {
  return `${getApiBaseUrl()}${path}`;
}

export function apiWsUrl(path: string): string {
  return apiUrl(path).replace(/^http/, "ws");
}

interface ApiRequestOptions extends RequestInit {
  timeoutMs?: number;
}

type RefreshResult = "refreshed" | "invalid" | "unavailable";
let refreshPromise: Promise<RefreshResult> | null = null;

async function refreshAccessToken(): Promise<RefreshResult> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return "invalid";

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await fetch(apiUrl("/api/v1/auth/refresh"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
          signal: controller.signal,
        });
        if (response.status === 401 || response.status === 403) return "invalid";
        if (!response.ok) return "unavailable";
        const body = (await response.json()) as TokenResponse;
        if (!body.access_token || !body.refresh_token || !body.user) return "unavailable";
        saveAuth(body, isRememberedSession());
        return "refreshed";
      } catch {
        return "unavailable";
      } finally {
        clearTimeout(timeout);
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}

function failureForStatus(status: number, body: any): ApiResponse<never> {
  const message =
    body?.message ??
    (status === 401
      ? "Your session has expired. Please sign in again."
      : status === 403
        ? "You do not have permission to perform this action."
        : status === 404
          ? "The requested content was not found."
          : status >= 500
            ? "Something went wrong on the server. Please try again."
            : "Unable to process your request. Please try again.");

  return {
    success: false,
    message,
    status,
    code:
      status === 401
        ? "AUTH_REQUIRED"
        : status === 403
          ? "FORBIDDEN"
          : status === 404
            ? "NOT_FOUND"
            : status >= 500
              ? "SERVER_ERROR"
              : undefined,
  };
}

export async function apiRequest<T>(
  path: string,
  { timeoutMs = 30_000, signal, ...init }: ApiRequestOptions = {},
  _retry = true,
): Promise<ApiResponse<T>> {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const forwardAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", forwardAbort, { once: true });
  }

  try {
    const headers = new Headers(init.headers);

    const token = getAccessToken();
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    // JSON requests must explicitly declare their content type.
    // Do not set this for FormData/file uploads.
    if (
      typeof init.body === "string" &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(apiUrl(path), {
      ...init,
      headers,
      signal: controller.signal,
    });

    const body = await response.json().catch(() => null);

    // Only an actual 401 is an authentication failure. Everything else is a
    // normal request failure and must leave the current session intact.
    if (
      response.status === 401 &&
      _retry &&
      !path.includes("/auth/login") &&
      !path.includes("/auth/refresh")
    ) {
      const refreshed = await refreshAccessToken();
      if (refreshed === "refreshed") {
        if (signal?.aborted) {
          return { success: false, message: "Request cancelled.", code: "CLIENT_ABORT" };
        }
        return apiRequest<T>(path, { ...init, signal, timeoutMs }, false);
      }
      if (refreshed === "invalid") {
        clearAuth();
        notifyAuthExpired();
        return {
          success: false,
          message: "Your session has expired. Please sign in again.",
          status: 401,
          code: "AUTH_REQUIRED",
        };
      }
      return {
        success: false,
        message: "Authentication service is temporarily unavailable. Please try again.",
        status: 503,
        code: "SERVER_ERROR",
      };
    }

    if (!response.ok) {
      return failureForStatus(response.status, body) as ApiResponse<T>;
    }

    if (body !== null && (typeof body === "object" || typeof body === "function")) {
      const successBody = body as T & { success?: boolean; data?: T; message?: string };
      if (successBody.success === false) {
        return {
          ...successBody,
          status: response.status,
        } as ApiResponse<T>;
      }

      Object.defineProperty(body, "success", {
        value: true,
        enumerable: true,
        configurable: true,
      });
      Object.defineProperty(body, "data", {
        value: body,
        enumerable: false,
        configurable: true,
      });
      Object.defineProperty(body, "status", {
        value: response.status,
        enumerable: false,
        configurable: true,
      });
      return body as ApiResponse<T>;
    }

    return { success: true, data: body as T, status: response.status } as ApiResponse<T>;
  } catch {
    if (timedOut) {
      return {
        success: false,
        message: "Request timed out. Please try again.",
        code: "TIMEOUT",
      };
    }

    if (signal?.aborted) {
      return {
        success: false,
        message: "Request cancelled.",
        code: "CLIENT_ABORT",
      };
    }

    return {
      success: false,
      message: "Unable to connect to the server. Please try again.",
      code: "NETWORK",
    };
  } finally {
    clearTimeout(timeout);
    if (signal) signal.removeEventListener("abort", forwardAbort);
  }
}
