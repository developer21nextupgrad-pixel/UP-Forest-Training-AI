"use client";

import Image from "next/image";
import {
    AlertTriangle,
    Camera,
    CheckCircle2,
    ImagePlus,
    Loader2,
    MapPin,
    Plus,
    RefreshCw,
    RotateCcw,
    Save,
    Send,
    Trash2,
    X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { apiRequest, apiUrl } from "@/lib/api";
import { getAccessToken } from "@/lib/auth";
import {
    createFieldLocalId,
    enqueueOfflineEvidenceDelete,
    enqueueOfflineEvidenceUpload,
    enqueueOfflineWildlifeIdentification,
    enqueueOfflineFieldOperation,
    fieldCreateOperationId,
    fieldSyncableFailure,
    getOfflineFormRecord,
    loadOfflineFormDraft,
    markOfflineFieldFormSubmitted,
    persistOfflineFieldRecord,
    removeOfflineWildlifePhoto,
    removeOfflineWildlifeSighting,
    saveOfflineFormDraft,
    useOfflineFieldForm,
    type OfflineFieldRecord,
} from "@/lib/offline-field-forms";
import {
    captureWildlifeLocation,
    compressWildlifeImage,
    createWildlifePhoto,
    createWildlifeSighting,
    mergeWildlifeSightings,
    type WildlifePhoto,
    type WildlifeSighting,
} from "@/lib/patrol-wildlife";
import { OfflineFieldFormControls } from "./offline-field-form-controls";

type PatrolReportFields = {
    patrol_date: string | null;
    beat: string | null;
    range_name: string | null;
    division: string | null;

    start_time: string | null;
    end_time: string | null;

    location: string | null;
    team_members: string[];

    purpose: string | null;
    observations: string | null;
    wildlife_sighting: string | null;
    wildlife_sightings: WildlifeSighting[];
    illegal_activity: string | null;
    action_taken: string | null;
    incident_details: string | null;
    additional_remarks: string | null;
};

type PatrolReportResponse = {
    success: boolean;
    form_type: string;
    fields: PatrolReportFields;
    missing_fields: string[];
    source_text: string;
    confidence: number | null;
    message: string | null;
};

type PatrolReportSaveResponse = {
    success: boolean;
    report_id: string;
    form_type: string;
    status: string;
    message: string;
};

type PatrolReportSubmitResponse = {
    success: boolean;
    report_id: string;
    form_type: string;
    status: string;
    submitted_at: string;
    message: string;
};

type PatrolReportDraft = PatrolReportFields & {
    report_id: string;
    local_record_id?: string;
    form_type: string;
    status: string;
    source_text: string | null;
    ai_confidence: number | null;
    created_at: string | null;
    updated_at: string | null;
};

function WildlifePhotoPreview({ photo }: { photo: WildlifePhoto }) {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
        let objectUrl: string | null = null;
        let cancelled = false;
        if (photo.file) {
            objectUrl = URL.createObjectURL(photo.file);
            setSrc(objectUrl);
        } else if (photo.evidence_id) {
            const token = getAccessToken();
            void fetch(apiUrl(`/api/v1/field/evidence/${photo.evidence_id}/file`), {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            }).then(async (response) => {
                if (!response.ok) throw new Error("Unable to load the saved wildlife photo.");
                objectUrl = URL.createObjectURL(await response.blob());
                if (!cancelled) setSrc(objectUrl);
            }).catch((error: unknown) => {
                if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load the saved wildlife photo.");
            });
        }
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [photo.evidence_id, photo.file]);

    return src
        ? <Image src={src} alt={photo.file_name} width={96} height={96} unoptimized className="h-24 w-24 rounded-lg object-cover" />
        : <div className="flex h-24 w-24 items-center justify-center rounded-lg bg-muted text-xs text-muted-foreground">Preview unavailable</div>;
}

function serializableWildlifeSightings(sightings: WildlifeSighting[]) {
    return sightings.map((sighting) => ({
        ...sighting,
        photos: sighting.photos.map((photo) => {
            const metadata = { ...photo };
            delete metadata.file;
            delete metadata.upload_status;
            delete metadata.upload_error;
            return metadata;
        }),
    }));
}

type Props = {
    onClose?: () => void;
    initialDraft?: PatrolReportDraft | null;
    initialLocalId?: string;
    startBlank?: boolean;
    onSaved?: () => void;
};

const EMPTY_FIELDS: PatrolReportFields = {
    patrol_date: null,
    beat: null,
    range_name: null,
    division: null,

    start_time: null,
    end_time: null,

    location: null,
    team_members: [],

    purpose: null,
    observations: null,
    wildlife_sighting: null,
    wildlife_sightings: [],
    illegal_activity: null,
    action_taken: null,
    incident_details: null,
    additional_remarks: null,
};

const FIELD_LABELS: Record<string, string> = {
    patrol_date: "Patrol Date",
    beat: "Beat",
    range_name: "Range",
    division: "Division",
    start_time: "Start Time",
    end_time: "End Time",
    location: "Location",
    purpose: "Purpose",
    observations: "Observations",
    wildlife_sighting: "Wildlife Sighting",
    illegal_activity: "Illegal Activity",
    action_taken: "Action Taken",
    incident_details: "Incident Details",
    additional_remarks: "Additional Remarks",
};

const REQUIRED_SUBMIT_FIELDS = [
    "patrol_date",
    "beat",
    "start_time",
    "end_time",
    "location",
    "purpose",
] as const;

