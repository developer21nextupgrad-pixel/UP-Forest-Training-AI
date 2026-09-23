export interface ApiFailure {
  success: false;
  message: string;
  status?: number;
  code?: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "TIMEOUT" | "NETWORK" | "SERVER_ERROR" | "CLIENT_ABORT";
}

export type ApiSuccess<T> = T & {
  success: true;
  data: T;
  message?: string;
  status?: number;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export interface HealthStatus {
  status: "healthy" | "degraded";
  version: string;
}
