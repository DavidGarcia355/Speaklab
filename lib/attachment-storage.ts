import "server-only";
import path from "node:path";
import { put } from "@vercel/blob";

export async function uploadAssignmentAttachment(input: {
  assignmentId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}) {
  const extMap: Record<string, string> = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpg",
  };
  const ext = extMap[input.mimeType] ?? "bin";
  const baseName = path.basename(input.fileName, path.extname(input.fileName));
  const safeName = baseName.replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").toLowerCase() || "attachment";
  const key = `assignment-attachments/${input.assignmentId}/${crypto.randomUUID()}-${safeName}.${ext}`;
  const result = await put(key, input.buffer, {
    access: "public",
    contentType: input.mimeType,
    addRandomSuffix: false,
  });
  return result.url;
}
