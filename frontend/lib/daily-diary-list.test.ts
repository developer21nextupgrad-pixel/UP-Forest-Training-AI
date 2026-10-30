import { beforeEach, describe, expect, it, vi } from "vitest";

import { loadDailyDiaryList } from "@/lib/daily-diary-list";
import { apiRequest } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

describe("Daily Diary list loading", () => {
  beforeEach(() => {
    mockedApiRequest.mockReset();
  });

  it("loads the existing authenticated list endpoint and returns its records", async () => {
    const diaries = [{ diary_id: "diary-1", status: "DRAFT" }];
    mockedApiRequest.mockResolvedValue({
      success: true,
      data: { success: true, diaries, total: 1 },
    });

    await expect(loadDailyDiaryList<{ diary_id: string; status: string }>()).resolves.toEqual(diaries);
    expect(mockedApiRequest).toHaveBeenCalledWith("/api/v1/field/forms/daily-diary");
  });

  it("preserves the API failure and logs diagnostic status in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedApiRequest.mockResolvedValue({
      success: false,
      status: 500,
      code: "SERVER_ERROR",
      message: "Something went wrong on the server. Please try again.",
    });

    await expect(loadDailyDiaryList()).rejects.toThrow(
      "Unable to load daily diaries right now. Please try again.",
    );
    expect(diagnostic).toHaveBeenCalledWith(
      "[Daily Diary] Failed to load diary list.",
      expect.objectContaining({ status: 500, code: "SERVER_ERROR" }),
    );
    diagnostic.mockRestore();
    vi.unstubAllEnvs();
  });

  it("logs network failures with an explicit missing HTTP status", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockedApiRequest.mockResolvedValue({
      success: false,
      code: "NETWORK",
      message: "Unable to connect to the server. Please try again.",
    });

    await expect(loadDailyDiaryList()).rejects.toThrow(
      "Unable to connect to the server. Please try again.",
    );
    expect(diagnostic).toHaveBeenCalledWith(
      "[Daily Diary] Failed to load diary list.",
      expect.objectContaining({
        path: "/api/v1/field/forms/daily-diary",
        status: null,
        code: "NETWORK",
        message: "Unable to connect to the server. Please try again.",
      }),
    );
    diagnostic.mockRestore();
    vi.unstubAllEnvs();
  });

  it("rejects a successful response with an invalid diary-list shape", async () => {
    mockedApiRequest.mockResolvedValue({
      success: true,
      data: { success: true, diaries: null, total: 0 },
    } as never);

    await expect(loadDailyDiaryList()).rejects.toThrow(
      "The diary list could not be read. Please refresh and try again.",
    );
  });
});
