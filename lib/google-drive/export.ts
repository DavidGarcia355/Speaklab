import { sanitizeDownloadFilenameBase } from "@/app/components/submission-download-filenames";

export const GOOGLE_DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
export const GOOGLE_IDENTITY_SCRIPT_URL = "https://accounts.google.com/gsi/client";
export const TRYHABLA_DRIVE_FOLDER_NAME = "TryHabla Oral Portfolios";

const DRIVE_API_ORIGIN = "https://www.googleapis.com";
const DRIVE_FILES_ENDPOINT = `${DRIVE_API_ORIGIN}/drive/v3/files`;
const DRIVE_UPLOAD_ENDPOINT = `${DRIVE_API_ORIGIN}/upload/drive/v3/files`;
const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_FOLDER_MARKER = "oral-portfolios-v1";
const STUDENT_FOLDER_MARKER = "student-portfolio-v1";
const EMAIL_ADDRESS = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export type GoogleDriveExportErrorCode =
  | "cancelled"
  | "configuration"
  | "source"
  | "authorization"
  | "drive"
  | "network";

export class GoogleDriveExportError extends Error {
  readonly code: GoogleDriveExportErrorCode;

  constructor(code: GoogleDriveExportErrorCode, message: string) {
    super(message);
    this.name = "GoogleDriveExportError";
    this.code = code;
  }
}

export type GoogleDrivePublicClientConfig = {
  enabled: boolean;
  clientId: string;
};

let publicConfigPromise: Promise<GoogleDrivePublicClientConfig> | null = null;

export type ProtectedSubmissionAssets = {
  transcript: string | null;
  audio: Blob;
};

type DriveFile = {
  id: string;
  name?: string;
  webViewLink?: string;
};

type ExportOptions = {
  accessToken: string;
  submissionId: string;
  studentName: string;
  filenameBase: string;
  includeTranscript?: boolean;
  fetchImpl?: typeof fetch;
};

export type GoogleDriveExportResult = {
  folderId: string;
  folderUrl: string;
  transcriptFileId: string | null;
  audioFileId: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function requireNonEmpty(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) {
    throw new GoogleDriveExportError("configuration", `${label} is required for Google Drive export.`);
  }
  return cleaned;
}

