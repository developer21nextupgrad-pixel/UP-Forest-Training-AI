export type WildlifeIdentification = {
  status: "PENDING" | "IDENTIFIED" | "UNCERTAIN" | "NOT_IDENTIFIABLE" | "FAILED";
  common_name: string | null;
  scientific_name: string | null;
  confidence: number | null;
  error?: string | null;
  candidates?: Array<{
    common_name: string | null;
    scientific_name: string | null;
    confidence: number | null;
  }>;
};

export type WildlifePhoto = {
  photo_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  evidence_id: string | null;
  identification: WildlifeIdentification;
  upload_status?: "PENDING" | "UPLOADING" | "UPLOADED" | "FAILED";
  upload_error?: string | null;
  captured_at?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  file?: Blob;
};

export type WildlifeSighting = {
  sighting_id: string;
  common_name: string;
  scientific_name: string;
  manual_species_name: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_m: number | null;
  captured_at?: string | null;
  location_capture_status?: "GPS" | "MANUAL" | "UNAVAILABLE" | "NOT_CAPTURED";
  photos: WildlifePhoto[];
};

export function mergeWildlifeSightings(
  current: WildlifeSighting[],
  incoming: WildlifeSighting[],
  deletedPhotoIds: ReadonlySet<string> = new Set(),
  deletedSightingIds: ReadonlySet<string> = new Set(),
): WildlifeSighting[] {
  const mergePhoto = (existing: WildlifePhoto, photo: WildlifePhoto): WildlifePhoto => {
    const existingIdentification = existing.identification;
    const incomingIdentification = photo.identification;
    const existingHasResult = ["IDENTIFIED", "UNCERTAIN", "NOT_IDENTIFIABLE"].includes(existingIdentification.status);
    const incomingHasResult = ["IDENTIFIED", "UNCERTAIN", "NOT_IDENTIFIABLE"].includes(incomingIdentification.status);
    const identification = existingIdentification.status === "IDENTIFIED" ||
      (existingHasResult && !incomingHasResult) ||
      (existingIdentification.status === "FAILED" && !incomingHasResult)
      ? existingIdentification
      : incomingIdentification;
    const uploadStatus = existing.upload_status === "UPLOADED"
      ? "UPLOADED"
      : existing.upload_status === "UPLOADING" && photo.upload_status === "PENDING"
        ? "UPLOADING"
        : photo.upload_status ?? existing.upload_status;
    return {
      ...existing,
      ...photo,
      evidence_id: photo.evidence_id ?? existing.evidence_id,
      identification,
      upload_status: uploadStatus,
      upload_error: uploadStatus === "UPLOADED"
        ? null
        : photo.upload_error ?? existing.upload_error ?? null,
      file: photo.file ?? existing.file,
    };
  };
  const byId = new Map<string, WildlifeSighting>();
  for (const sighting of current) {
    if (!deletedSightingIds.has(sighting.sighting_id)) byId.set(sighting.sighting_id, sighting);
  }
  for (const sighting of incoming) {
    if (deletedSightingIds.has(sighting.sighting_id)) continue;
    const existing = byId.get(sighting.sighting_id);
    const incomingHasValidLocation = Number.isFinite(sighting.latitude) &&
      sighting.latitude !== null && sighting.latitude >= -90 && sighting.latitude <= 90 &&
      Number.isFinite(sighting.longitude) &&
      sighting.longitude !== null && sighting.longitude >= -180 && sighting.longitude <= 180;
    const existingHasValidLocation = existing &&
      Number.isFinite(existing.latitude) &&
      existing.latitude !== null && existing.latitude >= -90 && existing.latitude <= 90 &&
      Number.isFinite(existing.longitude) &&
      existing.longitude !== null && existing.longitude >= -180 && existing.longitude <= 180;
    const photos = new Map((existing?.photos ?? [])
      .filter((photo) => !deletedPhotoIds.has(JSON.stringify([sighting.sighting_id, photo.photo_id])))
      .map((photo) => [photo.photo_id, photo]));
    for (const photo of sighting.photos) {
      if (deletedPhotoIds.has(JSON.stringify([sighting.sighting_id, photo.photo_id]))) continue;
      const currentPhoto = photos.get(photo.photo_id);
      photos.set(photo.photo_id, currentPhoto ? mergePhoto(currentPhoto, photo) : photo);
    }
    byId.set(sighting.sighting_id, {
      ...existing,
      ...sighting,
      ...(incomingHasValidLocation
        ? {
            accuracy_m: Number.isFinite(sighting.accuracy_m) && sighting.accuracy_m !== null &&
              sighting.accuracy_m >= 0
                ? sighting.accuracy_m
                : existing?.accuracy_m ?? null,
            captured_at: sighting.captured_at ?? existing?.captured_at ?? null,
            location_capture_status:
              sighting.location_capture_status === "GPS" || sighting.location_capture_status === "MANUAL"
                ? sighting.location_capture_status
                : existing?.location_capture_status ?? sighting.location_capture_status,
          }
        : existingHasValidLocation
          ? {
              latitude: existing.latitude,
              longitude: existing.longitude,
              accuracy_m: existing.accuracy_m,
              captured_at: existing.captured_at,
              location_capture_status: existing.location_capture_status,
            }
          : {}),
      photos: [...photos.values()],
    });
  }
  return [...byId.values()];
}

