export const APP_NAME = "Forest Library";

export const APP_DESCRIPTION =
  "Uttar Pradesh Forest Department Library & Learning Portal for secure, guided forest education.";

export const APP_VERSION = "1.0.0";

export const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/legal", label: "Forest Laws & Compliance" },
  { href: "/field", label: "Field Officer Assistant" },
  { href: "/training", label: "Training & Learning" },
  { href: "/ocr", label: "OCR" },
  { href: "/speech", label: "Speech" },
] as const;

export const MAX_OCR_FILE_SIZE_BYTES = 100 * 1024 * 1024;

export const ACCEPTED_OCR_FILE_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;
