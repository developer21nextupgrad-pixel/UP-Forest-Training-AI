import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";

import {
  loadOfflineSpeciesDraft,
  saveOfflineSpeciesDraft,
} from "@/lib/offline-species-draft";

const DB_NAME = "up-forest-offline-species-draft";

beforeEach(async () => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Species draft database deletion was blocked."));
  });
});

describe("Offline species identification draft", () => {
  it("restores the queued image only for the field officer who saved it", async () => {
    await saveOfflineSpeciesDraft({
      ownerId: "officer-1",
      image: new Blob(["forest image"], { type: "image/jpeg" }),
      fileName: "tree.jpg",
      mimeType: "image/jpeg",
      queued: true,
      result: null,
      forestKnowledge: [],
      updatedAt: "2026-10-26T09:00:00.000Z",
    });

    const restored = await loadOfflineSpeciesDraft("officer-1");
    expect(restored?.queued).toBe(true);
    expect(restored?.fileName).toBe("tree.jpg");
    expect(await restored?.image.text()).toBe("forest image");
    expect(await loadOfflineSpeciesDraft("officer-2")).toBeUndefined();
  });
});
