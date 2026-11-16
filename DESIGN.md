---
name: FRAME Studio
description: A photographic product studio from capture evidence to creative plans.
colors:
  primary: "#244eca"
  primary-hover: "#17399b"
  ink: "#18253d"
  muted: "#56657b"
  paper: "#f3f5f9"
  white: "#ffffff"
  line: "#d7deea"
  input-line: "#b7c3d8"
  focus: "#355ddd"
  photo-ground: "#e9edf5"
  notice-ground: "#e8edf9"
  receipt-ground: "#e8eefb"
  notice-ink: "#254384"
  error-ink: "#893624"
  error-ground: "#fbede7"
  capture-error-ground: "#fff0e9"
  camera-ground: "#102037"
typography:
  display:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "38px"
    fontWeight: 650
    lineHeight: 1.35
  body:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "25px"
    fontWeight: 600
    letterSpacing: "-0.025em"
  control:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  field:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "16px"
    lineHeight: 1.7
  label:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "12px"
rounded:
  photo: "4px"
  thumbnail: "6px"
  control: "7px"
  field: "8px"
  panel: "14px"
  circle: "50%"
spacing:
  small: "8px"
  thumbnail-gap: "10px"
  compact: "12px"
  medium: "16px"
  gutter-mobile: "20px"
  section: "24px"
  gutter-tablet: "30px"
  workspace-tablet-gap: "36px"
  gutter-desktop: "48px"
  workspace-gap: "64px"
  capture-gap: "72px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "13px 20px"
    width: "100%"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "13px 20px"
  request-field:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "18px"
    width: "100%"
  active-navigation:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "12px 18px"
  step-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.white}"
    rounded: "{rounded.circle}"
    size: "24px"
  source-label:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.photo}"
    padding: "3px 8px"
  plan-sheet:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "18px 22px"
  upload-tile:
    backgroundColor: "#e9eef8"
    textColor: "{colors.primary}"
    rounded: "{rounded.thumbnail}"
    size: "110px"
---

# Design System: FRAME Studio

## Overview

**Creative North Star: "The Product Catalog Studio"**

A restrained product-catalog studio: cool paper, navy ink, cobalt actions and large product photographs. The interface stays quiet while capture evidence and concrete shot instructions carry the work. This records the implemented code-led direction, not an approved visual comp.

**Key Characteristics:**

- One Korean sans stack across capture and planning.
- Photographic context beside a focused task; tasks precede imagery on phones.
- Thin dividers, compact control corners and flat tonal surfaces.

## Colors

Cobalt supplies action emphasis; cool paper and navy keep long Korean instructions readable. Values in the frontmatter describe the effective shared workspace, not every historical declaration.

- **Primary:** `primary` for actions, links, selected steps and carets; `primary-hover` for enabled primary hover; `focus` for keyboard rings.
- **Neutral:** `ink` for headings and active navigation; `muted` for supporting copy; `paper` for the canvas; `white` for fields and source labels; `line` for structure; `input-line` for fields and secondary controls; `photo-ground` behind contained product images.
- **Feedback:** `notice-ground` and `notice-ink` for saved/export information, `receipt-ground` for capture handoff. Error text uses `error-ink` on `error-ground` in planning and `capture-error-ground` in capture. Live camera framing uses `camera-ground` with white text.

`--green` is the existing compatibility alias for cobalt, not a green brand token. The green bottle belongs to the synthetic photo, not the UI palette.

## Typography

The preferred stack is listed in frontmatter. No font asset or webfont loader is currently installed; the browser uses available local fallbacks. All routes inherit that same stack.

Primary headings use `display`, stepping to 34px at 1050px and 30px at 750px. Capture uses −0.03em tracking; planning uses −0.035em. Supporting paragraphs are 14px (13px on narrow screens), with 1.75–1.85 line height. Planning description width is capped at 49ch. Titles use 20–25px; controls and labels use 12–14px; metadata uses 10–11px. Request text stays 16px. Timers, step numbers and shot indices use tabular numerals. FRAME lettering is 22px/750 with 0.04em tracking, reducing to 20px on phones; STUDIO is 9px/600 with 0.24em tracking.

## Layout

Both routes use a centered 1280px maximum outer shell, including 48px horizontal padding. At 1050px the gutters become 30px; at 750px they become 20px. Capture starts as two equal columns with a 72px gap (40px at 1050px); planning uses a flexible task column plus a 340px evidence aside and 64px gap (280px/36px at 1050px).

