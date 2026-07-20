import type { GenerationRequest } from "./generation-types";
import { providerVideoSeconds } from "./video-config";

export function unitEstimateCents(request: Pick<GenerationRequest, "model" | "size" | "seconds">) {
  const rate = request.model === "sora-2" ? 10
    : /1920|1080/.test(request.size) ? 70
    : /1792|1024/.test(request.size) ? 50 : 30;
  return rate * Number(providerVideoSeconds(request.seconds));
}

export function batchEstimateCents(request: GenerationRequest) {
  return unitEstimateCents(request) * (request.variations ?? 1);
}

export function formatUsd(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
