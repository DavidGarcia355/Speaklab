import type { GradingConfig, GradingModelConfig } from "@/lib/grading/config";
import type { GradingAssignment } from "@/lib/grading/contracts";

const DIRECT_GEMINI_AUDIO_TYPES = new Set([
  "audio/aac",
  "audio/aiff",
  "audio/flac",
  "audio/mpeg",
  "audio/mp3",
  "audio/ogg",
  "audio/wav",
  "audio/x-aiff",
  "audio/x-wav",
]);

const AUDIO_ONLY_RUBRIC =
  /\b(?:pronunciation|prosody|pacing|intonation|fluency|accent|delivery|volume|voice|audio quality)\b/i;

export type TextRouteDecision = {
  model: GradingModelConfig;
  forceEscalation: boolean;
  reasons: string[];
};

export type AudioRouteDecision = {
  strategy: "gemini_direct" | "transcribe_then_grade";
  model: GradingModelConfig;
  upload: "inline" | "files_api" | "transcription_provider";
  requiresTeacherReview: boolean;
  reasons: string[];
};

function normalizedContentType(contentType: string) {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() || "application/octet-stream";
}

export function assignmentNeedsAudioEvidence(assignment: GradingAssignment) {
  const trustedText = [
    assignment.question,
    assignment.instructions,
    ...(assignment.rubric?.criteria.map((criterion) => criterion.description) ?? []),
  ].join("\n");
  return AUDIO_ONLY_RUBRIC.test(trustedText);
}

/**
 * Text length changes risk and latency much more than price at TryHabla's scale.
 * Short/ordinary work stays on the cheapest configured model; high-risk work
 * starts on the verification model instead of paying for two predictable calls.
 */
export function routeTextGrading(input: {
  config: GradingConfig;
  assignment: GradingAssignment;
  answerCharacters: number;
  enhanced?: boolean;
  promptInjectionDetected?: boolean;
}): TextRouteDecision {
  const reasons: string[] = [];
  if (input.enhanced) reasons.push("teacher_requested_enhanced_grading");
  if (input.promptInjectionDetected) reasons.push("prompt_injection_detected");
  if (input.answerCharacters > input.config.unusuallyLongAnswerChars) {
    reasons.push("unusually_long_answer");
  }
  if (assignmentNeedsAudioEvidence(input.assignment)) reasons.push("audio_evidence_required");

  const forceEscalation = reasons.length > 0;
  return {
    model: forceEscalation ? input.config.escalationModel : input.config.defaultModel,
    forceEscalation,
    reasons,
  };
}

/**
 * Duration determines Gemini audio-token spend. File bytes only determine
 * whether an inline request is safe; files above the inline safety limit use
 * the temporary Files API. Unsupported containers retain the proven STT path.
 */
export function routeAudioGrading(input: {
  config: GradingConfig;
  assignment: GradingAssignment;
  contentType: string;
  byteLength: number;
  durationSeconds?: number;
  enhanced?: boolean;
}): AudioRouteDecision {
  const contentType = normalizedContentType(input.contentType);
  const reasons: string[] = [];
  const audioEvidenceRequired = assignmentNeedsAudioEvidence(input.assignment);
  const supported =
    DIRECT_GEMINI_AUDIO_TYPES.has(contentType) ||
    (contentType === "audio/webm" && input.config.experimentalGeminiWebm);
  const directRequested = input.config.audioStrategy === "gemini_direct";
  const transcriptionRequested = input.config.audioStrategy === "transcribe_then_grade";
  const googleConfigured = Boolean(process.env.GOOGLE_API_KEY?.trim());

  if (!supported) reasons.push(`unsupported_direct_audio_type:${contentType}`);
  if (!googleConfigured) reasons.push("google_api_key_unavailable");
  if (transcriptionRequested) reasons.push("transcription_strategy_configured");

  const useDirect =
    !transcriptionRequested &&
    supported &&
    googleConfigured &&
    (directRequested || input.config.audioStrategy === "auto");

  if (!useDirect) {
    if (audioEvidenceRequired) reasons.push("transcript_cannot_verify_audio_only_criteria");
    return {
      strategy: "transcribe_then_grade",
      model: input.config.defaultModel,
      upload: "transcription_provider",
      requiresTeacherReview: audioEvidenceRequired,
      reasons,
    };
  }

  const duration = Math.max(0, input.durationSeconds ?? 0);
  const useEscalationModel =
    Boolean(input.enhanced) ||
    audioEvidenceRequired ||
    duration > input.config.audioEscalationSeconds;
  if (input.enhanced) reasons.push("teacher_requested_enhanced_grading");
  if (audioEvidenceRequired) reasons.push("audio_evidence_required");
  if (duration > input.config.audioEscalationSeconds) reasons.push("long_audio");

  // Base64 and JSON overhead make a nominal 20 MB request unsafe near the cap.
  const upload = input.byteLength <= 15 * 1024 * 1024 ? "inline" : "files_api";
  if (upload === "files_api") reasons.push("large_file_uses_temporary_upload");
  return {
    strategy: "gemini_direct",
    model: useEscalationModel ? input.config.audioEscalationModel : input.config.audioModel,
    upload,
    requiresTeacherReview: false,
    reasons,
  };
}

export function isDirectGeminiAudioType(contentType: string) {
  return DIRECT_GEMINI_AUDIO_TYPES.has(normalizedContentType(contentType));
}
