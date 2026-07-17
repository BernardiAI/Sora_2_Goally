export const VIDEO_MODELS = ["sora-2", "sora-2-pro"] as const;
export const VIDEO_SECONDS = ["4", "8", "12"] as const;
export const VIDEO_SIZES = {
  "sora-2": ["1280x720", "720x1280"],
  "sora-2-pro": ["1280x720", "720x1280", "1792x1024", "1024x1792", "1920x1080", "1080x1920"],
} as const;

export type VideoModel = (typeof VIDEO_MODELS)[number];
export type VideoSeconds = (typeof VIDEO_SECONDS)[number];

export function estimateVideoCents(model: VideoModel, size: string, seconds: VideoSeconds) {
  const rate = model === "sora-2" ? 10 : /1920|1080/.test(size) ? 70 : /1792|1024/.test(size) ? 50 : 30;
  return rate * Number(seconds);
}

export function isValidVideoRequest(value: any) {
  const model = VIDEO_MODELS.includes(value?.model);
  const seconds = VIDEO_SECONDS.includes(String(value?.seconds) as VideoSeconds);
  const size = model && (VIDEO_SIZES[value.model as VideoModel] as readonly string[]).includes(value?.size);
  return Boolean(typeof value?.prompt === "string" && value.prompt.trim() && model && seconds && size);
}