export type WildlifeLocation = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  captured_at: string;
  location_capture_status: "GPS";
};

export const MAX_WILDLIFE_IMAGE_BYTES = 10 * 1024 * 1024;
export const TARGET_WILDLIFE_IMAGE_BYTES = 2 * 1024 * 1024;

export async function compressWildlifeImage(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    throw new Error("Choose a JPEG, PNG, or WebP wildlife photo.");
  }
  if (file.size === 0 || file.size > MAX_WILDLIFE_IMAGE_BYTES) {
    throw new Error("Wildlife photos must be greater than 0 bytes and no larger than 10 MB.");
  }

  const image = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser cannot process the selected image.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);

    for (const quality of [0.82, 0.68, 0.54]) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob) throw new Error("Unable to compress the selected wildlife photo.");
      if (blob.size <= TARGET_WILDLIFE_IMAGE_BYTES || quality === 0.54) {
        if (blob.size > MAX_WILDLIFE_IMAGE_BYTES) {
          throw new Error("The compressed wildlife photo is larger than 10 MB.");
        }
        const baseName = file.name.replace(/\.[^.]+$/, "") || "wildlife-photo";
        return new File([blob], `${baseName}.jpg`, {
          type: "image/jpeg",
          lastModified: file.lastModified,
        });
      }
    }
    throw new Error("Unable to compress the selected wildlife photo.");
  } finally {
    image.close();
  }
}

export function captureWildlifeLocation(): Promise<WildlifeLocation> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.reject(new Error("Location services are not available in this browser."));
  }
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      if (
        !Number.isFinite(coords.latitude) || coords.latitude < -90 || coords.latitude > 90 ||
        !Number.isFinite(coords.longitude) || coords.longitude < -180 || coords.longitude > 180
      ) {
        reject(new Error("The device returned invalid coordinates. Existing saved coordinates were preserved."));
        return;
      }
      resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy_m: Number.isFinite(coords.accuracy) && coords.accuracy >= 0
          ? coords.accuracy
          : null,
        captured_at: new Date().toISOString(),
        location_capture_status: "GPS",
      });
    },
      (error) => reject(new Error(
        error.code === error.PERMISSION_DENIED
          ? "Location permission was denied. You can enter coordinates manually."
          : error.code === error.POSITION_UNAVAILABLE
            ? "Current location is unavailable. You can enter coordinates manually."
            : "Location capture timed out. You can try again or enter coordinates manually.",
      )),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

export function createWildlifeSighting(location?: WildlifeLocation): WildlifeSighting {
  return {
    sighting_id: crypto.randomUUID(),
    common_name: "",
    scientific_name: "",
    manual_species_name: "",
    latitude: location?.latitude ?? null,
    longitude: location?.longitude ?? null,
    accuracy_m: location?.accuracy_m ?? null,
    captured_at: location?.captured_at ?? null,
    location_capture_status: location?.location_capture_status ?? "NOT_CAPTURED",
    photos: [],
  };
}

export function createWildlifePhoto(
  file: File,
  sighting: Pick<WildlifeSighting, "latitude" | "longitude">,
): WildlifePhoto {
  return {
    photo_id: crypto.randomUUID(),
    file_name: file.name,
    mime_type: file.type,
    file_size: file.size,
    captured_at: new Date().toISOString(),
    latitude: sighting.latitude,
    longitude: sighting.longitude,
    evidence_id: null,
    identification: {
      status: "PENDING",
      common_name: null,
      scientific_name: null,
      confidence: null,
    },
    upload_status: "PENDING",
    file,
  };
}
