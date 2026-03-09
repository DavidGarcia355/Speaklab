import "server-only";
import { z, ZodError } from "zod";
import { HttpError } from "@/lib/http";

export const LIMITS = {
  classNameMax: 100,
  assignmentNameMax: 100,
  assignmentDescriptionMax: 500,
  assignmentInstructionsMax: 500,
  studentNameMax: 80,
  feedbackMax: 1000,
  maxAudioBytes: 25 * 1024 * 1024,
} as const;

const HTML_PATTERN = /<[^>]*>/i;
const SCRIPT_PATTERN = /<\/?\s*script\b/i;

function hasUnsafeHtml(value: string) {
  return HTML_PATTERN.test(value) || SCRIPT_PATTERN.test(value);
}

function cleanTextSchema(fieldLabel: string, min: number, max: number, optional = false) {
  const base = z
    .string()
    .transform((value) => value.trim())
    .refine((value) => value.length >= min, `${fieldLabel} must be at least ${min} characters.`)
    .refine((value) => value.length <= max, `${fieldLabel} must be ${max} characters or fewer.`)
    .refine((value) => !hasUnsafeHtml(value), `${fieldLabel} cannot contain HTML or script content.`);
  return optional ? base.optional() : base;
}

export const classCreateSchema = z.object({
  name: cleanTextSchema("Class name", 1, LIMITS.classNameMax),
});

export const classUpdateSchema = classCreateSchema;

export const assignmentCreateSchema = z.object({
  title: cleanTextSchema("Assignment name", 1, LIMITS.assignmentNameMax),
  description: cleanTextSchema("Assignment description", 0, LIMITS.assignmentDescriptionMax, true).default(""),
  instructions: cleanTextSchema("Assignment instructions", 1, LIMITS.assignmentInstructionsMax),
});

export const assignmentUpdateSchema = z.object({
  title: cleanTextSchema("Assignment name", 1, LIMITS.assignmentNameMax),
  instructions: cleanTextSchema("Assignment instructions", 1, LIMITS.assignmentInstructionsMax),
});

export const submissionCreateSchema = z.object({
  studentName: cleanTextSchema("Student name", 1, LIMITS.studentNameMax),
  audioData: z.string().min(1, "Audio data is required."),
});

export const submissionPatchSchema = z
  .object({
    studentName: cleanTextSchema("Student name", 1, LIMITS.studentNameMax, true),
    grade: z
      .number()
      .int("Score must be an integer.")
      .min(0, "Score must be between 0 and 100.")
      .max(100, "Score must be between 0 and 100.")
      .nullable()
      .optional(),
    feedback: cleanTextSchema("Feedback", 0, LIMITS.feedbackMax, true),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable field is required.",
    path: ["_form"],
  });

export type ParsedAudio = {
  mimeType: "audio/webm" | "audio/ogg" | "audio/mp4" | "audio/wav";
  buffer: Buffer;
};

const allowedAudioTypes = new Set<ParsedAudio["mimeType"]>([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
]);

export function parseAudioDataUrl(dataUrl: string): ParsedAudio {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:(audio\/[a-z0-9.+-]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new HttpError(400, "Validation failed.", {
      audioData: ["Audio must be a valid base64 data URL."],
    });
  }

  const mimeType = match[1].toLowerCase() as ParsedAudio["mimeType"];
  if (!allowedAudioTypes.has(mimeType)) {
    throw new HttpError(400, "Validation failed.", {
      audioData: ["Unsupported audio type. Allowed: webm, ogg, mp4, wav."],
    });
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > LIMITS.maxAudioBytes) {
    throw new HttpError(400, "Validation failed.", {
      audioData: ["Audio file is too large. Maximum size is 25MB."],
    });
  }

  return { mimeType, buffer };
}

export function zodErrorToFieldErrors(error: ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  const flattened = error.flatten();

  for (const [key, messages] of Object.entries(flattened.fieldErrors as Record<string, string[] | undefined>)) {
    if (Array.isArray(messages) && messages.length > 0) {
      fieldErrors[key] = messages;
    }
  }
  if (flattened.formErrors.length > 0) {
    fieldErrors._form = flattened.formErrors;
  }
  return fieldErrors;
}

export function parseOrThrow400<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, "Validation failed.", zodErrorToFieldErrors(result.error));
  }
  return result.data;
}
