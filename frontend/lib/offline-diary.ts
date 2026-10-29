import { apiRequest, apiUrl } from "@/lib/api";
import { getStoredUser } from "@/lib/auth";

const DB_NAME = "up-forest-field-offline";
const DB_VERSION = 1;
const DIARY_STORE = "diaries";
const OPERATION_STORE = "operations";
const DRAFT_STORE = "drafts";
const LOCK_STORE = "locks";
const MAX_RETRIES = 5;
const LOCK_TTL_MS = 240_000;

export type DiaryPayload = {
  diary_date: string | null;
  subject: string | null;
  description: string | null;
  location: string | null;
  activities: string[];
  observations: string | null;
  additional_remarks: string | null;
  source_text?: string | null;
};

export type DiaryOperationKind = "CREATE" | "UPDATE" | "SUBMIT";
export type DiaryOperationStatus =
  | "PENDING"
  | "SYNCING"
  | "FAILED"
  | "AUTH_REQUIRED";

export type OfflineDiary = {
  ownerId: string;
  localId: string;
  serverId: string | null;
  payload: DiaryPayload;
  status: "DRAFT" | "PENDING_SUBMISSION";
  updatedAt: string;
  syncError: string | null;
};

type DiaryOperation = {
  ownerId: string;
  id: string;
  localId: string;
  kind: DiaryOperationKind;
  payload?: DiaryPayload & { client_operation_id?: string };
  status: DiaryOperationStatus;
  createdAt: number;
  attempts: number;
  revision: number;
  error: string | null;
};

type FormDraft = {
  ownerId: string;
  key: string;
  localId: string;
  editingId: string | null;
  form: Record<string, unknown>;
  updatedAt: string;
};

type Lock = { key: string; token: string; expiresAt: number };
type SyncResult = "synced" | "offline" | "auth_required" | "failed" | "busy";

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline storage is not available in this browser."));
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(DIARY_STORE)) {
        database.createObjectStore(DIARY_STORE, { keyPath: ["ownerId", "localId"] });
      }
      if (!database.objectStoreNames.contains(OPERATION_STORE)) {
        database.createObjectStore(OPERATION_STORE, { keyPath: ["ownerId", "id"] });
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE)) {
        database.createObjectStore(DRAFT_STORE, { keyPath: ["ownerId", "key"] });
      }
      if (!database.objectStoreNames.contains(LOCK_STORE)) {
        database.createObjectStore(LOCK_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline storage."));
    request.onblocked = () => reject(new Error("Offline storage upgrade is blocked by another tab."));
  });
}

async function withStore<T>(
  storeNames: string | string[],
  mode: IDBTransactionMode,
  work: (stores: Record<string, IDBObjectStore>, transaction: IDBTransaction) => Promise<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const transaction = database.transaction(names, mode);
    const stores = Object.fromEntries(names.map((name) => [name, transaction.objectStore(name)]));
    const complete = new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage transaction failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage transaction was interrupted."));
    });
    try {
      const result = await work(stores, transaction);
      await complete;
      return result;
    } catch (error) {
      try {
        transaction.abort();
      } catch {
        // The transaction may already have been aborted by IndexedDB.
      }
      await complete.catch(() => undefined);
      throw error;
    }
  } finally {
    database.close();
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Offline storage request failed."));
  });
}

function makeId(): string {
  return crypto.randomUUID();
}

export function notifyOfflineQueueChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("up-forest-offline-queue-changed"));
    if ("BroadcastChannel" in window) {
      const channel = new BroadcastChannel("up-forest-field-offline");
      channel.postMessage({ type: "queue-changed" });
      channel.close();
    }
  }
}

export async function saveDiaryFormDraft(
  ownerId: string,
  draft: Omit<FormDraft, "ownerId" | "updatedAt">,
): Promise<void> {
  const value: FormDraft = { ...draft, ownerId, updatedAt: new Date().toISOString() };
  await withStore(DRAFT_STORE, "readwrite", async ({ [DRAFT_STORE]: store }) => {
    await requestResult(store.put(value));
  });
}

export async function loadDiaryFormDraft(ownerId: string, key: string): Promise<FormDraft | undefined> {
  const draft = await withStore(DRAFT_STORE, "readonly", async ({ [DRAFT_STORE]: store }) =>
    requestResult(store.get([ownerId, key])),
  ) as FormDraft | undefined;
  if (draft && (
    draft.ownerId !== ownerId ||
    typeof draft.localId !== "string" ||
    typeof draft.form !== "object" ||
    draft.form === null ||
    (draft.editingId !== null && typeof draft.editingId !== "string")
  )) {
    throw new Error("The saved local diary draft is malformed and has been retained for recovery.");
  }
  return draft;
}

