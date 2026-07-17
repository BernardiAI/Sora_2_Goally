import { expect, test } from "@playwright/test";

test.skip(
  process.env.LIVE_SORA_TEST !== "1",
  "Set LIVE_SORA_TEST=1 to run the live Sora test (this incurs API charges).",
);

test("generates and downloads a four-second Sora video", async ({ page }) => {
  test.setTimeout(600_000);

  await page.goto("/");
  await expect(page.getByRole("button", { name: "OpenAI connected" })).toBeVisible();

  const prompt =
    "A single blue marble rolls slowly across a plain white tabletop, locked camera, soft daylight.";
  await page.locator("#prompt").fill(prompt);
  await page.getByRole("button", { name: /^Generate/ }).click();

  const confirmation = page.locator(".confirm-sheet");
  await expect(confirmation.getByRole("heading", { name: "Confirm this generation" })).toBeVisible();
  await expect(confirmation.getByText(prompt, { exact: true })).toBeVisible();
  await expect(confirmation.getByText("Sora 2", { exact: true })).toBeVisible();
  await expect(confirmation.getByText("1280 × 720", { exact: true })).toBeVisible();
  await expect(confirmation.getByText("4 seconds", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Confirm & generate" }).click();
  await expect(page.locator(".generating-state")).toBeVisible({ timeout: 30_000 });

  const video = page.locator("video.generated-video");
  await expect(video).toBeVisible({ timeout: 540_000 });

  const source = await video.getAttribute("src");
  expect(source).toBeTruthy();

  const contentResponse = await page.request.get(new URL(source!, page.url()).toString());
  expect(contentResponse.ok()).toBeTruthy();
  expect(contentResponse.headers()["content-type"]).toMatch(/^video\//);
  expect((await contentResponse.body()).byteLength).toBeGreaterThan(0);
});
