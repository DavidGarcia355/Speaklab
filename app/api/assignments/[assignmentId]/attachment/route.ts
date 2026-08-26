import { get } from "@vercel/blob";
import {
  isAssignmentAttachmentPath,
  isAssignmentAttachmentType,
  MAX_ASSIGNMENT_ATTACHMENT_BYTES,
  normalizeMediaType,
} from "@/lib/attachment-policy";
import { getPrivateBlobCommandOptions } from "@/lib/audio-blob";
import { requireAuthenticatedEmail } from "@/lib/authz";
import { findAssignmentById } from "@/lib/db";
import { HttpError, withApiHandler } from "@/lib/http";
import { enforceStudentAssignmentAccessPolicy } from "@/lib/student-assignment-access";

export const runtime = "nodejs";

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, "-").trim().slice(0, 120) || "worksheet";
}

function trustedLegacyUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname.toLowerCase().endsWith(".public.blob.vercel-storage.com")
    ) {
      return null;
    }
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    return isAssignmentAttachmentPath(pathname) ? url : null;
  } catch {
    return null;
  }
}

function responseHeaders(contentType: string, fileName: string) {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `inline; filename="${safeFileName(fileName)}"`,
    "Cache-Control": "private, no-store",
    "Content-Security-Policy": "sandbox",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ assignmentId: string }> }
) {
  return withApiHandler(request, async () => {
    const email = await requireAuthenticatedEmail();
    const { assignmentId } = await context.params;
    const assignment = await findAssignmentById(assignmentId);
    if (!assignment?.attachmentUrl) throw new HttpError(404, "Worksheet not found.");

    const isOwner = assignment.ownerEmail.trim().toLowerCase() === email.trim().toLowerCase();
    if (!isOwner) {
      await enforceStudentAssignmentAccessPolicy({
        classId: assignment.classId,
        ownerEmail: assignment.ownerEmail,
        studentEmail: email,
      });
    }

    const contentType = normalizeMediaType(assignment.attachmentContentType);
    if (!isAssignmentAttachmentType(contentType)) {
      throw new HttpError(415, "This worksheet type is not supported.");
    }

    const reference = assignment.attachmentUrl.trim();
    if (/^https?:\/\//i.test(reference)) {
      const legacyUrl = trustedLegacyUrl(reference);
      if (!legacyUrl) throw new HttpError(410, "This worksheet needs to be uploaded again.");
      const upstream = await fetch(legacyUrl, {
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      });
      if (!upstream.ok || !upstream.body) throw new HttpError(404, "Worksheet not found.");
      const upstreamType = normalizeMediaType(upstream.headers.get("content-type"));
      if (upstreamType && upstreamType !== "application/octet-stream" && upstreamType !== contentType) {
        throw new HttpError(415, "This worksheet type is not supported.");
      }
      const buffer = await upstream.arrayBuffer();
      if (buffer.byteLength > MAX_ASSIGNMENT_ATTACHMENT_BYTES) {
        throw new HttpError(413, "This worksheet is too large to open.");
      }
      return new Response(buffer, {
        status: 200,
        headers: responseHeaders(contentType, assignment.attachmentName),
      });
    }

    const pathname = reference.replace(/^\/+/, "");
    if (!isAssignmentAttachmentPath(pathname)) {
      throw new HttpError(410, "This worksheet needs to be uploaded again.");
    }
    const upstream = await get(pathname, {
      access: "private",
      useCache: false,
      ...getPrivateBlobCommandOptions(),
    });
    if (
      !upstream ||
      upstream.statusCode !== 200 ||
      !upstream.stream ||
      upstream.blob.size > MAX_ASSIGNMENT_ATTACHMENT_BYTES
    ) {
      throw new HttpError(404, "Worksheet not found.");
    }
    const storedType = normalizeMediaType(upstream.blob.contentType);
    if (storedType && storedType !== contentType) {
      throw new HttpError(415, "This worksheet type is not supported.");
    }
    return new Response(upstream.stream, {
      status: 200,
      headers: responseHeaders(contentType, assignment.attachmentName),
    });
  });
}
