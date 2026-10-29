import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  enqueueOfflineFieldOperation,
  enqueueOfflineEvidenceUpload,
  getOfflineFormRecord,
  getPendingFieldOperationCount,
  loadOfflineFormDraft,
  saveOfflineFormDraft,
  syncOfflineFieldFormQueue,
  type OfflineFieldRecord,
} from "@/lib/offline-field-forms";

const OWNER = "officer-patrol-1";

const record: OfflineFieldRecord = {
  ownerId: OWNER,
  module: "PATROL_REPORT",
  localId: "patrol-local-1",
  serverId: null,
  payload: { purpose: "Track wildlife", team_members: ["Officer A"] },
  status: "DRAFT",
  syncError: null,
  updatedAt: "2026-10-26T09:00:00.000Z",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("up-forest-offline-field-forms");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Offline form database deletion was blocked."));
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, "dispatchEvent", { configurable: true, value: vi.fn() });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
  const storage = () => ({
    getItem: vi.fn((key: string) =>
      key === "up_forest_user"
        ? JSON.stringify({ id: OWNER, role: "FIELD_OFFICER" })
        : null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage() });
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: storage() });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).endsWith("/api/v1/health")) {
      return jsonResponse({ status: "healthy", database: "ok" });
    }
    return jsonResponse({ report_id: "patrol-server-1", status: "DRAFT" });
  });
});

