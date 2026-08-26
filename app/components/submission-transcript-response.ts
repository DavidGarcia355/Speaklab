type JsonObject = Record<string, unknown>;

export type ParsedTranscriptResponse = {
  transcript: string | null;
  status: string;
  message: string;
  error: string;
};

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function transcriptFrom(container: JsonObject) {
  const direct = cleanString(container.transcript);
  if (direct) return direct;

  const nestedTranscript = asObject(container.transcript);
  if (nestedTranscript) {
    const nested = cleanString(nestedTranscript.text) || cleanString(nestedTranscript.transcript);
    if (nested) return nested;
  }

  return cleanString(container.text);
}

function errorFrom(value: unknown) {
  const direct = cleanString(value);
  if (direct) return direct;
  const nested = asObject(value);
  return nested ? cleanString(nested.message) || cleanString(nested.error) : "";
}

export function parseTranscriptResponse(value: unknown): ParsedTranscriptResponse {
  const root = asObject(value);
  if (!root) return { transcript: null, status: "", message: "", error: "" };

  const containers = [root, asObject(root.item), asObject(root.result), asObject(root.data)].filter(
    (item): item is JsonObject => item !== null,
  );
  const transcript = containers.map(transcriptFrom).find(Boolean) || null;
  const status = containers
    .map((container) => cleanString(container.status))
    .find(Boolean)
    ?.toLowerCase() ?? "";
  const message = containers.map((container) => cleanString(container.message)).find(Boolean) ?? "";
  const error = errorFrom(root.error) || containers.map((container) => errorFrom(container.error)).find(Boolean) || "";

  return { transcript, status, message, error };
}
