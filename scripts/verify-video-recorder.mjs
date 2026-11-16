const validationVideoPath = process.env.VALIDATION_VIDEO_PATH;
if (!validationVideoPath) throw new Error("Set VALIDATION_VIDEO_PATH to your local test video.");
const { chromium,   devices } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({
  ...devices["iPhone 13"],
  defaultBrowserType: undefined,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.route("**/fixture.mov", (r) =>
  r.fulfill({
    path: validationVideoPath,
    contentType: "video/quicktime",
  }),
);
await page.addInitScript(() => {
  const OriginalRecorder = window.MediaRecorder;
  window.MediaRecorder = class extends OriginalRecorder {
    constructor(...args) {
      super(...args);
      window.testRecorder = this;
    }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    const v = document.createElement("video");
    v.src = "/fixture.mov";
    v.muted = true;
    v.playsInline = true;
    await v.play();
    window.testVideo = v;
    return v.captureStream();
  };
});
await page.goto("http://localhost:3014/capture");
await page.getByRole("button", { name: "영상 촬영", exact: true }).click();
await page.getByRole("button", { name: "← 왼쪽으로" }).click();
await page.getByRole("button", { name: "이 정면으로 녹화 시작" }).click();
await page.getByAltText("처음 정한 기준 정면").waitFor();
await page.waitForTimeout(2500);
// Fault injection: the recorder stops without a user finish action.
await page.evaluate(() => window.testRecorder.stop());
await page
  .getByText("녹화가 중단됐어요. 모인 영상을 마무리할 수 있어요.")
  .waitFor();
assert.equal(
  await page.getByRole("heading", { name: "영상으로 제품 관찰" }).count(),
  0,
);
await page.screenshot({
  path: "artifacts/video-evidence/recording-unexpected-stop.png",
});
await page.getByRole("button", { name: "녹화 마치고 전체 영상 확인" }).click();
await page.locator('[aria-label="원본 영상"]').waitFor();
const stored = await page.evaluate(async () => {
  const d = await new Promise((r) => {
    const q = indexedDB.open("frame-whole-video");
    q.onsuccess = () => r(q.result);
  });
  const s = await new Promise((r) => {
    const q = d.transaction("sessions").objectStore("sessions").get("current");
    q.onsuccess = () => r(q.result);
  });
  return { bytes: s.clips[0].blob?.size||s.clips[0].bytes?.byteLength, baseline: !!s.baseline };
});
assert.ok(stored.bytes > 10000);
assert.ok(stored.baseline);
await page.getByRole("button", { name: "영상 촬영", exact: true }).click();
await page.getByRole("button", { name: "이 정면으로 녹화 시작" }).click();
await page.waitForTimeout(1500);
await page.evaluate(() => {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
});
await page.getByRole("button", { name: "녹화 계속" }).waitFor();
assert.equal(await page.evaluate(() => window.testRecorder.state), "paused");
assert.equal(
  await page.getByRole("heading", { name: "영상으로 제품 관찰" }).count(),
  0,
);
await page.evaluate(() =>
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  }),
);
await page.getByRole("button", { name: "녹화 계속" }).click();
assert.equal(await page.evaluate(() => window.testRecorder.state), "recording");
await page.waitForTimeout(1200);
await page.getByRole("button", { name: "녹화 마치고 전체 영상 확인" }).click();
await page.locator('[aria-label="원본 영상"]').waitFor();
const result = {
  unexpectedStopRemainsInRecorder: true,
  explicitFinishSavesActualVideo: stored,
  backgroundPausesWithoutNavigation: true,
  resume: true,
  errors,
};
await fs.writeFile(
  "artifacts/video-evidence/recorder-check.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
await browser.close();
