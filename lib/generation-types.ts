import type { VideoSeconds } from "./video-config";

export type JobStatus =
  | "draft" | "submitting" | "submission_unknown" | "queued" | "in_progress"
  | "completed" | "archiving" | "ready" | "archive_failed" | "stalled"
  | "failed" | "moderation_blocked" | "cancelled" | "expired";

export type GenerationRequest = {
  prompt: string;
  model: "sora-2" | "sora-2-pro";
  seconds: VideoSeconds;
  size: string;
  reference?: { name: string; type: "image/jpeg" | "image/png" | "image/webp"; path: string };
  /** @deprecated Legacy migration field. New requests always create one job. */
  variations?: 1 | 2 | 4;
};

export type ApiError = {
  code: string;
  message: string;
  retryable: boolean;
  jobId?: string;
  batchId?: string;
  providerRequestId?: string | null;
  clientRequestId?: string | null;
};
