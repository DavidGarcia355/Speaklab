export const MAX_ASSIGNMENT_ATTACHMENT_BYTES = 3 * 1024 * 1024;

export const ASSIGNMENT_ATTACHMENT_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
] as const;

export type AssignmentAttachmentType = (typeof ASSIGNMENT_ATTACHMENT_TYPES)[number];

const allowedTypes = new Set<string>(ASSIGNMENT_ATTACHMENT_TYPES);

export function normalizeMediaType(value: string | null | undefined) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() || "";
}

export function isAssignmentAttachmentType(
  value: string | null | undefined
): value is AssignmentAttachmentType {
  return allowedTypes.has(normalizeMediaType(value));
}

export function assignmentAttachmentExtension(mimeType: AssignmentAttachmentType) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  return "jpg";
}

export function hasMatchingAttachmentSignature(
  mimeType: AssignmentAttachmentType,
  buffer: Uint8Array
) {
  if (mimeType === "application/pdf") {
    return (
      buffer.byteLength >= 5 &&
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46 &&
      buffer[4] === 0x2d
    );
  }
  if (mimeType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return (
      buffer.byteLength >= signature.length &&
      signature.every((byte, index) => buffer[index] === byte)
    );
  }
  return buffer.byteLength >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
}

export function isAssignmentAttachmentPath(value: string) {
  return /^assignment-attachments\/[a-z0-9_-]+\/[a-z0-9._-]+$/i.test(
    value.trim().replace(/^\/+/, "")
  );
}

export function isLegacyPublicAssignmentAttachmentUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname.toLowerCase().endsWith(".public.blob.vercel-storage.com") &&
      isAssignmentAttachmentPath(decodeURIComponent(url.pathname))
    );
  } catch {
    return false;
  }
}

export function isReusableAssignmentAttachmentReference(value: string) {
  const trimmed = value.trim();
  return isAssignmentAttachmentPath(trimmed) || isLegacyPublicAssignmentAttachmentUrl(trimmed);
}
