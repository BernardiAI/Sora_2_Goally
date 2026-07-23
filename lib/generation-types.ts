import type { VideoSeconds } from "./video-config";

export type JobStatus =
  | "draft" | "submitting" | "submission_unknown" | "queued" | "in_progress"
  | "completed" | "archiving" | "ready" | "archive_failed" | "stalled"
  | "failed" | "moderation_blocked" | "cancelled" | "expired";

export type ContinuityMode = "extend" | "edit";

export type ContinuityRequest = {
  mode: ContinuityMode;
  sourceJobId: string;
  sourceProviderVideoId: string;
  chainRootJobId: string;
  extensionDepth: number;
  sourceTotalSeconds: number;
  appendedSeconds?: VideoSeconds;
};

export type GenerationRequest = {
  prompt: string;
  finalPrompt?: string;
  dialogue?: string;
  audioDirection?: string;
  consistencyGuardrails?: boolean;
  model: "sora-2" | "sora-2-pro";
  seconds: VideoSeconds;
  /** Delivered length. For an extension this includes the source plus the new segment. */
  totalSeconds?: number;
  size: string;
  continuity?: ContinuityRequest;
  reference?: { name: string; type: "image/jpeg" | "image/png" | "image/webp"; path: string };
  referencePhotos?: Array<{ name: string; type: "image/jpeg" | "image/png" | "image/webp"; path: string }>;
  referencePhotoGuidance?: string;
  videoReference?: { name: string; type: "video/mp4"; path: string; characterName?: string; selectedStart?: number; selectedDuration?: number; characterId?: string };
  videoReferences?: Array<{ name: string; type: "video/mp4"; path: string; characterName: string; description: string; selectedStart?: number; selectedDuration?: number; characterId?: string }>;
  characters?: Array<{ id: string; name: string; description: string }>;
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
