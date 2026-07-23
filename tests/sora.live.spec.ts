import { expect, test } from "@playwright/test";

test.skip(
  process.env.LIVE_SORA_TEST !== "1",
  "Set LIVE_SORA_TEST=1 to run the live Sora test (this incurs API charges).",
);

test("generates and downloads a four-second Sora 2 Pro video with assigned dialogue", async ({ page }) => {
  test.setTimeout(600_000);

  await page.goto("/");
  await expect(page.getByText("OpenAI connected", { exact: true })).toBeVisible();

  const prompt =
    "A small blue tin robot named Pip stands alone on a plain white tabletop, locked medium shot, soft daylight. Pip looks directly at the camera and speaks once.";
  await page.locator("#prompt").fill(prompt);
  await page.locator("summary").filter({ hasText: "Dialogue & audio" }).click();
  await page.getByLabel("Dialogue").fill('Pip: "Ready when you are."');
  await page.getByLabel("Voice and sound direction").fill(
    "Pip has one clear, bright, friendly voice. No narrator, no music, no other voices.",
  );
  await page.locator("summary").filter({ hasText: "Output options" }).click();
  await page.getByLabel("Model").selectOption("sora-2-pro");
  await page.getByLabel("Resolution").selectOption("1280x720");
  await page.getByRole("button", { name: "Generate clip" }).click();

  const confirmation = page.getByRole("dialog", { name: "Confirm your clip" });
  await expect(confirmation).toBeVisible();
  await expect(confirmation.locator("pre")).toContainText(prompt);
  await expect(confirmation.locator("pre")).toContainText("<dialogue>");
  await expect(confirmation.locator("pre")).toContainText('Pip: "Ready when you are."');
  await expect(confirmation.getByText("Sora 2 Pro", { exact: true })).toBeVisible();
  await expect(confirmation.getByText("1280 × 720", { exact: true })).toBeVisible();
  await expect(confirmation.getByText("4 seconds", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Confirm & generate" }).click();
  await expect(page.getByText("Creating your clip", { exact: true })).toBeVisible({ timeout: 30_000 });

  const video = page.locator("video.generated-video");
  await expect(video).toBeVisible({ timeout: 540_000 });

  const source = await video.getAttribute("src");
  expect(source).toBeTruthy();

  const contentResponse = await page.request.get(new URL(source!, page.url()).toString());
  expect(contentResponse.ok()).toBeTruthy();
  expect(contentResponse.headers()["content-type"]).toMatch(/^video\//);
  expect((await contentResponse.body()).byteLength).toBeGreaterThan(0);
});
