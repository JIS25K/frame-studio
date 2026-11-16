import test from "node:test";
import assert from "node:assert/strict";
import { audit, addEvidence, addGap } from "../lib/video-capture/ledger.ts";
import {
  seedPoints,
  trackPoints,
  measure,
} from "../lib/video-capture/metrics.ts";
const session = () => ({ clips: [], regions: [], gaps: [] });
const ev = (frame, time, overrides = {}) => ({
  clipId: "original",
  frame,
  time,
  quality: "clear",
  verified: true,
  ...overrides,
});
const gap = {
  key: "hinge",
  state: "closed",
  label: "hinge",
  kind: "blurred",
  reason: "blurred",
  instruction: "show hinge",
};
test("a different side or configuration cannot resolve a marked gap; two distinct verified views can", () => {
  const s = session();
  addGap(s, gap, ev(0, 0));
  addEvidence(s, "lid", "lid", "closed", ev(15, 0.5));
  addEvidence(s, "hinge", "hinge", "open", ev(30, 1));
  assert.equal(s.gaps[0].support.length, 0);
  addEvidence(s, "hinge", "hinge", "closed", ev(1, 0.03));
  assert.equal(s.gaps[0].support.length, 0);
  addEvidence(s, "hinge", "hinge", "closed", ev(30, 1, { verified: false }));
  assert.equal(s.gaps[0].support.length, 0);
  addEvidence(s, "hinge", "hinge", "closed", ev(45, 1.5));
  addEvidence(s, "hinge", "hinge", "closed", ev(46, 1.53));
  assert.equal(s.gaps[0].status, "open");
  addEvidence(s, "hinge", "hinge", "closed", ev(60, 2));
  assert.equal(s.gaps[0].status, "evidence_added");
});
test("retries are idempotent, omitted gaps remain, unseen hypothesis does not override clear evidence", () => {
  const s = session();
  addGap(s, gap, null);
  addGap(s, gap, null);
  assert.equal(s.gaps.length, 1);
  const e = ev(30, 1);
  addEvidence(s, "hinge", "hinge", "closed", e);
  addEvidence(s, "hinge", "hinge", "closed", e);
  assert.equal(s.regions[0].evidence.length, 1);
  assert.equal(s.gaps[0].support.length, 1);
  assert.equal(s.gaps[0].status, "open");
  addGap(s, { ...gap, kind: "not_observed" }, null);
  assert.equal(s.gaps.length, 1);
});
test("completion requires full decoding AND every window plus independent detail verification", () => {
  const s = session();
  assert.equal(audit(s).complete, false);
  s.clips = [
    {
      decoded: {
        frameCount: 1169,
        packetCount: 1169,
        complete: true,
        sheets: [{ index: 0 }, { index: 1 }],
      },
      windows: [
        { sheet: 0, status: "done" },
        { sheet: 1, status: "pending" },
      ],
      detailsDone: [0],
    },
  ];
  assert.equal(audit(s).complete, false);
  s.clips[0].windows[1].status = "done";
  assert.equal(audit(s).complete, false);
  s.clips[0].detailsDone.push(1);
  assert.equal(audit(s).complete, true);
  assert.equal(audit(s).coverage, "not-certified");
  s.clips[0].decoded.complete = false;
  assert.equal(audit(s).complete, false);
});
test("patch tracking retains identities under translation and discards textureless frames", () => {
  const w = 96,
    h = 96,
    a = new Uint8Array(w * h),
    b = new Uint8Array(w * h);
  let seed = 1;
  for (let i = 0; i < a.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    a[i] = seed >>> 24;
  }
  for (let y = 0; y < h; y++)
    for (let x = 2; x < w; x++) b[y * w + x] = a[y * w + x - 2];
  const points = seedPoints(a, w, h, 10),
    tracked = trackPoints(a, b, w, h, points);
  assert.ok(points.length > 10);
  assert.ok(tracked.length > 8);
  assert.ok(
    tracked.every((p) =>
      points.some(
        (old) =>
          old.id === p.id && Math.abs(p.x - old.x - 2) <= 1 && p.age > old.age,
      ),
    ),
  );
  assert.equal(seedPoints(new Uint8Array(w * h), w, h, 0).length, 0);
  assert.equal(measure(a, a, w, h).change, 0);
  assert.ok(measure(a, b, w, h).change > 0);
});

test("transient blur does not demand a reshoot of an already well-supported part", () => {
  const s = session();
  addEvidence(s, "hinge", "hinge", "closed", ev(0, 0));
  addEvidence(s, "hinge", "hinge", "closed", ev(30, 1));
  addGap(s, gap, ev(60, 2, { quality: "blurred" }));
  assert.equal(s.gaps.length, 0);
});
test("different quality problems in the same part share one actionable target", () => {
  const s = session();
  addGap(s, gap, null);
  addGap(s, { ...gap, kind: "occluded" }, null);
  assert.equal(s.gaps.length, 1);
});
test("window arrays and detail IDs cannot falsely certify a missing interval", () => {
  const s = session();
  s.clips = [
    {
      decoded: {
        complete: true,
        frameCount: 96,
        packetCount: 96,
        sheets: [{ index: 0 }, { index: 1 }],
      },
      windows: [{ sheet: 0, status: "done" }],
      detailsDone: [0],
    },
  ];
  assert.equal(audit(s).complete, false);
  s.clips[0].windows.push({ sheet: 1, status: "done" });
  s.clips[0].detailsDone.push(0);
  assert.equal(audit(s).complete, false);
});
