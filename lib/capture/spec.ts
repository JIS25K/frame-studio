import { z } from 'zod';

export const viewSchema = z.enum(['front', 'side', 'oblique', 'back', 'top', 'bottom', 'left', 'right', 'detail', 'unknown']);
export const requirementSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/),
  label: z.string().min(1).max(80),
  view: viewSchema.exclude(['unknown']),
  framing: z.enum(['whole', 'closeup']),
  instruction: z.string().min(1).max(240),
  motion: z.enum(['hold', 'clockwise', 'counterclockwise', 'closer', 'tilt-top', 'tilt-bottom']).optional(),
  mustSee: z.array(z.string().min(1).max(120)).min(1).max(5),
  acceptance: z.string().min(1).max(400),
});
export const specSchema = z.object({
  version: z.literal(1),
  id: z.string().regex(/^[a-z][a-z0-9-]{0,59}$/),
  title: z.string().min(1).max(100),
  product: z.string().min(1).max(400),
  frontDefinition: z.string().min(1).max(240),
  requirements: z.array(requirementSchema).min(1).max(6),
}).superRefine((s, ctx) => {
  if (new Set(s.requirements.map(r => r.id)).size !== s.requirements.length)
    ctx.addIssue({ code: 'custom', message: '촬영 항목 ID가 중복됐어요.' });
  if (s.requirements[0].view !== 'front' || s.requirements[0].framing !== 'whole')
    ctx.addIssue({ code: 'custom', message: '첫 항목은 기준이 되는 정면 전체 모습이어야 해요.' });
});
export type CaptureSpec = z.infer<typeof specSchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export const verdictSchema = z.object({
  observedView: viewSchema,
  sameProduct: z.enum(['yes', 'no', 'uncertain', 'no_reference']),
  framingMatches: z.boolean(),
  matchesTarget: z.boolean(),
  confidence: z.number().min(0).max(1),
  visibleParts: z.array(z.string().max(120)).max(8),
  missingParts: z.array(z.string().max(120)).max(8),
  evidence: z.string().min(1).max(500),
  guidance: z.string().min(1).max(240),
});
export type Verdict = z.infer<typeof verdictSchema>;

// Model confidence is a heuristic, not a calibrated probability of correctness.
export function qualifies(v: Verdict, target: Requirement, hasReference: boolean) {
  return v.matchesTarget && v.framingMatches && v.observedView === target.view &&
    v.confidence >= 0.85 && v.missingParts.length === 0 &&
    (hasReference ? v.sameProduct === 'yes' : v.sameProduct === 'no_reference');
}
export function advanceConfirmation(previous: number, v: Verdict, target: Requirement, hasReference: boolean) {
  return qualifies(v, target, hasReference) ? Math.min(2, previous + 1) : 0;
}

