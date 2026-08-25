#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client";
import { BlobNotFoundError, del, get, head, list, put } from "@vercel/blob";

const CLEANUP_TABLE = "media_migration_cleanup";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const PUBLIC_BLOB_SUFFIX = ".public.blob.vercel-storage.com";
const MEDIA_ERROR_DETAILS = Symbol("mediaErrorDetails");
const SAFE_ERROR_CODES = new Set([
  "AttachmentTypeMismatch",
  "ConflictingAttachmentTypes",
  "InvalidBase64",
  "InvalidDataUrl",
  "InvalidPrivateUploadResult",
  "LegacyStorePaginationLimit",
  "LegacyStorePaginationStalled",
  "MissingEnvironment.AUDIO_BLOB_STORE_ID",
  "MissingEnvironment.AUDIO_READ_WRITE_TOKEN",
  "MissingEnvironment.BLOB_READ_WRITE_TOKEN",
  "MissingEnvironment.TURSO_AUTH_TOKEN",
  "MissingEnvironment.TURSO_DATABASE_URL",
  "MediaSignatureMismatch",
  "MediaTooLarge",
  "PrivateUploadVerificationFailed",
  "PrivateObjectMissing",
  "PrivateObjectReadFailed",
  "SourceFetchFailed",
  "UnsupportedMediaType",
]);

const audioTypes = new Map([
  ["audio/webm", { extension: "webm", signature: (b) => startsWith(b, [0x1a, 0x45, 0xdf, 0xa3]) }],
  ["audio/ogg", { extension: "ogg", signature: (b) => startsWithAscii(b, "OggS") }],
  ["audio/mp4", { extension: "m4a", signature: (b) => b.length >= 8 && asciiAt(b, 4, "ftyp") }],
  [
    "audio/wav",
    {
      extension: "wav",
      signature: (b) => b.length >= 12 && asciiAt(b, 0, "RIFF") && asciiAt(b, 8, "WAVE"),
    },
  ],
]);