describe("Offline field form queue", () => {
  it("queues an offline Patrol create and clears its pending count only after confirmation", async () => {
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: false } });
    await enqueueOfflineFieldOperation(OWNER, "PATROL_REPORT", record, "CREATE");

    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(1);
    expect(vi.mocked(globalThis.dispatchEvent).mock.calls.some(([event]) =>
      event instanceof Event && event.type === "up-forest-offline-queue-changed",
    )).toBe(true);

    Object.defineProperty(globalThis, "navigator", { configurable: true, value: { onLine: true } });
    expect(await syncOfflineFieldFormQueue(OWNER, "PATROL_REPORT")).toBe("synced");
    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(0);
    expect(await getOfflineFormRecord(OWNER, "PATROL_REPORT", record.localId)).toMatchObject({
      serverId: "patrol-server-1",
      status: "DRAFT",
    });
  });

  it("restores editor drafts only for the matching owner and module", async () => {
    await saveOfflineFormDraft(OWNER, "PATROL_REPORT", "active", {
      localId: record.localId,
      purpose: "Track wildlife",
    });

    expect(await loadOfflineFormDraft(OWNER, "PATROL_REPORT", "active")).toMatchObject({
      snapshot: { localId: record.localId, purpose: "Track wildlife" },
    });
    expect(await loadOfflineFormDraft("another-officer", "PATROL_REPORT", "active")).toBeUndefined();
    expect(await loadOfflineFormDraft(OWNER, "INCIDENT_REPORT", "active")).toBeUndefined();
  });

  it("deduplicates queued create operations and stores the confirmed server ID", async () => {
    await enqueueOfflineFieldOperation(OWNER, "PATROL_REPORT", record, "CREATE");
    await enqueueOfflineFieldOperation(OWNER, "PATROL_REPORT", record, "CREATE");

    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(1);
    expect(await syncOfflineFieldFormQueue(OWNER, "PATROL_REPORT")).toBe("synced");
    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(0);
    expect(await getOfflineFormRecord(OWNER, "PATROL_REPORT", record.localId)).toMatchObject({
      serverId: "patrol-server-1",
      status: "DRAFT",
    });

    const saveCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/api/v1/field/forms/patrol"));
    expect(saveCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(saveCall?.[1]?.body))).toMatchObject({
      client_operation_id: `create:patrol_report:${record.localId}`,
    });
  });

  it("recovers a queued Patrol update without a server ID as an idempotent create", async () => {
    await enqueueOfflineFieldOperation(OWNER, "PATROL_REPORT", record, "UPDATE");

    expect(await syncOfflineFieldFormQueue(OWNER, "PATROL_REPORT")).toBe("synced");
    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(0);
    expect(await getOfflineFormRecord(OWNER, "PATROL_REPORT", record.localId)).toMatchObject({
      serverId: "patrol-server-1",
      status: "DRAFT",
    });

    const createCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).endsWith("/api/v1/field/forms/patrol"),
    );
    expect(createCall?.[1]?.method).toBe("POST");
    expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({
      purpose: "Track wildlife",
      client_operation_id: `create:patrol_report:${record.localId}`,
    });
    expect(vi.mocked(fetch).mock.calls.some(([url]) =>
      /\/api\/v1\/field\/forms\/patrol\/[^/]+$/.test(String(url)),
    )).toBe(false);
  });

  it("retries an interrupted Patrol create with the same idempotency key", async () => {
    const serverRecords = new Map<string, string>();
    const operationIds: string[] = [];
    let attempts = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({ status: "healthy", database: "ok" });
      }
      if (init?.method === "POST") {
        attempts += 1;
        const operationId = (JSON.parse(String(init.body)) as { client_operation_id: string }).client_operation_id;
        operationIds.push(operationId);
        const serverId = serverRecords.get(operationId) ?? "patrol-server-retry";
        serverRecords.set(operationId, serverId);
        if (attempts === 1) return jsonResponse({ message: "Temporary server error" }, 503);
        return jsonResponse({ report_id: serverId, status: "DRAFT" });
      }
      return jsonResponse({ report_id: "patrol-server-retry", status: "DRAFT" });
    });
    await enqueueOfflineFieldOperation(OWNER, "PATROL_REPORT", record, "CREATE");

    expect(await syncOfflineFieldFormQueue(OWNER, "PATROL_REPORT")).toBe("synced");
    expect(attempts).toBe(2);
    expect(operationIds[0]).toBe(operationIds[1]);
    expect(serverRecords.size).toBe(1);
    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(0);
  });

  it("retains validation failures and their local form data", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({ status: "healthy", database: "ok" });
      }
      return jsonResponse({ detail: "Patrol date is required" }, 422);
    });
    await enqueueOfflineFieldOperation(OWNER, "PATROL_REPORT", record, "CREATE");

    expect(await syncOfflineFieldFormQueue(OWNER, "PATROL_REPORT")).toBe("failed");
    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(1);
    expect(await getOfflineFormRecord(OWNER, "PATROL_REPORT", record.localId)).toMatchObject({
      payload: { purpose: "Track wildlife" },
      status: "DRAFT",
    });
  });

  it("pauses the queue when authentication expires without deleting operations", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({ status: "healthy", database: "ok" });
      }
      return jsonResponse({ message: "Expired session" }, 401);
    });
    await enqueueOfflineFieldOperation(OWNER, "PATROL_REPORT", record, "CREATE");

    expect(await syncOfflineFieldFormQueue(OWNER, "PATROL_REPORT")).toBe("auth_required");
    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(1);
  });

  it("does not send one officer's queued data under another signed-in account", async () => {
    await enqueueOfflineFieldOperation(OWNER, "PATROL_REPORT", record, "CREATE");
    vi.mocked(localStorage.getItem).mockImplementation((key: string) =>
      key === "up_forest_user"
        ? JSON.stringify({ id: "different-officer", role: "FIELD_OFFICER" })
        : null,
    );

    expect(await syncOfflineFieldFormQueue(OWNER, "PATROL_REPORT")).toBe("auth_required");
    expect(await getPendingFieldOperationCount(OWNER, "PATROL_REPORT")).toBe(1);
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/api/v1/field/forms/patrol"))).toBe(false);
  });

  it("retains evidence uploads locally and synchronizes them with a stable client key", async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/api/v1/health")) {
        return jsonResponse({ status: "healthy", database: "ok" });
      }
      return jsonResponse({ evidence: { id: "evidence-1" } });
    });
    const offenceRecord: OfflineFieldRecord = {
      ...record,
      module: "OFFENCE_SEIZURE",
      serverId: "offence-server-1",
      localId: "offence-local-1",
    };
    const image = new File(["evidence"], "photo.jpg", { type: "image/jpeg" });
    await enqueueOfflineEvidenceUpload(OWNER, offenceRecord, image, null, "evidence-key-1");

    expect(await getPendingFieldOperationCount(OWNER, "OFFENCE_SEIZURE")).toBe(1);
    expect(await syncOfflineFieldFormQueue(OWNER, "OFFENCE_SEIZURE")).toBe("synced");
    expect(await getPendingFieldOperationCount(OWNER, "OFFENCE_SEIZURE")).toBe(0);

    const uploadCall = vi.mocked(fetch).mock.calls.find(([url]) =>
      String(url).endsWith("/api/v1/field/evidence/upload"),
    );
    expect(uploadCall?.[1]?.body).toBeInstanceOf(FormData);
    expect((uploadCall?.[1]?.body as FormData).get("client_operation_id"))
      .toBe("evidence:offence-local-1:evidence-key-1");
  });
});
