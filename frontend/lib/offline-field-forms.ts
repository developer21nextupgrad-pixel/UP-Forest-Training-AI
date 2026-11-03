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
  };
  evidenceId?: string;
  retryable?: boolean;
  createdAt: number;
  revision: number;
  attempts: number;
  status: "PENDING" | "SYNCING" | "FAILED" | "AUTH_REQUIRED";
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
  const record = await getOfflineFormRecord(ownerId, module, localId);
  if (!record) return;
  await saveRecord({
    ...record,
    status: "SUBMITTED",
    syncError: null,
    updatedAt: new Date().toISOString(),
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
  const operationId = kind === "CREATE"
    ? fieldCreateOperationId(module, record.localId)
    : `${kind.toLowerCase()}:${module.toLowerCase()}:${record.localId}`;
  await withStores([RECORDS, OPERATIONS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
    const recordStore = stores[RECORDS];
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
          ...record.payload,
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
    await requestValue(recordStore.put({ ...record, ownerId, module, syncError: null }));
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
  if (moduleName !== "OFFENCE_SEIZURE" &&
    (moduleName !== "PATROL_REPORT" || !wildlife?.sightingId || !wildlife.photoId)) {
    throw new Error("Wildlife evidence uploads require a Patrol Report sighting and photo ID.");
  }
  await withStores([RECORDS, OPERATIONS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
    const all = await requestValue(operationStore.getAll()) as Operation[];
    const operationId = `evidence:${record.localId}:${clientOperationId}`;
    const existing = await requestValue(operationStore.get([ownerId, moduleName, operationId])) as Operation | undefined;
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
      if (existing.status === "FAILED" || existing.status === "AUTH_REQUIRED") {
        await requestValue(operationStore.put({
          ...existing,
          file: {
            blob: file,
            fileName: file.name,
            mimeType: file.type,
            description,
            ...(wildlife ? {
              wildlifeSightingId: wildlife.sightingId,
              wildlifePhotoId: wildlife.photoId,
              clientOperationId,
            } : {}),
          },
          revision: existing.revision + 1,
          attempts: 0,
          status: "PENDING",
          error: null,
        } satisfies Operation));
      }
      await requestValue(stores[RECORDS].put({
        ...record,
        ownerId,
        module: moduleName,
        payload: moduleName === "PATROL_REPORT" && wildlife
          ? updateWildlifePhotoUpload(record, wildlife.sightingId, wildlife.photoId, "PENDING", null).payload
          : record.payload,
      }));
      return;
    }
    const createdAt = Math.max(
      Date.now(),
      ...      all.filter((item) => item?.ownerId === ownerId && item.module === moduleName)
        .map((item) => item.createdAt + 1),
    );
    await requestValue(operationStore.put({
      ownerId,
      module: moduleName,
      id: operationId,
      localId: record.localId,
      kind: "EVIDENCE_UPLOAD",
      file: {
        blob: file,
        fileName: file.name,
        mimeType: file.type,
        description,
        ...(wildlife ? {
          wildlifeSightingId: wildlife.sightingId,
          wildlifePhotoId: wildlife.photoId,
          clientOperationId,
        } : {}),
      },
      createdAt,
      revision: 1,
      attempts: 0,
      status: "PENDING",
      error: null,
    } satisfies Operation));
    await requestValue(stores[RECORDS].put({
      ...record,
      ownerId,
      module: moduleName,
      syncError: null,
      payload: moduleName === "PATROL_REPORT" && wildlife
        ? updateWildlifePhotoUpload(record, wildlife.sightingId, wildlife.photoId, "PENDING", null).payload
        : record.payload,
    }));
  });
  notifyOfflineQueueChanged();
}

export async function enqueueOfflineWildlifeIdentification(
  ownerId: string,
  record: OfflineFieldRecord,
  evidenceId: string,
  sightingId: string,
  photoId: string,
): Promise<Operation> {
  if (record.module !== "PATROL_REPORT" || !record.serverId || !evidenceId || !sightingId || !photoId) {
    throw new Error("Wildlife identification requires a saved Patrol Report and uploaded photo.");
  }
  const operationId = `wildlife-identify:${record.localId}:${photoId}`;
  const operation = await withStores([RECORDS, OPERATIONS, LOCKS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
    const existing = await requestValue(operationStore.get([ownerId, record.module, operationId])) as Operation | undefined;
    let queuedOperation: Operation;
    if (existing) {
      if (existing.status === "FAILED" || existing.status === "AUTH_REQUIRED") {
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
      await requestValue(stores[RECORDS].put({ ...record, ownerId, syncError: null }));
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
      await requestValue(stores[RECORDS].put({ ...record, ownerId, syncError: null }));
      queuedOperation = created;
    }
    const key = `field-sync:${ownerId}:${record.module}`;
    const lock = await requestValue(stores[LOCKS].get(key)) as
      { token: string; expiresAt: number; wakeRequested?: boolean } | undefined;
    if (lock && lock.expiresAt > Date.now()) {
      await requestValue(stores[LOCKS].put({ ...lock, wakeRequested: true }));
    }
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
      throw new Error("This wildlife photo is currently syncing. Wait for sync to finish before removing it.");
    }
    if (operation) await requestValue(store.delete([ownerId, module, operationId]));
  });
  notifyOfflineQueueChanged();
}

export async function enqueueOfflineEvidenceDelete(
  ownerId: string,
  record: OfflineFieldRecord,
  evidenceId: string,
): Promise<void> {
  const moduleName = record.module;
  const operationId = `evidence-delete:${record.localId}:${evidenceId}`;
  await withStores([RECORDS, OPERATIONS], "readwrite", async (stores) => {
    const operationStore = stores[OPERATIONS];
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
    await requestValue(stores[RECORDS].put({ ...record, ownerId, module: moduleName, syncError: null }));
  });
  notifyOfflineQueueChanged();
}

export async function getPendingFieldOperationCount(ownerId: string, module: OfflineFieldModule): Promise<number> {
  return withStores([OPERATIONS], "readonly", async ({ [OPERATIONS]: store }) => {
    const all = await requestValue(store.getAll()) as Operation[];
    const owned = all.filter((item) => item?.ownerId === ownerId && item.module === module);
    if (owned.some((item) => !item.id || !item.localId || !Number.isFinite(item.createdAt))) {
      throw new Error("A queued field operation is malformed and has been retained.");
    }
    return owned.length;
  });
}

async function markOperation(ownerId: string, module: OfflineFieldModule, operation: Operation): Promise<void> {
  await withStores([OPERATIONS], "readwrite", async ({ [OPERATIONS]: store }) => {
    await requestValue(store.put(operation));
  });
}

async function saveRecord(record: OfflineFieldRecord): Promise<void> {
  await withStores([RECORDS], "readwrite", async ({ [RECORDS]: store }) => {
    await requestValue(store.put(record));
  });
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
    const key: IDBValidKey = [operation.ownerId, operation.module, operation.id];
    const current = await requestValue(operationStore.get(key)) as Operation | undefined;
    if (current?.revision !== operation.revision) {
      if (current) await requestValue(operationStore.put({ ...current, status: "PENDING", attempts: 0, error: null }));
      return;
    }
    await requestValue(operationStore.delete(key));
    const status = operation.kind === "SUBMIT" || record.status === "SUBMITTED"
      ? "SUBMITTED"
      : record.status === "PENDING_SUBMISSION"
        ? "PENDING_SUBMISSION"
        : "DRAFT";
    await requestValue(stores[RECORDS].put({
      ...record,
      serverId: serverId ?? record.serverId,
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
  let record = await getOfflineFormRecord(operation.ownerId, operation.module, operation.localId);
  if (!record) {
    await markOperation(operation.ownerId, operation.module, { ...operation, status: "FAILED", error: "The local form data is missing; the queued operation was retained." });
    return "failed";
  }
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
    });
    let requestBody: BodyInit | undefined = body;
    if (operationKind === "EVIDENCE_UPLOAD" && operation.module === "PATROL_REPORT") {
      const sightingId = operation.file?.wildlifeSightingId;
      const photoId = operation.file?.wildlifePhotoId;
      const sightings = Array.isArray(record.payload.wildlife_sightings)
        ? record.payload.wildlife_sightings as Array<Record<string, unknown>>
        : [];
      const targetSighting = sightings.find((item) => item.sighting_id === sightingId);
      const photos = Array.isArray(targetSighting?.photos)
        ? targetSighting.photos as Array<Record<string, unknown>>
        : [];
      if (
        !record.serverId ||
        typeof sightingId !== "string" ||
        typeof photoId !== "string" ||
        !photos.some((photo) => photo.photo_id === photoId)
      ) {
        const error = "The saved Patrol Report is missing the queued wildlife sighting or photo.";
        await markOperation(operation.ownerId, operation.module, {
          ...operation, status: "FAILED", retryable: false, error,
        });
        if (typeof sightingId === "string" && typeof photoId === "string") {
          await saveRecord(updateWildlifePhotoUpload(record, sightingId, photoId, "FAILED", error));
          notifyOfflineQueueChanged();
        }
        return "failed";
      }
      record = updateWildlifePhotoUpload(record, sightingId, photoId, "UPLOADING", null);
      await saveRecord(record);
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
      record = updateWildlifePhotoIdentification(record, sightingId, photoId, {
        status: "PENDING",
        common_name: null,
        scientific_name: null,
        confidence: null,
        error: null,
      });
      await saveRecord(record);
    }
    if (operationKind === "EVIDENCE_UPLOAD") {
      if (!operation.file) {
        const error = "The queued evidence file is missing; the operation was retained.";
        await markOperation(operation.ownerId, operation.module, {
          ...operation, status: "FAILED", error,
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
            ...operation, status: "FAILED", error,
          });
          notifyOfflineQueueChanged();
          return "failed";
        }
        formData.append("wildlife_sighting_id", operation.file.wildlifeSightingId);
        formData.append("wildlife_photo_id", operation.file.wildlifePhotoId);
      }
      requestBody = formData;
    }
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
          ...operation, status: "FAILED", error,
        });
        if (operation.file?.wildlifeSightingId && operation.file.wildlifePhotoId) {
          await saveRecord(updateWildlifePhotoUpload(
            record,
            operation.file.wildlifeSightingId,
            operation.file.wildlifePhotoId,
            "FAILED",
            error,
          ));
          notifyOfflineQueueChanged();
        }
        return "failed";
      }
      const sightings: Array<Record<string, unknown>> = Array.isArray(record.payload.wildlife_sightings)
        ? record.payload.wildlife_sightings as Array<Record<string, unknown>>
        : [];
      const updatedSightings = sightings.map((sighting) => {
        if (sighting.sighting_id !== operation.file?.wildlifeSightingId || !Array.isArray(sighting.photos)) return sighting;
        return {
          ...sighting,
          photos: (sighting.photos as Array<Record<string, unknown>>).map((photo) =>
            photo.photo_id === operation.file?.wildlifePhotoId
              ? { ...photo, evidence_id: evidenceId, upload_status: "UPLOADED", upload_error: null }
              : photo,
          ),
        };
      });
      record = { ...record, payload: { ...record.payload, wildlife_sightings: updatedSightings }, syncError: null };
      await saveRecord(record);
      notifyOfflineQueueChanged();
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
          error: "The identification service did not return a persisted identification result.",
        });
        return "failed";
      }
      record = updateWildlifePhotoIdentification(record, sightingId, photoId, result as Record<string, unknown>);
      await saveRecord(record);
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
            ...operation, status: "FAILED", error,
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
      await markOperation(operation.ownerId, operation.module, { ...operation, status: "AUTH_REQUIRED", retryable: false, error: message });
      if (operation.kind === "EVIDENCE_UPLOAD" && operation.module === "PATROL_REPORT" &&
        operation.file?.wildlifeSightingId && operation.file.wildlifePhotoId) {
        record = updateWildlifePhotoUpload(
          record,
          operation.file.wildlifeSightingId,
          operation.file.wildlifePhotoId,
          "FAILED",
          message,
        );
      }
      await saveRecord({ ...record, syncError: message });
      notifyOfflineQueueChanged();
      return "auth";
    }
    const retryable = response.code === "NETWORK" || response.code === "TIMEOUT" ||
      response.code === "SERVER_ERROR" || (response.status !== undefined && response.status >= 500);
    if (!retryable || attempt === MAX_RETRIES) {
      if (operation.kind === "EVIDENCE_UPLOAD" && operation.module === "PATROL_REPORT" &&
        operation.file?.wildlifeSightingId && operation.file.wildlifePhotoId) {
        record = updateWildlifePhotoUpload(
          record,
          operation.file.wildlifeSightingId,
          operation.file.wildlifePhotoId,
          "FAILED",
          message,
        );
      }
      if (operation.kind === "EVIDENCE_IDENTIFY") {
        const sightingId = operation.payload?.wildlifeSightingId;
        const photoId = operation.payload?.wildlifePhotoId;
        if (typeof sightingId === "string" && typeof photoId === "string") {
          record = updateWildlifePhotoIdentification(record, sightingId, photoId, {
            status: "FAILED",
            common_name: null,
            scientific_name: null,
            confidence: null,
            error: message,
          });
        }
      }
      await markOperation(operation.ownerId, operation.module, {
        ...operation, status: "FAILED", attempts: attempt, retryable, error: message,
      });
      await saveRecord({ ...record, syncError: message });
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
    const processedOperationIds = new Set<string>();
    const deferredOperationIds = new Set<string>();
    while (true) {
      const operation = await withStores([OPERATIONS], "readonly", async ({ [OPERATIONS]: store }) => {
        const all = await requestValue(store.getAll()) as Operation[];
        const owned = all.filter((item) => item?.ownerId === ownerId && item.module === module);
        if (owned.some((item) =>
          !item.id || !item.localId || !["CREATE", "UPDATE", "SUBMIT", "EVIDENCE_UPLOAD", "EVIDENCE_IDENTIFY", "EVIDENCE_DELETE"].includes(item.kind) ||
          !Number.isFinite(item.createdAt) || !Number.isFinite(item.revision) ||
          !["PENDING", "SYNCING", "FAILED", "AUTH_REQUIRED"].includes(item.status)
        )) throw new Error("A queued field operation is malformed and has been retained.");
        const savePriority = (candidate: Operation) =>
          candidate.module === "PATROL_REPORT" &&
          (candidate.kind === "CREATE" || candidate.kind === "UPDATE")
            ? 0
            : 1;
        const selectable = owned
          .filter((candidate) =>
            !processedOperationIds.has(candidate.id) &&
            !deferredOperationIds.has(candidate.id),
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
          return "busy";
        }
        break;
      }
      if (operation.status === "AUTH_REQUIRED" || operation.status === "FAILED") {
        if (operation.status === "AUTH_REQUIRED") return "auth_required";
        return "failed";
      }
      const result = await syncOne(operation);
      if (result === "auth") return "auth_required";
      if (result === "failed") return "failed";
      if (result === "deferred") {
        deferredOperationIds.add(operation.id);
        continue;
      }
      processedOperationIds.add(operation.id);
      deferredOperationIds.clear();
    }
    notifyOfflineQueueChanged();
    return "synced";
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
        await requestValue(store.put({ ...item, status: "PENDING", attempts: 0, error: null }));
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
        setMessage("Sign in again to sync this form. The saved local data is retained.");
      } else if (result === "failed") {
        updateState("Sync Failed");
        setMessage("A field form could not be synchronized. Correct the issue and use Sync Now to retry.");
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
      if (!navigator.onLine || !(await checkDiaryBackendReachable())) {
        updateState("Offline");
        return;
      }
      if (module === "PATROL_REPORT") await retryTransientPatrolWildlifeOperations(ownerId);
      const count = await getPendingFieldOperationCount(ownerId, module);
      setPendingCount(count);
      if (!count) { updateState("Online"); return; }
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
