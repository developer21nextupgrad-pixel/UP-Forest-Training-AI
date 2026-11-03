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
  photos: WildlifePhoto[];
};

export type WildlifeLocation = {
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
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
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({
        latitude: coords.latitude,
        longitude: coords.longitude,
        accuracy_m: Number.isFinite(coords.accuracy) ? coords.accuracy : null,
      }),
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
    photos: [],
  };
}