export async function clearDiaryFormDraft(ownerId: string, key: string): Promise<void> {
  await withStore(DRAFT_STORE, "readwrite", async ({ [DRAFT_STORE]: store }) => {
    await requestResult(store.delete([ownerId, key]));
  });
}

export async function saveOfflineDiary(diary: OfflineDiary): Promise<void> {
  await withStore(DIARY_STORE, "readwrite", async ({ [DIARY_STORE]: store }) => {
    await requestResult(store.put(diary));
  });
  notifyOfflineQueueChanged();
}

export async function getOfflineDiaries(ownerId: string): Promise<OfflineDiary[]> {
  return withStore(DIARY_STORE, "readonly", async ({ [DIARY_STORE]: store }) => {
    const diaries = (await requestResult(store.getAll())) as OfflineDiary[];
    const owned = diaries.filter((diary) => diary?.ownerId === ownerId);
    for (const diary of owned) {
      if (
        typeof diary.localId !== "string" ||
        !diary.payload ||
        !Array.isArray(diary.payload.activities) ||
        !["DRAFT", "PENDING_SUBMISSION"].includes(diary.status)
      ) {
        throw new Error("A saved offline diary is malformed and has been retained for recovery.");
      }
    }
    return owned;
  });
}

export async function enqueueDiaryOperation(
  ownerId: string,
  diary: OfflineDiary,
  kind: DiaryOperationKind,
): Promise<void> {
  const id = kind === "CREATE"
    ? `create:${diary.localId}`
    : kind === "UPDATE"
      ? `update:${diary.localId}`
      : makeId();

  await withStore([DIARY_STORE, OPERATION_STORE], "readwrite", async (stores) => {
    const diaryStore = stores[DIARY_STORE];
    const operationStore = stores[OPERATION_STORE];
    const key: IDBValidKey = [ownerId, id];
    const previous = (await requestResult(operationStore.get(key))) as DiaryOperation | undefined;
    const ownerOperations = (await requestResult(operationStore.getAll())) as DiaryOperation[];
    if (ownerOperations.some((operation) => operation?.ownerId === ownerId && !Number.isFinite(operation.createdAt))) {
      throw new Error("An offline sync operation is malformed and has been retained for recovery.");
    }
    const nextCreatedAt = Math.max(
      Date.now(),
      ...ownerOperations
        .filter((operation) => operation?.ownerId === ownerId)
        .map((operation) => operation.createdAt + 1),
    );
    const operation: DiaryOperation = {
      ownerId,
      id,
      localId: diary.localId,
      kind,
      payload: kind === "SUBMIT" ? undefined : {
        ...diary.payload,
        ...(kind === "CREATE" ? { client_operation_id: id } : {}),
      },
      status: "PENDING",
      createdAt: previous?.createdAt ?? nextCreatedAt,
      attempts: 0,
      revision: (previous?.revision ?? 0) + 1,
      error: null,
    };
    await requestResult(operationStore.put(operation));
    if (kind === "UPDATE") {
      for (const pending of ownerOperations) {
        if (pending?.ownerId === ownerId && pending.localId === diary.localId && pending.kind === "SUBMIT") {
          await requestResult(operationStore.put({
            ...pending,
            createdAt: Math.max(pending.createdAt, operation.createdAt + 1),
            status: "PENDING",
            error: null,
          }));
        }
      }
    }
    await requestResult(diaryStore.put({ ...diary, syncError: null }));
  });
  notifyOfflineQueueChanged();
}

export async function getPendingDiaryOperationCount(ownerId: string): Promise<number> {
  return withStore(OPERATION_STORE, "readonly", async ({ [OPERATION_STORE]: store }) => {
    const operations = (await requestResult(store.getAll())) as DiaryOperation[];
    const owned = operations.filter((operation) => operation?.ownerId === ownerId);
    if (owned.some((operation) => !operation.id || !operation.localId || !operation.kind)) {
      throw new Error("An offline sync operation is malformed and has been retained for recovery.");
    }
    return owned.length;
  });
}