export function PatrolReportForm({
    onClose,
    initialDraft,
    initialLocalId,
    startBlank = false,
    onSaved,
}: Props) {
    const offline = useOfflineFieldForm("PATROL_REPORT");
    const localId = useRef(initialLocalId ?? initialDraft?.report_id ?? createFieldLocalId());
    const reportSaveRequested = useRef(Boolean(initialDraft || initialLocalId));
    const previousOwnerId = useRef<string | null>(null);
    const [description, setDescription] = useState("");

    const [fields, setFields] =
        useState<PatrolReportFields>(EMPTY_FIELDS);
    const fieldsRef = useRef(fields);
    fieldsRef.current = fields;
    const localPersistChain = useRef<Promise<void>>(Promise.resolve());

    const [photoTarget, setPhotoTarget] = useState<{ sightingId: string; photoId?: string } | null>(null);
    const cameraInputRef = useRef<HTMLInputElement>(null);
    const galleryInputRef = useRef<HTMLInputElement>(null);

    const [missingFields, setMissingFields] = useState<string[]>([]);

    const [confidence, setConfidence] =
        useState<number | null>(null);

    const [isExtracting, setIsExtracting] = useState(false);
    const [isExtracted, setIsExtracted] = useState(false);

    const [isSaving, setIsSaving] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const [savedReportId, setSavedReportId] =
        useState<string | null>(null);

    const [reportId, setReportId] =
        useState<string | null>(null);

    const [isSubmitted, setIsSubmitted] = useState(false);
    const [queuedCreate, setQueuedCreate] = useState(false);
    const [offlineDraftRestored, setOfflineDraftRestored] = useState(false);

    useEffect(() => {
        if (!localId.current) localId.current = initialLocalId ?? initialDraft?.report_id ?? createFieldLocalId();
    }, [initialDraft, initialLocalId]);

    useEffect(() => {
        if (previousOwnerId.current !== offline.ownerId) {
            const hadPreviousOwner = previousOwnerId.current !== null;
            previousOwnerId.current = offline.ownerId;
            if (!initialDraft || hadPreviousOwner) {
                setFields(EMPTY_FIELDS);
                setDescription("");
                setConfidence(null);
                setIsExtracted(false);
                setReportId(null);
                setSavedReportId(null);
                setQueuedCreate(false);
                setIsSubmitted(false);
                localId.current = offline.ownerId ? createFieldLocalId() : "";
            }
        }
        setOfflineDraftRestored(false);
        if (!offline.ownerId) return;
        if (startBlank) {
            setOfflineDraftRestored(true);
            return;
        }
        let cancelled = false;
        const selectedLocalId = initialLocalId ?? initialDraft?.report_id;
        const selectedDraftKey = selectedLocalId ? `patrol:${selectedLocalId}` : "active";
        void loadOfflineFormDraft<Record<string, unknown>>(
            offline.ownerId,
            "PATROL_REPORT",
            selectedDraftKey,
        )
            .then(async (draft) => {
                if (draft || selectedDraftKey === "active") return draft;
                const active = await loadOfflineFormDraft<Record<string, unknown>>(
                    offline.ownerId!,
                    "PATROL_REPORT",
                    "active",
                );
                return active?.snapshot.localId === selectedLocalId ? active : undefined;
            })
            .then(async (draft) => {
                if (cancelled || !draft) return;
                const snapshot = draft.snapshot;
                let matchingRecord: OfflineFieldRecord | undefined;
                if (typeof snapshot.localId === "string") {
                    matchingRecord = await getOfflineFormRecord(
                        offline.ownerId!,
                        "PATROL_REPORT",
                        snapshot.localId,
                    );
                }
                if (
                    selectedLocalId &&
                    typeof snapshot.localId === "string" &&
                    snapshot.localId !== selectedLocalId
                ) return;
                if (initialDraft &&
                    !selectedLocalId &&
                    matchingRecord?.serverId !== initialDraft.report_id &&
                    snapshot.reportId !== initialDraft.report_id &&
                    snapshot.savedReportId !== initialDraft.report_id) {
                    return;
                }
                if (typeof snapshot.localId === "string") localId.current = snapshot.localId;
                if (snapshot.fields && typeof snapshot.fields === "object") {
                    const storedFields = snapshot.fields as Partial<PatrolReportFields>;
                    setFields((previous) => ({
                        ...previous,
                        ...storedFields,
                        wildlife_sightings: mergeWildlifeSightings(
                            Array.isArray(matchingRecord?.payload.wildlife_sightings)
                                ? matchingRecord.payload.wildlife_sightings as WildlifeSighting[]
                                : previous.wildlife_sightings,
                            Array.isArray(storedFields.wildlife_sightings)
                                ? storedFields.wildlife_sightings
                                : [],
                            new Set(matchingRecord?.deletedWildlifePhotoIds ?? []),
                            new Set(matchingRecord?.deletedWildlifeSightingIds ?? []),
                        ),
                    }));
                }
                if (typeof snapshot.description === "string") setDescription(snapshot.description);
                if (typeof snapshot.confidence === "number" || snapshot.confidence === null) setConfidence(snapshot.confidence as number | null);
                setIsExtracted(snapshot.isExtracted === true);
                if (!initialDraft && typeof snapshot.reportId === "string") setReportId(snapshot.reportId);
                if (!initialDraft && typeof snapshot.savedReportId === "string") setSavedReportId(snapshot.savedReportId);
                if ((!initialDraft || selectedLocalId) && snapshot.queuedCreate === true) setQueuedCreate(true);
                toast.info("Restored your locally saved patrol report draft.");
            })
            .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to restore the local patrol draft."))
            .finally(() => { if (!cancelled) setOfflineDraftRestored(true); });
        return () => { cancelled = true; };
    }, [initialDraft, initialLocalId, offline.ownerId, startBlank]);

    useEffect(() => {
        if (!offline.ownerId || !offlineDraftRestored || !localId.current || isSubmitted) return;
        const snapshot = {
            localId: localId.current,
            fields: fields as unknown as Record<string, unknown>,
            description,
            confidence,
            isExtracted,
            reportId,
            savedReportId,
            queuedCreate,
        };
        void Promise.all([
            saveOfflineFormDraft(offline.ownerId, "PATROL_REPORT", "active", snapshot),
            saveOfflineFormDraft(offline.ownerId, "PATROL_REPORT", `patrol:${localId.current}`, snapshot),
        ]).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to save the local patrol draft."));
    }, [confidence, description, fields, isExtracted, isSubmitted, offline.ownerId, offlineDraftRestored, queuedCreate, reportId, savedReportId]);

    useEffect(() => {
        if (!offline.ownerId || !localId.current) return;
        const refreshRecord = () => {
            void getOfflineFormRecord(offline.ownerId!, "PATROL_REPORT", localId.current)
                .then((record) => {
                    if (!record) return;
                    if (record.serverId) {
                        setReportId(record.serverId);
                        setSavedReportId(record.serverId);
                        setQueuedCreate(false);
                    }
                    if (Array.isArray(record.payload.wildlife_sightings)) {
                        setFields((previous) => ({
                            ...previous,
                            wildlife_sightings: mergeWildlifeSightings(
                                previous.wildlife_sightings,
                                record.payload.wildlife_sightings as WildlifeSighting[],
                                new Set(record.deletedWildlifePhotoIds ?? []),
                                new Set(record.deletedWildlifeSightingIds ?? []),
                            ),
                        }));
                    }
                    if (record.status === "SUBMITTED") setIsSubmitted(true);
                })
                .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Unable to refresh patrol sync status."));
        };
        window.addEventListener("up-forest-offline-queue-changed", refreshRecord);
        return () => window.removeEventListener("up-forest-offline-queue-changed", refreshRecord);
    }, [offline.ownerId]);

    /**
     * Load an existing saved draft into the form.
     */
    useEffect(() => {
        if (!initialDraft) {
            return;
        }

        setDescription(initialDraft.source_text ?? "");

        setFields({
            patrol_date: initialDraft.patrol_date,
            beat: initialDraft.beat,
            range_name: initialDraft.range_name,
            division: initialDraft.division,

            start_time: initialDraft.start_time,
            end_time: initialDraft.end_time,

            location: initialDraft.location,
            team_members: initialDraft.team_members ?? [],

            purpose: initialDraft.purpose,
            observations: initialDraft.observations,
            wildlife_sighting: initialDraft.wildlife_sighting,
            wildlife_sightings: initialDraft.wildlife_sightings ?? [],
            illegal_activity: initialDraft.illegal_activity,
            action_taken: initialDraft.action_taken,
            incident_details: initialDraft.incident_details,
            additional_remarks: initialDraft.additional_remarks,
        });

        setMissingFields([]);
        setConfidence(initialDraft.ai_confidence);

        const isLocalOnlyDraft = initialLocalId === initialDraft.report_id;
        setReportId(isLocalOnlyDraft ? null : initialDraft.report_id);
        setSavedReportId(isLocalOnlyDraft ? null : initialDraft.report_id);
        localId.current = initialLocalId ?? initialDraft.report_id;

        setIsExtracted(true);
        setIsSubmitted(initialDraft.status === "SUBMITTED");
    }, [initialDraft, initialLocalId]);

    const updateField = <K extends keyof PatrolReportFields>(
        key: K,
        value: PatrolReportFields[K],
    ) => {
        setFields((previous) => ({
            ...previous,
            [key]: value,
        }));

        if (key === "patrol_date") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "patrol_date"),
            );
        }

        if (key === "beat") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "beat"),
            );
        }

        if (key === "start_time") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "start_time"),
            );
        }

        if (key === "end_time") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "end_time"),
            );
        }

        if (key === "location") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "location"),
            );
        }

        if (key === "purpose") {
            setMissingFields((previous) =>
                previous.filter((field) => field !== "purpose"),
            );
        }
    };

    const persistPatrolLocalState = (
        requestedFields: PatrolReportFields = fieldsRef.current,
    ): Promise<OfflineFieldRecord | null> => {
        if (!offline.ownerId) return Promise.resolve(null);
        const ownerId = offline.ownerId;
        const task = localPersistChain.current.catch(() => undefined).then(async () => {
            const draftLocalId = localId.current || (localId.current = createFieldLocalId());
            const latest = await getOfflineFormRecord(ownerId, "PATROL_REPORT", draftLocalId);
            const currentFields = fieldsRef.current;
            const deletedPhotos = new Set(latest?.deletedWildlifePhotoIds ?? []);
            const deletedSightings = new Set(latest?.deletedWildlifeSightingIds ?? []);
            const mergedFields: PatrolReportFields = {
                ...requestedFields,
                ...currentFields,
                wildlife_sightings: mergeWildlifeSightings(
                    requestedFields.wildlife_sightings,
                    currentFields.wildlife_sightings,
                    deletedPhotos,
                    deletedSightings,
                ),
            };
            const payload = {
                ...mergedFields,
                wildlife_sightings: serializableWildlifeSightings(mergedFields.wildlife_sightings),
                team_members: mergedFields.team_members.map((member) => member.trim()).filter(Boolean),
                source_text: description.trim() || null,
                ai_confidence: confidence,
            };
            const snapshot = {
                localId: draftLocalId,
                fields: mergedFields as unknown as Record<string, unknown>,
                description,
                confidence,
                isExtracted,
                reportId: latest?.serverId ?? reportId,
                savedReportId: latest?.serverId ?? savedReportId,
                queuedCreate,
            };
            const persisted = await persistOfflineFieldRecord(ownerId, {
                ownerId,
                module: "PATROL_REPORT",
                localId: draftLocalId,
                serverId: latest?.serverId ?? reportId,
                payload,
                status: latest?.status ?? (isSubmitted ? "SUBMITTED" : "DRAFT"),
                syncError: latest?.syncError ?? null,
                updatedAt: new Date().toISOString(),
                deletedWildlifePhotoIds: latest?.deletedWildlifePhotoIds,
                deletedWildlifeSightingIds: latest?.deletedWildlifeSightingIds,
            });
            await Promise.all([
                saveOfflineFormDraft(ownerId, "PATROL_REPORT", "active", snapshot),
                saveOfflineFormDraft(ownerId, "PATROL_REPORT", `patrol:${draftLocalId}`, snapshot),
            ]);
            return persisted;
        });
        localPersistChain.current = task.then(() => undefined, () => undefined);
        return task;
    };

    const enqueueSavedPatrolMetadata = async () => {
        if (!offline.ownerId || !reportSaveRequested.current) return;
        const latest = await getOfflineFormRecord(offline.ownerId, "PATROL_REPORT", localId.current);
        if (!latest || latest.status === "SUBMITTED") return;
        await enqueueOfflineFieldOperation(
            offline.ownerId,
            "PATROL_REPORT",
            latest,
            latest.serverId ? "UPDATE" : "CREATE",
        );
        if (!latest.serverId) setQueuedCreate(true);
    };

    const addWildlifeSighting = async () => {
        if (!offline.ownerId) {
            toast.error("Sign in as a field officer to save wildlife sightings locally.");
            return;
        }
        const sighting = createWildlifeSighting();
        const currentFields = fieldsRef.current;
        const nextFields = {
            ...currentFields,
            wildlife_sightings: [...currentFields.wildlife_sightings, sighting],
        };
        fieldsRef.current = nextFields;
        setFields(nextFields);
        try {
            await persistPatrolLocalState(nextFields);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save the wildlife sighting locally.");
            return;
        }

        let location: Awaited<ReturnType<typeof captureWildlifeLocation>>;
        try {
            location = await captureWildlifeLocation();
        } catch (error) {
            const latestFields = fieldsRef.current;
            const updatedFields = {
                ...latestFields,
                wildlife_sightings: latestFields.wildlife_sightings.map((item) =>
                    item.sighting_id === sighting.sighting_id &&
                    (item.latitude === null || item.longitude === null)
                        ? { ...item, location_capture_status: "UNAVAILABLE" as const }
                        : item,
                ),
            };
            fieldsRef.current = updatedFields;
            setFields(updatedFields);
            await persistPatrolLocalState(updatedFields).catch((persistError: unknown) =>
                toast.error(persistError instanceof Error ? persistError.message : "Unable to save location status locally."),
            );
            toast.info(error instanceof Error ? error.message : "Location is unavailable. You can enter coordinates manually.");
            return;
        }
        const latestFields = fieldsRef.current;
        const updatedFields = {
            ...latestFields,
            wildlife_sightings: latestFields.wildlife_sightings.map((item) =>
                item.sighting_id === sighting.sighting_id
                    ? item.latitude === null && item.longitude === null &&
                        item.location_capture_status === "NOT_CAPTURED"
                        ? { ...item, ...location }
                        : item
                    : item,
            ),
        };
        fieldsRef.current = updatedFields;
        setFields(updatedFields);
        try {
            await persistPatrolLocalState(updatedFields);
            await enqueueSavedPatrolMetadata();
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save the GPS location locally.");
        }
    };

    const getStoredEvidenceId = async (
        sightingId: string,
        photoId: string,
        fallback: string | null,
    ) => {
        if (!offline.ownerId) return fallback;
        const record = await getOfflineFormRecord(offline.ownerId, "PATROL_REPORT", localId.current);
        const sightings = record?.payload.wildlife_sightings;
        if (!Array.isArray(sightings)) return fallback;
        const sighting = sightings.find((item) =>
            item && typeof item === "object" && (item as Record<string, unknown>).sighting_id === sightingId,
        ) as Record<string, unknown> | undefined;
        const photos = sighting?.photos;
        if (!Array.isArray(photos)) return fallback;
        const photo = photos.find((item) =>
            item && typeof item === "object" && (item as Record<string, unknown>).photo_id === photoId,
        ) as Record<string, unknown> | undefined;
        return typeof photo?.evidence_id === "string" ? photo.evidence_id : fallback;
    };

    const removeWildlifePhoto = async (sightingId: string, photoId: string) => {
        const currentFields = fieldsRef.current;
        const sighting = currentFields.wildlife_sightings.find((item) => item.sighting_id === sightingId);
        const photo = sighting?.photos.find((item) => item.photo_id === photoId);
        if (!sighting || !photo) return;
        const nextSightings = currentFields.wildlife_sightings.map((item) =>
            item.sighting_id === sightingId
                ? { ...item, photos: item.photos.filter((itemPhoto) => itemPhoto.photo_id !== photoId) }
                : item,
        );
        try {
            if (offline.ownerId) {
                const evidenceId = await getStoredEvidenceId(sightingId, photoId, photo.evidence_id);
                const record: OfflineFieldRecord = {
                    ownerId: offline.ownerId,
                    module: "PATROL_REPORT",
                    localId: localId.current,
                    serverId: reportId,
                    payload: {
                        ...currentFields,
                        wildlife_sightings: serializableWildlifeSightings(nextSightings),
                    },
                    status: "DRAFT",
                    syncError: null,
                    updatedAt: new Date().toISOString(),
                };
                await removeOfflineWildlifePhoto(
                    offline.ownerId,
                    localId.current,
                    sightingId,
                    photoId,
                );
                const latestRecord = await getOfflineFormRecord(
                    offline.ownerId,
                    "PATROL_REPORT",
                    localId.current,
                );
                if (evidenceId) {
                    await enqueueOfflineEvidenceDelete(offline.ownerId, latestRecord ?? record, evidenceId);
                }
                if (latestRecord?.status !== "SUBMITTED") {
                    await enqueueOfflineFieldOperation(
                        offline.ownerId,
                        "PATROL_REPORT",
                        latestRecord ?? record,
                        reportId ? "UPDATE" : "CREATE",
                    );
                }
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to remove the wildlife photo.");
            return;
        }
        const nextFields = { ...currentFields, wildlife_sightings: nextSightings };
        fieldsRef.current = nextFields;
        setFields(nextFields);
    };

    const removeWildlifeSighting = async (sightingId: string) => {
        const currentFields = fieldsRef.current;
        const sighting = currentFields.wildlife_sightings.find((item) => item.sighting_id === sightingId);
        if (!sighting) return;
        const nextSightings = currentFields.wildlife_sightings.filter(
            (item) => item.sighting_id !== sightingId,
        );
        try {
            if (offline.ownerId) {
                const record: OfflineFieldRecord = {
                    ownerId: offline.ownerId,
                    module: "PATROL_REPORT",
                    localId: localId.current,
                    serverId: reportId,
                    payload: {
                        ...currentFields,
                        wildlife_sightings: serializableWildlifeSightings(nextSightings),
                    },
                    status: "DRAFT",
                    syncError: null,
                    updatedAt: new Date().toISOString(),
                };
                const evidenceIds: string[] = [];
                for (const photo of sighting.photos) {
                    const evidenceId = await getStoredEvidenceId(
                        sightingId,
                        photo.photo_id,
                        photo.evidence_id,
                    );
                    if (evidenceId) {
                        evidenceIds.push(evidenceId);
                    }
                }
                await removeOfflineWildlifeSighting(
                    offline.ownerId,
                    localId.current,
                    sightingId,
                );
                const latestRecord = await getOfflineFormRecord(
                    offline.ownerId,
                    "PATROL_REPORT",
                    localId.current,
                );
                for (const evidenceId of evidenceIds) {
                    await enqueueOfflineEvidenceDelete(offline.ownerId, latestRecord ?? record, evidenceId);
                }
                if (latestRecord?.status !== "SUBMITTED") {
                    await enqueueOfflineFieldOperation(
                        offline.ownerId,
                        "PATROL_REPORT",
                        latestRecord ?? record,
                        reportId ? "UPDATE" : "CREATE",
                    );
                }
            }
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to remove the wildlife sighting.");
            return;
        }
        const nextFields = { ...currentFields, wildlife_sightings: nextSightings };
        fieldsRef.current = nextFields;
        setFields(nextFields);
    };

    const captureSightingLocation = async (sightingId: string) => {
        if (!offline.ownerId) {
            toast.error("Sign in as a field officer to save wildlife locations locally.");
            return;
        }
        const startingSighting = fieldsRef.current.wildlife_sightings
            .find((sighting) => sighting.sighting_id === sightingId);
        if (!startingSighting) {
            toast.error("The wildlife sighting is no longer available.");
            return;
        }
        let location: Awaited<ReturnType<typeof captureWildlifeLocation>>;
        try {
            location = await captureWildlifeLocation();
        } catch (error) {
            const previous = fieldsRef.current;
            const nextFields = {
                ...previous,
                wildlife_sightings: previous.wildlife_sightings.map((sighting) =>
                    sighting.sighting_id === sightingId &&
                    (sighting.latitude === null || sighting.longitude === null)
                        ? { ...sighting, location_capture_status: "UNAVAILABLE" as const }
                        : sighting,
                ),
            };
            fieldsRef.current = nextFields;
            setFields(nextFields);
            await persistPatrolLocalState(nextFields).catch((persistError: unknown) =>
                toast.error(persistError instanceof Error ? persistError.message : "Unable to save location status locally."),
            );
            toast.error(error instanceof Error ? error.message : "Unable to capture current location.");
            return;
        }
        const previous = fieldsRef.current;
        const nextFields = {
            ...previous,
            wildlife_sightings: previous.wildlife_sightings.map((sighting) =>
                sighting.sighting_id === sightingId
                    ? sighting.latitude === startingSighting.latitude &&
                        sighting.longitude === startingSighting.longitude &&
                        sighting.accuracy_m === startingSighting.accuracy_m &&
                        sighting.captured_at === startingSighting.captured_at
                        ? { ...sighting, ...location }
                        : sighting
                    : sighting,
            ),
        };
        fieldsRef.current = nextFields;
        setFields(nextFields);
        try {
            await persistPatrolLocalState(nextFields);
            await enqueueSavedPatrolMetadata();
            toast.success("GPS location saved locally.");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "Unable to save the GPS location locally.");
        }
    };

    const handleWildlifePhotoSelection = async (selectedFiles: FileList | null) => {
        if (!selectedFiles || !photoTarget) return;
        if (!offline.ownerId) {
            toast.error("Sign in as a field officer to save wildlife photos locally.");
            return;
        }
        const target = photoTarget;
        setPhotoTarget(null);
        const prepared: WildlifePhoto[] = [];
        for (const file of Array.from(selectedFiles)) {
            try {
                const compressed = await compressWildlifeImage(file);
                const currentSighting = fieldsRef.current.wildlife_sightings
                    .find((item) => item.sighting_id === target.sightingId);
                if (!currentSighting) {
                    toast.error("The selected wildlife sighting is no longer available.");
                    continue;
                }
                prepared.push(createWildlifePhoto(compressed, currentSighting));
            } catch (error) {
                toast.error(error instanceof Error ? error.message : "Unable to process the selected wildlife photo.");
            }
        }
        if (!prepared.length) return;
        if (target.photoId) await removeWildlifePhoto(target.sightingId, target.photoId);
        const currentFields = fieldsRef.current;
        const nextFields = {
            ...currentFields,
            wildlife_sightings: currentFields.wildlife_sightings.map((sighting) => {
                if (sighting.sighting_id !== target.sightingId) return sighting;
                return { ...sighting, photos: [...sighting.photos, ...prepared] };
            }),
        };
        fieldsRef.current = nextFields;
        setFields(nextFields);

        if (offline.ownerId) {
            const record: OfflineFieldRecord = {
                ownerId: offline.ownerId,
                module: "PATROL_REPORT",
                localId: localId.current,
                serverId: reportId,
                payload: {
                    ...nextFields,
                    wildlife_sightings: serializableWildlifeSightings(nextFields.wildlife_sightings),
                },
                status: "DRAFT",
                syncError: null,
                updatedAt: new Date().toISOString(),
            };
            try {
                await persistPatrolLocalState(nextFields);
                await queueWildlifePhotos(record);
            } catch (error) {
                toast.error(error instanceof Error
                    ? `Wildlife photo is visible but could not be saved locally: ${error.message}`
                    : "Wildlife photo is visible but could not be saved locally.");
            }
        }
    };

    const updateSighting = (sightingId: string, update: Partial<WildlifeSighting>) => {
        const previous = fieldsRef.current;
        const nextFields: PatrolReportFields = {
            ...previous,
            wildlife_sightings: previous.wildlife_sightings.map((sighting) =>
                sighting.sighting_id === sightingId
                    ? (() => {
                        const updated = { ...sighting, ...update };
                        const validCoordinates = Number.isFinite(updated.latitude) &&
                            updated.latitude !== null && updated.latitude >= -90 && updated.latitude <= 90 &&
                            Number.isFinite(updated.longitude) &&
                            updated.longitude !== null && updated.longitude >= -180 && updated.longitude <= 180;
                        return validCoordinates && (
                            Object.hasOwn(update, "latitude") || Object.hasOwn(update, "longitude")
                        )
                            ? {
                                ...updated,
                                captured_at: new Date().toISOString(),
                                location_capture_status: "MANUAL" as const,
                            }
                            : updated;
                    })()
                    : sighting,
            ),
        };
        fieldsRef.current = nextFields;
        setFields(nextFields);
        if (
            Object.prototype.hasOwnProperty.call(update, "latitude") ||
            Object.prototype.hasOwnProperty.call(update, "longitude") ||
            Object.prototype.hasOwnProperty.call(update, "accuracy_m")
        ) {
            const sighting = nextFields.wildlife_sightings.find((item) => item.sighting_id === sightingId);
            const hasValidCoordinates = sighting?.latitude !== null && sighting?.latitude !== undefined &&
                sighting.latitude >= -90 && sighting.latitude <= 90 &&
                sighting.longitude !== null && sighting.longitude !== undefined &&
                sighting.longitude >= -180 && sighting.longitude <= 180;
            void persistPatrolLocalState(nextFields)
                .then(() => hasValidCoordinates ? enqueueSavedPatrolMetadata() : undefined)
                .catch((error: unknown) =>
                    toast.error(error instanceof Error ? error.message : "Unable to save wildlife location locally."),
                );
        }
    };

    const queueWildlifePhotos = async (
        record: OfflineFieldRecord,
        reportMetadataReady = false,
        retryFailedIdentification?: { sightingId: string; photoId: string },
    ) => {
        if (!offline.ownerId) return;
        let authoritativeRecord = await persistOfflineFieldRecord(offline.ownerId, record);
        if (!reportMetadataReady) {
            await enqueueOfflineFieldOperation(
                offline.ownerId,
                "PATROL_REPORT",
                authoritativeRecord,
                authoritativeRecord.serverId ? "UPDATE" : "CREATE",
            );
        }
        authoritativeRecord = await getOfflineFormRecord(
            offline.ownerId,
            "PATROL_REPORT",
            record.localId,
        ) ?? authoritativeRecord;
        const wildlifeSightings = Array.isArray(authoritativeRecord.payload.wildlife_sightings)
            ? authoritativeRecord.payload.wildlife_sightings as WildlifeSighting[]
            : [];
        for (const sighting of wildlifeSightings) {
            for (const photo of sighting.photos ?? []) {
                authoritativeRecord = await getOfflineFormRecord(
                    offline.ownerId,
                    "PATROL_REPORT",
                    record.localId,
                ) ?? authoritativeRecord;
                const latestSighting = (authoritativeRecord.payload.wildlife_sightings as WildlifeSighting[] | undefined)
                    ?.find((item) => item.sighting_id === sighting.sighting_id);
                const latestPhoto = latestSighting?.photos.find((item) => item.photo_id === photo.photo_id);
                if (!latestPhoto) continue;
                if (latestPhoto.evidence_id) {
                    if (
                        latestPhoto.identification.status === "PENDING" ||
                        (
                            latestPhoto.identification.status === "FAILED" &&
                            retryFailedIdentification?.sightingId === sighting.sighting_id &&
                            retryFailedIdentification.photoId === photo.photo_id
                        )
                    ) {
                        await enqueueOfflineWildlifeIdentification(
                            offline.ownerId,
                            authoritativeRecord,
                            latestPhoto.evidence_id,
                            sighting.sighting_id,
                            photo.photo_id,
                            Boolean(retryFailedIdentification),
                        );
                    }
                    authoritativeRecord = await getOfflineFormRecord(
                        offline.ownerId,
                        "PATROL_REPORT",
                        record.localId,
                    ) ?? authoritativeRecord;
                    continue;
                }
                const currentPhoto = fieldsRef.current.wildlife_sightings
                    .find((item) => item.sighting_id === sighting.sighting_id)
                    ?.photos.find((item) => item.photo_id === photo.photo_id);
                const photoFile = currentPhoto?.file ?? latestPhoto.file;
                if (!photoFile) continue;
                const file = photoFile instanceof File
                    ? photoFile
                    : new File([photoFile], latestPhoto.file_name, { type: latestPhoto.mime_type });
                await enqueueOfflineEvidenceUpload(
                    offline.ownerId,
                    authoritativeRecord,
                    file,
                    `Wildlife sighting ${sighting.sighting_id}`,
                    `wildlife:${sighting.sighting_id}:${photo.photo_id}`,
                    { sightingId: sighting.sighting_id, photoId: photo.photo_id },
                );
                authoritativeRecord = await getOfflineFormRecord(
                    offline.ownerId,
                    "PATROL_REPORT",
                    record.localId,
                ) ?? authoritativeRecord;
            }
        }
    };

    const extractReport = async () => {
        const cleanDescription = description.trim();

        if (!cleanDescription) {
            toast.error(
                "Please describe the patrol before extracting the report.",
            );
            return;
        }

        setIsExtracting(true);
        setIsExtracted(false);
        setReportId(null);
        setSavedReportId(null);
        setIsSubmitted(false);

        try {
            const result =
                await apiRequest<PatrolReportResponse>(
                    "/api/v1/field/forms/patrol/extract",
                    {
                        method: "POST",
                        body: JSON.stringify({
                            text: cleanDescription,
                            language: null,
                        }),
                    },
                );

            if (!result.success) {
                throw new Error(
                    result.message ||
                        "Unable to extract patrol report.",
                );
            }

            setFields(result.fields);

            setMissingFields(
                result.missing_fields ?? [],
            );

            setConfidence(result.confidence ?? null);

            setIsExtracted(true);

            toast.success(
                "Patrol report fields extracted successfully.",
            );
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unable to extract patrol report.";

            toast.error(message);
        } finally {
            setIsExtracting(false);
        }
    };

    const validateRequiredFields = () => {
        const missing: string[] = [];

        for (const fieldName of REQUIRED_SUBMIT_FIELDS) {
            const value = fields[fieldName];

            if (
                value === null ||
                value === undefined ||
                String(value).trim() === ""
            ) {
                missing.push(fieldName);
            }
        }

        if (missing.length > 0) {
            setMissingFields(missing);

            const labels = missing.map(
                (field) => FIELD_LABELS[field] || field,
            );

            toast.error(
                `Please complete: ${labels.join(", ")}`,
            );

            return false;
        }

        if (
            fields.start_time &&
            fields.end_time &&
            fields.end_time <= fields.start_time
        ) {
            toast.error(
                "End time must be later than start time.",
            );

            return false;
        }

        for (const [index, sighting] of fields.wildlife_sightings.entries()) {
            const hasLatitude = sighting.latitude !== null;
            const hasLongitude = sighting.longitude !== null;
            if (hasLatitude !== hasLongitude) {
                toast.error(`Enter both latitude and longitude for wildlife sighting ${index + 1}, or leave both blank.`);
                return false;
            }
            if (
                (hasLatitude && (!Number.isFinite(sighting.latitude) || sighting.latitude! < -90 || sighting.latitude! > 90)) ||
                (hasLongitude && (!Number.isFinite(sighting.longitude) || sighting.longitude! < -180 || sighting.longitude! > 180)) ||
                (sighting.accuracy_m !== null && (!Number.isFinite(sighting.accuracy_m) || sighting.accuracy_m < 0))
            ) {
                toast.error(`Check the GPS coordinates and accuracy for wildlife sighting ${index + 1}.`);
                return false;
            }
        }

        return true;
    };

    const saveDraft = async () => {
        if (isSubmitted) {
            toast.error(
                "This patrol report has already been submitted.",
            );
            return;
        }

        setIsSaving(true);
        reportSaveRequested.current = true;

        try {
            const persistedRecord = await persistPatrolLocalState(fieldsRef.current);
            const activeReportId = persistedRecord?.serverId ?? reportId;
            const persistedFields = persistedRecord?.payload ?? fieldsRef.current;
            const persistedSightings = Array.isArray(persistedFields.wildlife_sightings)
                ? persistedFields.wildlife_sightings as WildlifeSighting[]
                : fieldsRef.current.wildlife_sightings;
            const payload = {
                ...persistedFields,
                wildlife_sightings: serializableWildlifeSightings(persistedSightings),

                team_members: (Array.isArray(persistedFields.team_members)
                    ? persistedFields.team_members as string[]
                    : fieldsRef.current.team_members)
                    .map((member) => member.trim())
                    .filter(Boolean),

                source_text:
                    description.trim() || null,

                ai_confidence: confidence,
            };

            const isUpdating = Boolean(activeReportId);
            const operationId = fieldCreateOperationId("PATROL_REPORT", localId.current || (localId.current = createFieldLocalId()));
            if (offline.ownerId && (!navigator.onLine || (queuedCreate && !activeReportId))) {
                const record: OfflineFieldRecord = {
                    ownerId: offline.ownerId,
                    module: "PATROL_REPORT",
                    localId: localId.current,
                    serverId: activeReportId,
                    payload,
                    status: "DRAFT",
                    syncError: null,
                    updatedAt: new Date().toISOString(),
                };
                await enqueueOfflineFieldOperation(
                    offline.ownerId,
                    "PATROL_REPORT",
                    record,
                    activeReportId ? "UPDATE" : "CREATE",
                );
                await queueWildlifePhotos(record, true);
                if (!activeReportId) setQueuedCreate(true);
                toast.info("Patrol report draft is saved locally and will sync when the service is available.");
                return;
            }

            const result =
                await apiRequest<PatrolReportSaveResponse>(
                    isUpdating
                        ? `/api/v1/field/forms/patrol/${activeReportId}`
                        : "/api/v1/field/forms/patrol",
                    {
                        method: isUpdating
                            ? "PUT"
                            : "POST",
                        body: JSON.stringify(isUpdating ? payload : { ...payload, client_operation_id: operationId }),
                    },
                );

            if (!result.success) {
                if (offline.ownerId && fieldSyncableFailure(result)) {
                    const record: OfflineFieldRecord = {
                        ownerId: offline.ownerId,
                        module: "PATROL_REPORT",
                        localId: localId.current,
                        serverId: activeReportId,
                        payload,
                        status: "DRAFT",
                        syncError: null,
                        updatedAt: new Date().toISOString(),
                    };
                    await enqueueOfflineFieldOperation(offline.ownerId, "PATROL_REPORT", record, isUpdating ? "UPDATE" : "CREATE");
                    await queueWildlifePhotos(record, true);
                    setQueuedCreate(!isUpdating);
                    toast.info("Patrol report draft is saved locally and will sync when the service is available.");
                    return;
                }
                throw new Error(
                    result.message ||
                        "Unable to save patrol report draft.",
                );
            }

            setReportId(result.report_id);
            setSavedReportId(result.report_id);
            setQueuedCreate(false);
            await queueWildlifePhotos({
                ownerId: offline.ownerId ?? "",
                module: "PATROL_REPORT",
                localId: localId.current,
                serverId: result.report_id,
                payload,
                status: "DRAFT",
                syncError: null,
                updatedAt: new Date().toISOString(),
            }, true);

            toast.success(
                isUpdating
                    ? "Patrol report draft updated successfully."
                    : "Patrol report draft saved successfully.",
            );

            onSaved?.();
        } catch (error) {
            const message =
                error instanceof Error
                    ? error.message
                    : "Unable to save patrol report draft.";

            toast.error(message);
        } finally {
            setIsSaving(false);
        }
    };

    const submitReport = async () => {
        if (isSubmitted) {
            toast.info("This patrol report is already submitted.");
            return;
        }

        if (!savedReportId && !queuedCreate) {
            toast.error(
                "Please save the patrol report draft before submitting.",
            );
            return;
        }

        if (!isExtracted) {
            toast.error(
                "Please extract the patrol report first.",
            );
            return;
        }

        if (!validateRequiredFields()) {
            return;
        }

        setIsSubmitting(true);

        try {
            const payload = {
                ...fields,
                wildlife_sightings: serializableWildlifeSightings(fields.wildlife_sightings),
                team_members: fields.team_members.map((member) => member.trim()).filter(Boolean),
                source_text: description.trim() || null,
                ai_confidence: confidence,
            };
            const record: OfflineFieldRecord = {
                ownerId: offline.ownerId ?? "",
                module: "PATROL_REPORT",
                localId: localId.current,
                serverId: savedReportId,
                payload,
                status: "PENDING_SUBMISSION",
                syncError: null,
                updatedAt: new Date().toISOString(),
            };

            if (offline.ownerId && (!navigator.onLine || (queuedCreate && !savedReportId))) {
                await enqueueOfflineFieldOperation(
                    offline.ownerId,
                    "PATROL_REPORT",
                    record,
                    savedReportId ? "UPDATE" : "CREATE",
                );
                await queueWildlifePhotos(record, true);
                await enqueueOfflineFieldOperation(offline.ownerId, "PATROL_REPORT", record, "SUBMIT");
                if (!savedReportId) setQueuedCreate(true);
                toast.info("Submission is pending sync and server validation.");
                return;
            }

            if (savedReportId) {
                const saveResult = await apiRequest<PatrolReportSaveResponse>(
                    `/api/v1/field/forms/patrol/${savedReportId}`,
                    { method: "PUT", body: JSON.stringify(payload) },
                );
                if (!saveResult.success) {
                    if (offline.ownerId && fieldSyncableFailure(saveResult)) {
                        await enqueueOfflineFieldOperation(
                            offline.ownerId,
                            "PATROL_REPORT",
                            record,
                            "UPDATE",
                        );
                        await queueWildlifePhotos(record, true);
                        await enqueueOfflineFieldOperation(offline.ownerId, "PATROL_REPORT", record, "SUBMIT");
                        toast.info("Submission is pending sync and server validation.");
                        return;
                    }
                    throw new Error(saveResult.message || "Unable to save the Patrol Report before submission.");
                }
                record.serverId = saveResult.report_id;
                await queueWildlifePhotos(record, true);
            }

            const result = await apiRequest<PatrolReportSubmitResponse>(
                `/api/v1/field/forms/patrol/${savedReportId}/submit`,
                { method: "POST" },
            );

            if (!result.success) {
                if (offline.ownerId && fieldSyncableFailure(result)) {
                    await enqueueOfflineFieldOperation(
                        offline.ownerId,
                        "PATROL_REPORT",
                        { ...record, serverId: savedReportId, status: "PENDING_SUBMISSION" },
                        "SUBMIT",
                    );
                    toast.info("Submission is pending sync and server validation.");
                    return;
                }
                throw new Error(result.message || "Unable to submit patrol report.");
            }

            setIsSubmitted(true);
            setReportId(result.report_id);
            setSavedReportId(result.report_id);
            if (offline.ownerId) {
                await markOfflineFieldFormSubmitted(
                    offline.ownerId,
                    "PATROL_REPORT",
                    localId.current,
                );
            }
            toast.success("Patrol report submitted successfully.");
            onSaved?.();
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unable to submit patrol report.";
            toast.error(message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const resetForm = () => {
        if (isSubmitted) {
            toast.error(
                "Submitted reports cannot be reset from this form.",
            );
            return;
        }

        setDescription("");
        setFields(EMPTY_FIELDS);
        setMissingFields([]);
        setConfidence(null);
        setIsExtracted(false);
        setSavedReportId(null);
        setReportId(null);
        setIsSubmitted(false);
    };

    const addTeamMember = () => {
        if (isSubmitted) {
            return;
        }

        setFields((previous) => ({
            ...previous,
            team_members: [
                ...previous.team_members,
                "",
            ],
        }));
    };

    const updateTeamMember = (
        index: number,
        value: string,
    ) => {
        if (isSubmitted) {
            return;
        }

        setFields((previous) => ({
            ...previous,
            team_members: previous.team_members.map(
                (member, memberIndex) =>
                    memberIndex === index
                        ? value
                        : member,
            ),
        }));
    };

    const removeTeamMember = (index: number) => {
        if (isSubmitted) {
            return;
        }

        setFields((previous) => ({
            ...previous,
            team_members:
                previous.team_members.filter(
                    (_, memberIndex) =>
                        memberIndex !== index,
                ),
        }));
    };

    const inputClassName =
        "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60";

    const textareaClassName =
        "min-h-[100px] w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60";

    const formDisabled = isSubmitted;

    return (
        <section
            id="patrol-report-form"
            className="rounded-2xl border border-border bg-card text-card-foreground shadow-sm"
        >
            <div className="border-b border-border px-5 py-3">
                <OfflineFieldFormControls {...offline} />
            </div>
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
                <div>
                    <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-semibold">
                            {isSubmitted
                                ? "Patrol Report Submitted"
                                : reportId
                                  ? "Edit Patrol Report Draft"
                                  : "Patrol Report Auto-Fill"}
                        </h2>

                        {isSubmitted && (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Submitted
                            </span>
                        )}
                    </div>

                    <p className="mt-1 text-sm text-muted-foreground">
                        {isSubmitted
                            ? "This patrol report has been successfully submitted."
                            : reportId
                              ? "Review and edit the saved patrol report draft."
                              : "Describe your patrol in Hindi or English and AI will extract the report fields."}
                    </p>
                </div>

                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isSaving || isSubmitting}
                        className="rounded-xl border border-border px-3 py-2 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        Close
                    </button>
                )}
            </div>

            <div className="space-y-6 p-5">
                {/* Description */}
                <div>
                    <label className="mb-2 block text-sm font-medium">
                        Patrol Description
                    </label>

                    <textarea
                        value={description}
                        onChange={(event) =>
                            setDescription(
                                event.target.value,
                            )
                        }
                        disabled={formDisabled}
                        placeholder="Describe your patrol in Hindi or English..."
                        className={textareaClassName}
                    />

                    <div className="mt-3 flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={extractReport}
                            disabled={
                                isExtracting ||
                                isSaving ||
                                isSubmitting ||
                                isSubmitted ||
                                !description.trim()
                            }
                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {isExtracting ? (
                                <>
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    Extracting...
                                </>
                            ) : (
                                "Extract Report"
                            )}
                        </button>

                        <button
                            type="button"
                            onClick={resetForm}
                            disabled={
                                isExtracting ||
                                isSaving ||
                                isSubmitting ||
                                isSubmitted
                            }
                            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <RotateCcw className="h-4 w-4" />
                            Reset
                        </button>
                    </div>
                </div>

                {/* Submission success */}
                {isSubmitted && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                        <div className="flex gap-3">
                            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />

                            <div>
                                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                                    Patrol report submitted successfully
                                </p>

                                <p className="mt-1 text-xs text-muted-foreground">
                                    The report is now in SUBMITTED status and can no longer be edited from this draft form.
                                </p>

                                {reportId && (
                                    <p className="mt-2 text-xs text-muted-foreground">
                                        Report ID: {reportId}
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Extraction status */}
                {isExtracted && (
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" />

                                <div>
                                    <p className="text-sm font-semibold">
                                        Report fields extracted
                                    </p>

                                    <p className="text-xs text-muted-foreground">
                                        {isSubmitted
                                            ? "Submitted report details."
                                            : "Review the fields before saving or submitting."}
                                    </p>
                                </div>
                            </div>

                            {confidence !== null && (
                                <div className="text-sm font-medium">
                                    AI Confidence:{" "}
                                    {Math.round(
                                        confidence * 100,
                                    )}
                                    %
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Missing fields */}
                {isExtracted &&
                    missingFields.length > 0 &&
                    !isSubmitted && (
                        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                            <div className="flex gap-3">
                                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />

                                <div>
                                    <p className="text-sm font-semibold">
                                        Some fields need attention
                                    </p>

                                    <p className="mt-1 text-xs text-muted-foreground">
                                        These fields were not found
                                        in the description. You can
                                        enter them manually.
                                    </p>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                        {missingFields.map(
                                            (field) => (
                                                <span
                                                    key={field}
                                                    className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                                >
                                                    {FIELD_LABELS[
                                                        field
                                                    ] || field}
                                                </span>
                                            ),
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                {/* Fields */}
                {isExtracted && (
                    <div className="space-y-6">
                        {/* Basic information */}
                        <div>
                            <h3 className="mb-4 text-sm font-semibold">
                                Patrol Information
                            </h3>

                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Patrol Date
                                    </label>

                                    <input
                                        type="date"
                                        value={
                                            fields.patrol_date ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "patrol_date",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Beat
                                    </label>

                                    <input
                                        value={
                                            fields.beat ?? ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "beat",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        placeholder="Beat number/name"
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Range
                                    </label>

                                    <input
                                        value={
                                            fields.range_name ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "range_name",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        placeholder="Range name"
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Division
                                    </label>

                                    <input
                                        value={
                                            fields.division ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "division",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        placeholder="Division name"
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Start Time
                                    </label>

                                    <input
                                        type="time"
                                        value={fields.start_time?.slice(0, 5) ?? ""}
                                        onChange={(event) =>
                                            updateField(
                                                "start_time",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={inputClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        End Time
                                    </label>

                                    <input
                                        type="time"
                                        value={fields.end_time?.slice(0, 5) ?? ""}
                                        onChange={(event) =>
                                            updateField(
                                                "end_time",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={inputClassName}
                                    />
                                </div>

                                <div className="md:col-span-2">
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Location
                                    </label>

                                    <input
                                        value={
                                            fields.location ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "location",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        placeholder="Patrol location"
                                        className={inputClassName}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Team */}
                        <div>
                            <div className="mb-4 flex items-center justify-between gap-3">
                                <h3 className="text-sm font-semibold">
                                    Team Members
                                </h3>

                                <button
                                    type="button"
                                    onClick={
                                        addTeamMember
                                    }
                                    disabled={formDisabled}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                    <Plus className="h-3.5 w-3.5" />
                                    Add Member
                                </button>
                            </div>

                            <div className="space-y-2">
                                {fields.team_members
                                    .length === 0 && (
                                    <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                                        No team members added.
                                    </p>
                                )}

                                {fields.team_members.map(
                                    (
                                        member,
                                        index,
                                    ) => (
                                        <div
                                            key={`${index}-${member}`}
                                            className="flex gap-2"
                                        >
                                            <input
                                                value={
                                                    member
                                                }
                                                onChange={(
                                                    event,
                                                ) =>
                                                    updateTeamMember(
                                                        index,
                                                        event
                                                            .target
                                                            .value,
                                                    )
                                                }
                                                disabled={
                                                    formDisabled
                                                }
                                                placeholder={`Team member ${index + 1}`}
                                                className={inputClassName}
                                            />

                                            <button
                                                type="button"
                                                onClick={() =>
                                                    removeTeamMember(
                                                        index,
                                                    )
                                                }
                                                disabled={
                                                    formDisabled
                                                }
                                                className="rounded-xl border border-border px-3 text-muted-foreground transition hover:border-red-500/30 hover:bg-red-500/5 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-50"
                                                aria-label="Remove team member"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </div>
                                    ),
                                )}
                            </div>
                        </div>

                        {/* Patrol details */}
                        <div>
                            <h3 className="mb-4 text-sm font-semibold">
                                Patrol Details
                            </h3>

                            <div className="space-y-4">
                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Purpose
                                    </label>

                                    <textarea
                                        value={
                                            fields.purpose ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "purpose",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Observations
                                    </label>

                                    <textarea
                                        value={
                                            fields.observations ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "observations",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Wildlife Sighting
                                    </label>

                                    <textarea
                                        value={
                                            fields.wildlife_sighting ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "wildlife_sighting",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div className="space-y-4 rounded-xl border border-border p-4 md:col-span-2">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div>
                                            <h3 className="text-sm font-semibold">Wildlife Sightings, Photos & GPS</h3>
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                Photos are saved with each sighting. AI suggestions remain unconfirmed until reviewed.
                                            </p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => void addWildlifeSighting()}
                                            disabled={formDisabled}
                                            className="inline-flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
                                        >
                                            <Plus className="h-4 w-4" />
                                            Add sighting
                                        </button>
                                    </div>

                                    <input
                                        ref={cameraInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        capture="environment"
                                        multiple={!photoTarget?.photoId}
                                        className="hidden"
                                        onChange={(event) => {
                                            void handleWildlifePhotoSelection(event.target.files);
                                            event.target.value = "";
                                        }}
                                    />
                                    <input
                                        ref={galleryInputRef}
                                        type="file"
                                        accept="image/jpeg,image/png,image/webp"
                                        multiple={!photoTarget?.photoId}
                                        className="hidden"
                                        onChange={(event) => {
                                            void handleWildlifePhotoSelection(event.target.files);
                                            event.target.value = "";
                                        }}
                                    />

                                    {fields.wildlife_sightings.length === 0 && (
                                        <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                                            No individual wildlife sightings added.
                                        </p>
                                    )}

                                    {fields.wildlife_sightings.map((sighting, sightingIndex) => (
                                        <div key={sighting.sighting_id} className="space-y-4 rounded-xl bg-muted/30 p-4">
                                            <div className="flex items-center justify-between gap-2">
                                                <h4 className="text-sm font-semibold">Sighting {sightingIndex + 1}</h4>
                                                <button
                                                    type="button"
                                                    aria-label={`Remove sighting ${sightingIndex + 1}`}
                                                    onClick={() => void removeWildlifeSighting(sighting.sighting_id)}
                                                    disabled={formDisabled}
                                                    className="rounded-lg p-2 text-muted-foreground hover:bg-background hover:text-destructive disabled:opacity-50"
                                                >
                                                    <X className="h-4 w-4" />
                                                </button>
                                            </div>

                                            <div className="grid gap-3 md:grid-cols-2">
                                                <label className="text-xs font-medium text-muted-foreground">
                                                    Common / local species name
                                                    <input
                                                        value={sighting.common_name}
                                                        onChange={(event) => updateSighting(sighting.sighting_id, { common_name: event.target.value })}
                                                        disabled={formDisabled}
                                                        placeholder="Review or enter a species"
                                                        className={`${inputClassName} mt-1`}
                                                    />
                                                </label>
                                                <label className="text-xs font-medium text-muted-foreground">
                                                    Scientific name
                                                    <input
                                                        value={sighting.scientific_name}
                                                        onChange={(event) => updateSighting(sighting.sighting_id, { scientific_name: event.target.value })}
                                                        disabled={formDisabled}
                                                        placeholder="Optional"
                                                        className={`${inputClassName} mt-1`}
                                                    />
                                                </label>
                                                <label className="text-xs font-medium text-muted-foreground md:col-span-2">
                                                    Manual species correction / notes
                                                    <input
                                                        value={sighting.manual_species_name}
                                                        onChange={(event) => updateSighting(sighting.sighting_id, { manual_species_name: event.target.value })}
                                                        disabled={formDisabled}
                                                        placeholder="Enter the officer's corrected identification or notes"
                                                        className={`${inputClassName} mt-1`}
                                                    />
                                                </label>
                                            </div>

                                            <div className="space-y-2">
                                                <div className="flex flex-wrap items-center justify-between gap-2">
                                                    <div className="text-xs font-medium">
                                                        <MapPin className="mr-1 inline h-3.5 w-3.5" />
                                                        {sighting.latitude !== null && sighting.longitude !== null
                                                            ? `${sighting.latitude.toFixed(6)}, ${sighting.longitude.toFixed(6)}`
                                                            : "Location not captured"}
                                                        {sighting.accuracy_m !== null && ` (accuracy ${Math.round(sighting.accuracy_m)} m)`}
                                                        {sighting.location_capture_status === "GPS" && " · GPS"}
                                                        {sighting.location_capture_status === "MANUAL" && " · Manual"}
                                                        {sighting.location_capture_status === "UNAVAILABLE" && " · GPS unavailable"}
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() => void captureSightingLocation(sighting.sighting_id)}
                                                        disabled={formDisabled}
                                                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-background disabled:opacity-50"
                                                    >
                                                        <MapPin className="h-3.5 w-3.5" />
                                                        Capture current location
                                                    </button>
                                                </div>
                                                <div className="grid gap-2 sm:grid-cols-3">
                                                    {([
                                                        ["latitude", "Latitude", -90, 90],
                                                        ["longitude", "Longitude", -180, 180],
                                                        ["accuracy_m", "Accuracy (m)", 0, undefined],
                                                    ] as const).map(([key, label, min, max]) => (
                                                        <label key={key} className="text-xs text-muted-foreground">
                                                            {label}
                                                            <input
                                                                type="number"
                                                                step="any"
                                                                min={min}
                                                                max={max}
                                                                value={sighting[key] ?? ""}
                                                                onChange={(event) => {
                                                                    const value = event.target.value === "" ? null : Number(event.target.value);
                                                                    updateSighting(sighting.sighting_id, { [key]: value !== null && !Number.isFinite(value) ? null : value });
                                                                }}
                                                                disabled={formDisabled}
                                                                className={`${inputClassName} mt-1`}
                                                            />
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setPhotoTarget({ sightingId: sighting.sighting_id });
                                                        cameraInputRef.current?.click();
                                                    }}
                                                    disabled={formDisabled}
                                                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
                                                >
                                                    <Camera className="h-4 w-4" />
                                                    Take photo
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setPhotoTarget({ sightingId: sighting.sighting_id });
                                                        galleryInputRef.current?.click();
                                                    }}
                                                    disabled={formDisabled}
                                                    className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-background disabled:opacity-50"
                                                >
                                                    <ImagePlus className="h-4 w-4" />
                                                    Choose from gallery
                                                </button>
                                            </div>

                                            {sighting.photos.length > 0 && (
                                                <div className="space-y-3">
                                                    {sighting.photos.map((photo) => (
                                                        <div key={photo.photo_id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background p-3">
                                                            <WildlifePhotoPreview photo={photo} />
                                                            <div className="min-w-48 flex-1">
                                                                <p className="text-xs font-medium">{photo.file_name}</p>
                                                                <p className="mt-1 text-xs text-muted-foreground">
                                                                    {photo.identification.status === "IDENTIFIED"
                                                                        ? "AI suggestion - review before confirming"
                                                                        : photo.identification.status === "UNCERTAIN" || photo.identification.status === "NOT_IDENTIFIABLE"
                                                                            ? "Uncertain AI suggestion - not confirmed"
                                                                            : photo.upload_status === "UPLOADING"
                                                                                ? "Uploading wildlife photo..."
                                                                                : photo.upload_status === "FAILED"
                                                                                    ? `Upload failed: ${photo.upload_error ?? "retry sync"}`
                                                                            : photo.identification.status === "FAILED"
                                                                                ? `Identification failed: ${photo.identification.error ?? "try again"}`
                                                                                : photo.evidence_id ? "Pending identification" : "Saved Locally · Pending Upload"}
                                                                </p>
                                                                {photo.identification.common_name && (
                                                                    <p className="mt-1 text-sm font-semibold">
                                                                        {photo.identification.common_name}
                                                                        {photo.identification.scientific_name && ` (${photo.identification.scientific_name})`}
                                                                        {photo.identification.confidence !== null && ` - ${Math.round(photo.identification.confidence * 100)}%`}
                                                                    </p>
                                                                )}
                                                                {photo.identification.candidates && photo.identification.candidates.length > 0 && (
                                                                    <label className="mt-2 block text-xs text-muted-foreground">
                                                                        Review alternative AI suggestion
                                                                        <select
                                                                            value=""
                                                                            onChange={(event) => {
                                                                                const candidate = photo.identification.candidates?.[Number(event.target.value)];
                                                                                if (candidate) updateSighting(sighting.sighting_id, {
                                                                                    common_name: candidate.common_name ?? "",
                                                                                    scientific_name: candidate.scientific_name ?? "",
                                                                                });
                                                                            }}
                                                                            disabled={formDisabled}
                                                                            className={`${inputClassName} mt-1`}
                                                                        >
                                                                            <option value="">Select a candidate</option>
                                                                            {photo.identification.candidates.map((candidate, candidateIndex) => (
                                                                                <option key={`${photo.photo_id}-${candidateIndex}`} value={candidateIndex}>
                                                                                    {[candidate.common_name, candidate.scientific_name].filter(Boolean).join(" - ")}
                                                                                    {candidate.confidence !== null && ` (${Math.round(candidate.confidence * 100)}%)`}
                                                                                </option>
                                                                            ))}
                                                                        </select>
                                                                    </label>
                                                                )}
                                                            </div>
                                                            {photo.evidence_id && photo.identification.status === "FAILED" && (
                                                                <button
                                                                    type="button"
                                                                    onClick={async () => {
                                                                        const record: OfflineFieldRecord = {
                                                                            ownerId: offline.ownerId ?? "",
                                                                            module: "PATROL_REPORT",
                                                                            localId: localId.current,
                                                                            serverId: reportId,
                                                                            payload: {
                                                                                ...fieldsRef.current,
                                                                                wildlife_sightings: serializableWildlifeSightings(fieldsRef.current.wildlife_sightings),
                                                                            },
                                                                            status: "DRAFT",
                                                                            syncError: null,
                                                                            updatedAt: new Date().toISOString(),
                                                                        };
                                                                        try {
                                                                            await queueWildlifePhotos(record, true, {
                                                                                sightingId: sighting.sighting_id,
                                                                                photoId: photo.photo_id,
                                                                            });
                                                                            toast.info("Wildlife photo queued for upload and identification.");
                                                                        } catch (error) {
                                                                            toast.error(error instanceof Error ? error.message : "Unable to retry wildlife identification.");
                                                                        }
                                                                    }}
                                                                    disabled={formDisabled || !offline.ownerId}
                                                                    className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                                                                >
                                                                    <RefreshCw className="h-3.5 w-3.5" />
                                                                    Retry identification
                                                                </button>
                                                            )}
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setPhotoTarget({ sightingId: sighting.sighting_id, photoId: photo.photo_id });
                                                                    galleryInputRef.current?.click();
                                                                }}
                                                                disabled={formDisabled}
                                                                className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-50"
                                                            >
                                                                Replace
                                                            </button>
                                                            <button
                                                                type="button"
                                                                aria-label={`Remove ${photo.file_name}`}
                                                                onClick={() => void removeWildlifePhoto(sighting.sighting_id, photo.photo_id)}
                                                                disabled={formDisabled}
                                                                className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Illegal Activity
                                    </label>

                                    <textarea
                                        value={
                                            fields.illegal_activity ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "illegal_activity",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Action Taken
                                    </label>

                                    <textarea
                                        value={
                                            fields.action_taken ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "action_taken",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Incident Details
                                    </label>

                                    <textarea
                                        value={
                                            fields.incident_details ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "incident_details",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>

                                <div>
                                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                                        Additional Remarks
                                    </label>

                                    <textarea
                                        value={
                                            fields.additional_remarks ??
                                            ""
                                        }
                                        onChange={(event) =>
                                            updateField(
                                                "additional_remarks",
                                                event.target
                                                    .value ||
                                                    null,
                                            )
                                        }
                                        disabled={formDisabled}
                                        className={textareaClassName}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* Footer actions */}
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
                            <div>
                                {savedReportId &&
                                    !isSubmitted && (
                                        <p className="text-xs text-emerald-600 dark:text-emerald-400">
                                            Draft saved successfully.
                                        </p>
                                    )}

                                {isSubmitted && (
                                    <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                                        Report status: SUBMITTED
                                    </p>
                                )}

                                {reportId && (
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Report ID:{" "}
                                        {reportId}
                                    </p>
                                )}
                            </div>

                            <div className="flex flex-wrap gap-2">
                                {!isSubmitted && (
                                    <>
                                        <button
                                            type="button"
                                            onClick={
                                                saveDraft
                                            }
                                            disabled={
                                                isSaving ||
                                                isSubmitting
                                            }
                                            className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                                        >
                                            {isSaving ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    {reportId
                                                        ? "Updating..."
                                                        : "Saving..."}
                                                </>
                                            ) : (
                                                <>
                                                    <Save className="h-4 w-4" />
                                                    {reportId
                                                        ? "Update Draft"
                                                        : "Save Draft"}
                                                </>
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={
                                                submitReport
                                            }
                                            disabled={
                                                isSubmitting ||
                                                isSaving ||
                                                (!savedReportId && !queuedCreate)
                                            }
                                            className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                                            title={
                                                !savedReportId && !queuedCreate
                                                    ? "Save the draft before submitting."
                                                    : "Submit patrol report"
                                            }
                                        >
                                            {isSubmitting ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Submitting...
                                                </>
                                            ) : (
                                                <>
                                                    <Send className="h-4 w-4" />
                                                    Submit Report
                                                </>
                                            )}
                                        </button>
                                    </>
                                )}

                                {isSubmitted && (
                                    <button
                                        type="button"
                                        disabled
                                        className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white opacity-90"
                                    >
                                        <CheckCircle2 className="h-4 w-4" />
                                        Report Submitted
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </section>
    );
}
