import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_DRIVE_FILE_SCOPE,
  GoogleDriveExportError,
  TRYHABLA_DRIVE_FOLDER_NAME,
  exportSubmissionToGoogleDrive,
  fetchProtectedSubmissionAssets,
  parseGoogleDrivePublicConfig,
  protectedSubmissionAssetUrls,
  sanitizeStudentDriveFolderName,
} from "@/lib/google-drive/export";
import {
  loadGoogleIdentityServices,
  requestGoogleDriveAccessToken,
  resetGoogleIdentityLoaderForTests,
} from "@/lib/google-drive/google-identity";

type FetchCall = {
  url: string;
  init: RequestInit;
};

function json(value: unknown, init?: ResponseInit) {
  return Response.json(value, init);
}

function headerValue(init: RequestInit, name: string) {
  return new Headers(init.headers).get(name);
}

function createNewExportFetch() {
  const calls: FetchCall[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });

    if (url.endsWith("/transcript")) {
      return json({ item: { transcript: "  Hola, me llamo Sandra.  " } });
    }
    if (url.endsWith("/audio")) {
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "Content-Type": "audio/ogg" },
      });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?") && init.method === "GET") {
      return json({ files: [] });
    }
    if (url.startsWith("https://www.googleapis.com/drive/v3/files?") && init.method === "POST") {
      const metadata = JSON.parse(String(init.body)) as { name: string };
      if (metadata.name === TRYHABLA_DRIVE_FOLDER_NAME) {
        return json({ id: "root-folder", name: metadata.name });
      }
      return json({ id: "student-folder", name: metadata.name });
    }
    if (url.includes("uploadType=multipart")) {
      return json({ id: "transcript-file", name: "transcript.txt" });
    }
    if (url.includes("upload_id=session-1")) {
      return json({ id: "audio-file", name: "recording.ogg" });
    }
    if (url.includes("uploadType=resumable")) {
      return new Response(null, {
        status: 200,
        headers: {
          Location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=session-1",
        },
      });
    }
    throw new Error(`Unexpected fetch: ${init.method ?? "GET"} ${url}`);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  resetGoogleIdentityLoaderForTests();
});

describe("Google Drive export privacy boundaries", () => {
  it("requests exactly drive.file after the teacher clicks and handles cancellation", async () => {
    let capturedConfig: Record<string, unknown> | null = null;
    let requestedPrompt = "";
    vi.stubGlobal("document", {});
    vi.stubGlobal("window", {
      google: {
        accounts: {
          oauth2: {
            initTokenClient(config: Record<string, unknown>) {
              capturedConfig = config;
              return {
                requestAccessToken(options?: { prompt?: string }) {
                  requestedPrompt = options?.prompt ?? "";
                  const callback = config.callback as (response: unknown) => void;
                  callback({ access_token: "ephemeral-token", scope: GOOGLE_DRIVE_FILE_SCOPE });
                },
              };
            },
          },
        },
      },
    });

    await expect(requestGoogleDriveAccessToken("client-id")).resolves.toBe("ephemeral-token");
    expect(capturedConfig).toMatchObject({
      client_id: "client-id",
      scope: GOOGLE_DRIVE_FILE_SCOPE,
      include_granted_scopes: false,
    });
    const requestedScope = String((capturedConfig as Record<string, unknown> | null)?.scope);
    expect(requestedScope).not.toContain("https://www.googleapis.com/auth/drive ");
    expect(requestedScope).not.toContain("drive.readonly");
    expect(requestedPrompt).toBe("");

    vi.stubGlobal("window", {
      google: {
        accounts: {
          oauth2: {
            initTokenClient(config: Record<string, unknown>) {
              return {
                requestAccessToken() {
                  const errorCallback = config.error_callback as (error: unknown) => void;
                  errorCallback({ type: "popup_closed" });
                },
              };
            },
          },
        },
      },
    });
    await expect(requestGoogleDriveAccessToken("client-id")).rejects.toMatchObject({
      code: "cancelled",
      message: "Google Drive export canceled. Nothing was uploaded.",
    });
  });

  it("fails cleanly when an existing Google Identity script never becomes usable", async () => {
    vi.useFakeTimers();
    const script = new EventTarget();
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
    });
    vi.stubGlobal("document", {
      querySelector: () => script,
      createElement: vi.fn(),
    });

    const loading = loadGoogleIdentityServices();
    const rejection = expect(loading).rejects.toMatchObject({
      code: "network",
      message: "Google Drive sign-in took too long to load. Check the internet connection and try again.",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
  });

  it("only fetches protected same-origin transcript and audio routes", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      expect(url.startsWith("/api/submissions/")).toBe(true);
      expect(init?.credentials).toBe("same-origin");
      expect(init?.cache).toBe("no-store");
      return url.endsWith("/transcript")
        ? json({ item: { transcript: "Bonjour." } })
        : new Response(new Uint8Array([9]), { headers: { "Content-Type": "audio/webm" } });
    }) as unknown as typeof fetch;

    expect(protectedSubmissionAssetUrls("sub/id ?")).toEqual({
      transcript: "/api/submissions/sub%2Fid%20%3F/transcript",
      audio: "/api/submissions/sub%2Fid%20%3F/audio",
    });
    const assets = await fetchProtectedSubmissionAssets({ submissionId: "sub/id ?", fetchImpl });
    expect(assets.transcript).toBe("Bonjour.");
    expect(assets.audio.type).toBe("audio/webm");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails before contacting Drive when a protected source is unusable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      return String(input).endsWith("/transcript")
        ? json({ item: null })
        : new Response(new Uint8Array([1]), { headers: { "Content-Type": "audio/webm" } });
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(exportSubmissionToGoogleDrive({
      accessToken: "token",
      submissionId: "sub-1",
      studentName: "Sandra",
      filenameBase: "TryHabla - Sandra - Task",
      fetchImpl,
    })).rejects.toMatchObject({ code: "source" });
    expect(fetchMock.mock.calls.every(([input]) => String(input).startsWith("/api/submissions/"))).toBe(true);
  });
});

