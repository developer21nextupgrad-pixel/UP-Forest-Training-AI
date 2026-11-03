"use client";

import { apiRequest } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";
import { checkDiaryBackendReachable, notifyOfflineQueueChanged } from "@/lib/offline-diary";
import { useCallback, useEffect, useRef, useState } from "react";

const DB_NAME = "up-forest-offline-field-forms";
const DB_VERSION = 1;
const RECORDS = "records";
const OPERATIONS = "operations";
const DRAFTS = "drafts";
const LOCKS = "locks";
const LOCK_TTL = 240_000;
const MAX_RETRIES = 5;

export type OfflineFieldModule = "PATROL_REPORT" | "INCIDENT_REPORT" | "OFFENCE_SEIZURE";
export type FieldSyncState = "Online" | "Offline" | "Pending Sync" | "Syncing" | "Synced" | "Sync Failed";
export type FieldOperationKind = "CREATE" | "UPDATE" | "SUBMIT" | "EVIDENCE_UPLOAD" | "EVIDENCE_IDENTIFY" | "EVIDENCE_DELETE";

export type OfflineFieldRecord = {
  ownerId: string;
  module: OfflineFieldModule;
  localId: string;
  serverId: string | null;
  payload: Record<string, unknown>;
  status: "DRAFT" | "PENDING_SUBMISSION" | "SUBMITTED";
  syncError: string | null;
  updatedAt: string;
  deletedWildlifePhotoIds?: string[];
  deletedWildlifeSightingIds?: string[];
};

type Operation = {
  ownerId: string;
  module: OfflineFieldModule;
  id: string;
  localId: string;
  kind: FieldOperationKind;
  payload?: Record<string, unknown>;
  file?: {
    blob: Blob;
    fileName: string;
    mimeType: string;
    description: string | null;
    wildlifeSightingId?: string;
    wildlifePhotoId?: string;
    clientOperationId?: string;
    wildlifeSightingMetadata?: Record<string, unknown>;
    wildlifePhotoMetadata?: Record<string, unknown>;
  };
  evidenceId?: string;
  retryable?: boolean;
  responseStatus?: number;
  responseCode?: string;
  createdAt: number;
  revision: number;
  attempts: number;
  status: "PENDING" | "SYNCING" | "FAILED" | "AUTH_REQUIRED" | "CANCELLED";
  error: string | null;
};

export type OfflineFormDraft<T extends Record<string, unknown>> = {
  ownerId: string;
  module: OfflineFieldModule;
  key: string;
  snapshot: T;
  updatedAt: string;
};

type FormConfig = {
  path: string;
  idField: "report_id" | "incident_id";
};

const CONFIG: Record<OfflineFieldModule, FormConfig> = {
  PATROL_REPORT: { path: "/api/v1/field/forms/patrol", idField: "report_id" },
  INCIDENT_REPORT: { path: "/api/v1/field/forms/incident", idField: "incident_id" },
  OFFENCE_SEIZURE: { path: "/api/v1/field/forms/offence-seizure", idField: "report_id" },
};

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline storage is not available in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: ["ownerId", "module", "localId"] });
      if (!db.objectStoreNames.contains(OPERATIONS)) db.createObjectStore(OPERATIONS, { keyPath: ["ownerId", "module", "id"] });
      if (!db.objectStoreNames.contains(DRAFTS)) db.createObjectStore(DRAFTS, { keyPath: ["ownerId", "module", "key"] });
      if (!db.objectStoreNames.contains(LOCKS)) db.createObjectStore(LOCKS, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline form storage."));
    request.onblocked = () => reject(new Error("Offline form storage upgrade is blocked by another tab."));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline form storage request failed."));
  });
}

async function withStores<T>(
  names: string[],
  mode: IDBTransactionMode,
  action: (stores: Record<string, IDBObjectStore>) => Promise<T>,
): Promise<T> {
  const db = await openDb();
  try {
    const transaction = db.transaction(names, mode);
    const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
    const completed = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Offline form transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline form transaction was interrupted."));
    });
    try {
      const result = await action(stores);
      await completed;
      return result;
    } catch (error) {
      try { transaction.abort(); } catch { /* IndexedDB may have already aborted it. */ }
      await completed.catch(() => undefined);
      throw error;
    }
  } finally {
    db.close();
  }
}

export function createFieldLocalId(): string {
  return crypto.randomUUID();
}

export function fieldCreateOperationId(module: OfflineFieldModule, localId: string): string {
  return `create:${module.toLowerCase()}:${localId}`;
}

export function fieldSyncableFailure(response: { code?: string; status?: number }): boolean {
  return response.code === "NETWORK" ||
    response.code === "TIMEOUT" ||
    response.code === "SERVER_ERROR" ||
    (response.status !== undefined && response.status >= 500);
}

export async function saveOfflineFormDraft<T extends Record<string, unknown>>(
  ownerId: string,
  module: OfflineFieldModule,
  key: string,
  snapshot: T,
): Promise<void> {
  const value: OfflineFormDraft<T> = { ownerId, module, key, snapshot, updatedAt: new Date().toISOString() };
  await withStores([DRAFTS], "readwrite", async ({ [DRAFTS]: store }) => {
    await requestValue(store.put(value));
  });
}

export async function loadOfflineFormDraft<T extends Record<string, unknown>>(
  ownerId: string,
  module: OfflineFieldModule,
  key: string,
): Promise<OfflineFormDraft<T> | undefined> {
  const draft = await withStores([DRAFTS], "readonly", async ({ [DRAFTS]: store }) =>
    requestValue(store.get([ownerId, module, key])),
  ) as OfflineFormDraft<T> | undefined;
  if (draft && (
    draft.ownerId !== ownerId ||
    draft.module !== module ||
    !draft.snapshot ||
    typeof draft.snapshot !== "object"
  )) {
    throw new Error("The saved local field form draft is malformed and has been retained.");
  }
  return draft;
}

export async function getOfflineFormRecord(
  ownerId: string,
  module: OfflineFieldModule,
  localId: string,
): Promise<OfflineFieldRecord | undefined> {
  return withStores([RECORDS], "readonly", async ({ [RECORDS]: store }) =>
    requestValue(store.get([ownerId, module, localId])),
  );
}

export async function markOfflineFieldFormSubmitted(
  ownerId: string,
  module: OfflineFieldModule,
  localId: string,
): Promise<void> {
  await updateStoredRecord(ownerId, module, localId, (latest) => {
    if (!latest) throw new Error("The submitted offline field form could not be found.");
    return {
      ...latest,
      status: "SUBMITTED",
      syncError: null,
      updatedAt: new Date().toISOString(),
    };
  });
  notifyOfflineQueueChanged();
}

export async function getOfflineFieldFormRecords(
  ownerId: string,
  module: OfflineFieldModule,
): Promise<OfflineFieldRecord[]> {
  return withStores([RECORDS], "readonly", async ({ [RECORDS]: store }) => {
    const all = await requestValue(store.getAll()) as OfflineFieldRecord[];
    const owned = all.filter((record) => record?.ownerId === ownerId && record.module === module);
    if (owned.some((record) =>
      typeof record.localId !== "string" ||
      !record.payload ||
      typeof record.payload !== "object" ||
      !["DRAFT", "PENDING_SUBMISSION", "SUBMITTED"].includes(record.status)
    )) {
      throw new Error("A saved offline field form is malformed and has been retained.");
    }
    return owned;
  });
}

export async function enqueueOfflineFieldOperation(
  ownerId: string,
  module: OfflineFieldModule,
  record: OfflineFieldRecord,
  kind: FieldOperationKind,
): Promise<void> {
  if (record.ownerId !== ownerId || record.module !== module) {
    throw new Error("Offline field operations must match the record owner and module.");
  }
  const operationId = kind === "CREATE"
    ? fieldCreateOperationId(module, record.localId)
    : `${kind.toLowerCase()}:${module.toLowerCase()}:${record.localId}`;
  await withStores([RECORDS, OPERATIONS, LOCKS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
    const recordStore = stores[RECORDS];
    const recordKey: IDBValidKey = [ownerId, module, record.localId];
    const currentRecord = await requestValue(recordStore.get(recordKey)) as OfflineFieldRecord | undefined;
    const mergedRecord = mergeOfflineFieldRecord(currentRecord, { ...record, ownerId, module });
    const key: IDBValidKey = [ownerId, module, operationId];
    const previous = await requestValue(operationStore.get(key)) as Operation | undefined;
    const all = await requestValue(operationStore.getAll()) as Operation[];
    if (all.some((item) =>
      item?.ownerId === ownerId &&
      item.module === module &&
      (!Number.isFinite(item.createdAt) || !Number.isFinite(item.revision) || !Number.isFinite(item.attempts))
    )) {
      throw new Error("A queued field operation is malformed and has been retained.");
    }
    const createdAt = previous?.createdAt ?? Math.max(
      Date.now(),
      ...all.filter((item) => item?.ownerId === ownerId && item.module === module).map((item) => item.createdAt + 1),
    );
    const payload = kind === "SUBMIT" || kind === "EVIDENCE_UPLOAD" || kind === "EVIDENCE_IDENTIFY" || kind === "EVIDENCE_DELETE"
      ? undefined
      : {
          ...mergedRecord.payload,
          ...(kind === "CREATE" || (module === "INCIDENT_REPORT" && kind === "UPDATE")
            ? { client_operation_id: fieldCreateOperationId(module, record.localId) }
            : {}),
        };
    await requestValue(operationStore.put({
      ownerId, module, id: operationId, localId: record.localId, kind, payload,
      createdAt, revision: (previous?.revision ?? 0) + 1, attempts: 0, status: "PENDING", error: null,
    } satisfies Operation));
    if (kind === "UPDATE") {
      for (const operation of all) {
        if (operation?.ownerId === ownerId && operation.module === module &&
          operation.localId === record.localId && operation.kind === "SUBMIT") {
          await requestValue(operationStore.put({
            ...operation, createdAt: Math.max(operation.createdAt, createdAt + 1),
            status: "PENDING", error: null,
          }));
        }
      }
    }
    await requestValue(recordStore.put({ ...mergedRecord, syncError: null }));
    await requestQueueWake(stores, ownerId, module);
  });
  notifyOfflineQueueChanged();
}