const attachmentTypes = new Map([
  ["application/pdf", { extension: "pdf", signature: (b) => startsWithAscii(b, "%PDF-") }],
  [
    "image/png",
    { extension: "png", signature: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  ],
  ["image/jpeg", { extension: "jpg", signature: (b) => startsWith(b, [0xff, 0xd8, 0xff]) }],
]);

function startsWith(buffer, signature) {
  return buffer.length >= signature.length && signature.every((byte, index) => buffer[index] === byte);
}

function startsWithAscii(buffer, value) {
  return asciiAt(buffer, 0, value);
}

function asciiAt(buffer, offset, value) {
  if (buffer.length < offset + value.length) return false;
  return buffer.subarray(offset, offset + value.length).toString("ascii") === value;
}

function stringValue(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeMediaType(value) {
  const normalized = stringValue(value).split(";", 1)[0].toLowerCase();
  if (normalized === "audio/x-wav" || normalized === "audio/wave") return "audio/wav";
  if (normalized === "image/jpg") return "image/jpeg";
  return normalized;
}

function safeSegment(value, fallback) {
  const normalized = stringValue(value).replace(/[^a-z0-9_-]+/gi, "-").slice(0, 100);
  return normalized || fallback;
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function isBlobMissing(error) {
  return error instanceof BlobNotFoundError || (error instanceof Error && error.name === "BlobNotFoundError");
}

function safeErrorKind(error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const safeName = /^[a-z0-9_.-]{1,80}$/i.test(name) ? name : "UnknownError";
  const code = error instanceof Error && SAFE_ERROR_CODES.has(error.message) ? error.message : "";
  return code ? `${safeName}.${code}` : safeName;
}

function incrementError(summary, error) {
  const kind = safeErrorKind(error);
  summary.errorKinds[kind] = (summary.errorKinds[kind] ?? 0) + 1;
  const details = error instanceof Error ? error[MEDIA_ERROR_DETAILS] : null;
  if (details) recordMediaTypeFinding(summary, details.claimedType, details.detectedType);
}

function safeMediaTypeLabel(value) {
  const normalized = normalizeMediaType(value);
  if (audioTypes.has(normalized) || attachmentTypes.has(normalized)) return normalized;
  return normalized ? "Unsupported" : "Unknown";
}

function recordMediaTypeFinding(summary, claimedType, detectedType) {
  if (!summary.validation?.mediaTypeFindings) return;
  const finding = `${safeMediaTypeLabel(claimedType)}->${safeMediaTypeLabel(detectedType)}`;
  summary.validation.mediaTypeFindings[finding] =
    (summary.validation.mediaTypeFindings[finding] ?? 0) + 1;
}

function mediaValidationError(code, claimedType, detectedType = "") {
  const error = new TypeError(code);
  error[MEDIA_ERROR_DETAILS] = { claimedType, detectedType };
  return error;
}

function inspectMediaBuffer(buffer, claimedType, typeMap, maxBytes) {
  if (buffer.byteLength > maxBytes) throw new RangeError("MediaTooLarge");
  const detected = [...typeMap.entries()].filter(([, config]) => config.signature(buffer));
  if (detected.length === 0) {
    const code = typeMap.has(claimedType) ? "MediaSignatureMismatch" : "UnsupportedMediaType";
    throw mediaValidationError(code, claimedType);
  }
  const [contentType, type] =
    detected.find(([candidate]) => candidate === claimedType) ?? detected[0];
  return {
    buffer,
    claimedType,
    contentType,
    extension: type.extension,
  };
}

export function isLegacyPublicBlobUrl(value, expectedPrefix) {
  try {
    const url = new URL(stringValue(value));
    if (url.protocol !== "https:" || !url.hostname.toLowerCase().endsWith(PUBLIC_BLOB_SUFFIX)) {
      return false;
    }
    const pathname = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    return pathname.startsWith(expectedPrefix);
  } catch {
    return false;
  }
}

function isPrivatePath(value, expectedPrefix) {
  const normalized = stringValue(value).replace(/^\/+/, "");
  return !/^https?:\/\//i.test(normalized) && normalized.startsWith(expectedPrefix);
}

function parseBase64DataUrl(value, typeMap, maxBytes) {
  const trimmed = stringValue(value);
  const marker = ";base64,";
  const markerIndex = trimmed.toLowerCase().lastIndexOf(marker);
  if (!trimmed.toLowerCase().startsWith("data:") || markerIndex < 0) {
    throw new TypeError("InvalidDataUrl");
  }
  const claimedType = normalizeMediaType(trimmed.slice(5, markerIndex));
  const encoded = trimmed.slice(markerIndex + marker.length).replace(/\s/g, "");
  if (!encoded || encoded.length % 4 !== 0 || !/^[a-z0-9+/]*={0,2}$/i.test(encoded)) {
    throw new TypeError("InvalidBase64");
  }
  const buffer = Buffer.from(encoded, "base64");
  return inspectMediaBuffer(buffer, claimedType, typeMap, maxBytes);
}

function mediaTypeFromPathname(value, typeMap) {
  let pathname = "";
  try {
    pathname = new URL(value).pathname.toLowerCase();
  } catch {
    pathname = stringValue(value).toLowerCase();
  }
  for (const [contentType, config] of typeMap) {
    if (pathname.endsWith(`.${config.extension}`)) return contentType;
    if (contentType === "audio/mp4" && pathname.endsWith(".mp4")) return contentType;
    if (contentType === "image/jpeg" && pathname.endsWith(".jpeg")) return contentType;
  }
  return "";
}

async function fetchLegacyMedia(source, options) {
  let response;
  try {
    response = await options.fetchImpl(source, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new Error("SourceFetchFailed");
  }
  if (!response.ok) throw new Error("SourceFetchFailed");
  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
    throw new RangeError("MediaTooLarge");
  }
  let buffer;
  try {
    buffer = Buffer.from(await response.arrayBuffer());
  } catch {
    throw new Error("SourceFetchFailed");
  }
  if (buffer.byteLength > options.maxBytes) throw new RangeError("MediaTooLarge");
  const headerType = normalizeMediaType(response.headers.get("content-type"));
  const pathType = mediaTypeFromPathname(source, options.typeMap);
  const claimedType = options.typeMap.has(headerType) ? headerType : pathType || headerType;
  return inspectMediaBuffer(buffer, claimedType, options.typeMap, options.maxBytes);
}

async function readPrivateMedia(pathname, options) {
  let upstream;
  try {
    upstream = await options.blob.get(pathname, {
      access: "private",
      useCache: false,
      ...options.privateOptions,
    });
  } catch (error) {
    if (isBlobMissing(error)) throw new Error("PrivateObjectMissing");
    throw new Error("PrivateObjectReadFailed");
  }
  if (!upstream || upstream.statusCode !== 200 || !upstream.stream) {
    throw new Error("PrivateObjectMissing");
  }
  if (
    stringValue(upstream.blob.pathname).replace(/^\/+/, "") !== pathname.replace(/^\/+/, "")
  ) {
    throw new Error("PrivateObjectReadFailed");
  }
  if (Number(upstream.blob.size) > options.maxBytes) throw new RangeError("MediaTooLarge");
  let buffer;
  try {
    buffer = Buffer.from(await new Response(upstream.stream).arrayBuffer());
  } catch {
    throw new Error("PrivateObjectReadFailed");
  }
  const metadataType = normalizeMediaType(upstream.blob.contentType);
  const pathType = mediaTypeFromPathname(pathname, options.typeMap);
  const claimedType = options.typeMap.has(metadataType) ? metadataType : pathType || metadataType;
  return inspectMediaBuffer(buffer, claimedType, options.typeMap, options.maxBytes);
}

function classifyAudioRow(row) {
  const audioBlobUrl = stringValue(row.audioBlobUrl);
  const audioData = stringValue(row.audioData);
  let kind = "none";
  let source = "";

  if (isLegacyPublicBlobUrl(audioBlobUrl, "submissions/")) {
    kind = "public-url";
    source = audioBlobUrl;
  } else if (audioBlobUrl.toLowerCase().startsWith("data:audio/")) {
    kind = "blob-data-url";
    source = audioBlobUrl;
  } else if (audioBlobUrl && isPrivatePath(audioBlobUrl, "submissions/")) {
    kind = "private";
  } else if (audioBlobUrl) {
    kind = "unsupported";
  } else if (audioData.toLowerCase().startsWith("data:audio/")) {
    kind = "audio-data-url";
    source = audioData;
  } else if (audioData) {
    kind = "unsupported";
  }

  return {
    id: stringValue(row.id),
    assignmentId: stringValue(row.assignmentId),
    audioBlobUrl,
    audioData,
    source,
    kind,
    hasRedundantData: kind !== "audio-data-url" && audioData.toLowerCase().startsWith("data:audio/"),
  };
}

function classifyAttachmentRow(row) {
  const source = stringValue(row.attachmentUrl);
  let kind = "none";
  if (isLegacyPublicBlobUrl(source, "assignment-attachments/")) kind = "public-url";
  else if (/^data:(application\/pdf|image\/(png|jpeg|jpg))/i.test(source)) kind = "data-url";
  else if (source && isPrivatePath(source, "assignment-attachments/")) kind = "private";
  else if (source) kind = "unsupported";
  return {
    source,
    kind,
    contentType: normalizeMediaType(row.attachmentContentType),
  };
}

function emptyResult(apply) {
  return {
    mode: apply ? "apply" : "dry-run",
    inventory: {
      submissionsScanned: 0,
      audioPublicUrls: 0,
      audioDataUrls: 0,
      redundantAudioData: 0,
      privateAudio: 0,
      unsupportedAudio: 0,
      assignmentsScanned: 0,
      attachmentPublicReferences: 0,
      attachmentPublicObjects: 0,
      attachmentDataUrls: 0,
      privateAttachments: 0,
      unsupportedAttachments: 0,
    },
    changes: {
      audioMigrated: 0,
      attachmentReferencesMigrated: 0,
      redundantAudioDataCleared: 0,
      raceSkips: 0,
      failed: 0,
      privateOrphansRemoved: 0,
    },
    validation: {
      sourcesChecked: 0,
      ready: 0,
      failed: 0,
      privateReferencesChecked: 0,
      privateReady: 0,
      privateFailed: 0,
      mediaTypeFindings: {},
    },
    publicCleanup: { deleted: 0, alreadyMissing: 0, deferred: 0, failed: 0, pending: 0 },
    legacyStore: {
      initialInScope: 0,
      initialReferenced: 0,
      initialJournaled: 0,
      initialUnreferenced: 0,
      outOfScope: 0,
      unreferencedDeleted: 0,
      unreferencedAlreadyMissing: 0,
      unreferencedDeleteFailed: 0,
      sweepSkipped: false,
      remainingInScope: 0,
    },
    remaining: null,
    errorKinds: {},
  };
}

export function parseMigrationArgs(args) {
  const known = new Set([
    "--apply",
    "--backup-confirmed",
    "--legacy-media-backup-confirmed",
    "--dry-run",
    "--help",
  ]);
  const unknown = args.filter((arg) => !known.has(arg));
  if (unknown.length) throw new Error("Unknown command-line option.");
  const apply = args.includes("--apply");
  const explicitDryRun = args.includes("--dry-run");
  const backupConfirmed = args.includes("--backup-confirmed");
  const legacyMediaBackupConfirmed = args.includes("--legacy-media-backup-confirmed");
  if (apply && explicitDryRun) throw new Error("Choose either --apply or --dry-run, not both.");
  if (apply && !backupConfirmed) {
    throw new Error("Apply mode requires --backup-confirmed after verifying a current database backup.");
  }
  if (!apply && backupConfirmed) throw new Error("--backup-confirmed is only valid with --apply.");
  if (apply && !legacyMediaBackupConfirmed) {
    throw new Error(
      "Apply mode requires --legacy-media-backup-confirmed after making a recoverable backup of both legacy media prefixes."
    );
  }
  if (!apply && legacyMediaBackupConfirmed) {
    throw new Error("--legacy-media-backup-confirmed is only valid with --apply.");
  }
  return {
    apply,
    backupConfirmed,
    legacyMediaBackupConfirmed,
    help: args.includes("--help"),
  };
}

function requireEnv(env, name) {
  const value = stringValue(env[name]);
  if (!value) {
    const error = new Error(`MissingEnvironment.${name}`);
    error.name = "MigrationConfigError";
    throw error;
  }
  return value;
}

export function readMigrationConfig(env) {
  const config = {
    tursoUrl: requireEnv(env, "TURSO_DATABASE_URL"),
    tursoToken: requireEnv(env, "TURSO_AUTH_TOKEN"),
    privateStoreId: requireEnv(env, "AUDIO_BLOB_STORE_ID"),
    privateToken: requireEnv(env, "AUDIO_READ_WRITE_TOKEN"),
    legacyToken: requireEnv(env, "BLOB_READ_WRITE_TOKEN"),
  };
  return config;
}

async function readInventory(client) {
  const [submissionResult, assignmentResult] = await Promise.all([
    client.execute(`SELECT id, assignment_id as assignmentId,
      COALESCE(audio_blob_url, '') as audioBlobUrl,
      COALESCE(audio_data, '') as audioData
      FROM submissions`),
    client.execute(`SELECT id, COALESCE(attachment_url, '') as attachmentUrl,
      COALESCE(attachment_content_type, '') as attachmentContentType
      FROM assignments`),
  ]);
  return {
    audio: submissionResult.rows.map(classifyAudioRow),
    attachments: assignmentResult.rows.map(classifyAttachmentRow),
  };
}

function summarizeInventory(result, inventory) {
  result.inventory.submissionsScanned = inventory.audio.length;
  for (const item of inventory.audio) {
    if (item.kind === "public-url") result.inventory.audioPublicUrls++;
    else if (item.kind === "blob-data-url" || item.kind === "audio-data-url") result.inventory.audioDataUrls++;
    else if (item.kind === "private") result.inventory.privateAudio++;
    else if (item.kind === "unsupported") result.inventory.unsupportedAudio++;
    if (item.hasRedundantData) result.inventory.redundantAudioData++;
  }

  result.inventory.assignmentsScanned = inventory.attachments.length;
  const publicObjects = new Set();
  for (const item of inventory.attachments) {
    if (item.kind === "public-url") {
      result.inventory.attachmentPublicReferences++;
      publicObjects.add(item.source);
    } else if (item.kind === "data-url") result.inventory.attachmentDataUrls++;
    else if (item.kind === "private") result.inventory.privateAttachments++;
    else if (item.kind === "unsupported") result.inventory.unsupportedAttachments++;
  }
  result.inventory.attachmentPublicObjects = publicObjects.size;
}

async function createCleanupJournal(client) {
  await client.execute(`CREATE TABLE IF NOT EXISTS ${CLEANUP_TABLE} (
    source_url TEXT NOT NULL,
    object_class TEXT NOT NULL CHECK (object_class IN ('audio', 'attachment')),
    created_at INTEGER NOT NULL,
    PRIMARY KEY (source_url, object_class)
  )`);
}

async function readCleanupJournal(client) {
  const exists = await client.execute({
    sql: "SELECT 1 as found FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    args: [CLEANUP_TABLE],
  });
  if (!exists.rows[0]) return [];
  const result = await client.execute(
    `SELECT source_url as sourceUrl, object_class as objectClass FROM ${CLEANUP_TABLE}`
  );
  return result.rows.map((row) => ({
    source: stringValue(row.sourceUrl),
    objectClass: stringValue(row.objectClass),
  }));
}

function isInScopeLegacyPath(pathname, objectClass) {
  const normalized = stringValue(pathname).replace(/^\/+/, "");
  if (objectClass === "audio") {
    return /^submissions\/[a-z0-9_-]{1,128}\/[a-z0-9._-]{1,240}\.(webm|ogg|m4a|mp4|wav)$/i.test(
      normalized
    );
  }
  return /^assignment-attachments\/[a-z0-9_-]{1,128}\/[a-z0-9._-]{1,240}\.(pdf|png|jpe?g)$/i.test(
    normalized
  );
}

async function listLegacyStoreObjects(dependencies) {
  const objects = [];
  for (const [prefix, objectClass] of [
    ["submissions/", "audio"],
    ["assignment-attachments/", "attachment"],
  ]) {
    let cursor;
    let pages = 0;
    do {
      const page = await dependencies.blob.list({
        token: dependencies.legacyToken,
        prefix,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      });
      for (const blob of page.blobs) {
        const url = stringValue(blob.url);
        const pathname = stringValue(blob.pathname);
        objects.push({
          url,
          pathname,
          objectClass,
          inScope:
            isLegacyPublicBlobUrl(url, prefix) && isInScopeLegacyPath(pathname, objectClass),
        });
      }
      pages++;
      if (pages > 10_000) throw new Error("LegacyStorePaginationLimit");
      const nextCursor = page.hasMore ? stringValue(page.cursor) : "";
      if (page.hasMore && (!nextCursor || nextCursor === cursor)) {
        throw new Error("LegacyStorePaginationStalled");
      }
      cursor = nextCursor;
    } while (cursor);
  }
  return objects;
}

function auditLegacyStore(objects, inventory, journal) {
  const referenced = new Set([
    ...inventory.audio.filter((item) => item.kind === "public-url").map((item) => item.source),
    ...inventory.attachments
      .filter((item) => item.kind === "public-url")
      .map((item) => item.source),
  ]);
  const journaled = new Set(journal.map((item) => item.source));
  const inScope = objects.filter((item) => item.inScope);
  return {
    inScope,
    referenced: inScope.filter((item) => referenced.has(item.url)),
    journaled: inScope.filter((item) => journaled.has(item.url)),
    unreferenced: inScope.filter(
      (item) => !referenced.has(item.url) && !journaled.has(item.url)
    ),
    outOfScope: objects.filter((item) => !item.inScope),
  };
}

async function transactionallySwap(client, update, journal) {
  const tx = await client.transaction("write");
  try {
    const updateResult = await tx.execute(update);
    if (Number(updateResult.rowsAffected) === 0) {
      await tx.rollback();
      return 0;
    }
    if (journal) {
      await tx.execute({
        sql: `INSERT OR IGNORE INTO ${CLEANUP_TABLE}
          (source_url, object_class, created_at) VALUES (?, ?, ?)`,
        args: [journal.source, journal.objectClass, Date.now()],
      });
    }
    await tx.commit();
    return Number(updateResult.rowsAffected);
  } finally {
    tx.close();
  }
}

async function countReferences(client, objectClass, reference) {
  const result =
    objectClass === "audio"
      ? await client.execute({
          sql: `SELECT COUNT(*) as count FROM submissions
            WHERE audio_blob_url = ? OR audio_data = ?`,
          args: [reference, reference],
        })
      : await client.execute({
          sql: "SELECT COUNT(*) as count FROM assignments WHERE attachment_url = ?",
          args: [reference],
        });
  return Number(result.rows[0]?.count ?? 0);
}

async function removeUnreferencedPrivateTarget(client, objectClass, pathname, dependencies, result) {
  if ((await countReferences(client, objectClass, pathname)) > 0) return;
  try {
    await dependencies.blob.del(pathname, dependencies.privateOptions);
    result.changes.privateOrphansRemoved++;
  } catch (error) {
    if (!isBlobMissing(error)) incrementError(result, error);
  }
}

async function verifyPrivateUpload(pathname, media, dependencies) {
  const metadata = await dependencies.blob.head(pathname, dependencies.privateOptions);
  if (
    stringValue(metadata.pathname).replace(/^\/+/, "") !== pathname.replace(/^\/+/, "") ||
    Number(metadata.size) !== media.buffer.byteLength ||
    normalizeMediaType(metadata.contentType) !== media.contentType
  ) {
    throw new Error("PrivateUploadVerificationFailed");
  }
  let storedMedia;
  try {
    storedMedia = await readPrivateMedia(pathname, {
      blob: dependencies.blob,
      privateOptions: dependencies.privateOptions,
      maxBytes: media.buffer.byteLength,
      typeMap: media.contentType.startsWith("audio/") ? audioTypes : attachmentTypes,
    });
  } catch {
    throw new Error("PrivateUploadVerificationFailed");
  }
  if (
    storedMedia.contentType !== media.contentType ||
    digest(storedMedia.buffer) !== digest(media.buffer)
  ) {
    throw new Error("PrivateUploadVerificationFailed");
  }
}

async function migrateAudioItem(client, item, dependencies, result) {
  let media;
  if (item.kind === "public-url") {
    media = await fetchLegacyMedia(item.source, {
      fetchImpl: dependencies.fetchImpl,
      maxBytes: MAX_AUDIO_BYTES,
      typeMap: audioTypes,
    });
  } else {
    media = parseBase64DataUrl(item.source, audioTypes, MAX_AUDIO_BYTES);
  }

  const hash = digest(media.buffer).slice(0, 24);
  const key = `submissions/${safeSegment(item.assignmentId, "unknown-assignment")}/${safeSegment(
    item.id,
    "unknown-submission"
  )}-migrated-${hash}.${media.extension}`;
  let pathname = "";
  try {
    const uploaded = await dependencies.blob.put(key, media.buffer, {
      access: "private",
      contentType: media.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      ...dependencies.privateOptions,
    });
    pathname = stringValue(uploaded.pathname);
    if (!isPrivatePath(pathname, "submissions/")) throw new Error("InvalidPrivateUploadResult");
    await verifyPrivateUpload(pathname, media, dependencies);
  } catch (error) {
    if (isPrivatePath(pathname, "submissions/")) {
      await removeUnreferencedPrivateTarget(client, "audio", pathname, dependencies, result);
    }
    throw error;
  }

  const update =
    item.kind === "audio-data-url"
      ? {
          sql: `UPDATE submissions SET audio_blob_url = ?, audio_data = NULL
            WHERE id = ? AND COALESCE(audio_blob_url, '') = '' AND audio_data = ?`,
          args: [pathname, item.id, item.source],
        }
      : {
          sql: `UPDATE submissions SET audio_blob_url = ?, audio_data = NULL
            WHERE id = ? AND audio_blob_url = ?`,
          args: [pathname, item.id, item.source],
        };
  let rows;
  try {
    rows = await transactionallySwap(
      client,
      update,
      item.kind === "public-url" ? { source: item.source, objectClass: "audio" } : null
    );
  } catch (error) {
    await removeUnreferencedPrivateTarget(client, "audio", pathname, dependencies, result);
    throw error;
  }
  if (rows === 0) {
    result.changes.raceSkips++;
    await removeUnreferencedPrivateTarget(client, "audio", pathname, dependencies, result);
    return;
  }
  result.changes.audioMigrated += rows;
}

async function clearRedundantAudioData(client, item, result) {
  const cleared = await client.execute({
    sql: `UPDATE submissions SET audio_data = NULL
      WHERE id = ? AND audio_blob_url = ? AND audio_data = ?`,
    args: [item.id, item.audioBlobUrl, item.audioData],
  });
  if (Number(cleared.rowsAffected) > 0) result.changes.redundantAudioDataCleared++;
  else result.changes.raceSkips++;
}

async function migrateAttachmentGroup(client, items, dependencies, result) {
  const source = items[0].source;
  const declaredTypes = new Set(items.map((item) => item.contentType).filter(Boolean));
  if (declaredTypes.size > 1) throw new TypeError("ConflictingAttachmentTypes");
  let media;
  if (items[0].kind === "public-url") {
    media = await fetchLegacyMedia(source, {
      fetchImpl: dependencies.fetchImpl,
      maxBytes: MAX_ATTACHMENT_BYTES,
      typeMap: attachmentTypes,
    });
  } else {
    media = parseBase64DataUrl(source, attachmentTypes, MAX_ATTACHMENT_BYTES);
  }
  const declaredType = [...declaredTypes][0];
  if (declaredType && declaredType !== media.contentType) throw new TypeError("AttachmentTypeMismatch");

  const hash = digest(media.buffer);
  const key = `assignment-attachments/migrated/${hash}.${media.extension}`;
  let pathname = "";
  try {
    const uploaded = await dependencies.blob.put(key, media.buffer, {
      access: "private",
      contentType: media.contentType,
      addRandomSuffix: false,
      allowOverwrite: true,
      ...dependencies.privateOptions,
    });
    pathname = stringValue(uploaded.pathname);
    if (!isPrivatePath(pathname, "assignment-attachments/")) {
      throw new Error("InvalidPrivateUploadResult");
    }
    await verifyPrivateUpload(pathname, media, dependencies);
  } catch (error) {
    if (isPrivatePath(pathname, "assignment-attachments/")) {
      await removeUnreferencedPrivateTarget(client, "attachment", pathname, dependencies, result);
    }
    throw error;
  }
  let rows;
  try {
    rows = await transactionallySwap(
      client,
      {
        sql: "UPDATE assignments SET attachment_url = ?, attachment_content_type = ? WHERE attachment_url = ?",
        args: [pathname, media.contentType, source],
      },
      items[0].kind === "public-url" ? { source, objectClass: "attachment" } : null
    );
  } catch (error) {
    await removeUnreferencedPrivateTarget(client, "attachment", pathname, dependencies, result);
    throw error;
  }
  if (rows === 0) {
    result.changes.raceSkips++;
    await removeUnreferencedPrivateTarget(client, "attachment", pathname, dependencies, result);
    return;
  }
  result.changes.attachmentReferencesMigrated += rows;
}

async function cleanupPublicJournal(client, dependencies, result) {
  const journal = await readCleanupJournal(client);
  for (const row of journal) {
    const source = row.source;
    const objectClass = row.objectClass;
    const prefix = objectClass === "audio" ? "submissions/" : "assignment-attachments/";
    if (!isLegacyPublicBlobUrl(source, prefix)) {
      result.publicCleanup.failed++;
      continue;
    }
    if ((await countReferences(client, objectClass, source)) > 0) {
      result.publicCleanup.deferred++;
      continue;
    }
    try {
      await dependencies.blob.del(source, { token: dependencies.legacyToken });
      result.publicCleanup.deleted++;
    } catch (error) {
      if (isBlobMissing(error)) result.publicCleanup.alreadyMissing++;
      else {
        result.publicCleanup.failed++;
        incrementError(result, error);
        continue;
      }
    }
    await client.execute({
      sql: `DELETE FROM ${CLEANUP_TABLE} WHERE source_url = ? AND object_class = ?`,
      args: [source, objectClass],
    });
  }
  const remaining = await client.execute(`SELECT COUNT(*) as count FROM ${CLEANUP_TABLE}`);
  result.publicCleanup.pending = Number(remaining.rows[0]?.count ?? 0);
}

async function runTasksWithConcurrency(tasks, limit = 6) {
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      await task();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
}

async function validateDryRun(inventory, fetchImpl, result) {
  const tasks = [];
  const seenAudioSources = new Set();
  for (const item of inventory.audio) {
    const shouldCheck = ["public-url", "blob-data-url", "audio-data-url"].includes(item.kind);
    const redundantOnly = item.kind === "private" && item.hasRedundantData;
    if (!shouldCheck && !redundantOnly) continue;
    const source = redundantOnly ? item.audioData : item.source;
    const key = `${item.kind}:${source}`;
    if (seenAudioSources.has(key)) continue;
    seenAudioSources.add(key);
    tasks.push(async () => {
      result.validation.sourcesChecked++;
      try {
        let media;
        if (item.kind === "public-url") {
          media = await fetchLegacyMedia(source, {
            fetchImpl,
            maxBytes: MAX_AUDIO_BYTES,
            typeMap: audioTypes,
          });
        } else {
          media = parseBase64DataUrl(source, audioTypes, MAX_AUDIO_BYTES);
        }
        recordMediaTypeFinding(result, media.claimedType, media.contentType);
        result.validation.ready++;
      } catch (error) {
        result.validation.failed++;
        incrementError(result, error);
      }
    });
  }

  const attachmentGroups = new Map();
  for (const item of inventory.attachments) {
    if (item.kind !== "public-url" && item.kind !== "data-url") continue;
    const group = attachmentGroups.get(item.source) ?? [];
    group.push(item);
    attachmentGroups.set(item.source, group);
  }
  for (const items of attachmentGroups.values()) {
    tasks.push(async () => {
      result.validation.sourcesChecked++;
      try {
        const declaredTypes = new Set(items.map((item) => item.contentType).filter(Boolean));
        if (declaredTypes.size > 1) throw new TypeError("ConflictingAttachmentTypes");
        const source = items[0].source;
        const media =
          items[0].kind === "public-url"
            ? await fetchLegacyMedia(source, {
                fetchImpl,
                maxBytes: MAX_ATTACHMENT_BYTES,
                typeMap: attachmentTypes,
              })
            : parseBase64DataUrl(source, attachmentTypes, MAX_ATTACHMENT_BYTES);
        recordMediaTypeFinding(result, media.claimedType, media.contentType);
        const declaredType = [...declaredTypes][0];
        if (declaredType && declaredType !== media.contentType) {
          throw new TypeError("AttachmentTypeMismatch");
        }
        result.validation.ready++;
      } catch (error) {
        result.validation.failed++;
        incrementError(result, error);
      }
    });
  }
  await runTasksWithConcurrency(tasks);
}

async function validatePrivateReferences(
  inventory,
  dependencies,
  result,
  previouslyChecked = new Set()
) {
  const checked = new Set(previouslyChecked);
  const tasks = [];

  for (const item of inventory.audio) {
    if (item.kind !== "private") continue;
    const key = `audio:${item.audioBlobUrl}`;
    if (checked.has(key)) continue;
    checked.add(key);
    tasks.push(async () => {
      result.validation.privateReferencesChecked++;
      try {
        const media = await readPrivateMedia(item.audioBlobUrl, {
          blob: dependencies.blob,
          privateOptions: dependencies.privateOptions,
          maxBytes: MAX_AUDIO_BYTES,
          typeMap: audioTypes,
        });
        recordMediaTypeFinding(result, media.claimedType, media.contentType);
        result.validation.privateReady++;
      } catch (error) {
        result.validation.privateFailed++;
        incrementError(result, error);
      }
    });
  }

  const attachmentGroups = new Map();
  for (const item of inventory.attachments) {
    if (item.kind !== "private") continue;
    const group = attachmentGroups.get(item.source) ?? [];
    group.push(item);
    attachmentGroups.set(item.source, group);
  }
  for (const [source, items] of attachmentGroups) {
    const key = `attachment:${source}`;
    if (checked.has(key)) continue;
    checked.add(key);
    tasks.push(async () => {
      result.validation.privateReferencesChecked++;
      try {
        const declaredTypes = new Set(items.map((item) => item.contentType).filter(Boolean));
        if (declaredTypes.size > 1) throw new TypeError("ConflictingAttachmentTypes");
        const media = await readPrivateMedia(source, {
          blob: dependencies.blob,
          privateOptions: dependencies.privateOptions,
          maxBytes: MAX_ATTACHMENT_BYTES,
          typeMap: attachmentTypes,
        });
        recordMediaTypeFinding(result, media.claimedType, media.contentType);
        const declaredType = [...declaredTypes][0];
        if (declaredType && declaredType !== media.contentType) {
          throw new TypeError("AttachmentTypeMismatch");
        }
        result.validation.privateReady++;
      } catch (error) {
        result.validation.privateFailed++;
        incrementError(result, error);
      }
    });
  }

  await runTasksWithConcurrency(tasks);
  return checked;
}

function remainingSummary(inventory) {
  const summary = emptyResult(false);
  summarizeInventory(summary, inventory);
  return {
    audioPublicUrls: summary.inventory.audioPublicUrls,
    audioDataUrls: summary.inventory.audioDataUrls,
    redundantAudioData: summary.inventory.redundantAudioData,
    unsupportedAudio: summary.inventory.unsupportedAudio,
    attachmentPublicReferences: summary.inventory.attachmentPublicReferences,
    attachmentDataUrls: summary.inventory.attachmentDataUrls,
    unsupportedAttachments: summary.inventory.unsupportedAttachments,
  };
}

function remainingReferenceCount(remaining) {
  return Object.values(remaining).reduce((sum, value) => sum + Number(value), 0);
}

async function deleteUnreferencedLegacyObjects(objects, dependencies, result) {
  for (const object of objects) {
    try {
      await dependencies.blob.del(object.url, { token: dependencies.legacyToken });
      result.legacyStore.unreferencedDeleted++;
    } catch (error) {
      if (isBlobMissing(error)) result.legacyStore.unreferencedAlreadyMissing++;
      else {
        result.legacyStore.unreferencedDeleteFailed++;
        incrementError(result, error);
      }
    }
  }
}

export async function runMediaMigration(options) {
  const result = emptyResult(options.apply);
  const inventory = await readInventory(options.client);
  summarizeInventory(result, inventory);
  const privateOptions = {
    storeId: options.config.privateStoreId,
    token: options.config.privateToken,
  };
  const dependencies = {
    blob: options.blob ?? { put, del, get, head, list },
    fetchImpl: options.fetchImpl ?? fetch,
    legacyToken: options.config.legacyToken,
    privateOptions,
  };
  const initialJournal = await readCleanupJournal(options.client);
  const initialLegacyObjects = await listLegacyStoreObjects(dependencies);
  const initialLegacyAudit = auditLegacyStore(initialLegacyObjects, inventory, initialJournal);
  result.legacyStore.initialInScope = initialLegacyAudit.inScope.length;
  result.legacyStore.initialReferenced = initialLegacyAudit.referenced.length;
  result.legacyStore.initialJournaled = initialLegacyAudit.journaled.length;
  result.legacyStore.initialUnreferenced = initialLegacyAudit.unreferenced.length;
  result.legacyStore.outOfScope = initialLegacyAudit.outOfScope.length;
  result.remaining = remainingSummary(inventory);

  if (!options.apply) {
    result.publicCleanup.pending = initialJournal.length;
    for (const item of initialJournal) {
      const prefix = item.objectClass === "audio" ? "submissions/" : "assignment-attachments/";
      if (!isLegacyPublicBlobUrl(item.source, prefix)) result.publicCleanup.failed++;
      else if ((await countReferences(options.client, item.objectClass, item.source)) > 0) {
        result.publicCleanup.deferred++;
      }
    }
    result.legacyStore.remainingInScope = initialLegacyAudit.inScope.length;
    await validateDryRun(inventory, dependencies.fetchImpl, result);
    await validatePrivateReferences(inventory, dependencies, result);
    return result;
  }
  if (!options.backupConfirmed) throw new Error("A current database backup must be confirmed before apply.");
  if (!options.legacyMediaBackupConfirmed) {
    throw new Error(
      "A recoverable backup of both legacy media prefixes must be confirmed before apply."
    );
  }
  const initiallyCheckedPrivateReferences = await validatePrivateReferences(
    inventory,
    dependencies,
    result
  );
  if (result.validation.privateFailed > 0) {
    result.publicCleanup.pending = initialJournal.length;
    result.legacyStore.sweepSkipped = true;
    result.legacyStore.remainingInScope = initialLegacyAudit.inScope.length;
    return result;
  }
  await createCleanupJournal(options.client);
  await cleanupPublicJournal(options.client, dependencies, result);

  for (const item of inventory.audio) {
    try {
      if (["public-url", "blob-data-url", "audio-data-url"].includes(item.kind)) {
        await migrateAudioItem(options.client, item, dependencies, result);
      } else if (item.kind === "private" && item.hasRedundantData) {
        parseBase64DataUrl(item.audioData, audioTypes, MAX_AUDIO_BYTES);
        await clearRedundantAudioData(options.client, item, result);
      }
    } catch (error) {
      result.changes.failed++;
      incrementError(result, error);
    }
  }

  const groups = new Map();
  for (const item of inventory.attachments) {
    if (item.kind !== "public-url" && item.kind !== "data-url") continue;
    const group = groups.get(item.source) ?? [];
    group.push(item);
    groups.set(item.source, group);
  }
  for (const items of groups.values()) {
    try {
      await migrateAttachmentGroup(options.client, items, dependencies, result);
    } catch (error) {
      result.changes.failed++;
      incrementError(result, error);
    }
  }

  const finalInventory = await readInventory(options.client);
  result.remaining = remainingSummary(finalInventory);
  await validatePrivateReferences(
    finalInventory,
    dependencies,
    result,
    initiallyCheckedPrivateReferences
  );
  if (result.validation.privateFailed === 0) {
    await cleanupPublicJournal(options.client, dependencies, result);
  }
  const finalJournal = await readCleanupJournal(options.client);
  result.publicCleanup.pending = finalJournal.length;
  const databasePostconditionsClean =
    result.changes.failed === 0 &&
    result.changes.raceSkips === 0 &&
    result.validation.privateFailed === 0 &&
    result.publicCleanup.failed === 0 &&
    result.publicCleanup.pending === 0 &&
    remainingReferenceCount(result.remaining) === 0;

  const beforeSweepObjects = await listLegacyStoreObjects(dependencies);
  const beforeSweepAudit = auditLegacyStore(beforeSweepObjects, finalInventory, finalJournal);
  result.legacyStore.outOfScope = beforeSweepAudit.outOfScope.length;
  if (databasePostconditionsClean) {
    await deleteUnreferencedLegacyObjects(beforeSweepAudit.unreferenced, dependencies, result);
  } else {
    result.legacyStore.sweepSkipped = true;
  }
  const finalLegacyObjects = await listLegacyStoreObjects(dependencies);
  const finalLegacyAudit = auditLegacyStore(finalLegacyObjects, finalInventory, finalJournal);
  result.legacyStore.remainingInScope = finalLegacyAudit.inScope.length;
  return result;
}

function hasBlockers(result) {
  return (
    result.inventory.unsupportedAudio > 0 ||
    result.inventory.unsupportedAttachments > 0 ||
    result.validation.failed > 0 ||
    result.validation.privateFailed > 0 ||
    result.changes.failed > 0 ||
    result.changes.raceSkips > 0 ||
    result.publicCleanup.failed > 0 ||
    result.publicCleanup.pending > 0 ||
    result.legacyStore.outOfScope > 0 ||
    result.legacyStore.unreferencedDeleteFailed > 0 ||
    result.legacyStore.remainingInScope > 0 ||
    (result.remaining ? remainingReferenceCount(result.remaining) > 0 : true)
  );
}

function printHelp() {
  console.log(`Private media migration (dry-run by default)

Usage:
  node scripts/migrate-public-audio-to-private.mjs
  node scripts/migrate-public-audio-to-private.mjs --apply --backup-confirmed --legacy-media-backup-confirmed

Dry-run requires TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, AUDIO_BLOB_STORE_ID,
AUDIO_READ_WRITE_TOKEN, and the legacy public-store BLOB_READ_WRITE_TOKEN so it
can validate private references and inventory every in-scope public object. Apply
writes only after a current database backup and a recoverable backup/export of
both legacy Blob prefixes are confirmed with the two explicit safety flags.`);
}

async function main() {
  const args = parseMigrationArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const config = readMigrationConfig(process.env);
  const client = createClient({ url: config.tursoUrl, authToken: config.tursoToken });
  try {
    const result = await runMediaMigration({
      client,
      apply: args.apply,
      backupConfirmed: args.backupConfirmed,
      legacyMediaBackupConfirmed: args.legacyMediaBackupConfirmed,
      config,
    });
    console.log(JSON.stringify(result, null, 2));
    if (!args.apply) {
      console.log("Dry-run only: no database or Blob writes were made.");
      console.log(
        "After verifying both backups, apply with --apply --backup-confirmed --legacy-media-backup-confirmed."
      );
    }
    if (hasBlockers(result)) process.exitCode = 1;
  } finally {
    client.close();
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  main().catch((error) => {
    console.error(`Media migration stopped safely (${safeErrorKind(error)}).`);
    process.exitCode = 1;
  });
}
