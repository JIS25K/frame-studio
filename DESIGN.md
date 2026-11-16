---
name: FRAME Studio
description: A photographic product studio from capture evidence to creative plans.
colors:
  primary: "#316de6"
  primary-hover: "#2459c3"
  ink: "#111827"
  muted: "#5e6675"
  paper: "#f5f6f8"
  white: "#ffffff"
  line: "#e2e5eb"
  input-line: "#cdd3dd"
  focus: "#3b82f6"
  photo-ground: "#f0f2f5"
  notice-ground: "#edf3ff"
  receipt-ground: "#edf3ff"
  notice-ink: "#2457aa"
  error-ink: "#893624"
  error-ground: "#fbede7"
  capture-error-ground: "#fff0e9"
  camera-ground: "#111827"
typography:
  display:
    fontFamily: "Pretendard, Apple SD Gothic Neo, Noto Sans KR, system-ui, sans-serif"
    fontSize: "30px"
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
  photo: "16px"
  thumbnail: "6px"
  control: "7px"
  field: "8px"
  panel: "16px"
  circle: "50%"
spacing:
  small: "8px"
  thumbnail-gap: "10px"
  compact: "12px"
  medium: "16px"
  gutter-mobile: "20px"
  section: "24px"
  gutter-tablet: "30px"
  workspace-tablet-gap: "30px"
  gutter-desktop: "48px"
  workspace-gap: "48px"
  capture-gap: "48px"
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
    backgroundColor: "#eaf1ff"
    textColor: "{colors.primary-hover}"
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
    backgroundColor: "#fafbfc"
    textColor: "{colors.primary}"
    rounded: "{rounded.thumbnail}"
    size: "110px"
---

# FRAME Studio design

A compact Korean demo workspace for capture and creative planning. Creazy's white surfaces, light neutral canvas and blue actions inform the tone; its exact colors and branding are not copied. Reference: https://creazy.app/ko and the signed-in studio, inspected 2026-11-16.

## Typography and layout

Self-hosted Pretendard Variable lives in `public/fonts`, with its SIL license. All routes share the same Korean sans stack. Task headings are 30px desktop, 28px tablet and 25px phone; request fields stay 16px. Body and control text use 13–15px. Small provenance and status labels use 11–12px.

The outer shell is 1180px including desktop gutters of 48px, becoming 30px at 1050px and 20px at 750px. Navigation is 80px tall on desktop and wraps at 650px. The active route uses a pale blue surface with blue text.

Capture starts with a white task panel and the fictional product photograph, separated by 48px (28px tablet). The decorative photograph is hidden at 750px and below. Review is limited to 860px; original photos use contain, never decorative cropping.

The initial planning form is one centered white composer, at most 760px wide with 30px padding and 16px corners. It has no decorative aside. Later steps use a task column and 280px evidence aside (240px tablet); these stack at 750px. Evidence, product identity and the original request remain available in those later steps.

## Controls and copy

Primary buttons are at least 48px high; secondary actions and photo removal retain 44px targets. Keyboard focus is a 3px blue ring. Inputs have persistent labels, native semantics and readable errors. Reduced-motion support remains in both engines.

Keep only actionable instructions, labels, source/provenance, progress, errors and useful results. Remove marketing slogans, repeated workflow explanations and implementation narration. Optional reference photos are behind a disclosure. When product photos are present, ask only for the desired feeling in the introductory line.

The capture receipt shows origin and image count. It must not suggest that synthetic examples are real capture results. OpenAI transmission remains disclosed beside the main action; actual missing information and saving warnings remain visible when relevant.

## Assets and boundaries

`public/studio/scene.jpg` is an AI-generated fictional LUMI scene, visibly labeled. Its provenance is in `public/studio/scene-provenance.txt`; `public/prompt/lumi-reference.png` supplies the fictional product original. No customer media is published.

This pass changes presentation and copy only. Capture selection, model prompts, question limits, handoff/storage, direct upload and exports keep their existing behavior. Performance testing is a separate next task.