export async function persistPatrolMetadataBeforeWildlifeEvidence(
  ownerId: string,
  record: OfflineFieldRecord,
): Promise<"saved" | "queued"> {
  if (record.module !== "PATROL_REPORT" || record.ownerId !== ownerId) {
    throw new Error("Wildlife evidence requires the owning officer's Patrol Report.");
  }
  if (!navigator.onLine || !record.serverId) {
    await enqueueOfflineFieldOperation(
      ownerId,
      "PATROL_REPORT",
      record,
      record.serverId ? "UPDATE" : "CREATE",
    );
    return "queued";
  }

  const result = await apiRequest<Record<string, unknown>>(
    `${CONFIG.PATROL_REPORT.path}/${record.serverId}`,
    { method: "PUT", body: JSON.stringify(record.payload) },
  );
  if (result.success) return "saved";
  if (!navigator.onLine || fieldSyncableFailure(result)) {
    await enqueueOfflineFieldOperation(ownerId, "PATROL_REPORT", record, "UPDATE");
    return "queued";
  }
  throw new Error(result.message || "Unable to save Patrol Report wildlife metadata.");
}

export async function enqueueOfflineEvidenceUpload(
  ownerId: string,
  record: OfflineFieldRecord,
  file: File,
  description: string | null,
  clientOperationId = createFieldLocalId(),
  wildlife?: { sightingId: string; photoId: string },
): Promise<void> {
  const moduleName = record.module;
  if (record.ownerId !== ownerId) {
    throw new Error("Offline evidence uploads must belong to the owning officer.");
  }
  if (moduleName !== "OFFENCE_SEIZURE" &&
    (moduleName !== "PATROL_REPORT" || !wildlife?.sightingId || !wildlife.photoId)) {
    throw new Error("Wildlife evidence uploads require a Patrol Report sighting and photo ID.");
  }
  await withStores([RECORDS, OPERATIONS, LOCKS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
    const recordStore = stores[RECORDS];
    const recordKey: IDBValidKey = [ownerId, moduleName, record.localId];
    const latestRecord = await requestValue(recordStore.get(recordKey)) as OfflineFieldRecord | undefined;
    let mergedRecord = mergeOfflineFieldRecord(
      latestRecord,
      { ...record, ownerId, module: moduleName },
      false,
    );
    const all = await requestValue(operationStore.getAll()) as Operation[];
    const operationId = `evidence:${record.localId}:${clientOperationId}`;
    const existing = await requestValue(operationStore.get([ownerId, moduleName, operationId])) as Operation | undefined;
    let wildlifeSightingMetadata: Record<string, unknown> | undefined;
    let wildlifePhotoMetadata: Record<string, unknown> | undefined;
    if (wildlife && moduleName === "PATROL_REPORT") {
      if (
        mergedRecord.deletedWildlifeSightingIds?.includes(wildlife.sightingId) ||
        mergedRecord.deletedWildlifePhotoIds?.includes(JSON.stringify([wildlife.sightingId, wildlife.photoId]))
      ) {
        throw new Error("This wildlife photo was removed from the Patrol Report and cannot be re-enqueued.");
      }
      const sourceSightings = Array.isArray(mergedRecord.payload.wildlife_sightings)
        ? mergedRecord.payload.wildlife_sightings.filter(isRecord)
        : [];
      const sourceSighting = sourceSightings.find((item) => item.sighting_id === wildlife.sightingId);
      const sourcePhotos = Array.isArray(sourceSighting?.photos)
        ? sourceSighting.photos.filter(isRecord)
        : [];
      const sourcePhoto = sourcePhotos.find((item) => item.photo_id === wildlife.photoId);
      if (sourceSighting && sourcePhoto) {
        wildlifeSightingMetadata = Object.fromEntries(
          Object.entries(sourceSighting).filter(([key]) => key !== "photos"),
        );
        wildlifePhotoMetadata = Object.fromEntries(
          Object.entries(sourcePhoto).filter(([key]) => key !== "file"),
        );
      }
      if (
        existing?.file?.wildlifeSightingId === wildlife.sightingId &&
        existing.file.wildlifePhotoId === wildlife.photoId
      ) {
        wildlifeSightingMetadata ??= existing.file?.wildlifeSightingMetadata;
        wildlifePhotoMetadata ??= existing.file?.wildlifePhotoMetadata;
      }

      const mergedSightings = Array.isArray(mergedRecord.payload.wildlife_sightings)
        ? mergedRecord.payload.wildlife_sightings.filter(isRecord)
        : [];
      const targetSighting = mergedSightings.find((item) => item.sighting_id === wildlife.sightingId);
      const targetPhotos = Array.isArray(targetSighting?.photos)
        ? targetSighting.photos.filter(isRecord)
        : [];
      const photoExists = targetPhotos.some((item) => item.photo_id === wildlife.photoId);
      if (!photoExists && wildlifeSightingMetadata && wildlifePhotoMetadata) {
        const restoredSighting = {
          ...wildlifeSightingMetadata,
          sighting_id: wildlife.sightingId,
          photos: [{ ...wildlifePhotoMetadata, photo_id: wildlife.photoId }],
        };
        mergedRecord = {
          ...mergedRecord,
          payload: {
            ...mergedRecord.payload,
            wildlife_sightings: targetSighting
              ? mergedSightings.map((item) =>
                  item.sighting_id === wildlife.sightingId
                    ? {
                        ...item,
                        photos: [...targetPhotos, { ...wildlifePhotoMetadata, photo_id: wildlife.photoId }],
                      }
                    : item,
                )
              : [...mergedSightings, restoredSighting],
          },
        };
      }
      const persistedSightings = Array.isArray(mergedRecord.payload.wildlife_sightings)
        ? mergedRecord.payload.wildlife_sightings.filter(isRecord)
        : [];
      const persistedSighting = persistedSightings.find(
        (item) => item.sighting_id === wildlife.sightingId,
      );
      const persistedPhotos = Array.isArray(persistedSighting?.photos)
        ? persistedSighting.photos.filter(isRecord)
        : [];
      if (!persistedPhotos.some((item) => item.photo_id === wildlife.photoId)) {
        throw new Error(
          "The queued wildlife photo metadata is missing and cannot be safely recovered; the upload was not enqueued.",
        );
      }
    }

    const operationFile = {
      blob: file,
      fileName: file.name,
      mimeType: file.type,
      description,
      ...(wildlife ? {
        wildlifeSightingId: wildlife.sightingId,
        wildlifePhotoId: wildlife.photoId,
        clientOperationId,
        ...(wildlifeSightingMetadata ? { wildlifeSightingMetadata } : {}),
        ...(wildlifePhotoMetadata ? { wildlifePhotoMetadata } : {}),
      } : {}),
    };
    if (existing) {
      if (
        moduleName === "PATROL_REPORT" &&
        wildlife &&
        (
          !existing.file ||
          existing.file.clientOperationId !== clientOperationId ||
          existing.file.wildlifeSightingId !== wildlife.sightingId ||
          existing.file.wildlifePhotoId !== wildlife.photoId
        )
      ) {
        throw new Error("This wildlife upload operation ID is already bound to another photo.");
      }
      const shouldRetry = existing.status === "FAILED" || existing.status === "AUTH_REQUIRED";
      if (shouldRetry) {
        await requestValue(operationStore.put({
          ...existing,
          file: {
            ...existing.file,
            ...operationFile,
            blob: existing.file?.blob ?? file,
            wildlifeSightingMetadata: wildlifeSightingMetadata ?? existing.file?.wildlifeSightingMetadata,
            wildlifePhotoMetadata: wildlifePhotoMetadata ?? existing.file?.wildlifePhotoMetadata,
          },
          revision: existing.revision + 1,
          attempts: 0,
          status: "PENDING",
          error: null,
          responseStatus: undefined,
          responseCode: undefined,
        } satisfies Operation));
        if (wildlife && moduleName === "PATROL_REPORT") {
          mergedRecord = updateWildlifePhotoUpload(
            mergedRecord,
            wildlife.sightingId,
            wildlife.photoId,
            "PENDING",
            null,
          );
        }
      }
      await requestValue(recordStore.put({ ...mergedRecord, syncError: null }));
      await requestQueueWake(stores, ownerId, moduleName);
      return;
    }
    if (
      wildlife &&
      moduleName === "PATROL_REPORT" &&
      Array.isArray(mergedRecord.payload.wildlife_sightings) &&
      mergedRecord.payload.wildlife_sightings.some((sighting) =>
        isRecord(sighting) &&
        sighting.sighting_id === wildlife.sightingId &&
        Array.isArray(sighting.photos) &&
        sighting.photos.some((photo) =>
          isRecord(photo) && photo.photo_id === wildlife.photoId &&
          typeof photo.evidence_id === "string" && photo.evidence_id.length > 0,
        ),
      )
    ) {
      await requestValue(recordStore.put(mergedRecord));
      await requestQueueWake(stores, ownerId, moduleName);
      return;
    }
    const createdAt = Math.max(
      Date.now(),
      ...all.filter((item) => item?.ownerId === ownerId && item.module === moduleName)
        .map((item) => item.createdAt + 1),
    );
    await requestValue(operationStore.put({
      ownerId,
      module: moduleName,
      id: operationId,
      localId: record.localId,
      kind: "EVIDENCE_UPLOAD",
      file: operationFile,
      createdAt,
      revision: 1,
      attempts: 0,
      status: "PENDING",
      error: null,
    } satisfies Operation));
    if (wildlife && moduleName === "PATROL_REPORT") {
      mergedRecord = updateWildlifePhotoUpload(
        mergedRecord,
        wildlife.sightingId,
        wildlife.photoId,
        "PENDING",
        null,
      );
    }
    await requestValue(recordStore.put({ ...mergedRecord, syncError: null }));
    await requestQueueWake(stores, ownerId, moduleName);
  });
  notifyOfflineQueueChanged();
}

