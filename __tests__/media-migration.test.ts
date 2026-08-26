import { createClient, type Client } from "@libsql/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseMigrationArgs,
  readMigrationDiagnosticKey,
  readMigrationConfig,
  runMediaMigration,
} from "@/scripts/migrate-public-audio-to-private.mjs";

const publicAudio =
  "https://legacy.public.blob.vercel-storage.com/submissions/asg_1/public.webm";
const publicAttachment =
  "https://legacy.public.blob.vercel-storage.com/assignment-attachments/asg_1/worksheet.pdf";
const orphanPublicAudio =
  "https://legacy.public.blob.vercel-storage.com/submissions/asg_orphan/orphan.webm";
const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x42, 0x86, 0x81, 0x01]);
const pdf = Buffer.from("%PDF-1.7\n%%EOF", "ascii");
const audioDataUrl = `data:audio/webm;base64,${webm.toString("base64")}`;

let testDbPath = "";
let config = {
  tursoUrl: "",
  tursoToken: "test-token",
  privateStoreId: "store_private",
  privateToken: "private-token",
  legacyToken: "legacy-token",
};

let client: Client;

async function seedDatabase() {
  await client.executeMultiple(`
    CREATE TABLE submissions (
      id TEXT PRIMARY KEY,
      assignment_id TEXT NOT NULL,
      audio_blob_url TEXT,
      audio_data TEXT
    );
    CREATE TABLE assignments (
      id TEXT PRIMARY KEY,
      attachment_url TEXT,
      attachment_content_type TEXT
    );
  `);
  await client.batch(
    [
      {
        sql: "INSERT INTO submissions VALUES (?, ?, ?, NULL)",
        args: ["sub_public", "asg_1", publicAudio],
      },
      {
        sql: "INSERT INTO submissions VALUES (?, ?, NULL, ?)",
        args: ["sub_data", "asg_1", audioDataUrl],
      },
      {
        sql: "INSERT INTO submissions VALUES (?, ?, ?, ?)",
        args: ["sub_private", "asg_1", "submissions/asg_1/private.webm", audioDataUrl],
      },
      {
        sql: "INSERT INTO assignments VALUES (?, ?, ?)",
        args: ["asg_1", publicAttachment, "application/pdf"],
      },
      {
        sql: "INSERT INTO assignments VALUES (?, ?, ?)",
        args: ["asg_2", publicAttachment, "application/pdf"],
      },
    ],
    "write"
  );
}

