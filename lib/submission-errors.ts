export function submissionLimitReachedMessage(maxSubmissions: number) {
  return `You have reached the maximum of ${maxSubmissions} submission${
    maxSubmissions === 1 ? "" : "s"
  } for this assignment. Delete an ungraded recording from My Recordings, or ask your teacher to allow another attempt.`;
}

export class SubmissionLimitReachedError extends Error {
  readonly maxSubmissions: number;

  constructor(maxSubmissions: number) {
    super(submissionLimitReachedMessage(maxSubmissions));
    this.name = "SubmissionLimitReachedError";
    this.maxSubmissions = maxSubmissions;
  }
}

export class DuplicateSubmissionError extends Error {
  constructor() {
    super("Looks like this recording was already submitted. Please wait before submitting again.");
    this.name = "DuplicateSubmissionError";
  }
}