export async function enqueueOfflineWildlifeIdentification(
  ownerId: string,
  record: OfflineFieldRecord,
  evidenceId: string,
  sightingId: string,
  photoId: string,
  retryFailed = false,
): Promise<Operation> {
  if (record.ownerId !== ownerId) {
    throw new Error("Wildlife identification must belong to the owning officer.");
  }
  if (record.module !== "PATROL_REPORT" || !record.serverId || !evidenceId || !sightingId || !photoId) {
    throw new Error("Wildlife identification requires a saved Patrol Report and uploaded photo.");
  }
  const operationId = `wildlife-identify:${record.localId}:${photoId}`;
  const operation = await withStores([RECORDS, OPERATIONS, LOCKS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
    const existing = await requestValue(operationStore.get([ownerId, record.module, operationId])) as Operation | undefined;
    const recordKey: IDBValidKey = [ownerId, record.module, record.localId];
    const latestRecord = await requestValue(stores[RECORDS].get(recordKey)) as OfflineFieldRecord | undefined;
    const mergedRecord = mergeOfflineFieldRecord(
      latestRecord,
      { ...record, ownerId },
      false,
    );
    let queuedOperation: Operation;
    if (existing) {
      if (
        existing.payload?.wildlifeSightingId !== sightingId ||
        existing.payload?.wildlifePhotoId !== photoId
      ) {
        throw new Error("This wildlife identification operation is already bound to another evidence photo.");
      }
      if (retryFailed && (existing.status === "FAILED" || existing.status === "AUTH_REQUIRED")) {
        queuedOperation = {
          ...existing,
          evidenceId,
          payload: { wildlifeSightingId: sightingId, wildlifePhotoId: photoId },
          revision: existing.revision + 1,
          attempts: 0,
          status: "PENDING",
          error: null,
          retryable: undefined,
        };
        await requestValue(operationStore.put(queuedOperation));
      } else {
        queuedOperation = existing;
      }
    } else {
      const all = await requestValue(operationStore.getAll()) as Operation[];
      const createdAt = Math.max(
        Date.now(),
        ...all.filter((item) => item?.ownerId === ownerId && item.module === record.module)
          .map((item) => item.createdAt + 1),
      );
      const created: Operation = {
        ownerId,
        module: record.module,
        id: operationId,
        localId: record.localId,
        kind: "EVIDENCE_IDENTIFY",
        evidenceId,
        payload: { wildlifeSightingId: sightingId, wildlifePhotoId: photoId },
        createdAt,
        revision: 1,
        attempts: 0,
        status: "PENDING",
        error: null,
      };
      await requestValue(operationStore.put(created));
      queuedOperation = created;
    }
    await requestValue(stores[RECORDS].put({ ...mergedRecord, syncError: null }));
    await requestQueueWake(stores, ownerId, record.module);
    return queuedOperation;
  });
  notifyOfflineQueueChanged();
  return operation;
}

export async function cancelOfflineEvidenceUpload(
  ownerId: string,
  module: OfflineFieldModule,
  localId: string,
  clientOperationId: string,
): Promise<void> {
  const operationId = `evidence:${localId}:${clientOperationId}`;
  await withStores([OPERATIONS], "readwrite", async ({ [OPERATIONS]: store }) => {
    const operation = await requestValue(store.get([ownerId, module, operationId])) as Operation | undefined;
    if (operation?.status === "SYNCING") {
      await requestValue(store.put({
        ...operation,
        status: "CANCELLED",
        revision: operation.revision + 1,
        error: null,
      } satisfies Operation));
    } else if (operation) {
      await requestValue(store.delete([ownerId, module, operationId]));
    }
  });
  notifyOfflineQueueChanged();
}

export async function enqueueOfflineEvidenceDelete(
  ownerId: string,
  record: OfflineFieldRecord,
  evidenceId: string,
): Promise<void> {
  const moduleName = record.module;
  if (record.ownerId !== ownerId) {
    throw new Error("Offline evidence deletion must belong to the owning officer.");
  }
  const operationId = `evidence-delete:${record.localId}:${evidenceId}`;
  await withStores([RECORDS, OPERATIONS, LOCKS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
    const recordKey: IDBValidKey = [ownerId, moduleName, record.localId];
    const latestRecord = await requestValue(stores[RECORDS].get(recordKey)) as OfflineFieldRecord | undefined;
    const mergedRecord = mergeOfflineFieldRecord(
      latestRecord,
      { ...record, ownerId, module: moduleName },
      false,
    );
    const existing = await requestValue(
      operationStore.get([ownerId, moduleName, operationId]),
    ) as Operation | undefined;
    if (!existing) {
      const all = await requestValue(operationStore.getAll()) as Operation[];
      const createdAt = Math.max(
        Date.now(),
        ...all.filter((item) => item?.ownerId === ownerId && item.module === moduleName)
          .map((item) => item.createdAt + 1),
      );
      await requestValue(operationStore.put({
        ownerId,
        module: moduleName,
        id: operationId,
        localId: record.localId,
        kind: "EVIDENCE_DELETE",
        evidenceId,
        createdAt,
        revision: 1,
        attempts: 0,
        status: "PENDING",
        error: null,
      } satisfies Operation));
    }
    await requestValue(stores[RECORDS].put({ ...mergedRecord, syncError: null }));
    await requestQueueWake(stores, ownerId, moduleName);
  });
  notifyOfflineQueueChanged();
}

export async function getPendingFieldOperationCount(ownerId: string, module: OfflineFieldModule): Promise<number> {
  await reconcileDeletedWildlifeUploads(ownerId, module);
  return withStores([OPERATIONS], "readonly", async ({ [OPERATIONS]: store }) => {
    const all = await requestValue(store.getAll()) as Operation[];
    const owned = all.filter((item) =>
      item?.ownerId === ownerId && item.module === module && item.status !== "CANCELLED",
    );
    if (owned.some((item) => !item.id || !item.localId || !Number.isFinite(item.createdAt))) {
      throw new Error("A queued field operation is malformed and has been retained.");
    }
    return owned.length;
  });
}

export async function getOfflineFieldQueueFailureMessage(
  ownerId: string,
  module: OfflineFieldModule,
): Promise<string | null> {
  await reconcileDeletedWildlifeUploads(ownerId, module);
  const failures = await withStores([OPERATIONS], "readonly", async ({ [OPERATIONS]: store }) => {
    const all = await requestValue(store.getAll()) as Operation[];
    return all
      .filter((item) =>
        item?.ownerId === ownerId &&
        item.module === module &&
        item.status !== "CANCELLED" &&
        (item.status === "FAILED" || item.status === "AUTH_REQUIRED"),
      )
      .sort((a, b) => b.createdAt - a.createdAt);
  });
  if (!failures.length) return null;

  return failures.map((operation) => {
    const category = operation.kind === "CREATE" || operation.kind === "UPDATE" || operation.kind === "SUBMIT"
      ? module === "PATROL_REPORT" ? "Patrol Report metadata" : "Field form metadata"
      : operation.kind === "EVIDENCE_IDENTIFY"
        ? "Wildlife identification"
        : operation.kind === "EVIDENCE_UPLOAD"
          ? "Wildlife evidence upload"
          : operation.kind === "EVIDENCE_DELETE"
            ? "Evidence deletion"
            : "Field form sync";
    const status = operation.responseStatus
      ? `HTTP ${operation.responseStatus}`
      : operation.responseCode ?? operation.status;
    return `${category} ${operation.kind} failed (${status}; ${operation.retryable ? "retryable" : "not retryable"}; operation ${operation.id}; local report ${operation.localId}): ${operation.error ?? "No response message was provided."}`;
  }).join(" | ");
}

async function markOperation(ownerId: string, module: OfflineFieldModule, operation: Operation): Promise<void> {
  await withStores([OPERATIONS], "readwrite", async ({ [OPERATIONS]: store }) => {
    await requestValue(store.put(operation));
  });
}