describe("Google Drive export delivery", () => {
  it("creates a clear portfolio hierarchy and exports UTF-8 transcript plus MIME-preserved resumable audio", async () => {
    const { calls, fetchImpl } = createNewExportFetch();
    const result = await exportSubmissionToGoogleDrive({
      accessToken: "short-lived-secret-token",
      submissionId: "sub-123",
      studentName: "Sandra Sosa sandra@example.edu",
      filenameBase: "TryHabla - Sandra - Mi respuesta",
      fetchImpl,
    });

    expect(result).toEqual({
      folderId: "student-folder",
      folderUrl: "https://drive.google.com/drive/folders/student-folder",
      transcriptFileId: "transcript-file",
      audioFileId: "audio-file",
    });

    const folderCreates = calls.filter((call) =>
      call.url.startsWith("https://www.googleapis.com/drive/v3/files?") && call.init.method === "POST",
    );
    expect(folderCreates).toHaveLength(2);
    const rootMetadata = JSON.parse(String(folderCreates[0]?.init.body));
    const studentMetadata = JSON.parse(String(folderCreates[1]?.init.body));
    expect(rootMetadata).toMatchObject({
      name: TRYHABLA_DRIVE_FOLDER_NAME,
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { tryhablaFolder: "oral-portfolios-v1" },
    });
    expect(studentMetadata.name).toBe("Student - Sandra Sosa");
    expect(JSON.stringify(studentMetadata)).not.toContain("example.edu");
    expect(JSON.stringify(studentMetadata)).not.toContain("@");

    const transcriptUpload = calls.find((call) => call.url.includes("uploadType=multipart"));
    expect(transcriptUpload?.init.method).toBe("POST");
    expect(headerValue(transcriptUpload!.init, "Content-Type")).toContain("multipart/related");
    const transcriptBody = await (transcriptUpload?.init.body as Blob).text();
    expect(transcriptBody).toContain("text/plain;charset=utf-8");
    expect(transcriptBody).toContain("Hola, me llamo Sandra.\n");
    expect(transcriptBody).toContain('"tryhablaSubmissionId":"sub-123"');
    expect(transcriptBody).toContain('"tryhablaAssetKind":"transcript"');

    const resumableStart = calls.find((call) => call.url.includes("uploadType=resumable") && !call.url.includes("upload_id="));
    expect(resumableStart?.init.method).toBe("POST");
    expect(headerValue(resumableStart!.init, "X-Upload-Content-Type")).toBe("audio/ogg");
    expect(headerValue(resumableStart!.init, "X-Upload-Content-Length")).toBe("4");
    expect(JSON.parse(String(resumableStart?.init.body))).toMatchObject({
      mimeType: "audio/ogg",
      appProperties: {
        tryhablaSubmissionId: "sub-123",
        tryhablaAssetKind: "audio",
      },
    });
    const audioPut = calls.find((call) => call.url.includes("upload_id=session-1"));
    expect(audioPut?.init.method).toBe("PUT");
    expect((audioPut?.init.body as Blob).type).toBe("audio/ogg");
    expect(headerValue(audioPut!.init, "Authorization")).toBeNull();

    for (const call of calls.filter((item) => item.url.startsWith("https://www.googleapis.com") && !item.url.includes("upload_id="))) {
      expect(headerValue(call.init, "Authorization")).toBe("Bearer short-lived-secret-token");
      expect(call.url).not.toContain("short-lived-secret-token");
      expect(String(call.init.body ?? "")).not.toContain("short-lived-secret-token");
    }
  });

  it("updates prior assets on retry instead of creating duplicates", async () => {
    const calls: FetchCall[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith("/transcript")) return json({ item: { transcript: "Retry-safe text" } });
      if (url.endsWith("/audio")) {
        return new Response(new Uint8Array([5, 6]), { headers: { "Content-Type": "audio/mp4" } });
      }
      if (url.startsWith("https://www.googleapis.com/drive/v3/files?") && init.method === "GET") {
        const q = new URL(url).searchParams.get("q") ?? "";
        if (q.includes("oral-portfolios-v1")) return json({ files: [{ id: "root-folder" }] });
        if (q.includes("student-portfolio-v1")) return json({ files: [{ id: "student-folder" }] });
        if (q.includes("value='transcript'")) return json({ files: [{ id: "old-transcript" }] });
        if (q.includes("value='audio'")) return json({ files: [{ id: "old-audio" }] });
      }
      if (url.includes("/old-transcript?") && url.includes("uploadType=multipart")) {
        return json({ id: "old-transcript" });
      }
      if (url.includes("/old-audio?") && url.includes("uploadType=resumable")) {
        return new Response(null, {
          headers: {
            Location: "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&upload_id=retry",
          },
        });
      }
      if (url.includes("upload_id=retry")) return json({ id: "old-audio" });
      throw new Error(`Unexpected fetch: ${init.method ?? "GET"} ${url}`);
    }) as unknown as typeof fetch;

    const result = await exportSubmissionToGoogleDrive({
      accessToken: "token",
      submissionId: "sub-retry",
      studentName: "Ana O'Brien",
      filenameBase: "TryHabla retry",
      fetchImpl,
    });
    expect(result.transcriptFileId).toBe("old-transcript");
    expect(result.audioFileId).toBe("old-audio");
    expect(calls.some((call) => call.init.method === "PATCH" && call.url.includes("old-transcript"))).toBe(true);
    expect(calls.some((call) => call.init.method === "PATCH" && call.url.includes("old-audio"))).toBe(true);
    expect(calls.some((call) =>
      call.init.method === "POST" && call.url.startsWith("https://www.googleapis.com/drive/v3/files"),
    )).toBe(false);
    const studentQuery = calls
      .filter((call) => call.init.method === "GET")
      .map((call) => new URL(call.url).searchParams.get("q") ?? "")
      .find((query) => query.includes("student-portfolio-v1"));
    expect(studentQuery).toContain("name = 'Student - Ana O\\'Brien'");
  });

  it("rejects an upload session outside the Google Drive API origin", async () => {
    const { fetchImpl } = createNewExportFetch();
    const unsafeFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetchImpl(input, init);
      if (String(input).includes("uploadType=resumable")) {
        return new Response(null, { headers: { Location: "https://evil.example/upload" } });
      }
      return response;
    }) as unknown as typeof fetch;

    await expect(exportSubmissionToGoogleDrive({
      accessToken: "token",
      submissionId: "sub-unsafe",
      studentName: "Student",
      filenameBase: "TryHabla",
      fetchImpl: unsafeFetch,
    })).rejects.toMatchObject({
      code: "drive",
      message: "Google Drive returned an unsafe recording upload address.",
    });
  });
});

describe("Google Drive presentation helpers", () => {
  it("parses nested and flat public config but fails closed without a client ID", () => {
    expect(parseGoogleDrivePublicConfig({
      googleDriveExport: { enabled: true, clientId: "client-id" },
    })).toEqual({ enabled: true, clientId: "client-id" });
    expect(parseGoogleDrivePublicConfig({
      googleDriveExportEnabled: true,
      googleDriveClientId: "flat-client-id",
    })).toEqual({ enabled: true, clientId: "flat-client-id" });
    expect(parseGoogleDrivePublicConfig({ googleDriveExport: { enabled: true } }))
      .toEqual({ enabled: false, clientId: "" });
  });

  it("sanitizes student folders and removes email addresses from Drive metadata", () => {
    expect(sanitizeStudentDriveFolderName("  Ana / García (ana@school.edu)  "))
      .toBe("Student - Ana García ( )");
  });

  it("uses a typed, friendly authorization error", () => {
    expect(new GoogleDriveExportError("authorization", "Reconnect")).toMatchObject({
      name: "GoogleDriveExportError",
      code: "authorization",
      message: "Reconnect",
    });
  });
});
