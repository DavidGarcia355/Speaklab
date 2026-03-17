import "server-only";
import { z, ZodError } from "zod";
import { HttpError } from "@/lib/http";

export const LIMITS = {
  classNameMax: 100,
  assignmentNameMax: 100,
  assignmentDescriptionMax: 500,
  assignmentInstructionsMax: 500,
  assignmentPointsMin: 1,
  assignmentPointsMax: 1000,
  rubricTitleMax: 80,
  rubricCriteriaMax: 8,
  rubricCriterionNameMax: 60,
  rubricCriterionDescriptionMax: 120,
  attachmentNameMax: 120,
  maxAttachmentBytes: 10 * 1024 * 1024,
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

const rubricCriterionSchema = z.object({
  id: cleanTextSchema("Criterion id", 1, 100),
  name: cleanTextSchema("Criterion name", 1, LIMITS.rubricCriterionNameMax),
  description: cleanTextSchema(
    "Criterion description",
    0,
    LIMITS.rubricCriterionDescriptionMax,
    true
  ).default(""),
  maxPoints: z
    .number()
    .int("Criterion points must be a whole number.")
    .min(1, "Criterion points must be at least 1.")
    .max(LIMITS.assignmentPointsMax, `Criterion points must be ${LIMITS.assignmentPointsMax} or fewer.`),
});

export const rubricSchema = z
  .object({
    title: cleanTextSchema("Rubric title", 1, LIMITS.rubricTitleMax),
    criteria: z
      .array(rubricCriterionSchema)
      .min(1, "Rubric must include at least one criterion.")
      .max(LIMITS.rubricCriteriaMax, `Rubric can include at most ${LIMITS.rubricCriteriaMax} criteria.`),
  })
  .superRefine((value, context) => {
    const total = value.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
    if (total < LIMITS.assignmentPointsMin || total > LIMITS.assignmentPointsMax) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Rubric total must be between ${LIMITS.assignmentPointsMin} and ${LIMITS.assignmentPointsMax}.`,
        path: ["criteria"],
      });
    }
  });

const rubricScoreSchema = z.object({
  criterionId: cleanTextSchema("Criterion id", 1, 100),
  criterionName: cleanTextSchema("Criterion name", 1, LIMITS.rubricCriterionNameMax),
  maxPoints: z
    .number()
    .int("Criterion points must be a whole number.")
    .min(1, "Criterion points must be at least 1.")
    .max(LIMITS.assignmentPointsMax, `Criterion points must be ${LIMITS.assignmentPointsMax} or fewer.`),
  awarded: z
    .number()
    .int("Criterion score must be a whole number.")
    .min(0, "Criterion score must be 0 or higher."),
});

export const assignmentCreateSchema = z.object({
  title: cleanTextSchema("Assignment name", 1, LIMITS.assignmentNameMax),
  description: cleanTextSchema("Assignment description", 0, LIMITS.assignmentDescriptionMax, true).default(""),
  instructions: cleanTextSchema("Assignment instructions", 1, LIMITS.assignmentInstructionsMax),
  maxPoints: z
    .number()
    .int("Points possible must be a whole number.")
    .min(LIMITS.assignmentPointsMin, `Points possible must be at least ${LIMITS.assignmentPointsMin}.`)
    .max(LIMITS.assignmentPointsMax, `Points possible must be ${LIMITS.assignmentPointsMax} or fewer.`),
  attachment: z
    .object({
      fileName: cleanTextSchema("Attachment file name", 1, LIMITS.attachmentNameMax),
      dataUrl: z.string().min(1, "Attachment data is required."),
    })
    .nullable()
    .optional(),
  existingAttachment: z
    .object({
      fileName: cleanTextSchema("Attachment file name", 1, LIMITS.attachmentNameMax),
      url: z.string().trim().url("Attachment URL must be valid."),
      contentType: z.enum(["application/pdf", "image/png", "image/jpeg"]),
    })
    .nullable()
    .optional(),
  rubric: rubricSchema.nullable().optional(),
}).superRefine((value, context) => {
  if (value.attachment && value.existingAttachment) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose either a new attachment upload or an existing attachment copy.",
      path: ["attachment"],
    });
  }
});

export const assignmentUpdateSchema = z.object({
  title: cleanTextSchema("Assignment name", 1, LIMITS.assignmentNameMax),
  instructions: cleanTextSchema("Assignment instructions", 1, LIMITS.assignmentInstructionsMax),
  maxPoints: z
    .number()
    .int("Points possible must be a whole number.")
    .min(LIMITS.assignmentPointsMin, `Points possible must be at least ${LIMITS.assignmentPointsMin}.`)
    .max(LIMITS.assignmentPointsMax, `Points possible must be ${LIMITS.assignmentPointsMax} or fewer.`),
  attachment: z
    .object({
      fileName: cleanTextSchema("Attachment file name", 1, LIMITS.attachmentNameMax),
      dataUrl: z.string().min(1, "Attachment data is required."),
    })
    .nullable()
    .optional(),
  rubric: rubricSchema.nullable().optional(),
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
      .min(0, "Score must be 0 or higher.")
      .max(LIMITS.assignmentPointsMax, `Score must be ${LIMITS.assignmentPointsMax} or fewer.`)
      .nullable()
      .optional(),
    feedback: cleanTextSchema("Feedback", 0, LIMITS.feedbackMax, true),
    rubricScores: z.array(rubricScoreSchema).optional(),
  })
  .superRefine((value, context) => {
    if (value.rubricScores) {
      for (const [index, score] of value.rubricScores.entries()) {
        if (score.awarded > score.maxPoints) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Criterion score cannot exceed its max points.",
            path: ["rubricScores", index, "awarded"],
          });
        }
      }
    }
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one editable field is required.",
    path: ["_form"],
  });

export const feedbackCreateSchema = z.object({
  name: cleanTextSchema("Name", 1, 80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email must be valid.")
    .max(254, "Email must be 254 characters or fewer."),
  school: cleanTextSchema("School", 1, 120),
  role: cleanTextSchema("Role", 1, 80),
  message: cleanTextSchema("Message", 10, 1000),
});

export type ParsedAudio = {
  mimeType: "audio/webm" | "audio/ogg" | "audio/mp4" | "audio/wav";
  buffer: Buffer;
};

export type ParsedAttachment = {
  mimeType: "application/pdf" | "image/png" | "image/jpeg";
  buffer: Buffer;
};

export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;
export type Rubric = z.infer<typeof rubricSchema>;
export type RubricScore = z.infer<typeof rubricScoreSchema>;

const allowedAudioTypes = new Set<ParsedAudio["mimeType"]>([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/wav",
]);

const allowedAttachmentTypes = new Set<ParsedAttachment["mimeType"]>([
  "application/pdf",
  "image/png",
  "image/jpeg",
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

export function parseAttachmentDataUrl(dataUrl: string): ParsedAttachment {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([a-z0-9/+.-]+);base64,([a-z0-9+/=]+)$/i);
  if (!match) {
    throw new HttpError(400, "Validation failed.", {
      attachment: ["Attachment must be a valid base64 data URL."],
    });
  }

  const mimeType = match[1].toLowerCase() as ParsedAttachment["mimeType"];
  if (!allowedAttachmentTypes.has(mimeType)) {
    throw new HttpError(400, "Validation failed.", {
      attachment: ["Attachment must be a PDF, PNG, or JPG file."],
    });
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.byteLength > LIMITS.maxAttachmentBytes) {
    throw new HttpError(400, "Validation failed.", {
      attachment: ["Attachment is too large. Maximum size is 10MB."],
    });
  }

  return { mimeType, buffer };
}

export function rubricTotalPoints(rubric: Rubric) {
  return rubric.criteria.reduce((sum, criterion) => sum + criterion.maxPoints, 0);
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
