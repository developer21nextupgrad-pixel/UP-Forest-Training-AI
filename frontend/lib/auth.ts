export type UserRole = "ADMIN" | "INSTRUCTOR" | "STUDENT" | "LEGAL_USER" | "FIELD_OFFICER";

export interface AuthUser {
  id: string;
  email: string;
  username?: string | null;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  preferred_language: string;
  last_login_at?: string | null;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export const ACCESS_TOKEN_KEY = "up_forest_access_token";
export const REFRESH_TOKEN_KEY = "up_forest_refresh_token";
export const USER_KEY = "up_forest_user";

export function saveAuth(data: TokenResponse, remember = true) {
  if (typeof window === "undefined") return;
  const primary = remember ? localStorage : sessionStorage;
  const secondary = remember ? sessionStorage : localStorage;
  secondary.removeItem(ACCESS_TOKEN_KEY);
  secondary.removeItem(REFRESH_TOKEN_KEY);
  secondary.removeItem(USER_KEY);
  primary.setItem(ACCESS_TOKEN_KEY, data.access_token);
  primary.setItem(REFRESH_TOKEN_KEY, data.refresh_token);
  primary.setItem(USER_KEY, JSON.stringify(data.user));
}

function getStoredValue(key: string) {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(key) ?? sessionStorage.getItem(key);
}

export function getAccessToken() {
  return getStoredValue(ACCESS_TOKEN_KEY);
}

export function getRefreshToken() {
  return getStoredValue(REFRESH_TOKEN_KEY);
}

export function setStoredUser(user: AuthUser) {
  if (typeof window === "undefined") return;
  const storage = isRememberedSession() ? localStorage : sessionStorage;
  storage.setItem(USER_KEY, JSON.stringify(user));
}

export function getStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;
  try {
    const value = getStoredValue(USER_KEY);
    return value ? (JSON.parse(value) as AuthUser) : null;
  } catch {
    localStorage.removeItem(USER_KEY);
    return null;
  }
}

export function clearAuth() {
  if (typeof window === "undefined") return;
  for (const storage of [localStorage, sessionStorage]) {
    storage.removeItem(ACCESS_TOKEN_KEY);
    storage.removeItem(REFRESH_TOKEN_KEY);
    storage.removeItem(USER_KEY);
  }
}


export function isRememberedSession() {
  if (typeof window === "undefined") return true;
  return Boolean(localStorage.getItem(ACCESS_TOKEN_KEY));
}

export function isAuthenticated() {
  return Boolean(getAccessToken() && getRefreshToken() && getStoredUser());
}

export function dashboardForRole(role: UserRole) {
    if (role === "ADMIN") return "/admin";
    if (role === "INSTRUCTOR") return "/instructor";
    if (role === "LEGAL_USER") return "/legal/dashboard";
    if (role === "FIELD_OFFICER") return "/field";
    return "/student";
}

export function notifyAuthExpired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("up-forest-auth-expired"));
  }
}
