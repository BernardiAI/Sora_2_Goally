import { expect, test } from "@playwright/test";

async function mockSuccessfulGeneration(page: import("@playwright/test").Page) {
  let statusReads = 0;
  await page.route("**/api/health", (route) => route.fulfill({ json: { configured: true } }));
  await page.route("**/api/videos?*", (route) => {
    statusReads += 1;
    return route.fulfill({ json: statusReads === 1
      ? { id: "video_mock", status: "in_progress", progress: 42 }
      : { id: "video_mock", status: "completed", progress: 100 } });
  });
  await page.route("**/api/videos", async (route) => {
    if (route.request().method() === "POST") return route.fulfill({ json: { id: "video_mock", status: "queued" } });
    return route.continue();
  });
  await page.route("**/api/videos/video_mock/content", (route) => route.fulfill({
    status: 200,
    contentType: "video/mp4",
    body: Buffer.from("mock video"),
  }));
}

test("shows a focused Studio with sensible defaults", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({ json: { configured: false } }));
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
  await expect(page.getByLabel("Prompt")).toBeFocused();
  await expect(page.getByRole("button", { name: "Generate clip" })).toBeDisabled();
  await expect(page.getByText("$0.40", { exact: true })).toBeVisible();
  await expect(page.getByText("One 4-second clip · Sora 2 · 1280 × 720", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
  await expect(page.getByText("Variations", { exact: true })).toHaveCount(0);
});

test("uses real output controls and confirms the selected values", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({ json: { configured: true } }));
  await page.goto("/");
  await page.locator("summary").click();
  await page.getByLabel("Model").selectOption("sora-2-pro");
  await page.getByLabel("Duration").selectOption("8");
  await page.getByLabel("Orientation").selectOption("portrait");
  await page.getByLabel("Resolution").selectOption("1080x1920");
  await page.getByLabel("Prompt").fill("A paper kite rises above a windswept field.");

  await expect(page.getByText("$5.60", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Generate clip" }).click();
  const dialog = page.getByRole("dialog", { name: "Confirm your clip" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Sora 2 Pro", { exact: true })).toBeVisible();
  await expect(dialog.getByText("8 seconds", { exact: true })).toBeVisible();
  await expect(dialog.getByText("1080 × 1920", { exact: true })).toBeVisible();
  await expect(dialog.getByText("$5.60", { exact: true })).toBeVisible();
});

test("creates exactly one clip and exposes playback and download", async ({ page }) => {
  await mockSuccessfulGeneration(page);
  let postCount = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/videos") postCount += 1;
  });
  await page.goto("/");
  await page.getByLabel("Prompt").fill("A blue marble rolls across a white table.");
  await page.getByRole("button", { name: "Generate clip" }).click();
  await page.getByRole("button", { name: "Confirm & generate" }).click();

  await expect(page.getByText("Creating your clip", { exact: true })).toBeVisible();
  await expect(page.locator("video.generated-video")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("link", { name: "Download" })).toHaveAttribute("href", "/api/videos/video_mock/content");
  expect(postCount).toBe(1);
  await expect(page.getByText("Recent clips", { exact: true })).toHaveCount(0);
});

test("keeps the prompt and shows an inline error when submission fails", async ({ page }) => {
  await page.route("**/api/health", (route) => route.fulfill({ json: { configured: true } }));
  await page.route("**/api/videos", (route) => route.fulfill({ status: 429, json: { error: "Rate limit reached." } }));
  await page.goto("/");
  const prompt = "A lantern floating over a still lake.";
  await page.getByLabel("Prompt").fill(prompt);
  await page.getByRole("button", { name: "Generate clip" }).click();
  await page.getByRole("button", { name: "Confirm & generate" }).click();

  await expect(page.locator(".inline-error")).toHaveText(/Rate limit reached/);
  await expect(page.getByLabel("Prompt")).toHaveValue(prompt);
  await expect(page.getByRole("button", { name: "Generate clip" })).toBeEnabled();
});

test("keeps the primary action accessible on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/health", (route) => route.fulfill({ json: { configured: false } }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Studio" })).toBeVisible();
  await expect(page.getByLabel("Prompt")).toBeVisible();
  await page.getByLabel("Prompt").fill("A short mobile test clip.");
  await expect(page.getByRole("button", { name: "Generate clip" })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBeTruthy();
});
