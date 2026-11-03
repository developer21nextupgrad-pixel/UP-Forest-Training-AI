import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureWildlifeLocation,
  compressWildlifeImage,
} from "@/lib/patrol-wildlife";
import {
  enqueueOfflineEvidenceDelete,
  enqueueOfflineEvidenceUpload,
  enqueueOfflineFieldOperation,
  enqueueOfflineWildlifeIdentification,
  getOfflineFormRecord,
  getPendingFieldOperationCount,
  persistPatrolMetadataBeforeWildlifeEvidence,
  syncOfflineFieldFormQueue,
  type OfflineFieldRecord,
} from "@/lib/offline-field-forms";
import "fake-indexeddb/auto";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ownerId = "wildlife-officer";
const localId = "patrol-wildlife-local";
const sightingId = "sighting-stable-id";
const photoId = "photo-stable-id";
const initialRecord: OfflineFieldRecord = {
  ownerId,
  module: "PATROL_REPORT",
  localId,
  serverId: null,
  payload: {
    purpose: "Observe wildlife",
    wildlife_sightings: [{
      sighting_id: sightingId,
      latitude: 27.123,
      longitude: 81.456,
      accuracy_m: 12,
      photos: [{
        photo_id: photoId,
        file_name: "wildlife.jpg",
        mime_type: "image/jpeg",
        file_size: 10,
        evidence_id: null,
        identification: {
          status: "PENDING",
          common_name: null,
          scientific_name: null,
          confidence: null,
        },
      }],
    }],
  },
  status: "DRAFT",
  syncError: null,
  updatedAt: new Date().toISOString(),
};

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("up-forest-offline-field-forms");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: globalThis });
  Object.defineProperty(globalThis, "dispatchEvent", { configurable: true, value: vi.fn() });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { onLine: true },
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => key === "up_forest_user"
        ? JSON.stringify({ id: ownerId, role: "FIELD_OFFICER" })
        : null,
      setItem: vi.fn(),
      removeItem: vi.fn(),
    },
  });
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() },
  });
});

