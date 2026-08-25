import "server-only";
import path from "node:path";
import { put } from "@vercel/blob";
import {
  assignmentAttachmentExtension,
  hasMatchingAttachmentSignature,
  isAssignmentAttachmentType,
  MAX_ASSIGNMENT_ATTACHMENT_BYTES,
} from "@/lib/attachment-policy";
import { getPrivateBlobCommandOptions } from "@/lib/audio-blob";

export async function uploadAssignmentAttachment(input: {
  assignmentId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  if (!/^[a-z0-9_-]{1,128}$/i.test(input.assignmentId)) {
    throw new Error("Assignment id is not safe for attachment storage.");
  }
  if (!isAssignmentAttachmentType(input.mimeType)) {
    throw new Error("Unsupported assignment attachment type.");
  }
  if (input.buffer.byteLength > MAX_ASSIGNMENT_ATTACHMENT_BYTES) {
    throw new Error("Assignment attachment exceeds the private upload limit.");
  }
  if (!hasMatchingAttachmentSignature(input.mimeType, input.buffer)) {
    throw new Error("Assignment attachment contents do not match its file type.");
  }

  const ext = assignmentAttachmentExtension(input.mimeType);
  const baseName = path.basename(input.fileName, path.extname(input.fileName));
  const safeName = baseName.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").toLowerCase() || "attachment";
  const key = `assignment-attachments/${input.assignmentId}/${crypto.randomUUID()}-${safeName}.${ext}`;
  const result = await put(key, input.buffer, {
    access: "private",
    contentType: input.mimeType,
    addRandomSuffix: false,
    ...getPrivateBlobCommandOptions(),
  });
  return result.pathname;
}