export const exampleSpecs: CaptureSpec[] = [
  {
    version: 1, id: 'box-ad', title: '상자 상품 · 입체 소개',
    product: '앞면과 옆면을 구별할 수 있는 불투명한 직육면체 상품 상자. 앞면에 제품명 또는 로고가 있다.',
    frontDefinition: '제품명이나 로고가 크게 표시된 면을 앞면으로 삼는다.',
    requirements: [
      { id: 'front', label: '제품명을 카메라에 맞춰주세요', view: 'front', framing: 'whole', motion: 'hold', instruction: '상자를 테이블에 세우고, 제품명이 가장 크게 적힌 면을 카메라에 똑바로 맞춰주세요. 휴대폰은 고정하고 상자 전체가 보이게 멈춰주세요.', mustSee: ['앞면 표시', '상자 전체 윤곽'], acceptance: '앞면이 카메라를 향하고 상자의 네 가장자리가 잘리지 않아야 한다.' },
      { id: 'side', label: '상자를 시계 방향으로 돌려주세요', view: 'side', framing: 'whole', motion: 'clockwise', instruction: '휴대폰은 그대로 두세요. 상자를 위에서 내려다봤을 때 시계 방향으로 천천히 돌리세요. 처음 보이던 면이 사라지고 바로 옆의 한 면이 카메라를 향하면 멈춰주세요.', mustSee: ['상자 옆면', '상자 전체 윤곽'], acceptance: '기준 사진의 앞면 대신 인접한 옆면이 주로 보여야 한다. 앞면 사선 구도는 통과시키지 않는다.' },
      { id: 'oblique', label: '반대 방향으로 조금 되돌려주세요', view: 'oblique', framing: 'whole', motion: 'counterclockwise', instruction: '위에서 봤을 때 반시계 방향으로 조금 되돌리세요. 제품명이 있던 면과 방금 찍은 면이 함께 보이고, 그 사이 세로 모서리가 화면 가운데 오면 멈춰주세요.', mustSee: ['기준 사진의 앞면', '옆면', '두 면 사이 모서리'], acceptance: '앞면과 옆면이 모두 충분히 보이고 상자 전체가 프레임 안에 있어야 한다.' },
    ],
  },
  {
    version: 1, id: 'nozzle-ad', title: '노즐형 화장품 · 부분 강조',
    product: '앞면에 제품명이 표시된 노즐형 화장품 용기. 원통형이면 몸통 각도보다 노즐 방향과 앞면 라벨을 함께 본다.',
    frontDefinition: '제품명 라벨을 정면으로 읽을 수 있는 방향을 앞면으로 삼는다.',
    requirements: [
      { id: 'front', label: '제품명을 카메라에 맞춰주세요', view: 'front', framing: 'whole', motion: 'hold', instruction: '용기를 세우고 제품명 라벨을 카메라 쪽으로 맞춰주세요. 노즐부터 바닥까지 화면 안에 담고 멈춰주세요.', mustSee: ['제품명 라벨', '노즐', '용기 바닥'], acceptance: '라벨이 카메라를 향하고 노즐부터 바닥까지 잘리지 않아야 한다.' },
      { id: 'side', label: '노즐이 옆으로 보이게 돌려주세요', view: 'side', framing: 'whole', motion: 'clockwise', instruction: '휴대폰은 고정하고, 용기를 위에서 봤을 때 시계 방향으로 천천히 돌려주세요. 노즐이 화면의 왼쪽이나 오른쪽으로 길게 뻗어 보이면 멈춰주세요.', mustSee: ['노즐의 측면 윤곽', '용기 전체'], acceptance: '기준 앞면에서 회전한 모습과 노즐 측면 구조를 확인할 수 있어야 한다. 대칭이라 방향을 구별할 수 없으면 uncertain으로 판정한다.' },
      { id: 'nozzle', label: '노즐 출구 확대', view: 'detail', framing: 'closeup', motion: 'closer', instruction: '내용물이 나오는 노즐 끝의 구멍을 카메라 쪽으로 돌리세요. 구멍이 선명하게 보이도록 용기를 천천히 가까이 가져온 뒤 멈춰주세요.', mustSee: ['노즐 출구 구멍', '노즐 끝의 윤곽'], acceptance: '노즐 출구 구멍이 직접 보이고 초점이 맞아야 한다. 단순히 용기 전체가 보이는 사진은 부족하다.' },
    ],
  },
];

