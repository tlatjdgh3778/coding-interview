# 스펙: 검토 현황 (Review Plugin)

- 상태: 완료
- 최종 갱신: 2026-10-04

## 1. 목표
투자자가 기준별 검토 목록 화면 상단에서 자신의 검토 진행 현황(작성한 기준 수, 확인함 수, `추가 확인 필요` 수, 미작성 기준 수)을 보고, 기준별 카드의 근거 자료로 바로 이동해 확인한다. `추가 확인 필요`는 작성한 검토로 센다. 현황은 투자자 개인의 검토 진행 상태이며 회사 전체의 합의나 투자 승인 상태가 아니다. 범위는 Plugin 목록 화면의 요약 카드와 근거 칩 이동(목록에서 여는 근거 미리보기 모달)이고, 서버는 기존 `criteria.list`·`reviews.list`를 그대로 쓴다. [사용자 결정]

## 2. 비목표
- 진행률 도넛과 우측 "검토 작성 가이드" 카드는 만들지 않는다. [사용자 결정]
- 서버 집계 RPC(`reviews.summary`), 새 DTO, gen-ts 변경, 마이그레이션은 추가하지 않는다. 집계는 클라이언트에서 한다. [사용자 결정]
- 별도 `/status` 라우트는 만들지 않는다. [사용자 결정]
- 다른 투자자나 회사 단위 집계, 합의·승인 표시는 하지 않는다. [사용자 결정]
- 기준 작성·수정 화면(`criterion-page`)의 흐름은 바꾸지 않는다. [제안 후 승인]

## 3. 완료의 정의
- DoD-1: 투자자의 목록 화면(`/`) 상단에 요약 카드가 표시되고 `작성 N/전체`, `확인함`, `추가 확인 필요`, `미작성` 4개 항목이 따로 보인다. 검토가 없는 `investor-peer`는 `작성 0/3`, `확인함 0`, `추가 확인 필요 0`, `미작성 3`이다 — 검증: Playwright E2E(실 API·DB, `peer@lighthouse.test`) [사용자 결정]
- DoD-2: `추가 확인 필요` 검토는 작성 수에 포함되고 확인함 수에는 포함되지 않는다 — 검증: Playwright E2E(실 API·DB, 저장 슬롯의 `추가 확인 필요` 검토 기준) [사용자 결정]
- DoD-3: 검토를 저장하면 목록으로 돌아온 화면의 현황 숫자가 새로고침 없이 갱신된다 — 검증: Playwright E2E(실 API·DB, 기존 저장 슬롯 방식) [사용자 결정]
- DoD-5: 기준별 카드의 근거 칩을 누르면 기준 상세·수정 모달 없이 목록 화면에서 해당 자료의 근거 미리보기 모달이 열린다 — 검증: Playwright E2E(실 API·DB, `target: "dataroom"` `documents.get` 응답의 자료 표시) [사용자 결정]
- DoD-6: 근거 미리보기 모달을 닫으면 목록 화면으로 돌아오고 현황 숫자가 그대로 보인다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-7: 기업 담당자 화면에는 요약 카드가 없고 Review Plugin의 `criteria.list` 외 RPC와 dataroom RPC 요청이 나가지 않는다 — 검증: Playwright E2E(실 API·DB, `page.on("request")`로 요청 확인) [사용자 결정]
- DoD-8: 서버 코드, `api-client/`, `api/migrations/` 변경 없이 `make check-docker`의 gen-ts 일치 검사가 통과한다 — 검증: `make check-docker` 실행과 diff 확인 [사용자 결정]

## 4. 인터페이스 계약
- 서버 API 변경은 없다. `criteria.list`, `reviews.list`(`pluginId: "review"`)와 `documents.list`, `documents.get`(`target: "dataroom"`)을 기존 형식 그대로 재사용한다. [사용자 결정]
- 집계 값은 클라이언트에서 계산한다: 전체 = `criteria.list`의 기준 수, 작성 = 기준과 매칭되는 `reviews.list` 항목 수, 확인함 = 그중 `status === "satisfied"`, `추가 확인 필요` = 그중 `status === "needs_information"`, 미작성 = 전체 − 작성. [제안 후 승인]
- 새 React Query 키는 만들지 않고 기존 `criteria`·`reviews` 쿼리(`scopedKey()`)를 재사용한다. 저장 후 기존 `reviews` invalidate로 현황이 갱신된다. Plugin 화면 경로는 기존 `/`와 `/criteria/:id` 2종을 유지한다. [제안 후 승인]
- 요약 카드 컴포넌트는 `CriteriaList`(투자자 경로) 안에만 두고 `app.tsx`의 기업 분기에는 두지 않는다(CLAUDE.md의 기업 사용자 규칙). [사용자 결정]

## 5. 엣지 케이스와 실패 시나리오

### 5.1 조회 실패·로딩
- EC-1: `criteria.list` 또는 `reviews.list` 조회가 실패하면 요약 카드는 숫자를 표시하지 않고(0건·미작성으로 표시하지 않음) 별도 오류 표시는 만들지 않는다. 오류와 재시도는 기존 목록의 오류 표시 하나가 맡는다 — 검증: Playwright E2E(실패 응답 mock) [사용자 결정]
- EC-2: `criteria.list` 또는 `reviews.list` 조회가 로딩 중이면 요약 카드는 숫자 대신 로딩 상태를 보여준다 — 검증: Playwright E2E(응답 지연 mock) [제안 후 승인]
- EC-3: `documents.list` 조회가 실패해도 현황 숫자는 그대로 표시되고 근거 칩은 raw ID 대신 "자료 제목을 불러오지 못했습니다"로 표시된다 — 검증: Playwright E2E(`documents.list` 실패 mock) [사용자 결정]
- EC-4: `documents.list` 조회가 로딩 중이면 근거 칩은 "불러오는 중" 텍스트를 보여준다 — 검증: Playwright E2E(응답 지연 mock) [제안 후 승인]
- EC-5: `documents.list` 실패 후에도 근거 칩을 누르면 미리보기가 `documents.get`으로 자체 조회해 열리고(조회 전·실패 시 모달 제목은 중립 제목 "근거 자료"이며, 화면에는 기존 미리보기 모달 제목 형식에 따라 "근거 자료 미리보기"로 표시된다), 조회가 실패하면 재시도할 수 있다 — 검증: Playwright E2E(`documents.list` 실패 mock, `documents.get` 실제·실패 mock) [사용자 결정]

### 5.2 표시 규칙
- EC-6: 모든 기준을 작성했지만 확인함이 더 적은 경우(예: `작성 3/3`, `확인함 1`, `추가 확인 필요 2`)에도 숫자 4개만 표시하고 "완료"·"모두 확인" 같은 판정 문구는 없다 — 검증: Playwright E2E(`reviews.list` 응답 mock) [사용자 결정]

### 5.4 동시성
- EC-9: 현황은 별도 저장 없이 `reviews.list` 결과에서 계산되므로 동시 저장은 기존 last-write-wins를 따르고 `reviews` 쿼리가 다시 조회되면 숫자가 최신 값으로 바뀐다 — 검증: 테스트 설계 단계에서 확정 [제안 후 승인]

## 미결정 사항
없음. 모바일 레이아웃 세부와 숫자·라벨 문구는 구현 단계에서 시안을 따른다.
