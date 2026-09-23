"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";

import { apiRequest } from "@/lib/api";
import {
  clearAuth,
  dashboardForRole,
  getAccessToken,
  getRefreshToken,
  getStoredUser,
  setStoredUser,
  type AuthUser,
} from "@/lib/auth";

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",

  // Training portal
  "/student/login",
  "/instructor/login",
  "/admin/login",

  // Legal portal
  "/legal/login",

  // Field portal
  "/field/login",
];

const PROTECTED_PREFIXES = [
  "/admin",
  "/student",
  "/instructor",
  "/legal",
  "/field",
];

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  loading: true,
  logout: async () => { },
});

/**
 * Shared session validation promise.
 *
 * React Strict Mode can execute effects more than once during development.
 * Keeping one shared validation request prevents duplicate /auth/me calls.
 */
let authValidationPromise: Promise<{
  user: AuthUser | null;
  authenticated: boolean;
}> | null = null;

/* =========================================================
   PATH HELPERS
========================================================= */

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.includes(pathname);
}

function isProtectedPath(pathname: string) {
  if (isPublicPath(pathname)) {
    return false;
  }

  return PROTECTED_PREFIXES.some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Decide which role is allowed to access a particular portal.
 */
function roleCanAccessPath(
  user: AuthUser,
  pathname: string,
): boolean {
  if (pathname.startsWith("/admin")) {
    return user.role === "ADMIN";
  }

  if (pathname.startsWith("/instructor")) {
    return user.role === "INSTRUCTOR";
  }

  if (pathname.startsWith("/student")) {
    return user.role === "STUDENT";
  }

  if (pathname.startsWith("/legal")) {
    return user.role === "LEGAL_USER";
  }

  if (pathname.startsWith("/field")) {
    return user.role === "FIELD_OFFICER";
  }

  return true;
}

/**
 * Return the correct login page for a protected portal.
 */
function loginPathForRoute(pathname: string) {
  if (pathname.startsWith("/admin")) {
    return "/admin/login";
  }

  if (pathname.startsWith("/instructor")) {
    return "/instructor/login";
  }

  if (pathname.startsWith("/student")) {
    return "/student/login";
  }

  if (pathname.startsWith("/legal")) {
    return "/legal/login";
  }

  if (pathname.startsWith("/field")) {
    return "/field/login";
  }

  return "/login";
}

/**
 * Build a safe login redirect preserving the requested route.
 */
function buildLoginRedirect(pathname: string) {
  const loginPath = loginPathForRoute(pathname);

  return `${loginPath}?next=${encodeURIComponent(pathname)}`;
}

/* =========================================================
   SESSION VALIDATION
========================================================= */

async function validateStoredSession(
  pathname: string,
): Promise<{
  user: AuthUser | null;
  authenticated: boolean;
}> {
  const token = getAccessToken();
  const stored = getStoredUser();

  if (!token || !stored) {
    clearAuth();

    return {
      user: null,
      authenticated: false,
    };
  }

  // Validate the access token with the backend.
  // All portals use the same JWT authentication mechanism.
  const result = await apiRequest<AuthUser>(
    "/api/v1/auth/me",
    {
      timeoutMs: 10_000,
    },
  );

  /*
   * Valid session.
   */
  if (result.success) {
    const currentUser = result.data;

    /*
     * Never allow a portal session to silently become another portal.
     */
    if (
      pathname.startsWith("/legal") &&
      currentUser.role !== "LEGAL_USER"
    ) {
      clearAuth();

      return {
        user: null,
        authenticated: false,
      };
    }

    if (
      pathname.startsWith("/field") &&
      currentUser.role !== "FIELD_OFFICER"
    ) {
      clearAuth();

      return {
        user: null,
        authenticated: false,
      };
    }

    setStoredUser(currentUser);

    return {
      user: currentUser,
      authenticated: true,
    };
  }

  /*
   * Network/server failure is NOT automatically an auth failure.
   *
   * Keep the stored session so temporary backend/network problems
   * don't unnecessarily log the user out.
   */
  if (result.status !== 401) {
    return {
      user: stored,
      authenticated: true,
    };
  }

  /*
   * Actual authentication failure.
   */
  clearAuth();

  return {
    user: null,
    authenticated: false,
  };
}


function getAuthValidation(pathname: string) {
  if (!authValidationPromise) {
    authValidationPromise = validateStoredSession(pathname).finally(() => {
      authValidationPromise = null;
    });
  }

  return authValidationPromise;
}

/* =========================================================
   AUTH PROVIDER
========================================================= */

export function AuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();

  const [user, setUser] = useState<AuthUser | null>(null);

  /*
   * IMPORTANT:
   *
   * mounted prevents browser-only localStorage/sessionStorage values
   * from affecting the first server/client render.
   *
   * This is the main hydration fix.
   */
  const [mounted, setMounted] = useState(false);

  const [loading, setLoading] = useState(true);

  /* =======================================================
     MOUNT
  ======================================================= */

  useEffect(() => {
    setMounted(true);
  }, []);

  /* =======================================================
     SESSION HYDRATION
  ======================================================= */

  useEffect(() => {
    if (!mounted) {
      return;
    }

    let active = true;

    async function hydrate() {
      const stored = getStoredUser();
      const token = getAccessToken();

      /*
       * No stored authentication.
       */
      if (!token || !stored) {
        if (!active) {
          return;
        }

        clearAuth();
        setUser(null);
        setLoading(false);

        if (isProtectedPath(pathname)) {
          router.replace(buildLoginRedirect(pathname));
        }

        return;
      }

      /*
       * Restore stored user immediately so the UI doesn't unnecessarily
       * wait for /auth/me.
       */
      if (active) {
        setUser(stored);
      }

      /*
       * Validate session.
       */
      const result = await getAuthValidation(pathname);

      if (!active) {
        return;
      }

      setUser(result.user);
      setLoading(false);

      /*
       * Authentication failed.
       */
      if (!result.authenticated || !result.user) {
        if (isProtectedPath(pathname)) {
          router.replace(buildLoginRedirect(pathname));
        }

        return;
      }

      /*
       * User is already authenticated and is visiting a login/public
       * portal page.
       *
       * Send them to their own dashboard.
       */
      if (
        isPublicPath(pathname) &&
        pathname !== "/"
      ) {
        router.replace(
          dashboardForRole(result.user.role),
        );

        return;
      }

      /*
       * User is authenticated but trying to access another role's portal.
       *
       * Example:
       * STUDENT -> /legal/dashboard
       *
       * They are redirected to their own dashboard.
       */
      if (
        isProtectedPath(pathname) &&
        !roleCanAccessPath(result.user, pathname)
      ) {
        router.replace(
          dashboardForRole(result.user.role),
        );

        return;
      }
    }

    void hydrate();

    return () => {
      active = false;
    };
  }, [mounted, pathname, router]);

  /* =======================================================
     GLOBAL AUTH EXPIRY EVENT
  ======================================================= */

  useEffect(() => {
    if (!mounted) {
      return;
    }

    const handleExpired = () => {
      clearAuth();
      authValidationPromise = null;

      setUser(null);
      setLoading(false);

      router.replace(
        buildLoginRedirect(pathname),
      );
    };

    window.addEventListener(
      "up-forest-auth-expired",
      handleExpired,
    );

    return () => {
      window.removeEventListener(
        "up-forest-auth-expired",
        handleExpired,
      );
    };
  }, [mounted, pathname, router]);

  /* =======================================================
     LOGOUT
  ======================================================= */

  async function logout() {
    const refreshToken = getRefreshToken();

    try {
      if (refreshToken) {
        await apiRequest(
          "/api/v1/auth/logout",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              refresh_token: refreshToken,
            }),
          },
          false,
        );
      }
    } catch {
      /*
       * Even if the backend logout request fails,
       * local authentication must still be cleared.
       */
    } finally {
      clearAuth();

      authValidationPromise = null;

      setUser(null);
      setLoading(false);

      router.replace(
        loginPathForRoute(pathname),
      );
    }
  }

  /* =======================================================
     CONTEXT
  ======================================================= */

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      logout,
    }),
    [user, loading],
  );

  /* =======================================================
     HYDRATION-SAFE INITIAL RENDER
  ======================================================= */

  /*
   * IMPORTANT:
   *
   * Before mounted === true, we render the exact same deterministic
   * loading UI on server and client.
   *
   * We DO NOT call getAccessToken(), getStoredUser() or window APIs
   * during this render.
   *
   * This prevents the SSR/client HTML mismatch shown in your screenshot.
   */
  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-lg font-bold text-white shadow-lg">
            F
          </div>

          <div>
            <p className="font-semibold text-slate-900">
              Forest Library
            </p>

            <p className="mt-1 text-sm text-slate-500">
              Loading secure portal...
            </p>
          </div>

          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-600" />
          </div>
        </div>
      </div>
    );
  }

  /* =======================================================
     AUTH CHECK LOADING
  ======================================================= */

  const hasStoredToken = Boolean(getAccessToken());

  const shouldBlockWhileChecking =
    loading &&
    (
      isProtectedPath(pathname) ||
      (
        isPublicPath(pathname) &&
        pathname !== "/" &&
        hasStoredToken
      )
    );

  if (shouldBlockWhileChecking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="flex flex-col items-center gap-4 text-center">

          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-lg font-bold text-white shadow-lg">
            F
          </div>

          <div>
            <p className="font-semibold text-slate-900">
              Securing your session
            </p>

            <p className="mt-1 text-sm text-slate-500">
              Checking your Forest Library access…
            </p>
          </div>

          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full w-1/2 animate-pulse rounded-full bg-emerald-600" />
          </div>

        </div>
      </div>
    );
  }

  /* =======================================================
     APPLICATION
  ======================================================= */

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/* =========================================================
   HOOK
========================================================= */

export function useAuth() {
  return useContext(AuthContext);
}