export async function checkDiaryBackendReachable(): Promise<boolean> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(apiUrl("/api/v1/health"), { signal: controller.signal, cache: "no-store" });
    if (!response.ok) return false;
    const health = (await response.json()) as { status?: string; database?: string };
    return health.status === "healthy" && health.database === "ok";
  } catch {
    return false;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function acquireLock(ownerId: string): Promise<string | null> {
  const token = makeId();
  const lockKey = `diary-sync:${ownerId}`;
  return withStore(LOCK_STORE, "readwrite", async ({ [LOCK_STORE]: store }) => {
    const current = (await requestResult(store.get(lockKey))) as Lock | undefined;
    if (current && current.expiresAt > Date.now()) return null;
    await requestResult(store.put({ key: lockKey, token, expiresAt: Date.now() + LOCK_TTL_MS }));
    return token;
  });
}

async function releaseLock(ownerId: string, token: string): Promise<void> {
  await withStore(LOCK_STORE, "readwrite", async ({ [LOCK_STORE]: store }) => {
    const key = `diary-sync:${ownerId}`;
    const current = (await requestResult(store.get(key))) as Lock | undefined;
    if (current?.token === token) await requestResult(store.delete(key));
  });
}

async function listOperations(ownerId: string): Promise<DiaryOperation[]> {
  return withStore(OPERATION_STORE, "readonly", async ({ [OPERATION_STORE]: store }) => {
    const all = (await requestResult(store.getAll())) as DiaryOperation[];
    const owned = all.filter((operation) => operation?.ownerId === ownerId);
    if (owned.some((operation) =>
      !operation.id ||
      !operation.localId ||
      !["CREATE", "UPDATE", "SUBMIT"].includes(operation.kind) ||
      !Number.isFinite(operation.createdAt) ||
      !Number.isFinite(operation.attempts) ||
      !Number.isFinite(operation.revision) ||
      ((operation.kind === "CREATE" || operation.kind === "UPDATE") &&
        (!operation.payload || !Array.isArray(operation.payload.activities))) ||
      !["PENDING", "SYNCING", "FAILED", "AUTH_REQUIRED"].includes(operation.status)
    )) {
      throw new Error("An offline sync operation is malformed and has been retained for recovery.");
    }
    return owned.sort((a, b) => a.createdAt - b.createdAt);
  });
}

async function getDiary(ownerId: string, localId: string): Promise<OfflineDiary | undefined> {
  return withStore(DIARY_STORE, "readonly", async ({ [DIARY_STORE]: store }) =>
    requestResult(store.get([ownerId, localId])),
  );
}

async function updateOperation(ownerId: string, operation: DiaryOperation): Promise<void> {
  await withStore(OPERATION_STORE, "readwrite", async ({ [OPERATION_STORE]: store }) => {
    await requestResult(store.put(operation));
  });
}

async function completeOperation(ownerId: string, operation: DiaryOperation): Promise<void> {
  await withStore([DIARY_STORE, OPERATION_STORE], "readwrite", async (stores) => {
    const operationStore = stores[OPERATION_STORE];
    const diaryStore = stores[DIARY_STORE];
    const key: IDBValidKey = [ownerId, operation.id];
    const latest = (await requestResult(operationStore.get(key))) as DiaryOperation | undefined;
    if (latest?.revision !== operation.revision) {
      if (latest) await requestResult(operationStore.put({ ...latest, status: "PENDING", attempts: 0, error: null }));
      return;
    }
    await requestResult(operationStore.delete(key));
    const all = (await requestResult(operationStore.getAll())) as DiaryOperation[];
    const hasMore = all.some((item) => item.ownerId === ownerId && item.localId === operation.localId);
    if (!hasMore) await requestResult(diaryStore.delete([ownerId, operation.localId]));
  });
}

async function failDiary(ownerId: string, localId: string, message: string): Promise<void> {
  const diary = await getDiary(ownerId, localId);
  if (diary) await saveOfflineDiary({ ...diary, syncError: message });
}

async function syncOperation(ownerId: string, operation: DiaryOperation): Promise<"ok" | "auth" | "failed"> {
  const activeUser = getStoredUser();
  if (activeUser?.role !== "FIELD_OFFICER" || activeUser.id !== ownerId) {
    await updateOperation(ownerId, { ...operation, status: "AUTH_REQUIRED", error: "The signed-in field officer changed. Switch back to the original account to sync this data." });
    return "auth";
  }
  const diary = await getDiary(ownerId, operation.localId);
  if (!diary) {
    await updateOperation(ownerId, { ...operation, status: "FAILED", error: "The local diary data is missing; queued data was retained." });
    return "failed";
  }

  let path: string;
  let method: string;
  let body: string | undefined;
  if (operation.kind === "CREATE") {
    path = "/api/v1/field/forms/daily-diary";
    method = "POST";
    body = JSON.stringify(operation.payload);
  } else if (operation.kind === "UPDATE") {
    const serverId = diary.serverId;
    if (!serverId) {
      await updateOperation(ownerId, { ...operation, status: "FAILED", error: "The diary has not been created on the server yet." });
      return "failed";
    }
    path = `/api/v1/field/forms/daily-diary/${serverId}`;
    method = "PUT";
    body = JSON.stringify(operation.payload);
  } else {
    const serverId = diary.serverId;
    if (!serverId) {
      await updateOperation(ownerId, { ...operation, status: "FAILED", error: "The diary must be saved before it can be submitted." });
      return "failed";
    }
    path = `/api/v1/field/forms/daily-diary/${serverId}/submit`;
    method = "POST";
  }

  await updateOperation(ownerId, { ...operation, status: "SYNCING", error: null });
  const response = await apiRequest<{ diary_id: string; status?: string }>(path, {
    method,
    body,
    timeoutMs: 15_000,
  });
  if (response.success) {
    if (operation.kind === "CREATE") {
      const serverId = response.data.diary_id;
      await saveOfflineDiary({ ...diary, serverId, status: "DRAFT", syncError: null });
    } else if (operation.kind === "SUBMIT") {
      await saveOfflineDiary({ ...diary, status: "DRAFT", syncError: null });
    }
    await completeOperation(ownerId, operation);
    return "ok";
  }

  const status = response.status;
  const message = response.message || "The server did not accept the diary operation.";
  if (status === 401 || status === 403 || response.code === "AUTH_REQUIRED" || response.code === "FORBIDDEN") {
    await updateOperation(ownerId, { ...operation, status: "AUTH_REQUIRED", error: message });
    await failDiary(ownerId, operation.localId, message);
    return "auth";
  }

  if (status && status >= 400 && status < 500) {
    await updateOperation(ownerId, { ...operation, status: "FAILED", error: message });
    await failDiary(ownerId, operation.localId, message);
    return "failed";
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const currentUser = getStoredUser();
    if (currentUser?.role !== "FIELD_OFFICER" || currentUser.id !== ownerId) {
      await updateOperation(ownerId, { ...operation, status: "AUTH_REQUIRED", error: "The signed-in field officer changed. Switch back to the original account to sync this data." });
      return "auth";
    }
    await updateOperation(ownerId, { ...operation, status: "SYNCING", attempts: attempt, error: message });
    await new Promise((resolve) => window.setTimeout(resolve, Math.min(1_000 * 2 ** (attempt - 1), 16_000)));
    if (!(await checkDiaryBackendReachable())) continue;
    const retry = await apiRequest<{ diary_id: string; status?: string }>(path, {
      method,
      body,
      timeoutMs: 15_000,
    });
    if (retry.success) {
      if (operation.kind === "CREATE") {
        await saveOfflineDiary({ ...diary, serverId: retry.data.diary_id, status: "DRAFT", syncError: null });
      }
      await completeOperation(ownerId, operation);
      return "ok";
    }
    if (retry.status === 401 || retry.status === 403 || retry.code === "AUTH_REQUIRED" || retry.code === "FORBIDDEN") {
      await updateOperation(ownerId, { ...operation, status: "AUTH_REQUIRED", error: retry.message });
      await failDiary(ownerId, operation.localId, retry.message);
      return "auth";
    }
    if (retry.status && retry.status >= 400 && retry.status < 500) {
      await updateOperation(ownerId, { ...operation, status: "FAILED", error: retry.message });
      await failDiary(ownerId, operation.localId, retry.message);
      return "failed";
    }
  }

  await updateOperation(ownerId, { ...operation, status: "FAILED", attempts: MAX_RETRIES, error: message });
  await failDiary(ownerId, operation.localId, message);
  return "failed";
}

export async function syncDiaryQueue(ownerId: string): Promise<SyncResult> {
  if (typeof window === "undefined" || !navigator.onLine || !(await checkDiaryBackendReachable())) return "offline";
  const activeUser = getStoredUser();
  if (activeUser?.role !== "FIELD_OFFICER" || activeUser.id !== ownerId) return "auth_required";
  const token = await acquireLock(ownerId);
  if (!token) return "busy";

  try {
    const operations = await listOperations(ownerId);
    for (const operation of operations) {
      if (operation.status === "AUTH_REQUIRED") return "auth_required";
      if (operation.status === "FAILED") return "failed";
      const result = await syncOperation(ownerId, operation);
      if (result === "auth") return "auth_required";
      if (result === "failed") return "failed";
    }
    notifyOfflineQueueChanged();
    return "synced";
  } finally {
    await releaseLock(ownerId, token);
  }
}

export async function retryFailedDiaryOperations(ownerId: string): Promise<void> {
  await withStore(OPERATION_STORE, "readwrite", async ({ [OPERATION_STORE]: store }) => {
    const operations = (await requestResult(store.getAll())) as DiaryOperation[];
    for (const operation of operations) {
      if (operation?.ownerId === ownerId && (operation.status === "FAILED" || operation.status === "AUTH_REQUIRED")) {
        await requestResult(store.put({ ...operation, status: "PENDING", attempts: 0, error: null }));
      }
    }
  });
}
