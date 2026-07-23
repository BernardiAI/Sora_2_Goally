import type { GenerationRequest } from "./generation-types";
import { estimateVideoCents } from "./video-config";

export function unitEstimateCents(request: Pick<GenerationRequest, "model" | "size" | "seconds">) {
  return estimateVideoCents(request.model, request.size, request.seconds);
}

export function batchEstimateCents(request: GenerationRequest) {
  return unitEstimateCents(request) * (request.variations ?? 1);
}

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
