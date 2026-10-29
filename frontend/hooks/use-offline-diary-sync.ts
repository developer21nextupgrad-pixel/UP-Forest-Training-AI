"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  checkDiaryBackendReachable,
  getPendingDiaryOperationCount,
  retryFailedDiaryOperations,
  syncDiaryQueue,
} from "@/lib/offline-diary";

export type OfflineSyncState =
  | "Online"
  | "Offline"
  | "Pending Sync"
  | "Syncing"
  | "Synced"
  | "Sync Failed";

export function useOfflineDiarySync(ownerId: string | null) {
  const [state, setState] = useState<OfflineSyncState>("Offline");
  const [pendingCount, setPendingCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncingRef = useRef(false);
  const authBlockedRef = useRef(false);
  const stateRef = useRef<OfflineSyncState>("Offline");

  const updateState = useCallback((next: OfflineSyncState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const refreshCount = useCallback(async () => {
    if (!ownerId) {
      setPendingCount(0);
      updateState("Offline");
      return;
    }
    try {
      const count = await getPendingDiaryOperationCount(ownerId);
      setPendingCount(count);
      if (count > 0 && !syncingRef.current && stateRef.current !== "Sync Failed") {
        updateState("Pending Sync");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to read offline queue.");
      updateState("Sync Failed");
    }
  }, [ownerId, updateState]);

  const syncNow = useCallback(async (manual = false) => {
    if (!ownerId || syncingRef.current) return;
    if (!manual && authBlockedRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    updateState("Syncing");
    setMessage(null);
    try {
      if (manual) {
        authBlockedRef.current = false;
        await retryFailedDiaryOperations(ownerId);
      }
      const result = await syncDiaryQueue(ownerId);
      if (result === "auth_required") {
        authBlockedRef.current = true;
        updateState("Sync Failed");
        setMessage("Sign in again to sync your saved diary data. Your local data is retained.");
      } else if (result === "failed") {
        updateState("Sync Failed");
        setMessage("A diary could not be synchronized. Review its error and retry after correcting the data.");
      } else if (result === "offline") {
        updateState("Offline");
      } else if (result === "busy") {
        updateState("Pending Sync");
      } else {
        updateState("Synced");
      }
    } catch (error) {
      updateState("Sync Failed");
      setMessage(error instanceof Error ? error.message : "Unable to synchronize offline diary data.");
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      await refreshCount();
    }
  }, [ownerId, refreshCount, updateState]);

  useEffect(() => {
    if (!ownerId) return;
    authBlockedRef.current = false;
    void refreshCount();

    const updateConnectivity = async () => {
      if (!navigator.onLine || !(await checkDiaryBackendReachable())) {
        updateState("Offline");
        return;
      }
      const count = await getPendingDiaryOperationCount(ownerId);
      setPendingCount(count);
      if (!count) {
        updateState("Online");
        return;
      }
      if (authBlockedRef.current) {
        updateState("Sync Failed");
        return;
      }
      updateState("Pending Sync");
      void syncNow();
    };
    const onQueueChanged = () => void refreshCount();
    const onOffline = () => updateState("Offline");
    const onVisibility = () => {
      if (document.visibilityState === "visible") void updateConnectivity();
    };

    window.addEventListener("online", updateConnectivity);
    window.addEventListener("offline", onOffline);
    window.addEventListener("up-forest-offline-queue-changed", onQueueChanged);
    document.addEventListener("visibilitychange", onVisibility);
    const interval = window.setInterval(updateConnectivity, 30_000);
    const channel = "BroadcastChannel" in window
      ? new BroadcastChannel("up-forest-field-offline")
      : null;
    if (channel) {
      channel.onmessage = () => void updateConnectivity();
    }
    void updateConnectivity();

    return () => {
      window.removeEventListener("online", updateConnectivity);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("up-forest-offline-queue-changed", onQueueChanged);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearInterval(interval);
      channel?.close();
    };
  }, [ownerId, refreshCount, syncNow, updateState]);

  return { state, pendingCount, message, syncing, syncNow };
}