// Fixed coverage route: named directions are relative to the first image, not a product catalog.
export const sixViewSpec: CaptureSpec = {
  version: 1, id: 'six-view', title: '제품 한 바퀴 + 위아래',
  product: '직접 돌리거나 기울일 수 있는 하나의 제품. 종류와 무관하게 처음 놓인 자세를 기준으로 여섯 방향의 외부 모습을 수집한다.',
  frontDefinition: '첫 사진에 보이는 방향을 시작 방향(front)으로 등록한다. 제품명이나 로고가 없어도 된다. 이때 위와 바닥도 함께 기준으로 정한다.',
  requirements: [
    { id: 'front', label: '시작 모습', view: 'front', framing: 'whole', motion: 'hold', instruction: '제품을 평소 세우는 자세로 놓으세요. 어느 쪽이 카메라를 향해도 괜찮아요. 전체가 테두리 안에 들어오면 2초 정도 멈춰주세요.', mustSee: ['제품 전체 윤곽'], acceptance: '하나의 실제 제품 전체가 선명하게 보이면 시작 방향으로 등록한다. 로고나 정해진 앞면을 요구하지 않는다.' },
    { id: 'right', label: '첫 번째 회전', view: 'right', framing: 'whole', motion: 'clockwise', instruction: '휴대폰은 고정하세요. 제품을 위에서 봤을 때 시계 방향으로 ¼바퀴 천천히 돌린 뒤 멈추세요. 상자라면 바로 옆의 한 면이 카메라를 향하는 위치예요.', mustSee: ['시작 방향과 인접한 새로운 측면', '제품 전체 윤곽'], acceptance: '시작 사진과 다른 인접한 측면이 주로 보여야 한다. right는 이 경로의 첫 시계방향 회전 위치다. 정면 또는 사선만 보이거나 대칭으로 식별 불가능하면 통과시키지 않는다.' },
    { id: 'back', label: '두 번째 회전', view: 'back', framing: 'whole', motion: 'clockwise', instruction: '같은 시계 방향으로 ¼바퀴 더 돌리고 멈추세요. 처음 카메라를 향했던 부분의 반대쪽을 보여주세요. 제품을 위아래로 뒤집지는 마세요.', mustSee: ['시작 방향의 반대쪽', '제품 전체 윤곽'], acceptance: '시작 사진 반대쪽의 외형이 보여야 한다. 이미 확보한 시작/첫 측면과 같은 모습이면 거절한다. 숨겨진 구조를 추정하지 않는다.' },
    { id: 'left', label: '세 번째 회전', view: 'left', framing: 'whole', motion: 'clockwise', instruction: '같은 시계 방향으로 ¼바퀴 더 돌린 뒤 멈추세요. 아직 보여주지 않은 나머지 측면을 담아요. 시작 모습으로 완전히 돌아오지는 마세요.', mustSee: ['첫 번째 회전과 반대인 나머지 측면', '제품 전체 윤곽'], acceptance: '시작 기준 반대편 측면이어야 한다. 첫 회전의 측면을 반복하면 통과시키지 않는다. 좌우가 같아 식별이 불가능하면 uncertain/unknown으로 남긴다.' },
    { id: 'top', label: '윗부분', view: 'top', framing: 'whole', motion: 'tilt-top', instruction: '같은 방향으로 ¼바퀴 더 돌려 시작 모습으로 돌아오세요. 이제 윗부분을 카메라 쪽으로 천천히 숙여주세요. 평소 위에서 내려다볼 때 보이는 부분이 화면을 향하면 멈추세요.', mustSee: ['시작 자세에서 위였던 부분의 외부 표면', '제품 전체 윤곽'], acceptance: '시작 자세의 윗부분이 주로 보여야 한다. 뚜껑을 열 필요 없고 내부를 요구하지 않는다. 측면만 보이면 거절한다.' },
    { id: 'bottom', label: '바닥 부분', view: 'bottom', framing: 'whole', motion: 'tilt-bottom', instruction: '제품을 들어 바닥을 카메라 쪽으로 향하게 해주세요. 평소 테이블에 닿던 부분이 보이게 손을 옮긴 뒤 멈추세요. 들기 어렵거나 뒤집을 수 없으면 아래 건너뛰기를 누르세요.', mustSee: ['시작 자세에서 테이블에 닿던 바닥 표면', '제품 전체 윤곽'], acceptance: '시작 자세의 바닥이 직접 보여야 한다. 윗부분 반복이나 손으로 바닥이 가려진 경우 거절한다.' },
  ],
};
