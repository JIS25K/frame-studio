const validationVideoPath = process.env.VALIDATION_VIDEO_PATH;
if (!validationVideoPath) throw new Error("Set VALIDATION_VIDEO_PATH to your local test video.");
const { chromium,   devices } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
});
const page = await browser.newPage({ ...devices["Pixel 7"] });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let calls = 0;
const started = Date.now();
page.on("response", (r) => {
  if (r.url().endsWith("/api/capture/video")) {
    calls++;
    console.log("API", calls, r.status());
  }
});
const read = () =>
  page.evaluate(async () => {
    const d = await new Promise((r) => {
      const q = indexedDB.open("frame-whole-video");
      q.onsuccess = () => r(q.result);
    });
    const s = await new Promise((r) => {
      const q = d
        .transaction("sessions")
        .objectStore("sessions")
        .get("current");
      q.onsuccess = () => r(q.result);
    });
    return {
      ...s,
      clips: s.clips.map(({ blob, bytes, ...c }) => ({
        ...c,
        originalBytes: blob?.size || bytes?.byteLength,
      })),
    };
  });
try {
  await page.goto("http://localhost:3027");
  if (process.argv.includes("--resume")) {
    const previous = JSON.parse(
      await fs.readFile(
        "artifacts/video-evidence/original-failure.json",
        "utf8",
      ),
    ).session;
    await page
      .locator("input[type=file]")
      .setInputFiles(validationVideoPath);
    await page.waitForFunction(async () => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("frame-whole-video");
        q.onsuccess = () => r(q.result);
      });
      return await new Promise((r) => {
        const q = db
          .transaction("sessions")
          .objectStore("sessions")
          .get("current");
        q.onsuccess = () => r(!!q.result?.clips[0]?.bytes);
      });
    });
    await page.evaluate(async (previous) => {
      const db = await new Promise((r) => {
        const q = indexedDB.open("frame-whole-video");
        q.onsuccess = () => r(q.result);
      });
      const raw = await new Promise((r) => {
        const q = db
          .transaction("sessions")
          .objectStore("sessions")
          .get("current");
        q.onsuccess = () => r(q.result);
      });
      previous.clips[0].bytes = raw.clips[0].bytes;
      previous.clips[0].mime = raw.clips[0].mime;
      await new Promise((resolve, reject) => {
        const tx = db.transaction("sessions", "readwrite");
        tx.objectStore("sessions").put(previous, "current");
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }, previous);
    await page.reload();
    await page.getByRole("button", { name: "미완료 구간 이어서 분석" }).click();
  } else {
    await page
      .locator("input[type=file]")
      .setInputFiles(validationVideoPath);
    await page
      .getByRole("button", { name: "전체 영상 분석 시작", exact: true })
      .click();
  }
  let finished = false;
  for (let i = 0; i < 240; i++) {
    await page.waitForTimeout(5000);
    if (
      await page
        .getByRole("button", { name: "전체 시간구간 분석됨", exact: true })
        .count()
    ) {
      finished = true;
      break;
    }
    const error = page.locator("main [role=alert]");
    if (await error.count()) throw new Error(await error.first().innerText());
    if (i % 6 === 0)
      console.log(
        await page.locator('[aria-label="전체 영상 처리 상태"]').innerText(),
      );
  }
  assert.ok(finished, "complete analysis");
  const s = await read();
  await fs.writeFile(
    "artifacts/video-evidence/original-full-session.json",
    JSON.stringify(s),
  );
  const c = s.clips[0];
  assert.equal(c.decoded.frameCount, 1169);
  assert.equal(c.decoded.packetCount, 1169);
  assert.equal(c.decoded.sheets.length, 25);
  assert.ok(c.windows.every((w) => w.status === "done"));
  assert.equal(c.detailsDone.length, 25);
  assert.deepEqual(
    c.decoded.sheets.flatMap((w) => w.frames),
    Array.from({ length: 1169 }, (_, i) => i),
  );
  assert.ok(
    s.regions.some(
      (r) =>
        r.state === "open" &&
        r.evidence.some(
          (e) => e.time >= 33 && e.verified && e.quality === "clear",
        ),
    ),
    "late open configuration must survive",
  );
  assert.ok(
    c.windows.some((w) => w.result.productVisible === false),
    "offscreen interval must not be hallucinated as product",
  );
  const heading = await page
    .getByRole("heading", { name: /누적한 제품 정보/ })
    .innerText();
  assert.ok(heading.includes(String(s.regions.length)));
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.screenshot({
    path: "artifacts/video-evidence/original-complete.png",
  });
  await page.locator('[aria-label="보충할 부분"]').scrollIntoViewIfNeeded();
  await page.screenshot({ path: "artifacts/video-evidence/original-gaps.png" });
  await page.reload();
  await page.getByRole("button", { name: "전체 시간구간 분석됨" }).waitFor();
  const result = {
    passed: true,
    elapsedSeconds: (Date.now() - started) / 1000,
    frames: c.decoded.frameCount,
    windows: c.windows.length,
    calls,
    regions: s.regions.map((r) => ({
      key: r.key,
      state: r.state,
      clear: r.evidence.filter((e) => e.verified && e.quality === "clear")
        .length,
    })),
    gaps: s.gaps.map((g) => ({
      key: g.key,
      state: g.state,
      status: g.status,
      support: g.support.length,
    })),
    late: c.windows.slice(17).map((w) => ({
      sheet: w.sheet,
      visible: w.result.productVisible,
      summary: w.result.summary,
    })),
    errors,
    restored: true,
  };
  await fs.writeFile(
    "artifacts/video-evidence/original-check.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
} catch (e) {
  await fs.writeFile(
    "artifacts/video-evidence/original-failure.json",
    JSON.stringify({
      error: e.message,
      body: await page.locator("body").innerText(),
      session: await read(),
    }),
  );
  await page.screenshot({
    path: "artifacts/video-evidence/original-failure.png",
  });
  throw e;
} finally {
  await browser.close();
}
