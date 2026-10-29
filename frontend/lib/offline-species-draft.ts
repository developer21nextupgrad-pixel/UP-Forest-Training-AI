const DB_NAME = "up-forest-offline-species-draft";
const STORE = "drafts";

export type OfflineSpeciesDraft = {
  ownerId: string;
  image: Blob;
  fileName: string;
  mimeType: string;
  queued: boolean;
  result: unknown | null;
  forestKnowledge: unknown[];
  updatedAt: string;
};

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("Offline image storage is not available in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "ownerId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Unable to open offline image storage."));
  });
}

export async function saveOfflineSpeciesDraft(draft: OfflineSpeciesDraft): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put({ ...draft, updatedAt: new Date().toISOString() });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to save the local species image."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Local species image save was interrupted."));
    });
  } finally {
    db.close();
  }
}

export async function loadOfflineSpeciesDraft(ownerId: string): Promise<OfflineSpeciesDraft | undefined> {
  const db = await openDb();
  try {
    const draft = await new Promise<OfflineSpeciesDraft | undefined>((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(ownerId);
      request.onsuccess = () => resolve(request.result as OfflineSpeciesDraft | undefined);
      request.onerror = () => reject(request.error ?? new Error("Unable to restore the local species image."));
    });
    if (draft && (
      draft.ownerId !== ownerId ||
      !(draft.image instanceof Blob) ||
      typeof draft.fileName !== "string" ||
      typeof draft.mimeType !== "string" ||
      typeof draft.queued !== "boolean" ||
      !Array.isArray(draft.forestKnowledge)
    )) {
      throw new Error("The saved local species identification is malformed and has been retained.");
    }
    return draft;
  } finally {
    db.close();
  }
}

export async function clearOfflineSpeciesDraft(ownerId: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(ownerId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Unable to clear the local species image."));
    });
  } finally {
    db.close();
  }
}
