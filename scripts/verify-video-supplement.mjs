const { chromium,   devices } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
import assert from "node:assert/strict";
import fs from "node:fs/promises";
const browser = await chromium.launch({
  ...(process.env.CHROME_EXECUTABLE_PATH ? { executablePath: process.env.CHROME_EXECUTABLE_PATH } : {}),
});
const context = await browser.newContext({ ...devices["Pixel 7"] });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
let calls = 0;
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
      id: s.id,
      clips: s.clips.map((c) => ({
        id: c.id,
        targetId: c.targetId,
        bytes: c.blob?.size || c.bytes?.byteLength,
        decoded: c.decoded
          ? {
              frameCount: c.decoded.frameCount,
              packetCount: c.decoded.packetCount,
              complete: c.decoded.complete,
            }
          : null,
        windows: c.windows,
      })),
      regions: s.regions.map((r) => ({
        ...r,
        evidence: r.evidence.map(({ image, crop, ...e }) => e),
      })),
      gaps: s.gaps.map((g) => ({
        ...g,
        anchor: g.anchor
          ? { clipId: g.anchor.clipId, time: g.anchor.time }
          : null,
        support: g.support.map((e) => ({
          clipId: e.clipId,
          time: e.time,
          verified: e.verified,
          quality: e.quality,
        })),
      })),
    };
  });
async function finish() {
  for (let i = 0; i < 90; i++) {
    await page.waitForTimeout(5000);
    if (
      await page
        .getByRole("button", { name: "전체 시간구간 분석됨", exact: true })
        .count()
    )
      return;
    const error = page.locator("main [role=alert]");
    if ((await error.count()) && (await error.innerText())) {
      throw new Error(await error.innerText());
    }
    if (i % 6 === 0)
      console.log(
        await page.locator('[aria-label="전체 영상 처리 상태"]').innerText(),
      );
  }
  throw new Error("Analysis timed out");
}
try {
  await page.goto("http://localhost:3027");
  await page
    .locator("input[type=file]")
    .setInputFiles("/private/tmp/case-closed-prefix.mp4");
  await page
    .getByRole("button", { name: "전체 영상 분석 시작", exact: true })
    .click();
  await finish();
  const before = await read();
  await fs.writeFile(
    "artifacts/video-evidence/supplement-before.json",
    JSON.stringify(before, null, 2),
  );
  const target = before.gaps.find(
    (g) => g.key === "interior" && g.state === "open",
  );
  assert.ok(
    target,
    "Closed prefix must retain the physically indicated interior as an unseen hypothesis",
  );
  const card = page
    .locator('[aria-label="보충할 부분"] article')
    .filter({
      has: page.getByRole("heading", { name: new RegExp(target.label) }),
    })
    .first();
  await card.getByRole("button", { name: "이 부분 보충하기" }).click();
  await page
    .locator("input[type=file]")
    .setInputFiles("/private/tmp/case-open-supplement.mp4");
  await page.getByRole("button", { name: "미완료 구간 이어서 분석" }).click();
  await finish();
  const after = await read();
  assert.equal(after.clips.length, 2);
  assert.equal(after.clips[1].targetId, target.id);
  assert.ok(after.clips.every((c) => c.decoded.complete));
  assert.ok(
    after.regions.some(
      (r) =>
        r.key === "interior" &&
        r.state === "open" &&
        r.evidence.some(
          (e) =>
            e.verified &&
            e.quality === "clear" &&
            e.clipId === after.clips[1].id,
        ),
    ),
  );
  const resolved = after.gaps.find((g) => g.id === target.id);
  assert.equal(resolved.status, "evidence_added");
  assert.ok(resolved.support.length >= 2);
  after.errors = errors;
  after.calls = calls;
  await fs.writeFile(
    "artifacts/video-evidence/supplement-after.json",
    JSON.stringify(after, null, 2),
  );
  await page.screenshot({
    path: "artifacts/video-evidence/supplement-complete.png",
  });
  console.log(
    JSON.stringify({
      passed: true,
      frames: after.clips.map((c) => c.decoded.frameCount),
      interior: resolved,
      calls,
      errors,
    }),
  );
} catch (e) {
  await fs.writeFile(
    "artifacts/video-evidence/supplement-failure.json",
    JSON.stringify(
      {
        error: e.message,
        body: await page.locator("body").innerText(),
        state: await read(),
      },
      null,
      2,
    ),
  );
  await page.screenshot({
    path: "artifacts/video-evidence/supplement-failure.png",
  });
  throw e;
} finally {
  await browser.close();
}