function parseTranscriptPayload(value: unknown): string {
  if (!isRecord(value)) return "";
  const containers = [value, value.item, value.result, value.data].filter(isRecord);
  for (const container of containers) {
    const direct = cleanString(container.transcript);
    if (direct) return direct;
    if (isRecord(container.transcript)) {
      const nested = cleanString(container.transcript.text) || cleanString(container.transcript.transcript);
      if (nested) return nested;
    }
    const text = cleanString(container.text);
    if (text) return text;
  }
  return "";
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function parseGoogleDrivePublicConfig(value: unknown): GoogleDrivePublicClientConfig {
  const root = isRecord(value) ? value : {};
  const nested = isRecord(root.googleDriveExport) ? root.googleDriveExport : {};
  const enabled = nested.enabled === true || root.googleDriveExportEnabled === true;
  const clientId = cleanString(nested.clientId) || cleanString(root.googleDriveClientId);
  return { enabled: enabled && clientId.length > 0, clientId };
}

export async function fetchGoogleDrivePublicConfig(
  fetchImpl: typeof fetch = fetch,
): Promise<GoogleDrivePublicClientConfig> {
  if (fetchImpl === fetch) {
    if (!publicConfigPromise) {
      publicConfigPromise = fetchGoogleDrivePublicConfigUncached(fetchImpl).catch((error) => {
        publicConfigPromise = null;
        throw error;
      });
    }
    return publicConfigPromise;
  }
  return fetchGoogleDrivePublicConfigUncached(fetchImpl);
}

async function fetchGoogleDrivePublicConfigUncached(
  fetchImpl: typeof fetch,
): Promise<GoogleDrivePublicClientConfig> {
  let response: Response;
  try {
    response = await fetchImpl("/api/features", {
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new GoogleDriveExportError(
      "network",
      "Could not check Google Drive availability. Check your connection and try again.",
    );
  }
  if (!response.ok) {
    throw new GoogleDriveExportError("configuration", "Google Drive export is not available right now.");
  }
  return parseGoogleDrivePublicConfig(await safeJson(response));
}

export function protectedSubmissionAssetUrls(submissionId: string) {
  const encoded = encodeURIComponent(requireNonEmpty(submissionId, "Submission ID"));
  return {
    transcript: `/api/submissions/${encoded}/transcript`,
    audio: `/api/submissions/${encoded}/audio`,
  };
}

export async function fetchProtectedSubmissionAssets(input: {
  submissionId: string;
  includeTranscript?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<ProtectedSubmissionAssets> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const includeTranscript = input.includeTranscript !== false;
  const urls = protectedSubmissionAssetUrls(input.submissionId);
  let transcriptResponse: Response | null = null;
  let audioResponse: Response;

  try {
    [transcriptResponse, audioResponse] = await Promise.all([
      includeTranscript
        ? fetchImpl(urls.transcript, {
            cache: "no-store",
            credentials: "same-origin",
            headers: { Accept: "application/json" },
          })
        : Promise.resolve(null),
      fetchImpl(urls.audio, {
        cache: "no-store",
        credentials: "same-origin",
        headers: { Accept: "audio/*" },
      }),
    ]);
  } catch {
    throw new GoogleDriveExportError(
      "network",
      "Could not load this recording from TryHabla. Check your connection and try again.",
    );
  }

  let transcript: string | null = null;
  if (transcriptResponse) {
    if (!transcriptResponse.ok) {
      throw new GoogleDriveExportError(
        "source",
        "Could not load the saved transcript. Refresh the page and try again.",
      );
    }
    transcript = parseTranscriptPayload(await safeJson(transcriptResponse));
    if (!transcript) {
      throw new GoogleDriveExportError(
        "source",
        "Generate a transcript before saving this recording to Google Drive.",
      );
    }
  }

  if (!audioResponse.ok) {
    throw new GoogleDriveExportError(
      "source",
      "Could not load the original recording. Refresh the page and try again.",
    );
  }
  const audio = await audioResponse.blob();
  if (audio.size === 0) {
    throw new GoogleDriveExportError("source", "The original recording was empty and was not exported.");
  }
  if (!audio.type.toLowerCase().startsWith("audio/")) {
    throw new GoogleDriveExportError(
      "source",
      "The original recording had an unsupported file type and was not exported.",
    );
  }
  return { transcript, audio };
}

export function sanitizeStudentDriveFolderName(studentName: string) {
  const withoutEmail = studentName.replace(EMAIL_ADDRESS, " ");
  const safeName = sanitizeDownloadFilenameBase(withoutEmail, "Student", 80);
  return sanitizeDownloadFilenameBase(`Student - ${safeName}`, "Student", 90);
}

export function audioExtensionForMimeType(contentType: string) {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
  const extensions: Record<string, string> = {
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/webm": "webm",
    "audio/x-m4a": "m4a",
  };
  return extensions[normalized] ?? "audio";
}

function escapeDriveQueryValue(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function driveHeaders(accessToken: string, additional?: HeadersInit) {
  return new Headers({
    Authorization: `Bearer ${accessToken}`,
    ...Object.fromEntries(new Headers(additional).entries()),
  });
}

async function driveError(response: Response, operation: string): Promise<never> {
  if (response.status === 401) {
    throw new GoogleDriveExportError(
      "authorization",
      "Google Drive access expired or was disconnected. Reconnect and try again.",
    );
  }
  if (response.status === 403) {
    throw new GoogleDriveExportError(
      "drive",
      "Google Drive blocked this export. Check your school Google account's app permissions or choose another authorized account.",
    );
  }
  if (response.status === 429 || response.status >= 500) {
    throw new GoogleDriveExportError(
      "drive",
      `Google Drive could not ${operation} right now. Nothing was removed; try again.`,
    );
  }
  throw new GoogleDriveExportError("drive", `Google Drive could not ${operation}. Try again.`);
}

async function requestDriveJson<T>(
  fetchImpl: typeof fetch,
  accessToken: string,
  url: string,
  init: RequestInit,
  operation: string,
): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      ...init,
      headers: driveHeaders(accessToken, init.headers),
    });
  } catch {
    throw new GoogleDriveExportError(
      "network",
      `Could not reach Google Drive to ${operation}. Check your connection and try again.`,
    );
  }
  if (!response.ok) await driveError(response, operation);
  const payload = await safeJson(response);
  if (!isRecord(payload)) {
    throw new GoogleDriveExportError("drive", `Google Drive returned an unusable response while trying to ${operation}.`);
  }
  return payload as T;
}

async function findDriveFile(
  fetchImpl: typeof fetch,
  accessToken: string,
  clauses: string[],
): Promise<DriveFile | null> {
  const query = [...clauses, "trashed = false"].join(" and ");
  const params = new URLSearchParams({
    q: query,
    spaces: "drive",
    pageSize: "10",
    fields: "files(id,name,webViewLink)",
  });
  const result = await requestDriveJson<{ files?: DriveFile[] }>(
    fetchImpl,
    accessToken,
    `${DRIVE_FILES_ENDPOINT}?${params.toString()}`,
    { method: "GET" },
    "check for an existing export",
  );
  const first = Array.isArray(result.files) ? result.files[0] : null;
  return first && cleanString(first.id) ? first : null;
}

async function createDriveFolder(input: {
  fetchImpl: typeof fetch;
  accessToken: string;
  name: string;
  parentId?: string;
  marker: string;
}) {
  const metadata = {
    name: input.name,
    mimeType: DRIVE_FOLDER_MIME,
    ...(input.parentId ? { parents: [input.parentId] } : {}),
    appProperties: { tryhablaFolder: input.marker },
  };
  return requestDriveJson<DriveFile>(
    input.fetchImpl,
    input.accessToken,
    `${DRIVE_FILES_ENDPOINT}?fields=id,name,webViewLink`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json;charset=utf-8" },
      body: JSON.stringify(metadata),
    },
    "create the TryHabla folder",
  );
}

