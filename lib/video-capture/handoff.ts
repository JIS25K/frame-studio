import type { VideoSession } from "./schema.ts";
// Planning may use provisional photographs; their uncertainty must remain explicit.
export function handoffFrames(session: VideoSession) {
  const frames = session.regions
    .filter((r) => r.key !== "product_correspondence")
    .flatMap((r) => {
      const ranked = [...r.evidence].sort(
        (a, b) =>
          Number(b.verified && b.quality === "clear") -
          Number(a.verified && a.quality === "clear"),
      );
      const e = ranked.find((e) => e.image);
      if (!e) return [];
      return [
        {
          image: e.image,
          at: e.time,
          description: `${e.verified && e.quality === "clear" ? "" : "AI 미확인 · "}${r.label} · ${e.detail}`,
        },
      ];
    });
  if (!frames.length && session.baseline)
    frames.push({
      image: session.baseline,
      at: 0,
      description: "기준 정면 · AI 세부 확인 전, 사진을 직접 확인해 사용",
    });
  return frames
    .filter((e, i) => frames.findIndex((x) => x.image === e.image) === i)
    .slice(0, 24);
}
export function correspondenceMessage(visible: boolean) {
  return visible
    ? {
        label: "같은 제품인지 확인이 필요한 구간",
        instruction:
          "다른 각도에서 같은 제품을 촬영한 것이 맞다면 현재 자료로 진행해도 좋아요. 필요하면 기준 정면과 이어지는 모습을 추가해주세요.",
      }
    : {
        label: "제품이 화면 밖으로 벗어난 구간",
        instruction:
          "제품이 잘 보이는 다른 구간으로 진행할 수 있어요. 빠진 면이 필요할 때만 추가로 촬영해주세요.",
      };
}
