import type {
  VideoSession,
  Evidence,
  Region,
  Gap,
  WindowObservation,
} from "./schema.ts";
export function identity(key: string, state: string) {
  return `${key.trim().toLowerCase()}::${state.trim().toLowerCase()}`;
}
export function addEvidence(
  session: VideoSession,
  key: string,
  label: string,
  state: string,
  evidence: Evidence,
) {
  const id = identity(key, state);
  let region = session.regions.find((r) => r.id === id);
  if (!region) {
    if (session.regions.length >= 48)
      throw new Error("관찰 부위가 48개를 넘었어요. 기존 근거는 보존됩니다.");
    region = { id, key, label, state, evidence: [] };
    session.regions.push(region);
  }
  if (
    !region.evidence.some(
      (e) => e.clipId === evidence.clipId && e.frame === evidence.frame,
    )
  )
    region.evidence.push(evidence);
  for (const gap of session.gaps.filter(
    (g) => identity(g.key, g.state) === id && g.status !== "deferred",
  )) {
    if (!evidence.verified || evidence.quality !== "clear") continue;
    if (
      gap.anchor?.clipId === evidence.clipId &&
      Math.abs(gap.anchor.time - evidence.time) < 0.4
    )
      continue;
    if (
      gap.support.some(
        (e) =>
          e.clipId === evidence.clipId &&
          Math.abs(e.time - evidence.time) < 0.4,
      )
    )
      continue;
    gap.support.push(evidence);
    if (gap.support.length >= 2) gap.status = "evidence_added";
  }
}
export function addGap(
  session: VideoSession,
  g: WindowObservation["gaps"][number],
  anchor: Evidence | null,
) {
  const existing = session.gaps.find(
    (x) => identity(x.key, x.state) === identity(g.key, g.state),
  );
  if (existing) return;
  // A later omission never invalidates an already clear region, nor does a model omission resolve a gap.
  const region = session.regions.find((r) => r.id === identity(g.key, g.state));
  if (region) {
    const clear = region.evidence.filter(
      (e) => e.verified && e.quality === "clear",
    );
    if (g.kind === "not_observed" && clear.length) return;
    // An occasional blurred/occluded view does not erase sufficient earlier evidence.
    if (
      clear.some((a, i) =>
        clear
          .slice(i + 1)
          .some(
            (b) => a.clipId !== b.clipId || Math.abs(a.time - b.time) >= 0.4,
          ),
      )
    )
      return;
  }
  if (session.gaps.length >= 48)
    throw new Error("보충 항목이 48개를 넘었어요. 기존 근거는 보존됩니다.");
  session.gaps.push({
    ...g,
    id: crypto.randomUUID(),
    anchor,
    status: "open",
    support: [],
  });
}
export function audit(session: VideoSession) {
  const expected = session.clips.reduce(
      (n, c) => n + (c.decoded?.packetCount || 0),
      0,
    ),
    decoded = session.clips.reduce(
      (n, c) => n + (c.decoded?.frameCount || 0),
      0,
    );
  const sheets = session.clips.reduce(
      (n, c) => n + (c.decoded?.sheets.length || 0),
      0,
    ),
    done = session.clips.reduce(
      (n, c) => n + c.windows.filter((w) => w.status === "done").length,
      0,
    );
  const missing = session.clips.some(
    (c) =>
      !c.decoded?.complete ||
      c.windows.length !== c.decoded.sheets.length ||
      c.decoded.sheets.some(
        (s) =>
          !c.windows.some((w) => w.sheet === s.index && w.status === "done") ||
          !c.detailsDone.includes(s.index),
      ) ||
      new Set(c.detailsDone).size !== c.windows.length,
  );
  return {
    expected,
    decoded,
    sheets,
    done,
    complete: session.clips.length > 0 && !missing,
    open: session.gaps.filter(
      (g) => g.status === "open" && g.key !== "product_correspondence",
    ).length,
    coverage: "not-certified" as const,
  };
}
export function compactContext(regions: Region[]) {
  return regions
    .filter((r) => r.key !== "product_correspondence")
    .map((r) => ({ key: r.key, label: r.label, state: r.state }));
}
export function targetContext(gaps: Gap[]) {
  return gaps
    .filter((g) => g.status === "open" && g.key !== "product_correspondence")
    .map((g) => ({
      key: g.key,
      label: g.label,
      state: g.state,
      reason: g.reason,
    }));
}