At 750px and below, both routes stack with full-width tasks first. Capture retains the example image below the controls; planning hides decorative inspiration but keeps actual product evidence below the task. At 650px, shared navigation wraps into a full-width second row, filmstrip tiles reduce from 110px to 96px, and revision/export controls stack. Planning additionally has a retained 850px rule for plan heading stacking and a 1000px desktop sticky-aside rule. Review images become 120px thumbnail rows below 750px. A short landscape camera viewport (maximum 550px height) puts controls in a 220px side column.

Shared navigation is at least 94px tall on desktop. Main content starts roughly 44–46px beneath the header/step rail. The filmstrip wraps with 10px gaps and scrolls above 300px height (260px on narrow screens). Native capture occupies 100svh and respects the bottom safe area. Spacing entries are observed recurring values, not an enforced arithmetic scale.

## Elevation & Depth

Depth comes from white fields, pale feedback surfaces, dark camera framing, thin rules and photography. No drop shadows are applied to the primary workspace or buttons. Palette swatches alone use an inset `0 0 0 1px #00000010` edge. The example still supplies natural photographic shadows; do not copy them into UI elevation.

## Shapes

Photographs have nearly square `photo` corners; filmstrip thumbnails use `thumbnail`; primary/secondary controls and nav use `control`; fields and plan sheets use `field`. Export/question panels retain the softer `panel` radius. Step indicators are circles. Direction alternatives are flat sections separated by a top rule, not raised cards.

## Components

- **Navigation and progress:** the active route is navy with white text and `aria-current`; the active planning step is cobalt, completed steps use a pale fill. Navigation hover reduces opacity to 0.85.
- **Actions:** primary controls span the task column and have a 52px minimum height. Other general buttons use a 44px minimum; photo removal is 44×44px with an authored SVG cross. Disabled buttons have 0.45 opacity. Secondary planning hover uses the pale notice surface. Text actions remain underlined.
- **Fields:** white native inputs/selects and a vertically resizable request textarea; the request has a 142px minimum height. Focus changes input/textarea borders to cobalt. Keyboard focus is a 3px ring, offset 4px in planning/navigation and 3px in capture. Native semantics are retained.
- **Photo evidence:** contain original product images to preserve identity; cover-crop decorative scene imagery. A source label identifies the product original. Upload tiles use a dashed border and `focus-within` ring; product and optional reference uploads stay separately labeled.
- **Plan sheet and feedback:** white bordered definition rows distinguish shot fields. Pale receipts establish capture continuity; error surfaces include readable text; the busy row includes a 17px spinner and explicit status.
- **Motion:** planning controls transition background/border over 180ms; added photos reveal over 200ms ease-out. The busy spinner rotates over 900ms linear. Both active routes disable animation and transitions under reduced motion. No added page entrance sequence.

**Photographic provenance:** `public/studio/scene.jpg` is the served derivative of `scene.png`, generated with the built-in image generation tool on 2026-11-16 from the existing fictional `public/prompt/lumi-reference.png`. The source prompt and provenance are in `public/studio/scene-provenance.txt`. The scene uses a pale-blue backdrop, cool-white stone/paper and a fictional LUMI bottle. Its visible caption states that it is AI-made and not an actual capture result. The original reference's earlier production history is not documented here. Neither asset is customer evidence or output from the app's planning flow.

Implementation sources: `app/globals.css`, `app/studio-nav.tsx`, `app/studio-nav.module.css`, `app/capture/orbit.module.css`, `app/prompt/studio.module.css`. The older capture stylesheet contains legacy styles and is not the active shared visual authority. Verified against seven supplied capture/upload/plan screenshots, including the 700px brief; finish-review evidence is in `.impeccable/review/final-review.md`. This documentation pass did not rerun browser interactions or camera hardware checks.

## Do's and Don'ts

- Keep product evidence visibly separate from staging references.
- Label synthetic examples and keep original product identity legible.
- Preserve visible keyboard focus and 44px primary interaction targets.
- Check the 700px stacked layout as well as desktop and 390px phone views.
- Do not present the example photograph as a customer capture or an image generated by the app.
- Do not reintroduce the rejected pale-green interface palette.
- Do not replace sequential direction comparisons with a decorative dashboard card grid.
- Do not infer a loaded webfont from the preferred family name.