function migrationDependencies() {
  const privateObjects = new Map<
    string,
    { body: Buffer; size: number; contentType: string }
  >([
    [
      "submissions/asg_1/private.webm",
      { body: webm, size: webm.byteLength, contentType: "audio/webm" },
    ],
  ]);
  const legacyObjects = new Map([
    [publicAudio, "submissions/asg_1/public.webm"],
    [publicAttachment, "assignment-attachments/asg_1/worksheet.pdf"],
    [orphanPublicAudio, "submissions/asg_orphan/orphan.webm"],
  ]);
  const blob = {
    put: vi.fn(
      async (key: string, body: Buffer, options: Record<string, unknown>) => {
        privateObjects.set(key, {
          body: Buffer.from(body),
          size: body.byteLength,
          contentType: String(options.contentType),
        });
        return { pathname: key };
      }
    ),
    del: vi.fn<(target: string, options?: Record<string, unknown>) => Promise<void>>(),
    head: vi.fn(async (pathname: string) => {
      const stored = privateObjects.get(pathname);
      if (!stored) throw new Error("private object missing");
      return { pathname, ...stored };
    }),
    get: vi.fn(async (pathname: string) => {
      const stored = privateObjects.get(pathname);
      if (!stored) return null;
      return {
        statusCode: 200,
        stream: new Response(new Uint8Array([...stored.body])).body,
        blob: {
          pathname,
          contentType: stored.contentType,
          size: stored.size,
        },
      };
    }),
    list: vi.fn(async (options: { prefix?: string }) => ({
      blobs: [...legacyObjects].filter(([, pathname]) => pathname.startsWith(options.prefix ?? "")).map(
        ([url, pathname]) => ({ url, pathname })
      ),
      hasMore: false,
    })),
  };
  const deleteImplementation = async (target: string) => {
    if (/^https:\/\//.test(target)) legacyObjects.delete(target);
    else privateObjects.delete(target);
  };
  blob.del.mockImplementation(deleteImplementation);
  const fetchImpl = vi.fn(async (source: string | URL | Request) => {
    const value = String(source);
    if (value === publicAudio) {
      return new Response(webm, { headers: { "content-type": "audio/webm" } });
    }
    if (value === publicAttachment) {
      return new Response(pdf, { headers: { "content-type": "application/pdf" } });
    }
    return new Response(null, { status: 404 });
  });
  const sleepImpl = vi.fn<(milliseconds: number) => Promise<void>>(async () => undefined);
  return {
    blob,
    fetchImpl,
    sleepImpl,
    restoreDelete: () => blob.del.mockReset().mockImplementation(deleteImplementation),
  };
}

beforeEach(async () => {
  testDbPath = path.join(os.tmpdir(), `habla-media-migration-${randomUUID()}.db`);
  config = { ...config, tursoUrl: `file:${testDbPath}` };
  client = createClient({ url: config.tursoUrl });
  await seedDatabase();
});

afterEach(() => {
  client.close();
  try {
    fs.rmSync(testDbPath, { force: true });
  } catch {
    // libSQL can briefly retain a Windows file handle; the unique file is in the OS temp directory.
  }
});

describe("private media migration", () => {
  it("is dry-run by default and requires both apply safety guards", () => {
    expect(parseMigrationArgs([])).toMatchObject({
      apply: false,
      backupConfirmed: false,
      legacyMediaBackupConfirmed: false,
      diagnostics: false,
    });
    expect(parseMigrationArgs(["--diagnostics"])).toMatchObject({
      apply: false,
      diagnostics: true,
    });
    expect(() => parseMigrationArgs(["--apply"])).toThrow(/backup-confirmed/);
    expect(() => parseMigrationArgs(["--backup-confirmed"])).toThrow(/only valid/);
    expect(() => parseMigrationArgs(["--apply", "--dry-run", "--backup-confirmed"])).toThrow(
      /either/
    );
    expect(() => parseMigrationArgs(["--apply", "--backup-confirmed"])).toThrow(
      /legacy-media-backup-confirmed/
    );
    expect(() => parseMigrationArgs(["--legacy-media-backup-confirmed"])).toThrow(/only valid/);
    expect(() =>
      parseMigrationArgs([
        "--apply",
        "--backup-confirmed",
        "--legacy-media-backup-confirmed",
        "--diagnostics",
      ])
    ).toThrow(/dry-run/);
    expect(
      parseMigrationArgs([
        "--apply",
        "--backup-confirmed",
        "--legacy-media-backup-confirmed",
      ])
    ).toMatchObject({
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
    });
    expect(() => readMigrationConfig({})).toThrow(/TURSO_DATABASE_URL/);
    expect(() =>
      readMigrationConfig({ TURSO_DATABASE_URL: "libsql://example", TURSO_AUTH_TOKEN: "token" })
    ).toThrow(/AUDIO_BLOB_STORE_ID/);
    expect(() => readMigrationDiagnosticKey({})).toThrow(/MEDIA_MIGRATION_DIAGNOSTIC_KEY/);
    expect(() =>
      readMigrationDiagnosticKey({ MEDIA_MIGRATION_DIAGNOSTIC_KEY: "too-short" })
    ).toThrow(/MEDIA_MIGRATION_DIAGNOSTIC_KEY/);
    expect(
      readMigrationDiagnosticKey({ MEDIA_MIGRATION_DIAGNOSTIC_KEY: "d".repeat(32) })
    ).toBe("d".repeat(32));
  });

  it("inventories every legacy shape without writing in dry-run mode", async () => {
    const dependencies = migrationDependencies();
    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });

    expect(result).toMatchObject({
      mode: "dry-run",
      inventory: {
        audioPublicUrls: 1,
        audioDataUrls: 1,
        redundantAudioData: 1,
        privateAudio: 1,
        attachmentPublicReferences: 2,
        attachmentPublicObjects: 1,
      },
      changes: { audioMigrated: 0, attachmentReferencesMigrated: 0 },
      validation: { sourcesChecked: 4, ready: 4, failed: 0 },
      legacyStore: { initialInScope: 3, initialUnreferenced: 1, remainingInScope: 3 },
    });
    expect(dependencies.blob.put).not.toHaveBeenCalled();
    expect(dependencies.blob.del).not.toHaveBeenCalled();
    expect(result).not.toHaveProperty("diagnostics");
  });

  it("validates existing private references and aborts apply before writes when one is corrupt", async () => {
    const dependencies = migrationDependencies();
    dependencies.blob.get.mockResolvedValue({
      statusCode: 200,
      stream: new Response("not audio").body,
      blob: {
        pathname: "submissions/asg_1/private.webm",
        contentType: "audio/webm",
        size: 9,
      },
    });

    const dryRun = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });
    expect(dryRun.validation).toMatchObject({
      privateReferencesChecked: 1,
      privateReady: 0,
      privateFailed: 1,
      mediaTypeFindings: { "audio/webm->Unknown": 1 },
    });
    expect(dryRun.errorKinds).toMatchObject({ "TypeError.MediaSignatureMismatch": 1 });

    const applied = await runMediaMigration({
      client,
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
      config,
      ...dependencies,
    });
    expect(applied.validation.privateFailed).toBe(1);
    expect(applied.legacyStore.sweepSkipped).toBe(true);
    expect(dependencies.blob.put).not.toHaveBeenCalled();
    expect(dependencies.blob.del).not.toHaveBeenCalled();
  });

  it("reports unreachable public sources during the read-only rehearsal", async () => {
    const dependencies = migrationDependencies();
    dependencies.fetchImpl.mockImplementation(async (source: string | URL | Request) => {
      if (String(source) === publicAudio) return new Response(null, { status: 404 });
      return new Response(pdf, { headers: { "content-type": "application/pdf" } });
    });

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });

    expect(result.validation.failed).toBe(1);
    expect(result.errorKinds).toEqual({ "Error.SourceFetchFailed": 1 });
    expect(result.changes.audioMigrated).toBe(0);
    expect(JSON.stringify(result)).not.toContain(publicAudio);
  });

  it("recovers after two transient source failures with at most three total attempts", async () => {
    await client.execute("DELETE FROM assignments");
    await client.execute("DELETE FROM submissions WHERE id <> 'sub_public'");
    const dependencies = migrationDependencies();
    dependencies.fetchImpl
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(
        new Response(webm, { headers: { "content-type": "audio/webm" } })
      );

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });

    expect(result.validation).toMatchObject({ sourcesChecked: 1, ready: 1, failed: 0 });
    expect(dependencies.fetchImpl).toHaveBeenCalledTimes(3);
    expect(dependencies.sleepImpl.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
      100,
      250,
    ]);
    expect(dependencies.blob.put).not.toHaveBeenCalled();
  });

  it.each([302, 400, 404])("does not retry permanent HTTP %s responses", async (status) => {
    await client.execute("DELETE FROM assignments");
    await client.execute("DELETE FROM submissions WHERE id <> 'sub_public'");
    const dependencies = migrationDependencies();
    dependencies.fetchImpl.mockResolvedValue(new Response(null, { status }));

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });

    expect(result.validation).toMatchObject({ sourcesChecked: 1, ready: 0, failed: 1 });
    expect(dependencies.fetchImpl).toHaveBeenCalledOnce();
    expect(dependencies.sleepImpl).not.toHaveBeenCalled();
  });

  it("does not retry media validation failures after a successful source read", async () => {
    await client.execute("DELETE FROM assignments");
    await client.execute("DELETE FROM submissions WHERE id <> 'sub_public'");
    const dependencies = migrationDependencies();
    dependencies.fetchImpl.mockResolvedValue(
      new Response("not valid webm", { headers: { "content-type": "audio/webm" } })
    );

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });

    expect(result.errorKinds).toEqual({ "TypeError.MediaSignatureMismatch": 1 });
    expect(dependencies.fetchImpl).toHaveBeenCalledOnce();
    expect(dependencies.sleepImpl).not.toHaveBeenCalled();
  });

  it("reports the final body-read phase after exhausting bounded retries", async () => {
    await client.execute("DELETE FROM assignments");
    await client.execute("DELETE FROM submissions WHERE id <> 'sub_public'");
    const diagnosticKey = "diagnostic-key-material-32-bytes!!";
    const dependencies = migrationDependencies();
    dependencies.fetchImpl.mockImplementation(async () =>
      ({
        ok: true,
        status: 200,
        headers: new Headers({ "content-type": "audio/webm" }),
        arrayBuffer: vi.fn().mockRejectedValue(new Error("secret body failure")),
      }) as unknown as Response
    );

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      diagnostics: true,
      diagnosticKey,
      config,
      ...dependencies,
    });

    expect(result.validation).toMatchObject({ sourcesChecked: 1, ready: 0, failed: 1 });
    expect(dependencies.fetchImpl).toHaveBeenCalledTimes(3);
    expect(dependencies.sleepImpl).toHaveBeenCalledTimes(2);
    expect(result.diagnostics?.validationFailures).toEqual([
      expect.objectContaining({
        errorKind: "Error.SourceFetchFailed",
        failurePhase: "body_read_failed",
        httpStatusFamily: null,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("secret body failure");
  });

  it("retries source reads without duplicating private writes", async () => {
    await client.execute("DELETE FROM assignments");
    await client.execute("DELETE FROM submissions WHERE id <> 'sub_public'");
    const dependencies = migrationDependencies();
    dependencies.fetchImpl
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        new Response(webm, { headers: { "content-type": "audio/webm" } })
      );

    const result = await runMediaMigration({
      client,
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
      config,
      ...dependencies,
    });

    expect(result.changes).toMatchObject({ audioMigrated: 1, failed: 0 });
    expect(dependencies.fetchImpl).toHaveBeenCalledTimes(2);
    expect(dependencies.sleepImpl).toHaveBeenCalledOnce();
    expect(dependencies.blob.put).toHaveBeenCalledOnce();
    const row = await client.execute(
      "SELECT audio_blob_url as audioBlobUrl, audio_data as audioData FROM submissions WHERE id = 'sub_public'"
    );
    expect(String(row.rows[0]?.audioBlobUrl)).toMatch(/^submissions\/asg_1\/sub_public-migrated-/);
    expect(row.rows[0]?.audioData).toBeNull();
  });

  it("identifies failed source groups with keyed opaque diagnostics only", async () => {
    const diagnosticKey = "diagnostic-key-material-32-bytes!!";
    const dependencies = migrationDependencies();
    dependencies.fetchImpl.mockImplementation(async (source: string | URL | Request) => {
      if (String(source) === publicAudio) return new Response(null, { status: 404 });
      if (String(source) === publicAttachment) throw new TypeError("secret provider detail");
      return new Response(null, { status: 404 });
    });

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      diagnostics: true,
      diagnosticKey,
      config,
      ...dependencies,
    });

    expect(result.validation).toMatchObject({ sourcesChecked: 4, ready: 2, failed: 2 });
    expect(result.errorKinds).toEqual({ "Error.SourceFetchFailed": 2 });
    expect(result.diagnostics).toMatchObject({
      schemaVersion: 1,
      scope: "legacy-source-validation",
      identifierScheme: "hmac-sha256-v1",
    });
    expect(result.diagnostics?.validationFailures).toHaveLength(2);
    const audioFailure = result.diagnostics?.validationFailures.find(
      (item) => item.objectClass === "audio"
    );
    const attachmentFailure = result.diagnostics?.validationFailures.find(
      (item) => item.objectClass === "attachment"
    );
    expect(audioFailure).toMatchObject({
      sourceKind: "public-url",
      errorKind: "Error.SourceFetchFailed",
      failurePhase: "http_status",
      httpStatusFamily: "4xx",
      databaseReferenceCount: 1,
      databaseReferenceIdsTruncated: 0,
      listedLegacyObject: true,
      listedLegacyObjectCount: 1,
      legacyObjectIdsTruncated: 0,
    });
    expect(audioFailure?.failureId).toMatch(/^failure_[a-f0-9]{24}$/);
    expect(audioFailure?.databaseReferenceIds).toEqual([
      expect.stringMatching(/^sub_[a-f0-9]{24}$/),
    ]);
    expect(audioFailure?.legacyObjectIds).toEqual([
      expect.stringMatching(/^obj_[a-f0-9]{24}$/),
    ]);
    expect(attachmentFailure).toMatchObject({
      sourceKind: "public-url",
      errorKind: "Error.SourceFetchFailed",
      failurePhase: "request_failed",
      httpStatusFamily: null,
      databaseReferenceCount: 2,
      listedLegacyObject: true,
      listedLegacyObjectCount: 1,
    });
    expect(attachmentFailure?.databaseReferenceIds).toHaveLength(2);

    const serialized = JSON.stringify(result);
    for (const secret of [
      diagnosticKey,
      publicAudio,
      publicAttachment,
      "sub_public",
      "asg_1",
      "worksheet.pdf",
      "secret provider detail",
    ]) {
      expect(serialized).not.toContain(secret);
    }

    const sameKeyRerun = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      diagnostics: true,
      diagnosticKey,
      config,
      ...dependencies,
    });
    expect(sameKeyRerun.diagnostics?.validationFailures).toEqual(
      result.diagnostics?.validationFailures
    );

    const differentKeyRerun = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      diagnostics: true,
      diagnosticKey: "different-diagnostic-key-material!!",
      config,
      ...dependencies,
    });
    expect(differentKeyRerun.diagnostics?.validationFailures.map((item) => item.failureId)).not.toEqual(
      result.diagnostics?.validationFailures.map((item) => item.failureId)
    );
  });

  it("reports only allowlisted validation categories without leaking error messages", async () => {
    await client.batch(
      [
        {
          sql: "UPDATE submissions SET audio_data = ? WHERE id = 'sub_data'",
          args: [`data:audio/webm;base64,${Buffer.from("not-webm").toString("base64")}`],
        },
        {
          sql: "INSERT INTO submissions VALUES (?, ?, NULL, ?)",
          args: ["sub_bad_data_url", "asg_1", "data:audio/webm,not-base64"],
        },
        {
          sql: "INSERT INTO submissions VALUES (?, ?, NULL, ?)",
          args: [
            "sub_unsupported",
            "asg_1",
            `data:audio/mpeg;base64,${Buffer.from("not-audio").toString("base64")}`,
          ],
        },
      ],
      "write"
    );
    const dependencies = migrationDependencies();
    dependencies.fetchImpl.mockImplementation(async (source: string | URL | Request) => {
      if (String(source) === publicAudio) throw new TypeError("secret source URL failed");
      return new Response(pdf, { headers: { "content-type": "application/pdf" } });
    });

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });

    expect(result.errorKinds).toEqual({
      "Error.SourceFetchFailed": 1,
      "TypeError.InvalidDataUrl": 1,
      "TypeError.MediaSignatureMismatch": 1,
      "TypeError.UnsupportedMediaType": 1,
    });
    expect(result.validation.mediaTypeFindings).toMatchObject({
      "Unsupported->Unknown": 1,
      "audio/webm->Unknown": 1,
    });
    expect(JSON.stringify(result)).not.toContain("secret source URL");
  });

  it("sniffs and safely normalizes mislabeled allowlisted audio", async () => {
    await client.execute("DELETE FROM assignments");
    await client.execute("DELETE FROM submissions WHERE id <> 'sub_public'");
    const dependencies = migrationDependencies();
    dependencies.fetchImpl.mockImplementation(async (source: string | URL | Request) => {
      if (String(source) === publicAudio) {
        return new Response(webm, { headers: { "content-type": "audio/mp4" } });
      }
      return new Response(null, { status: 404 });
    });

    const dryRun = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });
    expect(dryRun.validation).toMatchObject({
      ready: 1,
      failed: 0,
      mediaTypeFindings: { "audio/mp4->audio/webm": 1 },
    });

    const applied = await runMediaMigration({
      client,
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
      config,
      ...dependencies,
    });
    expect(applied.changes).toMatchObject({ audioMigrated: 1, failed: 0 });
    expect(dependencies.blob.put).toHaveBeenCalledWith(
      expect.stringMatching(/\.webm$/),
      webm,
      expect.objectContaining({ contentType: "audio/webm", access: "private" })
    );
  });

  it("keeps the database-declared worksheet type authoritative after byte sniffing", async () => {
    await client.execute("DELETE FROM submissions");
    await client.execute("UPDATE assignments SET attachment_content_type = 'image/png'");
    const dependencies = migrationDependencies();
    dependencies.fetchImpl.mockResolvedValue(
      new Response(pdf, { headers: { "content-type": "image/png" } })
    );

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });

    expect(result.validation).toMatchObject({
      ready: 0,
      failed: 1,
      mediaTypeFindings: { "image/png->application/pdf": 1 },
    });
    expect(result.errorKinds).toEqual({ "TypeError.AttachmentTypeMismatch": 1 });
  });

  it("paginates both legacy prefixes without returning object URLs", async () => {
    const dependencies = migrationDependencies();
    dependencies.blob.list.mockImplementation(async (options: { prefix?: string; cursor?: string }) => {
      if (options.prefix === "submissions/" && !options.cursor) {
        return {
          blobs: [{ url: publicAudio, pathname: "submissions/asg_1/public.webm" }],
          hasMore: true,
          cursor: "audio-page-2",
        };
      }
      if (options.prefix === "submissions/" && options.cursor === "audio-page-2") {
        return {
          blobs: [{ url: orphanPublicAudio, pathname: "submissions/asg_orphan/orphan.webm" }],
          hasMore: false,
        };
      }
      return {
        blobs: [
          {
            url: publicAttachment,
            pathname: "assignment-attachments/asg_1/worksheet.pdf",
          },
        ],
        hasMore: false,
      };
    });

    const result = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });

    expect(result.legacyStore).toMatchObject({ initialInScope: 3, initialUnreferenced: 1 });
    expect(dependencies.blob.list).toHaveBeenCalledWith(
      expect.objectContaining({ prefix: "submissions/", cursor: "audio-page-2" })
    );
    expect(JSON.stringify(result)).not.toContain("blob.vercel-storage.com");
  });

  it("migrates audio, DB data URLs, and shared attachments with private-store options", async () => {
    const dependencies = migrationDependencies();
    const result = await runMediaMigration({
      client,
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
      config,
      ...dependencies,
    });

    expect(result).toMatchObject({
      changes: {
        audioMigrated: 2,
        attachmentReferencesMigrated: 2,
        redundantAudioDataCleared: 1,
        failed: 0,
      },
      publicCleanup: { deleted: 2, failed: 0, pending: 0 },
      legacyStore: { unreferencedDeleted: 1, remainingInScope: 0 },
    });
    expect(dependencies.blob.put).toHaveBeenCalledTimes(3);
    for (const call of dependencies.blob.put.mock.calls) {
      expect(call[2]).toMatchObject({
        access: "private",
        storeId: "store_private",
        token: "private-token",
        addRandomSuffix: false,
      });
    }
    expect(dependencies.blob.del).toHaveBeenCalledWith(
      publicAudio,
      { token: "legacy-token" }
    );
    expect(dependencies.blob.del).toHaveBeenCalledWith(
      publicAttachment,
      { token: "legacy-token" }
    );

    const submissions = await client.execute(
      "SELECT audio_blob_url as audioBlobUrl, audio_data as audioData FROM submissions ORDER BY id"
    );
    expect(submissions.rows.every((row) => row.audioData === null)).toBe(true);
    expect(submissions.rows.every((row) => String(row.audioBlobUrl).startsWith("submissions/"))).toBe(true);
    const assignments = await client.execute("SELECT DISTINCT attachment_url as attachmentUrl FROM assignments");
    expect(assignments.rows).toHaveLength(1);
    expect(String(assignments.rows[0]?.attachmentUrl)).toMatch(/^assignment-attachments\/migrated\//);

    dependencies.blob.put.mockClear();
    dependencies.blob.del.mockClear();
    const rerun = await runMediaMigration({
      client,
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
      config,
      ...dependencies,
    });
    expect(rerun.changes.audioMigrated).toBe(0);
    expect(rerun.changes.attachmentReferencesMigrated).toBe(0);
    expect(rerun.publicCleanup.pending).toBe(0);
    expect(dependencies.blob.put).not.toHaveBeenCalled();
    expect(dependencies.blob.del).not.toHaveBeenCalled();
  });

  it("keeps failed public deletes in a durable retry journal without exposing them in output", async () => {
    const dependencies = migrationDependencies();
    dependencies.blob.del.mockRejectedValue(new Error("provider unavailable for secret URL"));
    const first = await runMediaMigration({
      client,
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
      config,
      ...dependencies,
    });

    expect(first.publicCleanup).toMatchObject({ failed: 2, pending: 2 });
    expect(JSON.stringify(first)).not.toContain("blob.vercel-storage.com");
    expect(JSON.stringify(first)).not.toContain("secret URL");

    const deleteCallsBeforeDryRun = dependencies.blob.del.mock.calls.length;
    const interruptedDryRun = await runMediaMigration({
      client,
      apply: false,
      backupConfirmed: false,
      config,
      ...dependencies,
    });
    expect(interruptedDryRun.publicCleanup.pending).toBe(2);
    expect(interruptedDryRun.legacyStore.initialJournaled).toBe(2);
    expect(dependencies.blob.del).toHaveBeenCalledTimes(deleteCallsBeforeDryRun);

    dependencies.restoreDelete();
    const second = await runMediaMigration({
      client,
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
      config,
      ...dependencies,
    });
    expect(second.publicCleanup).toMatchObject({ deleted: 2, failed: 0, pending: 0 });
  });

  it("compensates a private upload when the conditional database swap fails", async () => {
    await client.execute("DELETE FROM assignments");
    await client.execute("DELETE FROM submissions WHERE id <> 'sub_public'");
    await client.executeMultiple(`
      CREATE TRIGGER reject_media_swap
      BEFORE UPDATE OF audio_blob_url ON submissions
      BEGIN
        SELECT RAISE(ABORT, 'test swap failure');
      END;
    `);
    const dependencies = migrationDependencies();

    const result = await runMediaMigration({
      client,
      apply: true,
      backupConfirmed: true,
      legacyMediaBackupConfirmed: true,
      config,
      ...dependencies,
    });

    expect(result.changes).toMatchObject({
      audioMigrated: 0,
      failed: 1,
      privateOrphansRemoved: 1,
    });
    expect(dependencies.blob.del).toHaveBeenCalledWith(
      expect.stringMatching(/^submissions\/asg_1\/sub_public-migrated-/),
      { storeId: "store_private", token: "private-token" }
    );
    const row = await client.execute(
      "SELECT audio_blob_url as audioBlobUrl FROM submissions WHERE id = 'sub_public'"
    );
    expect(row.rows[0]?.audioBlobUrl).toBe(publicAudio);
  });
});
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
