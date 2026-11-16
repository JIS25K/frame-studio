const validationVideoPath = process.env.VALIDATION_VIDEO_PATH;
if (!validationVideoPath) throw new Error("Set VALIDATION_VIDEO_PATH to your local test video.");
const { webkit,   devices } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let calls = 0;
await page.route("**/api/capture/video", async (route) => {
  calls++;
  await route.fulfill({
    status: 502,
    contentType: "application/json",
    body: JSON.stringify({
      error: "검증용 연결 중단: 원본 해독 후 재개 상태 확인",
    }),
  });
});
await page.goto("http://localhost:3027/capture");
await page
  .locator("input[type=file]")
  .setInputFiles(validationVideoPath);
await page
  .getByRole("button", { name: "전체 영상 분석 시작", exact: true })
  .click();
for (let n = 0; n < 30; n++) {
  await page.waitForTimeout(10000);
  console.log(
    await page.locator('[aria-label="전체 영상 처리 상태"]').innerText(),
  );
  if (calls || (await page.locator("main [role=alert]").count())) break;
}
console.log("errors", errors);
console.log("body", await page.locator("body").innerText());
const result = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open("frame-whole-video");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const s = await new Promise((resolve, reject) => {
    const r = db.transaction("sessions").objectStore("sessions").get("current");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const c = s?.clips[0];
  return {
    decoded: c?.decoded
      ? {
          frameCount: c.decoded.frameCount,
          packetCount: c.decoded.packetCount,
          complete: c.decoded.complete,
          duration: c.decoded.duration,
          first: c.decoded.frames[0].time,
          last: c.decoded.frames.at(-1).time,
          sheets: c.decoded.sheets.length,
          tracks: c.decoded.frames.filter((f) => f.tracked > 0).length,
        }
      : null,
    bytes: c?.blob?.size || c?.bytes?.byteLength,
    windows: c?.windows.map((w) => ({ status: w.status, error: w.error })),
    overflow: document.documentElement.scrollWidth > innerWidth,
    alert: document.querySelector("[role=alert]")?.textContent,
  };
});
console.log(JSON.stringify(result));
await fs.writeFile(
  "artifacts/video-evidence/webkit-check.json",
  JSON.stringify(result, null, 2),
);
await page.screenshot({ path: "artifacts/video-evidence/webkit-decoded.png" });
await page.reload();
await page.getByRole("button", { name: "미완료 구간 이어서 분석" }).waitFor();
result.restored = true;
assert.equal(result.decoded.frameCount, 1169);
assert.equal(result.decoded.complete, true);
assert.equal(result.bytes, 36699440);
assert.equal(result.overflow, false);
result.calls = calls;
result.errors = errors;
await fs.writeFile(
  "artifacts/video-evidence/webkit-check.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
await browser.close();