async function saveRecord(record: OfflineFieldRecord): Promise<void> {
  await withStores([RECORDS], "readwrite", async ({ [RECORDS]: store }) => {
    const key: IDBValidKey = [record.ownerId, record.module, record.localId];
    const latest = await requestValue(store.get(key)) as OfflineFieldRecord | undefined;
    const merged = mergeOfflineFieldRecord(latest, record);
    await requestValue(store.put({
      ...merged,
      syncError: record.syncError,
      updatedAt: latest?.updatedAt ?? record.updatedAt,
    }));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeWildlifePhoto(
  latest: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...latest, ...incoming };
  const latestEvidenceId = latest.evidence_id;
  const incomingEvidenceId = incoming.evidence_id;
  merged.evidence_id = typeof latestEvidenceId === "string" && latestEvidenceId
    ? latestEvidenceId
    : incomingEvidenceId ?? null;

  const latestIdentification = isRecord(latest.identification) ? latest.identification : null;
  const incomingIdentification = isRecord(incoming.identification) ? incoming.identification : null;
  const latestHasResult = latestIdentification && latestIdentification.status !== "PENDING";
  const incomingHasResult = incomingIdentification && incomingIdentification.status !== "PENDING";
  if (latestHasResult || incomingHasResult || latestIdentification || incomingIdentification) {
    merged.identification = latestHasResult
      ? latestIdentification
      : incomingHasResult
        ? incomingIdentification
        : latestIdentification ?? incomingIdentification;
  }

  if (latest.upload_status === "UPLOADED" || latest.upload_status === "UPLOADING") {
    merged.upload_status = latest.upload_status;
    merged.upload_error = latest.upload_error ?? null;
  } else if (latest.upload_status !== undefined) {
    merged.upload_status = latest.upload_status;
    merged.upload_error = latest.upload_error ?? incoming.upload_error ?? null;
  }
  delete merged.file;
  return merged;
}

function mergeWildlifeSightings(latestValue: unknown, incomingValue: unknown): unknown[] {
  const latest = Array.isArray(latestValue) ? latestValue.filter(isRecord) : [];
  const incoming = Array.isArray(incomingValue) ? incomingValue.filter(isRecord) : [];
  const byId = new Map<string, Record<string, unknown>>();

  for (const sighting of latest) {
    if (typeof sighting.sighting_id === "string") byId.set(sighting.sighting_id, sighting);
  }
  for (const incomingSighting of incoming) {
    const sightingId = incomingSighting.sighting_id;
    if (typeof sightingId !== "string") continue;
    const current = byId.get(sightingId);
    if (!current) {
      byId.set(sightingId, {
        ...incomingSighting,
        photos: (Array.isArray(incomingSighting.photos) ? incomingSighting.photos : [])
          .filter(isRecord)
          .map((photo) => {
            const copy = { ...photo };
            delete copy.file;
            return copy;
          }),
      });
      continue;
    }

    const latestPhotos = Array.isArray(current.photos) ? current.photos.filter(isRecord) : [];
    const incomingPhotos = Array.isArray(incomingSighting.photos)
      ? incomingSighting.photos.filter(isRecord)
      : [];
    const photos = new Map<string, Record<string, unknown>>();
    for (const photo of latestPhotos) {
      if (typeof photo.photo_id === "string") photos.set(photo.photo_id, photo);
    }
    for (const photo of incomingPhotos) {
      if (typeof photo.photo_id !== "string") continue;
      const currentPhoto = photos.get(photo.photo_id);
      if (currentPhoto) photos.set(photo.photo_id, mergeWildlifePhoto(currentPhoto, photo));
      else {
        const copy = { ...photo };
        delete copy.file;
        photos.set(photo.photo_id, copy);
      }
    }
    const hasValidLocation = (sighting: Record<string, unknown> | undefined): boolean =>
      Number.isFinite(sighting?.latitude) &&
      typeof sighting?.latitude === "number" &&
      sighting.latitude >= -90 &&
      sighting.latitude <= 90 &&
      Number.isFinite(sighting.longitude) &&
      typeof sighting.longitude === "number" &&
      sighting.longitude >= -180 &&
      sighting.longitude <= 180;
    const locationSource = hasValidLocation(incomingSighting)
      ? incomingSighting
      : hasValidLocation(current)
        ? current
        : undefined;
    byId.set(sightingId, {
      ...current,
      ...incomingSighting,
      ...(locationSource
        ? {
            latitude: locationSource.latitude,
            longitude: locationSource.longitude,
            accuracy_m: Number.isFinite(locationSource.accuracy_m) &&
              typeof locationSource.accuracy_m === "number" &&
              locationSource.accuracy_m >= 0
                ? locationSource.accuracy_m
                : current.accuracy_m ?? null,
            captured_at: locationSource.captured_at ?? current.captured_at ?? null,
            location_capture_status: locationSource.location_capture_status === "GPS" ||
              locationSource.location_capture_status === "MANUAL"
                ? locationSource.location_capture_status
                : current.location_capture_status ?? locationSource.location_capture_status,
          }
        : {}),
      photos: [...photos.values()],
    });
  }

  return [...byId.values()];
}

function filterDeletedWildlifeMetadata(
  sightingsValue: unknown,
  deletedPhotoIds: Set<string>,
  deletedSightingIds: Set<string>,
): unknown[] {
  const sightings = Array.isArray(sightingsValue) ? sightingsValue.filter(isRecord) : [];
  return sightings
    .filter((sighting) =>
      typeof sighting.sighting_id !== "string" ||
      !deletedSightingIds.has(sighting.sighting_id),
    )
    .map((sighting) => ({
      ...sighting,
      photos: (Array.isArray(sighting.photos) ? sighting.photos : [])
        .filter(isRecord)
        .filter((photo) =>
          typeof sighting.sighting_id !== "string" ||
          typeof photo.photo_id !== "string" ||
          !deletedPhotoIds.has(JSON.stringify([sighting.sighting_id, photo.photo_id])),
        ),
    }));
}

function mergeOfflineFieldRecord(
  latest: OfflineFieldRecord | undefined,
  incoming: OfflineFieldRecord,
  preferIncoming = true,
): OfflineFieldRecord {
  const deletedWildlifePhotoIds = new Set([
    ...(latest?.deletedWildlifePhotoIds ?? []),
    ...(incoming.deletedWildlifePhotoIds ?? []),
  ]);
  const deletedWildlifeSightingIds = new Set([
    ...(latest?.deletedWildlifeSightingIds ?? []),
    ...(incoming.deletedWildlifeSightingIds ?? []),
  ]);
  if (!latest) {
    return incoming.module === "PATROL_REPORT"
      ? {
          ...incoming,
          deletedWildlifePhotoIds: [...deletedWildlifePhotoIds],
          deletedWildlifeSightingIds: [...deletedWildlifeSightingIds],
          payload: {
            ...incoming.payload,
            wildlife_sightings: filterDeletedWildlifeMetadata(
              incoming.payload.wildlife_sightings,
              deletedWildlifePhotoIds,
              deletedWildlifeSightingIds,
            ),
          },
        }
      : incoming;
  }
  const statusPriority = { DRAFT: 0, PENDING_SUBMISSION: 1, SUBMITTED: 2 };
  const status = statusPriority[latest.status] > statusPriority[incoming.status]
    ? latest.status
    : incoming.status;
  const mergedPayload = preferIncoming
    ? { ...latest.payload, ...incoming.payload }
    : { ...incoming.payload, ...latest.payload };
  return {
    ...(preferIncoming ? { ...latest, ...incoming } : { ...incoming, ...latest }),
    ownerId: latest.ownerId,
    module: latest.module,
    localId: latest.localId,
    serverId: latest.serverId ?? incoming.serverId,
    status,
    deletedWildlifePhotoIds: [...deletedWildlifePhotoIds],
    deletedWildlifeSightingIds: [...deletedWildlifeSightingIds],
    payload: {
      ...mergedPayload,
      ...(incoming.module === "PATROL_REPORT" || latest.module === "PATROL_REPORT"
        ? {
            wildlife_sightings: filterDeletedWildlifeMetadata(
              mergeWildlifeSightings(
                latest.payload.wildlife_sightings,
                incoming.payload.wildlife_sightings,
              ),
              deletedWildlifePhotoIds,
              deletedWildlifeSightingIds,
            ),
          }
        : {}),
    },
  };
}

export async function persistOfflineFieldRecord(
  ownerId: string,
  record: OfflineFieldRecord,
): Promise<OfflineFieldRecord> {
  if (record.ownerId !== ownerId) {
    throw new Error("Offline form data must belong to the owning officer.");
  }
  return withStores([RECORDS], "readwrite", async ({ [RECORDS]: store }) => {
    const key: IDBValidKey = [ownerId, record.module, record.localId];
    const latest = await requestValue(store.get(key)) as OfflineFieldRecord | undefined;
    const merged = mergeOfflineFieldRecord(latest, record);
    await requestValue(store.put(merged));
    return merged;
  });
}

async function updateStoredRecord(
  ownerId: string,
  module: OfflineFieldModule,
  localId: string,
  update: (latest: OfflineFieldRecord | undefined) => OfflineFieldRecord,
): Promise<OfflineFieldRecord> {
  return withStores([RECORDS], "readwrite", async ({ [RECORDS]: store }) => {
    const key: IDBValidKey = [ownerId, module, localId];
    const latest = await requestValue(store.get(key)) as OfflineFieldRecord | undefined;
    const updated = update(latest);
    await requestValue(store.put(updated));
    return updated;
  });
}

function wildlifeUploadMatchesDeletion(
  operation: Operation,
  record: OfflineFieldRecord,
): boolean {
  if (operation.module !== "PATROL_REPORT" || operation.kind !== "EVIDENCE_UPLOAD") return false;
  const sightingId = operation.file?.wildlifeSightingId;
  const photoId = operation.file?.wildlifePhotoId;
  return Boolean(
    (sightingId && record.deletedWildlifeSightingIds?.includes(sightingId)) ||
    (sightingId && photoId &&
      record.deletedWildlifePhotoIds?.includes(JSON.stringify([sightingId, photoId]))),
  );
}

async function cancelDeletedWildlifeUploads(
  stores: Record<string, IDBObjectStore>,
  ownerId: string,
  localId: string,
  record: OfflineFieldRecord,
): Promise<void> {
  const operationStore = stores[OPERATIONS];
  const all = await requestValue(operationStore.getAll()) as Operation[];
  for (const operation of all) {
    if (
      operation?.ownerId !== ownerId ||
      operation.module !== "PATROL_REPORT" ||
      operation.localId !== localId ||
      !wildlifeUploadMatchesDeletion(operation, record)
    ) continue;
    const key: IDBValidKey = [ownerId, "PATROL_REPORT", operation.id];
    if (operation.status === "SYNCING") {
      await requestValue(operationStore.put({
        ...operation,
        status: "CANCELLED",
        revision: operation.revision + 1,
        error: null,
      } satisfies Operation));
    } else {
      await requestValue(operationStore.delete(key));
    }
  }
}

async function reconcileDeletedWildlifeUploads(
  ownerId: string,
  module: OfflineFieldModule,
): Promise<void> {
  if (module !== "PATROL_REPORT") return;
  await withStores([RECORDS, OPERATIONS], "readwrite", async (stores) => {
    const operations = await requestValue(stores[OPERATIONS].getAll()) as Operation[];
    for (const operation of operations) {
      if (
        operation?.ownerId !== ownerId ||
        operation.module !== module ||
        operation.kind !== "EVIDENCE_UPLOAD" ||
        operation.status === "CANCELLED"
      ) continue;
      const record = await requestValue(stores[RECORDS].get([
        ownerId,
        module,
        operation.localId,
      ])) as OfflineFieldRecord | undefined;
      if (!record || !wildlifeUploadMatchesDeletion(operation, record)) continue;
      const key: IDBValidKey = [ownerId, module, operation.id];
      if (operation.status === "SYNCING") {
        await requestValue(stores[OPERATIONS].put({
          ...operation,
          status: "CANCELLED",
          revision: operation.revision + 1,
          error: null,
        } satisfies Operation));
      } else {
        await requestValue(stores[OPERATIONS].delete(key));
      }
    }
  });
}

export async function removeOfflineWildlifePhoto(
  ownerId: string,
  localId: string,
  sightingId: string,
  photoId: string,
): Promise<void> {
  await withStores([RECORDS, OPERATIONS, LOCKS], "readwrite", async (stores) => {
    const key: IDBValidKey = [ownerId, "PATROL_REPORT", localId];
    const latest = await requestValue(stores[RECORDS].get(key)) as OfflineFieldRecord | undefined;
    if (!latest) throw new Error("The Patrol Report could not be found while removing the wildlife photo.");
    const deletedWildlifePhotoIds = new Set(latest.deletedWildlifePhotoIds ?? []);
    deletedWildlifePhotoIds.add(JSON.stringify([sightingId, photoId]));
    const sightings = Array.isArray(latest.payload.wildlife_sightings)
      ? latest.payload.wildlife_sightings.filter(isRecord)
      : [];
    const updated = {
      ...latest,
      deletedWildlifePhotoIds: [...deletedWildlifePhotoIds],
      payload: {
        ...latest.payload,
        wildlife_sightings: sightings.map((sighting) =>
          sighting.sighting_id === sightingId
            ? {
                ...sighting,
                photos: (Array.isArray(sighting.photos) ? sighting.photos : [])
                  .filter(isRecord)
                  .filter((photo) => photo.photo_id !== photoId),
              }
            : sighting,
        ),
      },
    };
    await requestValue(stores[RECORDS].put(updated));
    await cancelDeletedWildlifeUploads(stores, ownerId, localId, updated);
    await requestQueueWake(stores, ownerId, "PATROL_REPORT");
  });
  notifyOfflineQueueChanged();
}

export async function removeOfflineWildlifeSighting(
  ownerId: string,
  localId: string,
  sightingId: string,
): Promise<void> {
  await withStores([RECORDS, OPERATIONS, LOCKS], "readwrite", async (stores) => {
    const key: IDBValidKey = [ownerId, "PATROL_REPORT", localId];
    const latest = await requestValue(stores[RECORDS].get(key)) as OfflineFieldRecord | undefined;
    if (!latest) throw new Error("The Patrol Report could not be found while removing the wildlife sighting.");
    const deletedWildlifeSightingIds = new Set(latest.deletedWildlifeSightingIds ?? []);
    deletedWildlifeSightingIds.add(sightingId);
    const sightings = Array.isArray(latest.payload.wildlife_sightings)
      ? latest.payload.wildlife_sightings.filter(isRecord)
      : [];
    const updated = {
      ...latest,
      deletedWildlifeSightingIds: [...deletedWildlifeSightingIds],
      payload: {
        ...latest.payload,
        wildlife_sightings: sightings.filter((sighting) => sighting.sighting_id !== sightingId),
      },
    };
    await requestValue(stores[RECORDS].put(updated));
    await cancelDeletedWildlifeUploads(stores, ownerId, localId, updated);
    await requestQueueWake(stores, ownerId, "PATROL_REPORT");
  });
  notifyOfflineQueueChanged();
}

async function requestQueueWake(
  stores: Record<string, IDBObjectStore>,
  ownerId: string,
  module: OfflineFieldModule,
): Promise<void> {
  const key = `field-sync:${ownerId}:${module}`;
  const lock = await requestValue(stores[LOCKS].get(key)) as
    { token: string; expiresAt: number; wakeRequested?: boolean } | undefined;
  if (lock && lock.expiresAt > Date.now()) {
    await requestValue(stores[LOCKS].put({ ...lock, wakeRequested: true }));
  }
}

async function acquireLock(ownerId: string, module: OfflineFieldModule): Promise<string | null> {
  const token = createFieldLocalId();
  const key = `field-sync:${ownerId}:${module}`;
  return withStores([LOCKS], "readwrite", async ({ [LOCKS]: store }) => {
    const current = await requestValue(store.get(key)) as
      { expiresAt: number; wakeRequested?: boolean } | undefined;
    if (current && current.expiresAt > Date.now()) {
      await requestValue(store.put({ ...current, wakeRequested: true }));
      return null;
    }
    await requestValue(store.put({ key, token, expiresAt: Date.now() + LOCK_TTL }));
    return token;
  });
}

async function releaseLock(
  ownerId: string,
  module: OfflineFieldModule,
  token: string,
  continueIfWakeRequested = false,
): Promise<boolean> {
  const key = `field-sync:${ownerId}:${module}`;
  return withStores([LOCKS], "readwrite", async ({ [LOCKS]: store }) => {
    const current = await requestValue(store.get(key)) as
      { token: string; expiresAt: number; wakeRequested?: boolean } | undefined;
    if (current?.token !== token) return false;
    const wakeRequested = continueIfWakeRequested && current.wakeRequested === true;
    await requestValue(store.delete(key));
    return wakeRequested;
  });
}

async function completeOperation(operation: Operation, record: OfflineFieldRecord, serverId: string | null): Promise<void> {
  await withStores([RECORDS, OPERATIONS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
    const recordStore = stores[RECORDS];
    const key: IDBValidKey = [operation.ownerId, operation.module, operation.id];
    const recordKey: IDBValidKey = [operation.ownerId, operation.module, operation.localId];
    const current = await requestValue(operationStore.get(key)) as Operation | undefined;
    if (current?.revision !== operation.revision) {
      if (current) await requestValue(operationStore.put({ ...current, status: "PENDING", attempts: 0, error: null }));
      return;
    }
    await requestValue(operationStore.delete(key));
    const latestRecord = await requestValue(recordStore.get(recordKey)) as OfflineFieldRecord | undefined;
    const storedStatus = latestRecord?.status ?? record.status;
    const status = operation.kind === "SUBMIT" ? "SUBMITTED" : storedStatus;
    const mergedRecord = mergeOfflineFieldRecord(latestRecord, {
      ...record,
      serverId: serverId ?? latestRecord?.serverId ?? record.serverId,
      status,
      syncError: null,
      updatedAt: new Date().toISOString(),
    }, false);
    await requestValue(recordStore.put({
      ...mergedRecord,
      serverId: serverId ?? latestRecord?.serverId ?? record.serverId,
      status,
      syncError: null,
      updatedAt: new Date().toISOString(),
    }));
  });
  notifyOfflineQueueChanged();
}

function updateWildlifePhotoIdentification(
  record: OfflineFieldRecord,
  sightingId: string,
  photoId: string,
  identification: Record<string, unknown>,
): OfflineFieldRecord {
  const sightings = Array.isArray(record.payload.wildlife_sightings)
    ? record.payload.wildlife_sightings as Array<Record<string, unknown>>
    : [];
  return {
    ...record,
    payload: {
      ...record.payload,
      wildlife_sightings: sightings.map((sighting) => {
        if (sighting.sighting_id !== sightingId || !Array.isArray(sighting.photos)) return sighting;
        return {
          ...sighting,
          photos: (sighting.photos as Array<Record<string, unknown>>).map((photo) =>
            photo.photo_id === photoId
              ? { ...photo, identification }
              : photo,
          ),
        };
      }),
    },
  };
}

function updateWildlifePhotoUpload(
  record: OfflineFieldRecord,
  sightingId: string,
  photoId: string,
  status: "PENDING" | "UPLOADING" | "UPLOADED" | "FAILED",
  error: string | null,
  evidenceId?: string,
): OfflineFieldRecord {
  const sightings = Array.isArray(record.payload.wildlife_sightings)
    ? record.payload.wildlife_sightings as Array<Record<string, unknown>>
    : [];
  return {
    ...record,
    payload: {
      ...record.payload,
      wildlife_sightings: sightings.map((sighting) => {
        if (sighting.sighting_id !== sightingId || !Array.isArray(sighting.photos)) return sighting;
        return {
          ...sighting,
          photos: (sighting.photos as Array<Record<string, unknown>>).map((photo) =>
            photo.photo_id === photoId
              ? {
                  ...photo,
                  upload_status: status,
                  upload_error: error,
                  ...(evidenceId ? { evidence_id: evidenceId } : {}),
                }
              : photo,
          ),
        };
      }),
    },
  };
}

function restoreQueuedWildlifePhoto(
  record: OfflineFieldRecord,
  operation: Operation,
): OfflineFieldRecord | null {
  const sightingId = operation.file?.wildlifeSightingId;
  const photoId = operation.file?.wildlifePhotoId;
  if (
    typeof sightingId !== "string" ||
    typeof photoId !== "string"
  ) return null;
  if (
    record.deletedWildlifeSightingIds?.includes(sightingId) ||
    record.deletedWildlifePhotoIds?.includes(JSON.stringify([sightingId, photoId]))
  ) return null;

  const sightings = Array.isArray(record.payload.wildlife_sightings)
    ? record.payload.wildlife_sightings.filter(isRecord)
    : [];
  const targetSighting = sightings.find((item) => item.sighting_id === sightingId);
  const savedPhoto = Array.isArray(targetSighting?.photos)
    ? targetSighting.photos.find((item) => isRecord(item) && item.photo_id === photoId) as
        Record<string, unknown> | undefined
    : undefined;
  const operationPhoto = operation.file?.wildlifePhotoMetadata;
  const reconstructedPhoto: Record<string, unknown> = {
    photo_id: photoId,
    file_name: operation.file?.fileName,
    mime_type: operation.file?.mimeType || operation.file?.blob.type || "application/octet-stream",
    file_size: operation.file?.blob.size,
    evidence_id: null,
    identification: {
      status: "PENDING",
      common_name: null,
      scientific_name: null,
      confidence: null,
    },
    upload_status: "PENDING",
    upload_error: null,
  };
  const photoMetadata = savedPhoto ?? (operationPhoto?.photo_id === photoId ? operationPhoto : reconstructedPhoto);
  const photo = {
    ...reconstructedPhoto,
    ...photoMetadata,
    photo_id: photoId,
    evidence_id: savedPhoto?.evidence_id ?? photoMetadata.evidence_id ?? null,
    identification: savedPhoto?.identification ?? photoMetadata.identification ?? reconstructedPhoto.identification,
    upload_status: savedPhoto?.upload_status ?? photoMetadata.upload_status ?? "PENDING",
    upload_error: savedPhoto?.upload_error ?? photoMetadata.upload_error ?? null,
  };
  if (targetSighting && savedPhoto) return record;
  if (targetSighting) {
    return {
      ...record,
      payload: {
        ...record.payload,
        wildlife_sightings: sightings.map((sighting) =>
          sighting.sighting_id === sightingId
            ? {
                ...sighting,
                photos: [
                  ...(Array.isArray(sighting.photos) ? sighting.photos.filter(isRecord) : []),
                  photo,
                ],
              }
            : sighting,
        ),
      },
    };
  }

  const sightingMetadata = operation.file?.wildlifeSightingMetadata;
  if (!sightingMetadata || sightingMetadata.sighting_id !== sightingId) return null;
  return {
    ...record,
    payload: {
      ...record.payload,
      wildlife_sightings: [
        ...sightings,
        { ...sightingMetadata, sighting_id: sightingId, photos: [photo] },
      ],
    },
  };
}

async function repairFailedWildlifeUploadMetadata(ownerId: string): Promise<void> {
  await withStores([RECORDS, OPERATIONS], "readwrite", async (stores) => {
    const records = stores[RECORDS];
    const operations = stores[OPERATIONS];
    const all = await requestValue(operations.getAll()) as Operation[];
    for (const operation of all) {
      const missingAssociationError = operation?.error?.includes(
        "missing the queued wildlife sighting or photo",
      );
      const alreadyExplainedUnrecoverableError = operation?.error?.includes(
        "does not contain enough valid sighting metadata",
      );
      if (
        operation?.ownerId !== ownerId ||
        operation.module !== "PATROL_REPORT" ||
        operation.kind !== "EVIDENCE_UPLOAD" ||
        operation.status !== "FAILED" ||
        !operation.file?.blob ||
        alreadyExplainedUnrecoverableError ||
        (!missingAssociationError && operation.file.wildlifePhotoMetadata)
      ) continue;

      const key: IDBValidKey = [ownerId, "PATROL_REPORT", operation.localId];
      const latest = await requestValue(records.get(key)) as OfflineFieldRecord | undefined;
      if (!latest) {
        await requestValue(operations.put({
          ...operation,
          revision: operation.revision + 1,
          error: "The Patrol Report is missing from local storage. Keep the queued image and restore the report before retrying.",
        } satisfies Operation));
        continue;
      }
      const restored = restoreQueuedWildlifePhoto(latest, operation);
      if (!restored) {
        const sightingId = operation.file.wildlifeSightingId;
        const photoId = operation.file.wildlifePhotoId;
        const deleted = latest.deletedWildlifeSightingIds?.includes(sightingId ?? "") ||
          latest.deletedWildlifePhotoIds?.includes(JSON.stringify([sightingId, photoId]));
        await requestValue(operations.put({
          ...operation,
          revision: operation.revision + 1,
          retryable: false,
          error: deleted
            ? "This wildlife photo was explicitly deleted. The retained upload was not sent; restore it intentionally before retrying."
            : "The wildlife upload Blob is retained, but the saved report has no matching sighting and the operation has no verified sighting metadata. Restore the original sighting, save the report, then retry.",
        } satisfies Operation));
        continue;
      }
      const sightingId = operation.file.wildlifeSightingId;
      const photoId = operation.file.wildlifePhotoId;
      if (!sightingId || !photoId) continue;
      const sightings = Array.isArray(restored.payload.wildlife_sightings)
        ? restored.payload.wildlife_sightings.filter(isRecord)
        : [];
      const sighting = sightings.find((item) => item.sighting_id === sightingId);
      const photos = Array.isArray(sighting?.photos) ? sighting.photos.filter(isRecord) : [];
      const photo = photos.find((item) => item.photo_id === photoId);
      if (!sighting || !photo) continue;
      const sightingMetadata = Object.fromEntries(
        Object.entries(sighting).filter(([field]) => field !== "photos"),
      );
      const photoMetadata = Object.fromEntries(
        Object.entries(photo).filter(([field]) => field !== "file"),
      );
      await requestValue(records.put(restored));
      await requestValue(operations.put({
        ...operation,
        file: {
          ...operation.file,
          wildlifeSightingMetadata: sightingMetadata,
          wildlifePhotoMetadata: photoMetadata,
        },
        revision: operation.revision + 1,
        attempts: 0,
        status: "PENDING",
        retryable: undefined,
        error: null,
        responseStatus: undefined,
        responseCode: undefined,
      } satisfies Operation));
    }
  });
}

async function discardDeletedWildlifeUpload(operation: Operation): Promise<boolean> {
  if (operation.module !== "PATROL_REPORT" || operation.kind !== "EVIDENCE_UPLOAD") return false;
  return withStores([RECORDS, OPERATIONS], "readwrite", async (stores) => {
    const operationKey: IDBValidKey = [operation.ownerId, operation.module, operation.id];
    const current = await requestValue(stores[OPERATIONS].get(operationKey)) as Operation | undefined;
    const record = await requestValue(stores[RECORDS].get([
      operation.ownerId,
      operation.module,
      operation.localId,
    ])) as OfflineFieldRecord | undefined;
    const cancelled = current?.status === "CANCELLED" ||
      Boolean(current && record && wildlifeUploadMatchesDeletion(current, record));
    if (cancelled && current) await requestValue(stores[OPERATIONS].delete(operationKey));
    return cancelled;
  });
}

async function syncOne(operation: Operation): Promise<"ok" | "auth" | "failed" | "deferred"> {
  const activeUser = getStoredUser();
  if (activeUser?.role !== "FIELD_OFFICER" || activeUser.id !== operation.ownerId) {
    await markOperation(operation.ownerId, operation.module, {
      ...operation,
      status: "AUTH_REQUIRED",
      error: "The signed-in field officer changed. Switch back to the original account to sync this data.",
    });
    return "auth";
  }
  const savedRecord = await getOfflineFormRecord(operation.ownerId, operation.module, operation.localId);
  if (!savedRecord) {
    await markOperation(operation.ownerId, operation.module, { ...operation, status: "FAILED", error: "The local form data is missing; the queued operation was retained." });
    return "failed";
  }
  if (await discardDeletedWildlifeUpload(operation)) return "ok";
  let record: OfflineFieldRecord = savedRecord;
  const config = CONFIG[operation.module];
  if (
    operation.module === "PATROL_REPORT" &&
    (operation.kind === "EVIDENCE_UPLOAD" || operation.kind === "EVIDENCE_IDENTIFY")
  ) {
    const hasPendingReportSave = await withStores([OPERATIONS], "readonly", async ({ [OPERATIONS]: store }) => {
      const all = await requestValue(store.getAll()) as Operation[];
      return all.some((item) =>
        item?.ownerId === operation.ownerId &&
        item.module === operation.module &&
        item.localId === operation.localId &&
        (item.kind === "CREATE" || item.kind === "UPDATE"),
      );
    });
    if (hasPendingReportSave) return "deferred";
  }
  const isIncidentUpdate =
    operation.module === "INCIDENT_REPORT" && operation.kind === "UPDATE";
  const isIncidentCreateRecovery = isIncidentUpdate && !record.serverId;
  const operationKind: FieldOperationKind =
    operation.kind === "UPDATE" && !record.serverId && !isIncidentUpdate
      ? "CREATE"
      : operation.kind;
  let path: string;
  let method: string;
  let body: string | undefined;
  if (operationKind === "CREATE" || isIncidentCreateRecovery) {
    path = config.path;
    method = "POST";
    body = JSON.stringify({
      ...operation.payload,
      client_operation_id: fieldCreateOperationId(operation.module, operation.localId),
    });
  } else if (operationKind === "UPDATE") {
    if (!record.serverId) {
      await markOperation(operation.ownerId, operation.module, { ...operation, status: "FAILED", error: "The draft has not been created on the server yet." });
      return "failed";
    }
    path = `${config.path}/${record.serverId}`;
    method = "PUT";
    body = JSON.stringify(
      isIncidentUpdate
        ? {
            ...operation.payload,
            client_operation_id: fieldCreateOperationId(
              operation.module,
              operation.localId,
            ),
          }
        : operation.payload,
    );
  } else if (operation.kind === "SUBMIT") {
    if (!record.serverId) {
      await markOperation(operation.ownerId, operation.module, { ...operation, status: "FAILED", error: "Save the draft before submitting it." });
      return "failed";
    }
    path = `${config.path}/${record.serverId}/submit`;
    method = "POST";
  } else if (operation.kind === "EVIDENCE_DELETE") {
    if (!operation.evidenceId) {
      await markOperation(operation.ownerId, operation.module, {
        ...operation, status: "FAILED", error: "The queued evidence deletion is missing its evidence ID.",
      });
      return "failed";
    }
    path = `/api/v1/field/evidence/${operation.evidenceId}`;
    method = "DELETE";
  } else if (operation.kind === "EVIDENCE_IDENTIFY") {
    const sightingId = operation.payload?.wildlifeSightingId;
    const photoId = operation.payload?.wildlifePhotoId;
    if (!record.serverId || !operation.evidenceId || typeof sightingId !== "string" || typeof photoId !== "string") {
      await markOperation(operation.ownerId, operation.module, {
        ...operation, status: "FAILED", retryable: false,
        error: "The queued wildlife identification is missing its report, evidence, or sighting ID.",
      });
      return "failed";
    }
    path = `/api/v1/field/forms/patrol/${record.serverId}/wildlife-identify`;
    method = "POST";
  } else {
    if (!record.serverId) {
      await markOperation(operation.ownerId, operation.module, {
        ...operation, status: "FAILED", error: "Save the report before uploading evidence.",
      });
      return "failed";
    }
    path = "/api/v1/field/evidence/upload";
    method = "POST";
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const currentUser = getStoredUser();
    if (currentUser?.role !== "FIELD_OFFICER" || currentUser.id !== operation.ownerId) {
      await markOperation(operation.ownerId, operation.module, {
        ...operation,
        status: "AUTH_REQUIRED",
        error: "The signed-in field officer changed. Switch back to the original account to sync this data.",
      });
      return "auth";
    }
    await markOperation(operation.ownerId, operation.module, {
      ...operation,
      status: "SYNCING",
      attempts: attempt,
      error: null,
      responseStatus: undefined,
      responseCode: undefined,
    });
    let requestBody: BodyInit | undefined = body;
    if (operationKind === "EVIDENCE_UPLOAD" && operation.module === "PATROL_REPORT") {
      const sightingId = operation.file?.wildlifeSightingId;
      const photoId = operation.file?.wildlifePhotoId;
      let latest = await getOfflineFormRecord(operation.ownerId, operation.module, operation.localId) ?? record;
      const restored = restoreQueuedWildlifePhoto(latest, operation);
      if (restored && restored !== latest) {
        await saveRecord(restored);
        const persisted = await getOfflineFormRecord(operation.ownerId, operation.module, operation.localId);
        if (!persisted) {
          await markOperation(operation.ownerId, operation.module, {
            ...operation,
            status: "FAILED",
            retryable: true,
            error: "Recovered wildlife metadata could not be verified in local storage. Keep this report open and retry sync.",
          });
          return "failed";
        }
        latest = persisted;
      }
      record = latest;
      const sightings = Array.isArray(record.payload.wildlife_sightings)
        ? record.payload.wildlife_sightings.filter(isRecord)
        : [];
      const targetSighting = sightings.find((item) => item.sighting_id === sightingId);
      const photos = Array.isArray(targetSighting?.photos)
        ? targetSighting.photos.filter(isRecord)
        : [];
      if (
        !record.serverId ||
        typeof sightingId !== "string" ||
        typeof photoId !== "string" ||
        !photos.some((photo) => photo.photo_id === photoId)
      ) {
        const deleted = record.deletedWildlifeSightingIds?.includes(sightingId ?? "") ||
          record.deletedWildlifePhotoIds?.includes(JSON.stringify([sightingId, photoId]));
        const error = deleted
          ? "This wildlife photo was explicitly deleted. The retained upload was not sent; remove or restore the photo intentionally before retrying."
          : "The saved Patrol Report is missing the queued wildlife sighting or photo, and the retained operation does not contain enough valid sighting metadata to restore it. Restore the sighting in the Patrol Report, then save and retry sync.";
        await markOperation(operation.ownerId, operation.module, {
          ...operation,
          status: "FAILED",
          retryable: !deleted,
          error: deleted
            ? error
            : `${error} The queued file has been retained.`,
        });
        return "failed";
      }
      const verified = await getOfflineFormRecord(operation.ownerId, operation.module, operation.localId);
      const verifiedSightings = Array.isArray(verified?.payload.wildlife_sightings)
        ? verified.payload.wildlife_sightings.filter(isRecord)
        : [];
      const verifiedSighting = verifiedSightings.find((item) => item.sighting_id === sightingId);
      const verifiedPhotos = Array.isArray(verifiedSighting?.photos)
        ? verifiedSighting.photos.filter(isRecord)
        : [];
      if (
        !verified ||
        !verified.serverId ||
        verified.serverId !== record.serverId ||
        typeof sightingId !== "string" ||
        typeof photoId !== "string" ||
        !verifiedPhotos.some((photo) => photo.photo_id === photoId)
      ) {
        await markOperation(operation.ownerId, operation.module, {
          ...operation,
          status: "FAILED",
          retryable: true,
          error: "Wildlife photo metadata could not be verified after recovery. Keep the saved photo and retry sync.",
        });
        return "failed";
      }
      record = verified;
      record = await updateStoredRecord(
        operation.ownerId,
        operation.module,
        operation.localId,
        (current) => updateWildlifePhotoUpload(
          current ?? record,
          sightingId!,
          photoId!,
          "UPLOADING",
          null,
        ),
      );
      notifyOfflineQueueChanged();
    }
    if (operationKind === "EVIDENCE_IDENTIFY") {
      const sightingId = operation.payload?.wildlifeSightingId;
      const photoId = operation.payload?.wildlifePhotoId;
      if (typeof sightingId !== "string" || typeof photoId !== "string" || !operation.evidenceId) {
        await markOperation(operation.ownerId, operation.module, {
          ...operation, status: "FAILED", retryable: false,
          error: "The queued wildlife identification is missing its evidence or sighting association.",
        });
        return "failed";
      }
      requestBody = new FormData();
      requestBody.append("evidence_id", operation.evidenceId);
      requestBody.append("wildlife_sighting_id", sightingId);
      requestBody.append("wildlife_photo_id", photoId);
      record = await updateStoredRecord(
        operation.ownerId,
        operation.module,
        operation.localId,
        (current) => updateWildlifePhotoIdentification(current ?? record, sightingId, photoId, {
          status: "PENDING",
          common_name: null,
          scientific_name: null,
          confidence: null,
          error: null,
        }),
      );
    }
    if (operationKind === "EVIDENCE_UPLOAD") {
      if (!operation.file) {
        const error = "The queued evidence file is missing; the operation was retained.";
        await markOperation(operation.ownerId, operation.module, {
          ...operation,
          status: "FAILED",
          retryable: false,
          error,
        });
        return "failed";
      }
      const formData = new FormData();
      formData.append("report_type", operation.module === "PATROL_REPORT" ? "PATROL" : "OFFENCE_SEIZURE");
      formData.append("report_id", record.serverId!);
      formData.append("file", operation.file.blob, operation.file.fileName);
      formData.append("client_operation_id", operation.file.clientOperationId ?? operation.id);
      if (operation.file.description) formData.append("description", operation.file.description);
      if (operation.module === "PATROL_REPORT") {
        if (!operation.file.wildlifeSightingId || !operation.file.wildlifePhotoId) {
          const error = "The queued wildlife photo is missing its sighting association.";
          await markOperation(operation.ownerId, operation.module, {
            ...operation,
            status: "FAILED",
            retryable: false,
            error,
          });
          notifyOfflineQueueChanged();
          return "failed";
        }
        formData.append("wildlife_sighting_id", operation.file.wildlifeSightingId);
        formData.append("wildlife_photo_id", operation.file.wildlifePhotoId);
      }
      requestBody = formData;
    }
    if (await discardDeletedWildlifeUpload(operation)) return "ok";
    let response = await apiRequest<Record<string, unknown>>(path, {
      method,
      body: requestBody,
      timeoutMs: operationKind === "EVIDENCE_IDENTIFY" ? 120_000 : 15_000,
    });
    const alreadyDeleted = operation.kind === "EVIDENCE_DELETE" && response.status === 404;
    if (response.success && operation.kind === "EVIDENCE_UPLOAD" && operation.module === "PATROL_REPORT") {
      const evidence = response.data.evidence as Record<string, unknown> | undefined;
      const evidenceId = evidence?.id;
      if (typeof evidenceId !== "string" || !operation.file?.wildlifeSightingId || !operation.file.wildlifePhotoId) {
        const error = "The server uploaded the wildlife photo without returning its evidence ID.";
        await markOperation(operation.ownerId, operation.module, {
          ...operation,
          status: "FAILED",
          retryable: false,
          responseStatus: response.status,
          responseCode: "INVALID_RESPONSE",
          error,
        });
        if (operation.file?.wildlifeSightingId && operation.file.wildlifePhotoId) {
          await updateStoredRecord(
            operation.ownerId,
            operation.module,
            operation.localId,
            (current) => updateWildlifePhotoUpload(
              current ?? record,
              operation.file!.wildlifeSightingId!,
              operation.file!.wildlifePhotoId!,
              "FAILED",
              error,
            ),
          );
          notifyOfflineQueueChanged();
        }
        return "failed";
      }
      const currentRecord = await getOfflineFormRecord(
        operation.ownerId,
        operation.module,
        operation.localId,
      );
      if (
        currentRecord &&
        wildlifeUploadMatchesDeletion(operation, currentRecord)
      ) {
        await enqueueOfflineEvidenceDelete(operation.ownerId, currentRecord, evidenceId);
        await withStores([OPERATIONS], "readwrite", async ({ [OPERATIONS]: store }) => {
          await requestValue(store.delete([
            operation.ownerId,
            operation.module,
            operation.id,
          ]));
        });
        notifyOfflineQueueChanged();
        return "ok";
      }
      record = await updateStoredRecord(
        operation.ownerId,
        operation.module,
        operation.localId,
        (current) => {
          const latest = current ?? record;
          const recovered = restoreQueuedWildlifePhoto(latest, operation);
          const target = recovered ?? latest;
          const targetSightings = Array.isArray(target.payload.wildlife_sightings)
            ? target.payload.wildlife_sightings.filter(isRecord)
            : [];
          const targetSighting = targetSightings.find(
            (sighting) => sighting.sighting_id === operation.file?.wildlifeSightingId,
          );
          const targetPhotos = Array.isArray(targetSighting?.photos)
            ? targetSighting.photos.filter(isRecord)
            : [];
          if (!targetPhotos.some((photo) => photo.photo_id === operation.file?.wildlifePhotoId)) {
            throw new Error("The uploaded wildlife photo metadata is no longer available; evidence was retained for safe retry.");
          }
          return {
            ...updateWildlifePhotoUpload(
              target,
              operation.file!.wildlifeSightingId!,
              operation.file!.wildlifePhotoId!,
              "UPLOADED",
              null,
              evidenceId,
            ),
            syncError: null,
          };
        },
      );
      notifyOfflineQueueChanged();
      record = await getOfflineFormRecord(operation.ownerId, operation.module, operation.localId) ?? record;
      await enqueueOfflineWildlifeIdentification(
        operation.ownerId,
        record,
        evidenceId,
        operation.file.wildlifeSightingId,
        operation.file.wildlifePhotoId,
      );
      await completeOperation(operation, record, record.serverId);
      return "ok";
    }
    if (response.success && operation.kind === "EVIDENCE_IDENTIFY") {
      const result = response.data.identification;
      const sightingId = operation.payload?.wildlifeSightingId;
      const photoId = operation.payload?.wildlifePhotoId;
      if (!result || typeof result !== "object" || typeof sightingId !== "string" || typeof photoId !== "string") {
        await markOperation(operation.ownerId, operation.module, {
          ...operation,
          status: "FAILED",
          retryable: false,
          responseStatus: response.status,
          responseCode: "INVALID_RESPONSE",
          error: "The identification service did not return a persisted identification result.",
        });
        return "failed";
      }
      record = await updateStoredRecord(
        operation.ownerId,
        operation.module,
        operation.localId,
        (current) => updateWildlifePhotoIdentification(
          current ?? record,
          sightingId,
          photoId,
          result as Record<string, unknown>,
        ),
      );
    }
    if (
      isIncidentUpdate &&
      method === "PUT" &&
      response.status === 404 &&
      response.message === "Incident report not found."
    ) {
      path = config.path;
      method = "POST";
      body = JSON.stringify({
        ...operation.payload,
        client_operation_id: fieldCreateOperationId(
          operation.module,
          operation.localId,
        ),
      });
      response = await apiRequest<Record<string, unknown>>(path, {
        method,
        body,
        timeoutMs: 15_000,
      });
    }
    if (response.success) {
      let serverId = record.serverId;
      if (
        operationKind === "CREATE" ||
        isIncidentUpdate
      ) {
        const id = response.data[config.idField];
        if (typeof id !== "string" || !id) {
          const error = operation.module === "INCIDENT_REPORT"
            ? "Server confirmed the save without returning the incident ID; local data was retained."
            : "Server confirmed the save without returning a report ID; local data was retained.";
          await markOperation(operation.ownerId, operation.module, {
            ...operation,
            status: "FAILED",
            retryable: false,
            responseStatus: response.status,
            responseCode: "INVALID_RESPONSE",
            error,
          });
          return "failed";
        }
        serverId = id;
      }
      await completeOperation(operation, record, serverId);
      return "ok";
    }
    if (alreadyDeleted) {
      await completeOperation(operation, record, record.serverId);
      return "ok";
    }
    const message = response.message || "The server did not accept the field form operation.";
    if (response.status === 401 || response.status === 403 || response.code === "AUTH_REQUIRED" || response.code === "FORBIDDEN") {
      await markOperation(operation.ownerId, operation.module, {
        ...operation,
        status: "AUTH_REQUIRED",
        retryable: false,
        responseStatus: response.status,
        responseCode: response.code,
        error: message,
      });
      if (operation.kind === "EVIDENCE_UPLOAD" && operation.module === "PATROL_REPORT" &&
        operation.file?.wildlifeSightingId && operation.file.wildlifePhotoId) {
        record = await updateStoredRecord(
          operation.ownerId,
          operation.module,
          operation.localId,
          (current) => updateWildlifePhotoUpload(
            current ?? record,
            operation.file!.wildlifeSightingId!,
            operation.file!.wildlifePhotoId!,
            "FAILED",
            message,
          ),
        );
      }
      if (operation.module !== "PATROL_REPORT" ||
        (operation.kind !== "EVIDENCE_UPLOAD" && operation.kind !== "EVIDENCE_IDENTIFY" && operation.kind !== "EVIDENCE_DELETE")) {
        await saveRecord({ ...record, syncError: message });
      }
      notifyOfflineQueueChanged();
      return "auth";
    }
    const retryable = response.code === "NETWORK" || response.code === "TIMEOUT" ||
      response.code === "SERVER_ERROR" || (response.status !== undefined && response.status >= 500);
    if (!retryable || attempt === MAX_RETRIES) {
      if (operation.kind === "EVIDENCE_UPLOAD" && operation.module === "PATROL_REPORT" &&
        operation.file?.wildlifeSightingId && operation.file.wildlifePhotoId) {
        record = await updateStoredRecord(
          operation.ownerId,
          operation.module,
          operation.localId,
          (current) => updateWildlifePhotoUpload(
            current ?? record,
            operation.file!.wildlifeSightingId!,
            operation.file!.wildlifePhotoId!,
            "FAILED",
            message,
          ),
        );
      }
      if (operation.kind === "EVIDENCE_IDENTIFY") {
        const sightingId = operation.payload?.wildlifeSightingId;
        const photoId = operation.payload?.wildlifePhotoId;
        if (typeof sightingId === "string" && typeof photoId === "string") {
          record = await updateStoredRecord(
            operation.ownerId,
            operation.module,
            operation.localId,
            (current) => updateWildlifePhotoIdentification(current ?? record, sightingId, photoId, {
              status: "FAILED",
              common_name: null,
              scientific_name: null,
              confidence: null,
              error: message,
            }),
          );
        }
      }
      await markOperation(operation.ownerId, operation.module, {
        ...operation,
        status: "FAILED",
        attempts: attempt,
        retryable,
        responseStatus: response.status,
        responseCode: response.code,
        error: message,
      });
      if (operation.module !== "PATROL_REPORT" ||
        (operation.kind !== "EVIDENCE_UPLOAD" && operation.kind !== "EVIDENCE_IDENTIFY" && operation.kind !== "EVIDENCE_DELETE")) {
        await saveRecord({ ...record, syncError: message });
      }
      notifyOfflineQueueChanged();
      return "failed";
    }
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(1_000 * 2 ** attempt, 16_000)));
    if (!(await checkDiaryBackendReachable())) continue;
    record = (await getOfflineFormRecord(operation.ownerId, operation.module, operation.localId)) ?? record;
  }
  return "failed";
}