async function findOrCreateFolder(input: {
  fetchImpl: typeof fetch;
  accessToken: string;
  name: string;
  parentId?: string;
  marker: string;
}) {
  const clauses = [
    `mimeType = '${DRIVE_FOLDER_MIME}'`,
    `name = '${escapeDriveQueryValue(input.name)}'`,
    `appProperties has { key='tryhablaFolder' and value='${escapeDriveQueryValue(input.marker)}' }`,
    input.parentId
      ? `'${escapeDriveQueryValue(input.parentId)}' in parents`
      : "'root' in parents",
  ];
  const existing = await findDriveFile(input.fetchImpl, input.accessToken, clauses);
  if (existing) return existing;
  return createDriveFolder(input);
}

function assetProperties(submissionId: string, kind: "transcript" | "audio") {
  return {
    tryhablaSubmissionId: submissionId,
    tryhablaAssetKind: kind,
  };
}

async function findExistingAsset(input: {
  fetchImpl: typeof fetch;
  accessToken: string;
  folderId: string;
  submissionId: string;
  kind: "transcript" | "audio";
}) {
  return findDriveFile(input.fetchImpl, input.accessToken, [
    `'${escapeDriveQueryValue(input.folderId)}' in parents`,
    `appProperties has { key='tryhablaSubmissionId' and value='${escapeDriveQueryValue(input.submissionId)}' }`,
    `appProperties has { key='tryhablaAssetKind' and value='${input.kind}' }`,
  ]);
}

