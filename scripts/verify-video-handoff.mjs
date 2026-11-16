const validationVideoPath = process.env.VALIDATION_VIDEO_PATH;
if (!validationVideoPath) throw new Error("Set VALIDATION_VIDEO_PATH to your local test video.");
const { chromium,   devices } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import assert from "node:assert/strict";
import fs from "node:fs/promises";
// Reuse the actual completed analysis, exactly as a browser-restored session.
const session = JSON.parse(
  await fs.readFile(
    "artifacts/video-evidence/original-full-session.json",
    "utf8",
  ),
);
const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
});
const page = await browser.newPage({ ...devices["iPhone 13"] });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto((process.argv[2]||"http://localhost:3014")+"/capture");
await page
  .locator("input[type=file]")
  .setInputFiles(validationVideoPath);
await page.waitForFunction(async () => {
  const db = await new Promise((r) => {
    const q = indexedDB.open("frame-whole-video");
    q.onsuccess = () => r(q.result);
  });
  return await new Promise((r) => {
    const q = db.transaction("sessions").objectStore("sessions").get("current");
    q.onsuccess = () => r(!!q.result?.clips[0]?.bytes);
  });
});
await page.evaluate(async (session) => {
  const db = await new Promise((r) => {
    const q = indexedDB.open("frame-whole-video");
    q.onsuccess = () => r(q.result);
  });
  const raw = await new Promise((r) => {
    const q = db.transaction("sessions").objectStore("sessions").get("current");
    q.onsuccess = () => r(q.result);
  });
  session.clips[0].bytes = raw.clips[0].bytes;
  session.clips[0].mime = raw.clips[0].mime;
  await new Promise((resolve, reject) => {
    const t = db.transaction("sessions", "readwrite");
    t.objectStore("sessions").put(session, "current");
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}, session);
await page.reload();
await page.getByRole('button',{name:'전체 시간구간 분석됨'}).waitFor();
const resolved=page.locator('[aria-label="보충할 부분"] article').filter({has:page.getByRole('heading',{name:'내부 보충 근거 추가됨'})});
await resolved.getByText('이후 구간에서 같은 부위의 선명한 근거를 확인했어요.').waitFor();
assert.equal(await resolved.locator('img').count(),1);
assert.equal(await resolved.getByRole('button',{name:'이 부분 보충하기'}).count(),0);
await resolved.scrollIntoViewIfNeeded();await page.screenshot({path:'artifacts/video-evidence/live-resolved-gap.png'});
for(const viewport of [{width:360,height:800},{width:844,height:390}]){await page.setViewportSize(viewport);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);}
await page.setViewportSize({width:390,height:844});
await page
  .getByRole("button", { name: "관찰 정보와 근거로 연출 기획" })
  .click();
try{await page.getByText(/영상 관찰 정보 연결됨/).waitFor();}catch(e){console.log(await page.locator('body').innerText());console.log('url',page.url(),'errors',errors);await page.screenshot({path:'artifacts/video-evidence/handoff-failure.png'});throw e;}
const result = await page.evaluate(async () => {
  const db = await new Promise((r) => {
    const q = indexedDB.open("frame-prompt-v1");
    q.onsuccess = () => r(q.result);
  });
  const p = await new Promise((r) => {
    const q = db.transaction("handoffs").objectStore("handoffs").getAll();
    q.onsuccess = () => r(q.result);
  });
  return {
    videoContext: p[0].videoContext,
    images: p[0].images.length,
    url: location.pathname,
    overflow: document.documentElement.scrollWidth > innerWidth,
  };
});
assert.equal(result.videoContext.decodedFrames, 1169);
assert.equal(result.videoContext.processedWindows, 25);
assert.equal(result.videoContext.regions.length, session.regions.length);
assert.equal(
  result.videoContext.regions.reduce((n, r) => n + r.evidence.length, 0),
  session.regions.reduce((n, r) => n + r.evidence.length, 0),
);
assert.ok(
  result.videoContext.regions.some(
    (r) => r.state === "open" && r.evidence.some((e) => e.time >= 33),
  ),
);
assert.equal(result.url, "/prompt");
assert.equal(result.overflow, false);
await page.screenshot({ path: "artifacts/video-evidence/handoff-mobile.png" });
await fs.writeFile(
  "artifacts/video-evidence/handoff-check.json",
  JSON.stringify({ ...result, errors }, null, 2),
);
console.log(
  JSON.stringify({
    passed: true,
    regions: result.videoContext.regions.length,
    images: result.images,
    errors,
  }),
);
await browser.close();
