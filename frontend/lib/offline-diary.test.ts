import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueueDiaryOperation,
  getOfflineDiaries,
  getPendingDiaryOperationCount,
  loadDiaryFormDraft,
  saveDiaryFormDraft,
  saveOfflineDiary,
  syncDiaryQueue,
  type OfflineDiary,
} from "@/lib/offline-diary";

const OWNER = "field-officer-1";
const OTHER_OWNER = "field-officer-2";

const diary: OfflineDiary = {
  ownerId: OWNER,
  localId: "local-diary-1",
  serverId: null,
  payload: {
    diary_date: "2026-10-26",
    subject: "Patrol",
    description: "Observed fresh tracks.",
    location: "North beat",
    activities: ["Patrol"],
    observations: null,
    additional_remarks: null,
  },
  status: "DRAFT",
  updatedAt: "2026-10-26T07:00:00.000Z",
  syncError: null,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setOnline(value: boolean): void {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: value },
  });
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("up-forest-field-offline");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Test IndexedDB deletion was blocked."));
  });

  const storage = () => ({
    getItem: vi.fn((key: string) =>
      key === "up_forest_user"
        ? JSON.stringify({ id: OWNER, role: "FIELD_OFFICER" })
        : null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage() });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage() });
  Object.defineProperty(globalThis, "dispatchEvent", { configurable: true, value: vi.fn() });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/v1/health")) return response({ status: "healthy", database: "ok" });
    return response({ diary_id: "server-diary-1", status: "DRAFT" });
  });
});

describe("Daily Diary offline storage and synchronization", () => {
  it("saves a draft while offline and restores it after a page reload", async () => {
    await saveDiaryFormDraft(OWNER, {
      key: "active",
      localId: diary.localId,
      editingId: null,
      form: { ...diary.payload, activities: ["Patrol"] },
    });

    const restored = await loadDiaryFormDraft(OWNER, "active");
    expect(restored?.form).toMatchObject({ subject: "Patrol", location: "North beat" });
    expect(restored?.localId).toBe(diary.localId);
  });

  it("keeps stored records isolated by field officer", async () => {
    await saveOfflineDiary(diary);
    await saveOfflineDiary({ ...diary, ownerId: OTHER_OWNER, localId: "other-diary" });

    expect((await getOfflineDiaries(OWNER)).map((entry) => entry.localId)).toEqual([diary.localId]);
    expect((await getOfflineDiaries(OTHER_OWNER)).map((entry) => entry.localId)).toEqual(["other-diary"]);
  });

  it("syncs automatically through the queue after connectivity returns", async () => {
    setOnline(false);
    await enqueueDiaryOperation(OWNER, diary, "CREATE");
    expect(await syncDiaryQueue(OWNER)).toBe("offline");
    expect(await getPendingDiaryOperationCount(OWNER)).toBe(1);
    setOnline(true);

    expect(await syncDiaryQueue(OWNER)).toBe("synced");
    expect(await getPendingDiaryOperationCount(OWNER)).toBe(0);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/field/forms/daily-diary"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("retries a temporary server error without creating a duplicate operation", async () => {
    const serverRows = new Map<string, string>();
    let postCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return response({ status: "healthy", database: "ok" });
      if (init?.method === "POST") {
        postCount += 1;
        const payload = JSON.parse(String(init.body)) as { client_operation_id: string };
        const existing = serverRows.get(payload.client_operation_id);
        if (!existing) serverRows.set(payload.client_operation_id, "server-diary-1");
        if (postCount === 1) return response({ message: "Temporary failure" }, 503);
        return response({ diary_id: existing ?? "server-diary-1", status: "DRAFT" });
      }
      return response({ diary_id: "server-diary-1", status: "DRAFT" });
    });

    await enqueueDiaryOperation(OWNER, diary, "CREATE");
    expect(await syncDiaryQueue(OWNER)).toBe("synced");
    expect(postCount).toBe(2);
    expect(serverRows.size).toBe(1);
    expect(await getPendingDiaryOperationCount(OWNER)).toBe(0);
  });

  it("pauses on authentication expiry and preserves the queued operation", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return response({ status: "healthy", database: "ok" });
      return response({ message: "Expired" }, 401);
    });
    await enqueueDiaryOperation(OWNER, diary, "CREATE");

    expect(await syncDiaryQueue(OWNER)).toBe("auth_required");
    expect(await getPendingDiaryOperationCount(OWNER)).toBe(1);
    expect((await getOfflineDiaries(OWNER))[0]?.syncError).toContain("expired");
  });

  it("prevents concurrent tabs from sending the same queued operation twice", async () => {
    let postCount = 0;
    let releasePost: (() => void) | undefined;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return response({ status: "healthy", database: "ok" });
      postCount += 1;
      await new Promise<void>((resolve) => { releasePost = resolve; });
      return response({ diary_id: "server-diary-1", status: "DRAFT" });
    });
    await enqueueDiaryOperation(OWNER, diary, "CREATE");

    const first = syncDiaryQueue(OWNER);
    await vi.waitFor(() => expect(postCount).toBe(1));
    const second = await syncDiaryQueue(OWNER);
    expect(second).toBe("busy");
    releasePost?.();
    expect(await first).toBe("synced");
    expect(postCount).toBe(1);
  });

  it("retains draft data and failed queue entry on server validation failure", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return response({ status: "healthy", database: "ok" });
      return response({ message: "Diary date is invalid" }, 422);
    });
    await enqueueDiaryOperation(OWNER, diary, "CREATE");

    expect(await syncDiaryQueue(OWNER)).toBe("failed");
    expect(await getPendingDiaryOperationCount(OWNER)).toBe(1);
    expect((await getOfflineDiaries(OWNER))[0]?.payload.description).toBe("Observed fresh tracks.");
    expect((await getOfflineDiaries(OWNER))[0]?.syncError).toContain("invalid");
  });

  it("uses the existing create, update, and submit endpoints when online", async () => {
    const methods: string[] = [];
    const paths: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return response({ status: "healthy", database: "ok" });
      methods.push(init?.method ?? "GET");
      paths.push(new URL(url).pathname);
      return response({ diary_id: "server-diary-1", status: "DRAFT" });
    });

    await enqueueDiaryOperation(OWNER, diary, "CREATE");
    expect(await syncDiaryQueue(OWNER)).toBe("synced");

    const serverDiary = { ...diary, serverId: "server-diary-1" };
    await enqueueDiaryOperation(OWNER, serverDiary, "UPDATE");
    expect(await syncDiaryQueue(OWNER)).toBe("synced");
    await enqueueDiaryOperation(OWNER, serverDiary, "SUBMIT");
    expect(await syncDiaryQueue(OWNER)).toBe("synced");

    expect(methods).toEqual(["POST", "PUT", "POST"]);
    expect(paths).toEqual([
      "/api/v1/field/forms/daily-diary",
      "/api/v1/field/forms/daily-diary/server-diary-1",
      "/api/v1/field/forms/daily-diary/server-diary-1/submit",
    ]);
  });
});
