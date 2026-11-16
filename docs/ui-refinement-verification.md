# UI refinement — 2026-11-16

Scope: concise demo copy and approximate Creazy light/blue tone. No model prompts, engine logic, API contracts or storage contracts changed.

- Production build and TypeScript: passed.
- Existing synthetic regression suite: 38/38 passed.
- Browser: desktop capture and prompt; 390px capture and prompt; 700px prompt. No horizontal overflow at checked mobile widths.
- Example capture → review acknowledgement → prompt: original image arrived without upload; request input and optional reference disclosure operated.
- Pretendard font loaded in browser. Primary blue #316de6 with white text meets 4.5:1 contrast (approximately 4.7:1).
- Design detector: advisory token/type/radius findings only, no blocking rules. Primary palette and effective layout synchronized in DESIGN.md after the scan; historical stylesheet overrides remain outside the compact token ramp.
- React review: no changed hook order, effects, network behavior or client/server boundary. Native labels, disclosure semantics, focus styling and removal controls retained.
- Not run this pass: paid AI generation, physical camera capture, engine performance evaluation. Later AI-generated direction/plan content was not regenerated for visual QA.

Production release: `7ae545b`, deployment `dpl_BvWoTmhCWU3exaTz3Y3TVeWHEMZD`, promoted to https://frame-prompt-demo.vercel.app. Both status endpoints reported configured, and the font returned HTTP 200. Live capture and a previously saved fictional LUMI plan rendered correctly; the saved plan was viewed without modifying it or rerunning AI. Current screenshots are `studio-preview.jpg` and `planning-preview.jpg`.