function createMultipartRelatedBody(metadata: Record<string, unknown>, content: Blob) {
  const boundary = `tryhabla_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
  const body = new Blob(
    [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
      JSON.stringify(metadata),
      `\r\n--${boundary}\r\nContent-Type: ${content.type || "application/octet-stream"}\r\n\r\n`,
      content,
      `\r\n--${boundary}--`,
    ],
    { type: `multipart/related; boundary=${boundary}` },
  );
  return { body, contentType: body.type };
}

async function uploadTranscript(input: {
  fetchImpl: typeof fetch;
  accessToken: string;
  folderId: string;
  submissionId: string;
  filename: string;
  transcript: string;
}) {
  const existing = await findExistingAsset({ ...input, kind: "transcript" });
  const metadata = {
    name: input.filename,
    mimeType: "text/plain",
    ...(!existing ? { parents: [input.folderId] } : {}),
    appProperties: assetProperties(input.submissionId, "transcript"),
  };
  const text = input.transcript.endsWith("\n") ? input.transcript : `${input.transcript}\n`;
  const content = new Blob([new TextEncoder().encode(text)], { type: "text/plain;charset=utf-8" });
  const multipart = createMultipartRelatedBody(metadata, content);
  const target = existing
    ? `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(existing.id)}?uploadType=multipart&fields=id,name,webViewLink`
    : `${DRIVE_UPLOAD_ENDPOINT}?uploadType=multipart&fields=id,name,webViewLink`;
  return requestDriveJson<DriveFile>(
    input.fetchImpl,
    input.accessToken,
    target,
    {
      method: existing ? "PATCH" : "POST",
      headers: { "Content-Type": multipart.contentType },
      body: multipart.body,
    },
    "save the transcript",
  );
}

function requireGoogleUploadSession(location: string | null) {
  if (!location) {
    throw new GoogleDriveExportError("drive", "Google Drive did not start the recording upload. Try again.");
  }
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    throw new GoogleDriveExportError("drive", "Google Drive returned an invalid recording upload address.");
  }
  if (url.protocol !== "https:" || url.hostname !== "www.googleapis.com") {
    throw new GoogleDriveExportError("drive", "Google Drive returned an unsafe recording upload address.");
  }
  return url.toString();
}

async function uploadAudioResumable(input: {
  fetchImpl: typeof fetch;
  accessToken: string;
  folderId: string;
  submissionId: string;
  filename: string;
  audio: Blob;
}) {
  const existing = await findExistingAsset({ ...input, kind: "audio" });
  const metadata = {
    name: input.filename,
    mimeType: input.audio.type,
    ...(!existing ? { parents: [input.folderId] } : {}),
    appProperties: assetProperties(input.submissionId, "audio"),
  };
  const target = existing
    ? `${DRIVE_UPLOAD_ENDPOINT}/${encodeURIComponent(existing.id)}?uploadType=resumable&fields=id,name,webViewLink`
    : `${DRIVE_UPLOAD_ENDPOINT}?uploadType=resumable&fields=id,name,webViewLink`;

  let sessionResponse: Response;
  try {
    sessionResponse = await input.fetchImpl(target, {
      method: existing ? "PATCH" : "POST",
      headers: driveHeaders(input.accessToken, {
        "Content-Type": "application/json;charset=utf-8",
        "X-Upload-Content-Type": input.audio.type,
        "X-Upload-Content-Length": String(input.audio.size),
      }),
      body: JSON.stringify(metadata),
    });
  } catch {
    throw new GoogleDriveExportError(
      "network",
      "Could not start the Google Drive recording upload. Check your connection and try again.",
    );
  }
  if (!sessionResponse.ok) await driveError(sessionResponse, "start the recording upload");
  const sessionUrl = requireGoogleUploadSession(sessionResponse.headers.get("Location"));

  let uploadResponse: Response;
  try {
    uploadResponse = await input.fetchImpl(sessionUrl, {
      method: "PUT",
      headers: { "Content-Type": input.audio.type },
      body: input.audio,
    });
  } catch {
    throw new GoogleDriveExportError(
      "network",
      "The Google Drive recording upload was interrupted. Reconnect and try again; TryHabla will reuse the export.",
    );
  }
  if (!uploadResponse.ok) await driveError(uploadResponse, "finish the recording upload");
  const payload = await safeJson(uploadResponse);
  if (!isRecord(payload) || !cleanString(payload.id)) {
    throw new GoogleDriveExportError("drive", "Google Drive did not confirm the recording upload. Try again.");
  }
  return payload as DriveFile;
}

export async function exportSubmissionToGoogleDrive(
  input: ExportOptions,
): Promise<GoogleDriveExportResult> {
  let accessToken = requireNonEmpty(input.accessToken, "Google access token");
  const submissionId = requireNonEmpty(input.submissionId, "Submission ID");
  const fetchImpl = input.fetchImpl ?? fetch;
  const includeTranscript = input.includeTranscript !== false;

  try {
    const assets = await fetchProtectedSubmissionAssets({
      submissionId,
      includeTranscript,
      fetchImpl,
    });
    const root = await findOrCreateFolder({
      fetchImpl,
      accessToken,
      name: TRYHABLA_DRIVE_FOLDER_NAME,
      marker: ROOT_FOLDER_MARKER,
    });
    const folder = await findOrCreateFolder({
      fetchImpl,
      accessToken,
      name: sanitizeStudentDriveFolderName(input.studentName),
      parentId: root.id,
      marker: STUDENT_FOLDER_MARKER,
    });
    const filenameBase = sanitizeDownloadFilenameBase(input.filenameBase, "TryHabla-recording");
    let transcriptFile: DriveFile | null = null;
    if (includeTranscript && assets.transcript) {
      transcriptFile = await uploadTranscript({
        fetchImpl,
        accessToken,
        folderId: folder.id,
        submissionId,
        filename: `${sanitizeDownloadFilenameBase(`${filenameBase} - transcript`)}.txt`,
        transcript: assets.transcript,
      });
    }
    const audioFile = await uploadAudioResumable({
      fetchImpl,
      accessToken,
      folderId: folder.id,
      submissionId,
      filename: `${filenameBase}.${audioExtensionForMimeType(assets.audio.type)}`,
      audio: assets.audio,
    });
    return {
      folderId: folder.id,
      folderUrl: `https://drive.google.com/drive/folders/${encodeURIComponent(folder.id)}`,
      transcriptFileId: transcriptFile?.id ?? null,
      audioFileId: audioFile.id,
    };
  } finally {
    // Keep the OAuth credential scoped to this invocation. It is never placed
    // in component state, browser storage, a cookie, a URL, or a log message.
    accessToken = "";
  }
}

export function googleDriveErrorMessage(error: unknown) {
  if (error instanceof GoogleDriveExportError) return error.message;
  return "Could not save to Google Drive. Nothing was removed; try again.";
}

export function isGoogleDriveReconnectError(error: unknown) {
  return error instanceof GoogleDriveExportError && error.code === "authorization";
}