export async function syncOfflineFieldFormQueue(
  ownerId: string,
  module: OfflineFieldModule,
): Promise<"synced" | "offline" | "auth_required" | "failed" | "busy"> {
  if (typeof window === "undefined" || !navigator.onLine || !(await checkDiaryBackendReachable())) return "offline";
  const activeUser = getStoredUser();
  if (activeUser?.role !== "FIELD_OFFICER" || activeUser.id !== ownerId) return "auth_required";
  let token = await acquireLock(ownerId, module);
  if (!token) return "busy";
  try {
    await reconcileDeletedWildlifeUploads(ownerId, module);
    if (module === "PATROL_REPORT") await repairFailedWildlifeUploadMetadata(ownerId);
    const processedOperationIds = new Set<string>();
    const deferredOperationIds = new Set<string>();
    let failedOperationFound = false;
    let authRequiredOperationFound = false;
    while (true) {
      const operation = await withStores([OPERATIONS], "readonly", async ({ [OPERATIONS]: store }) => {
        const all = await requestValue(store.getAll()) as Operation[];
        const owned = all.filter((item) => item?.ownerId === ownerId && item.module === module);
        failedOperationFound ||= owned.some((item) => item.status === "FAILED");
        authRequiredOperationFound ||= owned.some((item) => item.status === "AUTH_REQUIRED");
        if (owned.some((item) =>
          item.status !== "CANCELLED" &&
          (
            !item.id || !item.localId ||
            !["CREATE", "UPDATE", "SUBMIT", "EVIDENCE_UPLOAD", "EVIDENCE_IDENTIFY", "EVIDENCE_DELETE"].includes(item.kind) ||
            !Number.isFinite(item.createdAt) || !Number.isFinite(item.revision) ||
            !["PENDING", "SYNCING", "FAILED", "AUTH_REQUIRED"].includes(item.status)
          )
        )) throw new Error("A queued field operation is malformed and has been retained.");
        const savePriority = (candidate: Operation) =>
          candidate.module === "PATROL_REPORT" &&
          (candidate.kind === "CREATE" || candidate.kind === "UPDATE")
            ? 0
            : 1;
        const selectable = owned
          .filter((candidate) =>
            !processedOperationIds.has(candidate.id) &&
            !deferredOperationIds.has(candidate.id) &&
            candidate.status !== "CANCELLED" &&
            candidate.status !== "FAILED" &&
            candidate.status !== "AUTH_REQUIRED",
          );
        return selectable
          .sort((a, b) =>
            savePriority(a) - savePriority(b) || a.createdAt - b.createdAt,
          )[0] ?? null;
      });
      if (!operation) {
        const wakeRequested = await releaseLock(ownerId, module, token, true);
        token = null;
        if (wakeRequested) {
          processedOperationIds.clear();
          deferredOperationIds.clear();
          token = await acquireLock(ownerId, module);
          if (!token) return "busy";
          continue;
        }
        if (deferredOperationIds.size) {
          notifyOfflineQueueChanged();
          return failedOperationFound ? "failed" : "busy";
        }
        break;
      }
      const result = await syncOne(operation);
      if (result === "auth") return "auth_required";
      if (result === "failed") {
        failedOperationFound = true;
        processedOperationIds.add(operation.id);
        continue;
      }
      if (result === "deferred") {
        deferredOperationIds.add(operation.id);
        continue;
      }
      processedOperationIds.add(operation.id);
      deferredOperationIds.clear();
    }
    notifyOfflineQueueChanged();
    if (authRequiredOperationFound) return "auth_required";
    return failedOperationFound ? "failed" : "synced";
  } finally {
    if (token && await releaseLock(ownerId, module, token, true)) {
      notifyOfflineQueueChanged();
    }
  }
}

