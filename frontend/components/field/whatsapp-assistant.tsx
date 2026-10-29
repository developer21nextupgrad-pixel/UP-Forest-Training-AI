"use client";

import { useCallback, useEffect, useState } from "react";
import { MessageCircle, RefreshCw, Unlink } from "lucide-react";
import { apiRequest } from "@/lib/api";

type PairingStatus = {
  success: boolean;
  configured: boolean;
  business_number: string | null;
  paired: boolean;
  masked_phone_number: string | null;
  pairing_expires_at: string | null;
};

type PairingCode = {
  success: boolean;
  code: string;
  expires_at: string;
  business_number: string | null;
};

export default function WhatsAppAssistant() {
  const [pairing, setPairing] = useState<PairingStatus | null>(null);
  const [pairingCode, setPairingCode] = useState<PairingCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    setError(null);
    const response = await apiRequest<PairingStatus>("/api/v1/whatsapp/pairing");
    if (!response.success) {
      setError(response.message || "Unable to load WhatsApp pairing status.");
      return;
    }
    setPairing(response.data);
    if (response.data.paired) setPairingCode(null);
  }, []);

  useEffect(() => {
    void refreshStatus()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Unable to load WhatsApp pairing status."))
      .finally(() => setLoading(false));
  }, [refreshStatus]);

  const startPairing = async () => {
    setWorking(true);
    setError(null);
    try {
      const response = await apiRequest<PairingCode>("/api/v1/whatsapp/pairing", {
        method: "POST",
      });
      if (!response.success) {
        setError(response.message || "Unable to create a WhatsApp pairing code.");
        return;
      }
      setPairingCode(response.data);
      await refreshStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create a WhatsApp pairing code.");
    } finally {
      setWorking(false);
    }
  };

  const unlink = async () => {
    setWorking(true);
    setError(null);
    try {
      const response = await apiRequest<{ success: boolean }>("/api/v1/whatsapp/pairing", {
        method: "DELETE",
      });
      if (!response.success) {
        setError(response.message || "Unable to unlink this WhatsApp number.");
        return;
      }
      setPairingCode(null);
      await refreshStatus();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to unlink this WhatsApp number.");
    } finally {
      setWorking(false);
    }
  };

  return (
    <main className="min-h-[calc(100vh-64px)] bg-background px-4 py-8 text-foreground sm:px-6 lg:px-8">
      <section className="mx-auto max-w-3xl rounded-2xl border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200">
            <MessageCircle className="size-6" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">WhatsApp Assistant</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Pair a WhatsApp number with your Field Officer account to ask questions answered from the field knowledge documents.
            </p>
          </div>
        </div>

        {loading ? (
          <p role="status" className="mt-8 text-sm text-muted-foreground">Loading WhatsApp setup…</p>
        ) : !pairing?.configured ? (
          <div className="mt-8 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            WhatsApp messaging is not configured by the administrator. Pairing and messaging are unavailable until Meta WhatsApp Cloud API settings are configured.
          </div>
        ) : (
          <div className="mt-8 space-y-5">
            {pairing.paired ? (
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/40">
                <div>
                  <p className="font-medium">WhatsApp number linked</p>
                  <p className="mt-1 text-sm text-muted-foreground">{pairing.masked_phone_number}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void unlink()}
                  disabled={working}
                  className="inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Unlink className="size-4" aria-hidden="true" />
                  Unlink
                </button>
              </div>
            ) : (
              <div className="space-y-4 rounded-xl border border-border p-4">
                <div>
                  <h2 className="font-medium">Link your WhatsApp number</h2>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    Create a short-lived code, then send <strong>LINK followed by the code</strong> to the official WhatsApp Business number. The number is linked only after WhatsApp confirms the message sender.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void startPairing()}
                  disabled={working}
                  className="inline-flex items-center gap-2 rounded-lg bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw className={`size-4 ${working ? "animate-spin" : ""}`} aria-hidden="true" />
                  {working ? "Working…" : "Create pairing code"}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshStatus()}
                  disabled={working}
                  className="ml-2 inline-flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Refresh pairing status
                </button>
                {pairingCode && (
                  <div role="status" className="rounded-lg bg-muted p-4">
                    <p className="text-sm font-medium">Send this message in WhatsApp:</p>
                    <p className="mt-2 font-mono text-xl font-bold tracking-wider">LINK {pairingCode.code}</p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      To: {pairingCode.business_number || "the configured official WhatsApp Business number"} · Expires {new Date(pairingCode.expires_at).toLocaleTimeString()}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && (
          <p role="alert" className="mt-5 rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
            {error}
          </p>
        )}
      </section>
    </main>
  );
}
