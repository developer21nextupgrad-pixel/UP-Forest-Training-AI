import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  captureWildlifeLocation,
  compressWildlifeImage,
  createWildlifePhoto,
  createWildlifeSighting,
  mergeWildlifeSightings,
  type WildlifeSighting,
} from "@/lib/patrol-wildlife";
import {
  enqueueOfflineEvidenceDelete,
  enqueueOfflineEvidenceUpload,
  enqueueOfflineFieldOperation,
  enqueueOfflineWildlifeIdentification,
  getOfflineFormRecord,
  getOfflineFieldQueueFailureMessage,
  getPendingFieldOperationCount,
  loadOfflineFormDraft,
  removeOfflineWildlifePhoto,
  persistPatrolMetadataBeforeWildlifeEvidence,
  persistOfflineFieldRecord,
  saveOfflineFormDraft,
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

function recordWithTwoPhotos(serverId: string | null = null): OfflineFieldRecord {
  const firstSighting = initialRecord.payload.wildlife_sightings as Array<Record<string, unknown>>;
  const sighting = firstSighting[0];
  const firstPhoto = (sighting.photos as Array<Record<string, unknown>>)[0];
  return {
    ...initialRecord,
    serverId,
    payload: {
      ...initialRecord.payload,
      wildlife_sightings: [{
        ...sighting,
        photos: [
          firstPhoto,
          {
            ...firstPhoto,
            photo_id: "photo-second-stable-id",
            file_name: "wildlife-second.jpg",
          },
        ],
      }],
    },
  };
}

async function getStoredOperation(id: string): Promise<{
  ownerId?: string;
  module?: string;
  id?: string;
  localId?: string;
  kind?: string;
  status?: string;
  retryable?: boolean;
  error?: string | null;
  revision?: number;
  attempts?: number;
  createdAt?: number;
  file?: {
    blob: Blob;
    fileName: string;
    mimeType?: string;
    description?: string | null;
    wildlifeSightingId?: string;
    wildlifePhotoId?: string;
    wildlifeSightingMetadata?: Record<string, unknown>;
    wildlifePhotoMetadata?: Record<string, unknown>;
  };
} | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("up-forest-offline-field-forms");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("operations", "readonly")
        .objectStore("operations")
        .get([ownerId, "PATROL_REPORT", id]);
      request.onsuccess = () => resolve(request.result as Awaited<ReturnType<typeof getStoredOperation>>);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function putStoredOperation(operation: NonNullable<Awaited<ReturnType<typeof getStoredOperation>>>): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("up-forest-offline-field-forms");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction("operations", "readwrite")
        .objectStore("operations")
        .put(operation);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

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
    await expect(captureWildlifeLocation()).resolves.toMatchObject({
      latitude: 27.5,
      longitude: 81.2,
      accuracy_m: 8,
      location_capture_status: "GPS",
    });
  });

  it("captures GPS offline and restores coordinates and photo Blobs from IndexedDB", async () => {
      Object.defineProperty(globalThis, "navigator", {
        configurable: true,
        value: {
          onLine: false,
          geolocation: {
            getCurrentPosition: (success: PositionCallback) => success({
              coords: { latitude: 28.25, longitude: 82.75, accuracy: 6.5 } as GeolocationCoordinates,
            } as GeolocationPosition),
          },
        },
      });
      const location = await captureWildlifeLocation();
      expect(location).toMatchObject({
        latitude: 28.25,
        longitude: 82.75,
        accuracy_m: 6.5,
        location_capture_status: "GPS",
      });
      expect(Number.isNaN(Date.parse(location.captured_at))).toBe(false);

      const sighting = createWildlifeSighting(location);
      const firstBlob = new File(["camera capture"], "camera.jpg", { type: "image/jpeg" });
      const secondBlob = new File(["gallery selection"], "gallery.jpg", { type: "image/jpeg" });
      const photos = [firstBlob, secondBlob].map((file) => createWildlifePhoto(file, sighting));
      const savedSighting = { ...sighting, photos };
      const savedRecord: OfflineFieldRecord = {
        ...initialRecord,
        payload: { ...initialRecord.payload, wildlife_sightings: [savedSighting] },
      };
      const snapshotFields = {
        wildlife_sightings: [savedSighting],
      } as unknown as Record<string, unknown>;

      await saveOfflineFormDraft(ownerId, "PATROL_REPORT", "active", {
        localId,
        fields: snapshotFields,
      });
      await saveOfflineFormDraft(ownerId, "PATROL_REPORT", `patrol:${localId}`, {
        localId,
        fields: snapshotFields,
      });
      await persistOfflineFieldRecord(ownerId, {
        ...savedRecord,
        payload: {
          ...savedRecord.payload,
          wildlife_sightings: [{
            ...savedSighting,
            photos: photos.map((photo) => {
              const { file, ...metadata } = photo;
              void file;
              return metadata;
            }),
          }],
        },
      });

      const restoredDraft = await loadOfflineFormDraft<{ fields: { wildlife_sightings: WildlifeSighting[] } }>(
        ownerId,
        "PATROL_REPORT",
        `patrol:${localId}`,
      );
      const restoredSighting = (await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId))
        ?.payload.wildlife_sightings as WildlifeSighting[];
      expect(restoredDraft?.snapshot.fields.wildlife_sightings[0]).toMatchObject({
        latitude: 28.25,
        longitude: 82.75,
        accuracy_m: 6.5,
        location_capture_status: "GPS",
      });
      expect(restoredDraft?.snapshot.fields.wildlife_sightings[0].photos.map((photo) => photo.photo_id))
        .toHaveLength(2);
      expect(new Set(photos.map((photo) => photo.photo_id)).size).toBe(2);
      expect(photos.map((photo) => photo.upload_status)).toEqual(["PENDING", "PENDING"]);
      expect(photos[0]).toMatchObject({
        file_name: "camera.jpg",
        mime_type: "image/jpeg",
        file_size: firstBlob.size,
        latitude: 28.25,
        longitude: 82.75,
        identification: { status: "PENDING" },
      });
      expect(await restoredDraft?.snapshot.fields.wildlife_sightings[0].photos[0].file?.text())
        .toBe("camera capture");
      expect(await restoredDraft?.snapshot.fields.wildlife_sightings[0].photos[1].file?.text())
        .toBe("gallery selection");
      expect(restoredSighting[0]).toMatchObject({
        latitude: 28.25,
        longitude: 82.75,
        accuracy_m: 6.5,
        captured_at: location.captured_at,
        location_capture_status: "GPS",
      });
      expect(restoredSighting[0].photos.map((photo) => photo.photo_id)).toEqual([
        photos[0].photo_id,
        photos[1].photo_id,
      ]);
  });

  it("preserves valid saved GPS coordinates when a stale refresh has null location fields", () => {
    const saved = createWildlifeSighting({
      latitude: 28.25,
      longitude: 82.75,
      accuracy_m: 6.5,
      captured_at: "2026-11-03T10:00:00.000Z",
      location_capture_status: "GPS",
    });
    const refreshed = mergeWildlifeSightings([saved], [{
      ...saved,
      latitude: null,
      longitude: null,
      accuracy_m: null,
      captured_at: null,
      location_capture_status: "UNAVAILABLE",
    }]);

    expect(refreshed[0]).toMatchObject({
      latitude: 28.25,
      longitude: 82.75,
      accuracy_m: 6.5,
      captured_at: "2026-11-03T10:00:00.000Z",
      location_capture_status: "GPS",
    });
  });

  it("reports location permission denial without fabricating coordinates", async () => {
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

  it("preserves two photos from the same stale snapshot through upload and identification", async () => {
    const record = recordWithTwoPhotos();
    const secondPhotoId = "photo-second-stable-id";
    const expectedPhotoIds = [photoId, secondPhotoId];
    const savedPhotoIds = new Set<string>();
    const uploadedEvidence = new Map<string, string>();
    const uploadRequests: string[] = [];
    const identifyRequests: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/forms/patrol")) {
        const payload = JSON.parse(String(init?.body)) as {
          wildlife_sightings: Array<{ sighting_id: string; photos: Array<{ photo_id: string }> }>;
        };
        for (const sighting of payload.wildlife_sightings) {
          for (const photo of sighting.photos) savedPhotoIds.add(photo.photo_id);
        }
        return jsonResponse({ report_id: "patrol-server-two-photos" });
      }
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        const body = init?.body as FormData;
        const wildlifePhotoId = String(body.get("wildlife_photo_id"));
        expect(body.get("wildlife_sighting_id")).toBe(sightingId);
        expect(savedPhotoIds.has(wildlifePhotoId)).toBe(true);
        uploadRequests.push(wildlifePhotoId);
        const evidenceId = `evidence-${wildlifePhotoId}`;
        uploadedEvidence.set(wildlifePhotoId, evidenceId);
        return jsonResponse({ evidence: { id: evidenceId } });
      }
      if (url.endsWith("/wildlife-identify")) {
        const body = init?.body as FormData;
        const wildlifePhotoId = String(body.get("wildlife_photo_id"));
        expect(body.get("evidence_id")).toBe(uploadedEvidence.get(wildlifePhotoId));
        identifyRequests.push(wildlifePhotoId);
        return jsonResponse({
          identification: {
            status: "IDENTIFIED",
            common_name: `Species ${wildlifePhotoId}`,
            scientific_name: "Test species",
            confidence: 0.9,
          },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: false },
    });
    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["first"], "first.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["second"], "second.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${secondPhotoId}`, { sightingId, photoId: secondPhotoId },
    );
    await persistOfflineFieldRecord(ownerId, initialRecord);
    await enqueueOfflineFieldOperation(ownerId, "PATROL_REPORT", record, "CREATE");

    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId))
      .toMatchObject({ payload: { wildlife_sightings: [{ photos: [{ photo_id: photoId }, { photo_id: secondPhotoId }] }] } });
    expect((await getStoredOperation(`evidence:${localId}:wildlife:${sightingId}:${photoId}`))?.file)
      .toMatchObject({
        wildlifeSightingId: sightingId,
        wildlifePhotoId: photoId,
        wildlifePhotoMetadata: { photo_id: photoId },
      });
    expect((await getStoredOperation(`evidence:${localId}:wildlife:${sightingId}:${secondPhotoId}`))?.file)
      .toMatchObject({
        wildlifeSightingId: sightingId,
        wildlifePhotoId: secondPhotoId,
        wildlifePhotoMetadata: { photo_id: secondPhotoId },
      });
    await expect(syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).resolves.toBe("offline");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: true },
    });
    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    const saved = await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId);
    expect(uploadRequests.sort()).toEqual([...expectedPhotoIds].sort());
    expect(identifyRequests.sort()).toEqual([...expectedPhotoIds].sort());
    expect(saved?.payload.wildlife_sightings).toMatchObject([{
      photos: [
        {
          photo_id: photoId,
          evidence_id: `evidence-${photoId}`,
          upload_status: "UPLOADED",
          identification: { status: "IDENTIFIED", common_name: `Species ${photoId}` },
        },
        {
          photo_id: secondPhotoId,
          evidence_id: `evidence-${secondPhotoId}`,
          upload_status: "UPLOADED",
          identification: { status: "IDENTIFIED", common_name: `Species ${secondPhotoId}` },
        },
      ],
    }]);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
  });

  it("extracts queued photo metadata from the latest record when the caller snapshot is stale", async () => {
    const secondPhotoId = "photo-second-stable-id";
    await persistOfflineFieldRecord(ownerId, recordWithTwoPhotos("patrol-server-latest-photo"));

    await enqueueOfflineEvidenceUpload(
      ownerId,
      initialRecord,
      new File(["latest-photo"], "latest.jpg", { type: "image/jpeg" }),
      null,
      `wildlife:${sightingId}:${secondPhotoId}`,
      { sightingId, photoId: secondPhotoId },
    );

    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId))
      .toMatchObject({
        serverId: "patrol-server-latest-photo",
        payload: { wildlife_sightings: [{ photos: [{ photo_id: photoId }, { photo_id: secondPhotoId }] }] },
      });
    expect((await getStoredOperation(`evidence:${localId}:wildlife:${sightingId}:${secondPhotoId}`))?.file)
      .toMatchObject({
        wildlifeSightingId: sightingId,
        wildlifePhotoId: secondPhotoId,
        wildlifePhotoMetadata: { photo_id: secondPhotoId, file_name: "wildlife-second.jpg" },
      });
  });

  it("preserves queued photos and completed identification during stale UI refreshes", () => {
    const stored = recordWithTwoPhotos().payload.wildlife_sightings as WildlifeSighting[];
    const originalFile = new File(["photo"], "saved.jpg", { type: "image/jpeg" });
    const current: WildlifeSighting[] = [{
      ...stored[0],
      photos: [
        {
          ...stored[0].photos[0],
          file: originalFile,
          evidence_id: "evidence-identified",
          upload_status: "UPLOADED",
          identification: {
            status: "IDENTIFIED",
            common_name: "Sambar",
            scientific_name: "Rusa unicolor",
            confidence: 0.94,
          },
        },
        stored[0].photos[1],
      ],
    }];
    const stale: WildlifeSighting[] = [{
      ...stored[0],
      photos: [{
        ...stored[0].photos[0],
        evidence_id: null,
        upload_status: "PENDING",
        identification: {
          status: "PENDING",
          common_name: null,
          scientific_name: null,
          confidence: null,
        },
      }],
    }];

    const refreshed = mergeWildlifeSightings(current, stale);
    expect(refreshed[0].photos).toHaveLength(2);
    expect(refreshed[0].photos[0]).toMatchObject({
      evidence_id: "evidence-identified",
      upload_status: "UPLOADED",
      identification: {
        status: "IDENTIFIED",
        common_name: "Sambar",
      },
    });
    expect(refreshed[0].photos[0].file).toBe(originalFile);
  });

  it("does not restore an explicitly removed photo from a stale record or queued upload", async () => {
    const record = {
      ...recordWithTwoPhotos("patrol-server-deletion"),
      status: "SUBMITTED" as const,
    };
    const secondPhotoId = "photo-second-stable-id";
    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["second"], "second.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${secondPhotoId}`, { sightingId, photoId: secondPhotoId },
    );
    const queuedId = `evidence:${localId}:wildlife:${sightingId}:${secondPhotoId}`;
    await putStoredOperation({
      ...(await getStoredOperation(queuedId))!,
      ownerId,
      module: "PATROL_REPORT",
      id: queuedId,
      localId,
      kind: "EVIDENCE_UPLOAD",
      status: "FAILED",
      retryable: false,
      error: "This wildlife photo was explicitly deleted. The retained upload was not sent; restore it intentionally before retrying.",
      revision: 2,
      attempts: 0,
      createdAt: Date.now(),
    });
    await removeOfflineWildlifePhoto(ownerId, localId, sightingId, secondPhotoId);
    await persistOfflineFieldRecord(ownerId, record);
    const saved = await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId);
    expect(saved?.payload.wildlife_sightings).toMatchObject([
      { photos: [{ photo_id: photoId }] },
    ]);
    expect(saved?.deletedWildlifePhotoIds).toContain(JSON.stringify([sightingId, secondPhotoId]));
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      throw new Error(`Unexpected request after photo deletion: ${url}`);
    });
    await expect(syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).resolves.toBe("synced");
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([input]) =>
      String(input).endsWith("/api/v1/field/evidence/upload"),
    )).toBe(false);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
    expect(await getOfflineFieldQueueFailureMessage(ownerId, "PATROL_REPORT")).toBeNull();
    expect((await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId))
      ?.payload.wildlife_sightings).toMatchObject([{ photos: [{ photo_id: photoId }] }]);
    expect((await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId))?.status).toBe("SUBMITTED");
  });

  it("cancels a wildlife upload while in flight and queues deletion if the server accepts it", async () => {
    let uploadStarted!: () => void;
    let finishUpload!: (response: Response) => void;
    const uploadInFlight = new Promise<void>((resolve) => { uploadStarted = resolve; });
    const uploadResponse = new Promise<Response>((resolve) => { finishUpload = resolve; });
    const requests: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        requests.push("upload");
        uploadStarted();
        return uploadResponse;
      }
      if (url.endsWith("/api/v1/field/evidence/evidence-uploaded-after-delete")) {
        expect(init?.method).toBe("DELETE");
        requests.push("delete");
        return jsonResponse({ success: true });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    const record = { ...initialRecord, serverId: "patrol-server-inflight-delete", status: "SUBMITTED" as const };
    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["photo"], "photo.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    const syncing = syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT");
    await uploadInFlight;
    await removeOfflineWildlifePhoto(ownerId, localId, sightingId, photoId);
    finishUpload(jsonResponse({ evidence: { id: "evidence-uploaded-after-delete" } }));

    await expect(syncing).resolves.toBe("synced");
    expect(requests).toEqual(["upload", "delete"]);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
    expect((await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId))?.status).toBe("SUBMITTED");
    expect((await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId))?.payload.wildlife_sightings)
      .toMatchObject([{ photos: [] }]);
  });

  it("keeps a genuine failed Patrol UPDATE visible after cancelling a deleted photo upload", async () => {
    const updateRecord = { ...initialRecord, serverId: "patrol-server-update-failure" };
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/forms/patrol/patrol-server-update-failure")) {
        return jsonResponse({ detail: "Patrol metadata rejected" }, 422);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    await enqueueOfflineEvidenceUpload(
      ownerId, { ...updateRecord, serverId: "patrol-server-update-failure" },
      new File(["deleted"], "deleted.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    await removeOfflineWildlifePhoto(ownerId, localId, sightingId, photoId);
    await enqueueOfflineFieldOperation(ownerId, "PATROL_REPORT", updateRecord, "UPDATE");

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("failed");
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(1);
    expect(await getOfflineFieldQueueFailureMessage(ownerId, "PATROL_REPORT"))
      .toContain("Patrol metadata rejected");
  });

  it("merges concurrent stale-snapshot photo enqueues without losing either photo", async () => {
    const record = recordWithTwoPhotos("patrol-server-concurrent");
    const secondPhotoId = "photo-second-stable-id";
    await Promise.all([
      enqueueOfflineEvidenceUpload(
        ownerId, record, new File(["first"], "first.jpg", { type: "image/jpeg" }), null,
        `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
      ),
      enqueueOfflineEvidenceUpload(
        ownerId, record, new File(["second"], "second.jpg", { type: "image/jpeg" }), null,
        `wildlife:${sightingId}:${secondPhotoId}`, { sightingId, photoId: secondPhotoId },
      ),
    ]);

    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(2);
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId))
      .toMatchObject({ payload: { wildlife_sightings: [{ photos: [{ photo_id: photoId }, { photo_id: secondPhotoId }] }] } });
  });

  it("processes a second photo enqueued while the first upload holds the queue lock", async () => {
    const record = recordWithTwoPhotos("patrol-server-overlap");
    const secondPhotoId = "photo-second-stable-id";
    let firstUploadStarted!: () => void;
    let finishFirstUpload!: (response: Response) => void;
    const uploadInFlight = new Promise<void>((resolve) => { firstUploadStarted = resolve; });
    const firstUploadResponse = new Promise<Response>((resolve) => { finishFirstUpload = resolve; });
    const uploadedPhotos: string[] = [];
    const identifiedPhotos: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        const wildlifePhotoId = String((init?.body as FormData).get("wildlife_photo_id"));
        uploadedPhotos.push(wildlifePhotoId);
        if (wildlifePhotoId === photoId) {
          firstUploadStarted();
          return firstUploadResponse;
        }
        return jsonResponse({ evidence: { id: `evidence-${wildlifePhotoId}` } });
      }
      if (url.endsWith("/wildlife-identify")) {
        const wildlifePhotoId = String((init?.body as FormData).get("wildlife_photo_id"));
        identifiedPhotos.push(wildlifePhotoId);
        return jsonResponse({ identification: { status: "IDENTIFIED", confidence: 0.8 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["first"], "first.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    const processing = syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT");
    await uploadInFlight;
    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["second"], "second.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${secondPhotoId}`, { sightingId, photoId: secondPhotoId },
    );
    finishFirstUpload(jsonResponse({ evidence: { id: `evidence-${photoId}` } }));

    await expect(processing).resolves.toBe("synced");
    expect(uploadedPhotos.sort()).toEqual([photoId, secondPhotoId].sort());
    expect(identifiedPhotos.sort()).toEqual([photoId, secondPhotoId].sort());
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId)).toMatchObject({
      payload: {
        wildlife_sightings: [{
          photos: [
            { photo_id: photoId, evidence_id: `evidence-${photoId}`, identification: { status: "IDENTIFIED" } },
            { photo_id: secondPhotoId, evidence_id: `evidence-${secondPhotoId}`, identification: { status: "IDENTIFIED" } },
          ],
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

  it("continues processing independent photos after one upload fails and retains its Blob", async () => {
    const record = recordWithTwoPhotos("patrol-server-isolated-failure");
    const secondPhotoId = "photo-second-stable-id";
    const uploadedPhotos: string[] = [];
    const identifiedPhotos: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        const wildlifePhotoId = String((init?.body as FormData).get("wildlife_photo_id"));
        uploadedPhotos.push(wildlifePhotoId);
        if (wildlifePhotoId === photoId) return jsonResponse({ message: "Invalid first image" }, 422);
        return jsonResponse({ evidence: { id: `evidence-${wildlifePhotoId}` } });
      }
      if (url.endsWith("/wildlife-identify")) {
        const wildlifePhotoId = String((init?.body as FormData).get("wildlife_photo_id"));
        identifiedPhotos.push(wildlifePhotoId);
        return jsonResponse({ identification: { status: "IDENTIFIED", confidence: 0.8 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["failed-file"], "first.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${photoId}`, { sightingId, photoId },
    );
    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["valid-file"], "second.jpg", { type: "image/jpeg" }), null,
      `wildlife:${sightingId}:${secondPhotoId}`, { sightingId, photoId: secondPhotoId },
    );

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("failed");
    expect(uploadedPhotos.sort()).toEqual([photoId, secondPhotoId].sort());
    expect(identifiedPhotos).toEqual([secondPhotoId]);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(1);
    const failed = await getStoredOperation(`evidence:${localId}:wildlife:${sightingId}:${photoId}`);
    expect(failed?.file?.fileName).toBe("first.jpg");
    expect(failed?.file?.blob.size).toBe("failed-file".length);
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId)).toMatchObject({
      payload: {
        wildlife_sightings: [{
          photos: [
            { photo_id: photoId, upload_status: "FAILED", upload_error: "Invalid first image" },
            { photo_id: secondPhotoId, upload_status: "UPLOADED", identification: { status: "IDENTIFIED" } },
          ],
        }],
      },
    });
  });

  it("keeps queued uploads owner-isolated and idempotent across offline recovery", async () => {
    const record = recordWithTwoPhotos("patrol-server-recovery");
    const image = new File(["original-blob"], "original.jpg", { type: "image/jpeg" });
    const operationId = `wildlife:${sightingId}:${photoId}`;
    await enqueueOfflineEvidenceUpload(
      ownerId, record, image, null, operationId, { sightingId, photoId },
    );
    await enqueueOfflineEvidenceUpload(
      ownerId, record, new File(["duplicate-blob"], "duplicate.jpg", { type: "image/jpeg" }), null,
      operationId, { sightingId, photoId },
    );
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(1);
    expect(await getPendingFieldOperationCount("another-officer", "PATROL_REPORT")).toBe(0);
    const queued = await getStoredOperation(`evidence:${localId}:${operationId}`);
    expect(queued?.file?.fileName).toBe("original.jpg");
    expect(await queued?.file?.blob.text()).toBe("original-blob");

    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: false },
    });
    await expect(syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).resolves.toBe("offline");
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId)).toBeDefined();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: true },
    });
    let uploadCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        uploadCount += 1;
        return jsonResponse({ evidence: { id: "evidence-recovered" } });
      }
      if (url.endsWith("/wildlife-identify")) {
        return jsonResponse({ identification: { status: "IDENTIFIED", confidence: 0.85 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    expect(uploadCount).toBe(1);
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", localId)).toMatchObject({
      payload: {
        wildlife_sightings: [{
          photos: [
            { photo_id: photoId, evidence_id: "evidence-recovered", identification: { status: "IDENTIFIED" } },
            { photo_id: "photo-second-stable-id", evidence_id: null, identification: { status: "PENDING" } },
          ],
        }],
      },
    });
  });

  it("recovers a failed upload's photo metadata from its retained Blob and saved sighting", async () => {
    const recoveryLocalId = "patrol-recovery-local";
    const recoveryRecord: OfflineFieldRecord = {
      ...initialRecord,
      localId: recoveryLocalId,
      serverId: "patrol-server-metadata-recovery",
      payload: {
        ...initialRecord.payload,
        wildlife_sightings: [{
          sighting_id: sightingId,
          latitude: 27.123,
          longitude: 81.456,
          accuracy_m: 12,
          photos: [],
        }],
      },
    };
    const recoveryOperationId = `evidence:${recoveryLocalId}:wildlife:${sightingId}:${photoId}`;
    const imageBlob = new Blob(["recoverable-image"], { type: "image/jpeg" });
    await persistOfflineFieldRecord(ownerId, recoveryRecord);
    await putStoredOperation({
      ownerId,
      module: "PATROL_REPORT",
      id: recoveryOperationId,
      localId: recoveryLocalId,
      kind: "EVIDENCE_UPLOAD",
      status: "FAILED",
      retryable: false,
      error: "The saved Patrol Report is missing the queued wildlife sighting or photo.",
      revision: 1,
      attempts: 0,
      createdAt: Date.now(),
      file: {
        blob: imageBlob,
        fileName: "recovered.jpg",
        mimeType: "image/jpeg",
        description: null,
        wildlifeSightingId: sightingId,
        wildlifePhotoId: photoId,
      },
    });

    let uploadCount = 0;
    let identifyCount = 0;
    let uploadedContents = "";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        uploadCount += 1;
        const uploadedFile = (init?.body as FormData).get("file");
        if (uploadedFile instanceof Blob) uploadedContents = await uploadedFile.text();
        return jsonResponse({ evidence: { id: "evidence-recovered-from-blob" } });
      }
      if (url.endsWith("/wildlife-identify")) {
        identifyCount += 1;
        return jsonResponse({ identification: { status: "IDENTIFIED", confidence: 0.91 } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("synced");
    expect(uploadCount).toBe(1);
    expect(identifyCount).toBe(1);
    expect(uploadedContents).toBe("recoverable-image");
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", recoveryLocalId)).toMatchObject({
      payload: {
        wildlife_sightings: [{
          sighting_id: sightingId,
          photos: [{
            photo_id: photoId,
            file_name: "recovered.jpg",
            mime_type: "image/jpeg",
            file_size: imageBlob.size,
            evidence_id: "evidence-recovered-from-blob",
            upload_status: "UPLOADED",
            identification: { status: "IDENTIFIED" },
          }],
        }],
      },
    });
    expect(await getPendingFieldOperationCount(ownerId, "PATROL_REPORT")).toBe(0);
  });

  it("retains a failed Blob and does not invent a missing sighting during recovery", async () => {
    const recoveryLocalId = "patrol-unsafe-recovery-local";
    const recoveryRecord: OfflineFieldRecord = {
      ...initialRecord,
      localId: recoveryLocalId,
      serverId: "patrol-server-unsafe-recovery",
      payload: { ...initialRecord.payload, wildlife_sightings: [] },
    };
    const recoveryOperationId = `evidence:${recoveryLocalId}:wildlife:${sightingId}:${photoId}`;
    const imageBlob = new Blob(["must-be-retained"], { type: "image/jpeg" });
    await persistOfflineFieldRecord(ownerId, recoveryRecord);
    await putStoredOperation({
      ownerId,
      module: "PATROL_REPORT",
      id: recoveryOperationId,
      localId: recoveryLocalId,
      kind: "EVIDENCE_UPLOAD",
      status: "FAILED",
      retryable: false,
      error: "The saved Patrol Report is missing the queued wildlife sighting or photo.",
      revision: 1,
      attempts: 0,
      createdAt: Date.now(),
      file: {
        blob: imageBlob,
        fileName: "unrecoverable.jpg",
        mimeType: "image/jpeg",
        description: null,
        wildlifeSightingId: sightingId,
        wildlifePhotoId: photoId,
      },
    });
    let uploadCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/evidence/upload")) {
        uploadCount += 1;
        return jsonResponse({ evidence: { id: "must-not-upload" } });
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    expect(await syncOfflineFieldFormQueue(ownerId, "PATROL_REPORT")).toBe("failed");
    expect(uploadCount).toBe(0);
    expect(await getOfflineFormRecord(ownerId, "PATROL_REPORT", recoveryLocalId))
      .toMatchObject({ payload: { wildlife_sightings: [] } });
    const retained = await getStoredOperation(recoveryOperationId);
    expect(retained?.status).toBe("FAILED");
    expect(retained?.error).toContain("no verified sighting metadata");
    expect(await retained?.file?.blob.text()).toBe("must-be-retained");
  });

  it("does not upload wildlife evidence when the report update fails", async () => {
    let uploadCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/health")) return jsonResponse({ status: "healthy", database: "ok" });
      if (url.endsWith("/api/v1/field/forms/patrol/patrol-server-existing")) {
        expect(init?.method).toBe("PUT");
        return jsonResponse({ detail: "The Patrol Report is missing the selected wildlife photo." }, 422);
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
    const failure = await getOfflineFieldQueueFailureMessage(ownerId, "PATROL_REPORT");
    expect(failure).toContain("Patrol Report metadata UPDATE failed (HTTP 422; not retryable");
    expect(failure).toContain("The Patrol Report is missing the selected wildlife photo.");
    expect(failure).toContain(`operation update:patrol_report:${localId}`);
    expect(failure).toContain(`local report ${localId}`);
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
      true,
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