async function retryFailed(ownerId: string, module: OfflineFieldModule): Promise<void> {
  await withStores([OPERATIONS], "readwrite", async ({ [OPERATIONS]: store }) => {
    const all = await requestValue(store.getAll()) as Operation[];
    for (const item of all) {
      if (item?.ownerId === ownerId && item.module === module &&
        (item.status === "FAILED" || item.status === "AUTH_REQUIRED")) {
        await requestValue(store.put({
          ...item,
          status: "PENDING",
          attempts: 0,
          error: null,
          responseStatus: undefined,
          responseCode: undefined,
        }));
      }
    }
  });
}

async function retryTransientPatrolWildlifeOperations(ownerId: string): Promise<void> {
  await withStores([OPERATIONS], "readwrite", async ({ [OPERATIONS]: store }) => {
    const all = await requestValue(store.getAll()) as Operation[];
    for (const item of all) {
      if (item?.ownerId === ownerId && item.module === "PATROL_REPORT" &&
        (item.kind === "EVIDENCE_UPLOAD" || item.kind === "EVIDENCE_IDENTIFY") &&
        item.status === "FAILED" && item.retryable) {
        await requestValue(store.put({
          ...item,
          status: "PENDING",
          attempts: 0,
          error: null,
          retryable: undefined,
          responseStatus: undefined,
          responseCode: undefined,
        }));
      }
    }
  });
}

