# 데모 접근 코드 제거 검증 — 2026-11-16

촬영·기획의 코드 입력창, 클라이언트 코드 전송, 서버 코드 검사를 제거했다. 기존 코드 환경변수가 남아 있어도 접근을 막지 않는다. API 키, 동일 출처 검사, 요청 크기 제한 및 인스턴스별 요청 제한은 유지한다.

## 배포

- 통합 앱: https://frame-prompt-demo.vercel.app — dpl_3HwZcWAUt39wYujcWmB2guSu3WFW, production READY
- 기존 촬영 앱: https://frame-capture-demo.vercel.app — dpl_EhMpG1Wa8jhqqyZJRLxwdvv1KrVV, production READY
- 통합 앱은 frame-studio 소스, 촬영 앱은 deployments/capture-app 소스로 배포했다.

## 확인 결과

- 통합 앱 테스트 38개 및 타입 검사 통과. 두 배포 대상 production build 통과.
- 두 호스트의 capture status: configured=true, accessRequired=false.
- 통합 앱의 prompt status: configured=true, accessRequired=false.
- 코드 없는 빈 observe 요청은 401 대신 입력 검증 오류 400 반환.
- 통합 앱 실제 observe 호출: 합성 테스트 사진으로 HTTP 200, gpt-5.4-mini, 입력 1662 / 출력 323 토큰.
- 통합 앱 실제 prompt plan 호출: 같은 합성 사진으로 HTTP 200, 연출안 3개 반환.
- 브라우저에서 촬영 시작 화면의 코드 입력창 제거, 촬영 준비됨 상태, 예시 사진 검토 및 기획 연결을 확인했다. 기존 저장 기획은 유지했다.
- 실제 휴대전화 카메라와 실물 제품 정확도는 이번 검증 범위에 포함되지 않는다.

촬영은 브라우저 품질 검사와 서버 비전 LLM 판정을 함께 사용하며, 기획 생성·수정은 서버 OpenAI 호출을 사용한다. 예시 사진 연결 체험은 별도 로컬 데모 흐름이다.