describe("Patrol wildlife capture and synchronization", () => {
  it("validates image types before processing and captures GPS or reports permission denial", async () => {
    await expect(compressWildlifeImage(
      new File(["not an image"], "photo.gif", { type: "image/gif" }),
    )).rejects.toThrow("Choose a JPEG, PNG, or WebP wildlife photo.");

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        geolocation: {
          getCurrentPosition: (success: PositionCallback) => success({
            coords: { latitude: 27.5, longitude: 81.2, accuracy: 8 } as GeolocationCoordinates,
          } as GeolocationPosition),
        },
      },
    });
    await expect(captureWildlifeLocation()).resolves.toEqual({
      latitude: 27.5,
      longitude: 81.2,
      accuracy_m: 8,
    });

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        geolocation: {
          getCurrentPosition: (_success: PositionCallback, error: PositionErrorCallback) => error({
            code: 1,
            message: "denied",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError),
        },
      },
    });
    await expect(captureWildlifeLocation()).rejects.toThrow("Location permission was denied.");
  });

  it("creates a Patrol report, uploads each photo once, identifies it, and persists the server mapping", async () => {
    const uploadKeys: string[] = [];
    let identificationRequests = 0;
    const savedSightings = new Set<string>();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/forms/patrol")) {
        const payload = JSON.parse(String(init?.body)) as {
          wildlife_sightings: Array<{ sighting_id: string; photos: Array<{ photo_id: string }> }>;
        };
        for (const sighting of payload.wildlife_sightings) {
          for (const photo of sighting.photos) {
            savedSightings.add(`${sighting.sighting_id}:${photo.photo_id}`);
          }
        }
        return jsonResponse({ report_id: "patrol-server-wildlife" });
      }
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        const body = init?.body as FormData;
        expect(body.get("report_type")).toBe("PATROL");
        expect(body.get("wildlife_sighting_id")).toBe(sightingId);
        expect(body.get("wildlife_photo_id")).toBe(photoId);
        expect(savedSightings.has(`${sightingId}:${photoId}`)).toBe(true);
        uploadKeys.push(String(body.get("client_operation_id")));
        return jsonResponse({ evidence: { id: "evidence-wildlife-1" } });
      }
      if (url.endsWith("/wildlife-identify")) {
        const body = init?.body as FormData;
        expect(body.get("evidence_id")).toBe("evidence-wildlife-1");
        const record = await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId);
        expect(record?.payload.wildlife_sightings).toMatchObject([{
          photos: [{ evidence_id: "evidence-wildlife-1", upload_status: "UPLOADED" }],
        }]);
        identificationRequests += 1;
        return jsonResponse({
          identification: {
            status: "UNCERTAIN",
            common_name: "Possible deer",
            scientific_name: "Cervidae",
            confidence: 0.42,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const image = new File(["wildlife"], "wildlife.jpg", { type: "image/jpeg" });
    await enqueueOfflineEvidenceUpload(
      ownerId,
      initialRecord,
      image,
      null,
      `wildlife:${sightingId}:${photoId}`,
      { sightingId, photoId },
    );
    await enqueueOfflineFieldOperation(ownerId, "PATROL_REPORT", initialRecord, "CREATE");
    await enqueueOfflineEvidenceUpload(
      ownerId,
      initialRecord,
      image,
      null,
      `wildlife:${sightingId}:${photoId}`,
      { sightingId, photoId },
    );

    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(2);
    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
    expect(uploadKeys).toEqual([`wildlife:${sightingId}:${photoId}`]);
    expect(identificationRequests).toBe(1);
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId)).toMatchObject({
      serverId: "patrol-server-wildlife",
      payload: {
        wildlife_sightings: [{
          photos: [{
            evidence_id: "evidence-wildlife-1",
            upload_status: "UPLOADED",
            identification: { status: "UNCERTAIN", confidence: 0.42 },
          }],
        }],
      },
    });
  });

  it("processes identification enqueued while the queue is waiting for upload success", async () => {
    let uploadStarted!: () => void;
    let finishUpload!: (response: Response) => void;
    const uploadInFlight = new Promise<void>((resolve) => {
      uploadStarted = resolve;
    });
    const uploadResponse = new Promise<Response>((resolve) => {
      finishUpload = resolve;
    });
    const requestOrder: string[] = [];
    let uploadCount = 0;
    let identificationCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) {
        return jsonResponse({ status: "healthy", database: "ok" });
      }
      if (url.endsWith("/api/v1/field/forms/patrol")) {
        return jsonResponse({ report_id: "patrol-server-inflight" });
      }
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        const body = init?.body as FormData;
        expect(body.get("wildlife_sighting_id")).toBe(sightingId);
        expect(body.get("wildlife_photo_id")).toBe(photoId);
        uploadCount += 1;
        requestOrder.push("upload-started");
        uploadStarted();
        return uploadResponse;
      }
      if (url.endsWith("/wildlife-identify")) {
        const body = init?.body as FormData;
        expect(body.get("evidence_id")).toBe("evidence-inflight");
        expect(body.get("wildlife_sighting_id")).toBe(sightingId);
        expect(body.get("wildlife_photo_id")).toBe(photoId);
        const saved = await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId);
        expect(saved?.payload.wildlife_sightings).toMatchObject([{
          photos: [{ evidence_id: "evidence-inflight", upload_status: "UPLOADED" }],
        }]);
        identificationCount += 1;
        requestOrder.push("identification-started");
        return jsonResponse({
          identification: {
            status: "UNCERTAIN",
            common_name: "Possible deer",
            confidence: 0.41,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    const image = new File(["wildlife"], "wildlife.jpg", { type: "image/jpeg" });
    await enqueueOfflineEvidenceUpload(
      ownerId,
      initialRecord,
      image,
      null,
      `wildlife:${sightingId}:${photoId}`,
      { sightingId, photoId },
    );
    await enqueueOfflineFieldOperation(ownerId, "PATROL_REPORT", initialRecord, "CREATE");

    const processing = syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT");
    await uploadInFlight;
    expect(requestOrder).toEqual(["upload-started"]);
    expect(identificationCount).toBe(0);
    await expect(syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).resolves.toBe("busy");

    finishUpload(jsonResponse({ evidence: { id: "evidence-inflight" } }));
    await expect(processing).resolves.toBe("synced");

    expect(requestOrder).toEqual(["upload-started", "identification-started"]);
    expect(uploadCount).toBe(1);
    expect(identificationCount).toBe(1);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId)).toMatchObject({
      payload: {
        wildlife_sightings: [{
          photos: [{
            evidence_id: "evidence-inflight",
            upload_status: "UPLOADED",
            identification: { status: "UNCERTAIN", confidence: 0.41 },
          }],
        }],
      },
    });
  });

  it("rechecks the queue when identification is enqueued at the active processor idle boundary", async () => {
    const savedSighting = initialRecord.payload.wildlife_sightings as Array<{
      sighting_id: string;
      photos: Array<Record<string, unknown>>;
    }>;
    const unrelatedPhotoId = "photo-not-being-identified";
    const savedRecord: OfflineFieldRecord = {
      ...initialRecord,
      serverId: "patrol-server-wakeup",
      payload: {
        ...initialRecord.payload,
        wildlife_sightings: [{
          ...savedSighting[0],
          photos: [
            {
              ...savedSighting[0].photos[0],
              evidence_id: "evidence-wakeup",
              upload_status: "UPLOADED",
            },
            {
              ...savedSighting[0].photos[0],
              photo_id: unrelatedPhotoId,
              evidence_id: "evidence-unrelated",
              upload_status: "UPLOADED",
            },
          ],
        }],
      },
    };
    let injected = false;
    let enqueueResult: Promise<unknown> | null = null;
    let activeLockReleases = 0;
    const originalGetAll = IDBObjectStore.prototype.getAll;
    const originalDelete = IDBObjectStore.prototype.delete;
    const getAllSpy = vi.spyOn(IDBObjectStore.prototype, "getAll").mockImplementation(
      function (this: IDBObjectStore, query?: IDBValidKey | IDBKeyRange | null, count?: number) {
        const request = originalGetAll.call(this, query, count);
        if (this.name === "operations" && !injected) {
          request.addEventListener("success", () => {
            if (injected || (request.result as unknown[]).length !== 0) return;
            injected = true;
            enqueueResult = enqueueOfflineWildlifeIdentification(
              ownerId,
              savedRecord,
              "evidence-wakeup",
              sightingId,
              photoId,
            );
          });
        }
        return request;
      },
    );
    const lockDeleteSpy = vi.spyOn(IDBObjectStore.prototype, "delete").mockImplementation(
      function (this: IDBObjectStore, query: IDBValidKey | IDBKeyRange) {
        if (this.name === "locks" && query === `field-sync:${ownerId}:PATROL_REPORT`) {
          activeLockReleases += 1;
        }
        return originalDelete.call(this, query);
      },
    );
    const requestOrder: string[] = [];
    const dispatchEvent = vi.mocked(globalThis.dispatchEvent);
    dispatchEvent.mockClear();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/wildlife-identify")) {
        const body = init?.body as FormData;
        expect(body.get("evidence_id")).toBe("evidence-wakeup");
        expect(body.get("wildlife_sighting_id")).toBe(sightingId);
        expect(body.get("wildlife_photo_id")).toBe(photoId);
        requestOrder.push("identify");
        return jsonResponse({ identification: { status: "UNCERTAIN", confidence: 0.44 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    try {
      await expect(syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).resolves.toBe("synced");
      await expect(enqueueResult).resolves.toBeDefined();
      expect(injected).toBe(true);
      expect(requestOrder).toEqual(["identify"]);
      expect(activeLockReleases).toBeGreaterThanOrEqual(2);
      expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
      expect(dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({ type: "up-forest-offline-queue-changed" }),
      );
      expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId)).toMatchObject({
        payload: {
          wildlife_sightings: [{
            photos: [
              {
                photo_id: photoId,
                evidence_id: "evidence-wakeup",
                identification: { status: "UNCERTAIN", confidence: 0.44 },
              },
              {
                photo_id: unrelatedPhotoId,
                evidence_id: "evidence-unrelated",
                identification: { status: "PENDING" },
              },
            ],
          }],
        },
      });
    } finally {
      getAllSpy.mockRestore();
      lockDeleteSpy.mockRestore();
    }
  });

  it("saves an existing Patrol update before uploading its wildlife photo", async () => {
    const requestOrder: string[] = [];
    let metadataSaved = false;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (/\/api\/v1\/field\/forms\/patrol\/patrol-server-existing$/.test(url)) {
        expect(init?.method).toBe("PUT");
        const payload = JSON.parse(String(init?.body)) as {
          wildlife_sightings: Array<{ sighting_id: string; photos: Array<{ photo_id: string }> }>;
        };
        metadataSaved = payload.wildlife_sightings.some((sighting) =>
          sighting.sighting_id === sightingId &&
          sighting.photos.some((photo) => photo.photo_id === photoId),
        );
        requestOrder.push("update");
        return jsonResponse({ report_id: "patrol-server-existing" });
      }
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        expect(metadataSaved).toBe(true);
        requestOrder.push("upload");
        return jsonResponse({ evidence: { id: "evidence-existing" } });
      }
      if (url.endsWith("/wildlife-identify")) {
        requestOrder.push("identify");
        return jsonResponse({ identification: { status: "UNCERTAIN", confidence: 0.4 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const record = { ...initialRecord, serverId: "patrol-server-existing" };
    const image = new File(["wildlife"], "wildlife.jpg", { type: "image/jpeg" });

    await enqueueOfflineEvidenceUpload(
      ownerId, record, image, null, `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    await enqueueOfflineFieldOperation(ownerId, "PATROL_REPORT", record, "UPDATE");

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    expect(requestOrder).toEqual(["update", "upload", "identify"]);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
  });

  it("persists latest report metadata before retrying identification", async () => {
    const requestOrder: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/forms/patrol/patrol-server-wildlife")) {
        expect(init?.method).toBe("PUT");
        const payload = JSON.parse(String(init?.body)) as {
          wildlife_sightings: Array<{ sighting_id: string; photos: Array<{ photo_id: string }> }>;
        };
        expect(payload.wildlife_sightings[0].sighting_id).toBe(sightingId);
        expect(payload.wildlife_sightings[0].photos[0].photo_id).toBe(photoId);
        requestOrder.push("update");
        return jsonResponse({ report_id: "patrol-server-wildlife" });
      }
      if (url.endsWith("/wildlife-identify")) {
        requestOrder.push("identify");
        return jsonResponse({ identification: { status: "IDENTIFIED", confidence: 0.9 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const record = { ...initialRecord, serverId: "patrol-server-wildlife" };

    await persistPatrolMetadataBeforeWildlifeEvidence(ownerId, record);
    await enqueueOfflineWildlifeIdentification(
      ownerId, record, "evidence-existing", sightingId, photoId,
    );

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    expect(requestOrder).toEqual(["update", "identify"]);
  });

  it("does not upload wildlife evidence when the report update fails", async () => {
    let uploadCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/forms/patrol/patrol-server-existing")) {
        expect(init?.method).toBe("PUT");
        return jsonResponse({ message: "Invalid patrol report metadata" }, 422);
      }
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        uploadCount += 1;
        return jsonResponse({ evidence: { id: "should-not-upload" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const record = { ...initialRecord, serverId: "patrol-server-existing" };
    const image = new File(["wildlife"], "wildlife.jpg", { type: "image/jpeg" });

    await enqueueOfflineEvidenceUpload(
      ownerId, record, image, null, `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    await enqueueOfflineFieldOperation(ownerId, "PATROL_REPORT", record, "UPDATE");

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("failed");
    expect(uploadCount).toBe(0);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(2);
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId)).toMatchObject({
      payload: { wildlife_sightings: [{ photos: [{ evidence_id: null }] }] },
    });
  });

  it("keeps a failed photo retryable and updates only its local photo after confirmation", async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        attempts += 1;
        return attempts === 1
          ? jsonResponse({ message: "Upload rejected" }, 422)
          : jsonResponse({ evidence: { id: "evidence-retry-upload" } });
      }
      if (url.endsWith("/wildlife-identify")) {
        return jsonResponse({ identification: { status: "UNCERTAIN", confidence: 0.4 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const record = {
      ...initialRecord,
      serverId: "patrol-server-wildlife",
      payload: {
        ...initialRecord.payload,
        wildlife_sightings: [
          (initialRecord.payload.wildlife_sightings as Array<Record<string, unknown>>)[0],
          {
            sighting_id: "another-sighting",
            photos: [{
              photo_id: "another-photo",
              file_name: "other.jpg",
              mime_type: "image/jpeg",
              file_size: 10,
              evidence_id: null,
              identification: { status: "PENDING", common_name: null, scientific_name: null, confidence: null },
            }],
          },
        ],
      },
    };
    const image = new File(["wildlife"], "wildlife.jpg", { type: "image/jpeg" });
    await enqueueOfflineEvidenceUpload(
      ownerId, record, image, null, `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    await expect(enqueueOfflineEvidenceUpload(
      ownerId, record, image, null, `wildlife:${sightingId}:${photoId}`, {
        sightingId: "another-sighting",
        photoId: "another-photo",
      },
    )).rejects.toThrow("already bound to another photo");

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("failed");
    let saved = await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId);
    expect(saved?.payload.wildlife_sightings).toMatchObject([
      { photos: [{ upload_status: "FAILED", upload_error: "Upload rejected", evidence_id: null }] },
      { photos: [{ photo_id: "another-photo", evidence_id: null }] },
    ]);

    await enqueueOfflineEvidenceUpload(
      ownerId, saved!, image, null, `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    saved = await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId);
    expect(attempts).toBe(2);
    expect(saved?.payload.wildlife_sightings).toMatchObject([
      { photos: [{ upload_status: "UPLOADED", evidence_id: "evidence-retry-upload" }] },
      { photos: [{ photo_id: "another-photo", evidence_id: null }] },
    ]);
  });

  it("retains failed identification for retry without uploading the image again", async () => {
    let identifyAttempts = 0;
    let uploadCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        uploadCount += 1;
        return jsonResponse({ evidence: { id: "evidence-retry" } });
      }
      if (url.endsWith("/wildlife-identify")) {
        identifyAttempts += 1;
        return identifyAttempts === 1
          ? jsonResponse({ message: "Identification request was rejected" }, 422)
          : jsonResponse({ identification: { status: "IDENTIFIED", common_name: "Sambar", confidence: 0.91 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const record = { ...initialRecord, serverId: "patrol-server-wildlife" };
    const image = new File(["wildlife"], "wildlife.jpg", { type: "image/jpeg" });

    await enqueueOfflineEvidenceUpload(
      ownerId,
      record,
      image,
      null,
      `wildlife:${sightingId}:${photoId}`,
      { sightingId, photoId },
    );
    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("failed");
    let saved = await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(1);
    expect(saved?.payload.wildlife_sightings).toMatchObject([{
      photos: [{
        evidence_id: "evidence-retry",
        identification: { status: "FAILED" },
      }],
    }]);

    await enqueueOfflineWildlifeIdentification(
      ownerId,
      saved!,
      "evidence-retry",
      sightingId,
      photoId,
    );
    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    saved = await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId);
    expect(uploadCount).toBe(1);
    expect(identifyAttempts).toBe(2);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
    expect(saved?.payload.wildlife_sightings).toMatchObject([{
      photos: [{
        evidence_id: "evidence-retry",
        identification: { status: "IDENTIFIED", common_name: "Sambar" },
      }],
    }]);
  });

  it("synchronizes a queued wildlife photo removal and clears it only after confirmation", async () => {
    let deleteRequests = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/evidence-to-remove")) {
        expect(init?.method).toBe("DELETE");
        deleteRequests += 1;
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const record = {
      ...initialRecord,
      serverId: "patrol-server-wildlife",
      payload: {
        ...initialRecord.payload,
        wildlife_sightings: [],
      },
    };
    await enqueueOfflineEvidenceDelete(ownerId, record, "evidence-to-remove");

    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(1);
    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    expect(deleteRequests).toBe(1);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
  });
});