export function useOfflineFieldForm(module: OfflineFieldModule) {
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [state, setState] = useState<FieldSyncState>("Offline");
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const pendingWakeRef = useRef(false);
  const authBlockedRef = useRef(false);
  const stateRef = useRef<FieldSyncState>("Offline");
  const updateState = useCallback((next: FieldSyncState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const updateOwner = () => {
      const user = getStoredUser();
      setOwnerId(user?.role === "FIELD_OFFICER" ? user.id : null);
    };
    updateOwner();
    window.addEventListener("storage", updateOwner);
    window.addEventListener("up-forest-auth-expired", updateOwner);
    return () => {
      window.removeEventListener("storage", updateOwner);
      window.removeEventListener("up-forest-auth-expired", updateOwner);
    };
  }, []);

  const refreshCount = useCallback(async () => {
    if (!ownerId) { setPendingCount(0); updateState("Offline"); return; }
    try {
      const count = await getPendingFieldOperationCount(ownerId, module);
      setPendingCount(count);
      if (count && !syncingRef.current && stateRef.current !== "Sync Failed") updateState("Pending Sync");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read the offline form queue.");
      updateState("Sync Failed");
    }
  }, [module, ownerId, updateState]);

  const syncNow = useCallback(async (manual = false) => {
    if (!ownerId || (!manual && authBlockedRef.current)) return;
    if (syncingRef.current) {
      pendingWakeRef.current = true;
      return;
    }
    syncingRef.current = true;
    setSyncing(true);
    updateState("Syncing");
    setMessage(null);
    try {
      if (manual) { authBlockedRef.current = false; await retryFailed(ownerId, module); }
      const result = await syncOfflineFieldFormQueue(ownerId, module);
      if (result === "auth_required") {
        authBlockedRef.current = true;
        updateState("Sync Failed");
        setMessage(
          await getOfflineFieldQueueFailureMessage(ownerId, module) ??
          "Sign in again to sync this form. The saved local data is retained.",
        );
      } else if (result === "failed") {
        updateState("Sync Failed");
        setMessage(
          await getOfflineFieldQueueFailureMessage(ownerId, module) ??
          "A field form could not be synchronized. Review the saved operation error before retrying.",
        );
      } else if (result === "offline") updateState("Offline");
      else if (result === "busy") updateState("Pending Sync");
      else updateState("Synced");
    } catch (error) {
      updateState("Sync Failed");
      setMessage(error instanceof Error ? error.message : "Unable to synchronize this field form.");
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshCount();
      if (pendingWakeRef.current) {
        pendingWakeRef.current = false;
        window.setTimeout(() => {
          window.dispatchEvent(new Event("up-forest-offline-queue-changed"));
        }, 0);
      }
    }
  }, [module, ownerId, refreshCount, updateState]);

  useEffect(() => {
    if (!ownerId) return;
    authBlockedRef.current = false;
    void refreshCount();
    const reconnect = async () => {
      let count = await getPendingFieldOperationCount(ownerId, module);
      setPendingCount(count);
      if (!navigator.onLine || !(await checkDiaryBackendReachable())) {
        updateState("Offline");
        return;
      }
      if (module === "PATROL_REPORT") await retryTransientPatrolWildlifeOperations(ownerId);
      count = await getPendingFieldOperationCount(ownerId, module);
      setPendingCount(count);
      if (!count) {
        setMessage(null);
        updateState("Online");
        return;
      }
      if (!authBlockedRef.current) { updateState("Pending Sync"); void syncNow(); }
      else updateState("Sync Failed");
    };
    const onQueueChanged = () => {
      if (module === "PATROL_REPORT") void reconnect();
      else void refreshCount();
    };
    const onOffline = () => updateState("Offline");
    const onVisibility = () => { if (document.visibilityState === "visible") void reconnect(); };
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("up-forest-field-offline") : null;
    window.addEventListener("online", reconnect);
    window.addEventListener("offline", onOffline);
    window.addEventListener("up-forest-offline-queue-changed", onQueueChanged);
    document.addEventListener("visibilitychange", onVisibility);
    if (channel) channel.onmessage = () => void reconnect();
    const interval = window.setInterval(reconnect, 30_000);
    void reconnect();
    return () => {
      window.removeEventListener("online", reconnect);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("up-forest-offline-queue-changed", onQueueChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
      channel?.close();
    };
  }, [module, ownerId, refreshCount, syncNow, updateState]);

  return { ownerId, state, pendingCount, message, syncing, syncNow, refreshCount };
}
