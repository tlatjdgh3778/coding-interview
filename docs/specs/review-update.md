# 스펙: 검토 수정 (Review Plugin)

- 상태: 완료
- 최종 갱신: 2026-10-03

## 1. 목표
투자자가 이미 저장한 기준별 검토를 다시 열어 `확인함(satisfied)`·`추가 확인 필요(needs_information)`, 의견, `ready` 자료 근거를 수정한다. 투자자 한 명의 기준별 검토는 한 개이며 수정해도 같은 검토(같은 `id`)로 유지한다. 범위는 `reviews.update` RPC, Plugin 수정 화면(저장된 기준 카드의 `검토 수정` 버튼과 값이 채워진 수정 모달), 근거 자료 제목 검색이다. 기존 스펙 `docs/specs/review-write.md`의 §2 재수정 제외, §4 화면 경로 설명, DoD-10·11(저장 후 읽기 전용 상세로 전환), DoD-12(상세에 수정 진입점 없음), DoD-13(상세 모달의 근거 미리보기)과 버튼 문구(`작성하기` → `검토 작성`, `상세 보기` → `검토 수정`)를 쓰는 DoD-2·15·16 등의 E2E case는 이 스펙에 맞게 갱신 대상이고, EC-10(`reviews.create` 재저장 409)은 그대로 유효하다. [제안 후 승인]

## 2. 비목표
- 수정 이력은 두지 않는다. 최신 내용과 수정 시각만 유지한다. [제안 후 승인]
- 낙관적 락·충돌 감지는 넣지 않는다. 동시 저장은 last-write-wins이다. [제안 후 승인]
- 검토 삭제는 구현하지 않는다. [제안 후 승인]
- 다른 투자자의 검토 조회·수정은 없다. 요청에 투자자 ID를 받지 않는다. [제안 후 승인]
- 기업 담당자의 수정은 지원하지 않는다. 403으로 거부한다. [제안 후 승인]
- 현황 패널(작성 수·확인함·추가 확인 필요 집계, 진행률)은 만들지 않고 화면에도 두지 않는다. 현황은 다음 구현 순서에서 다룬다. [사용자 결정]

## 3. 완료의 정의
- DoD-1: 투자자가 `reviews.update`로 `status`와 `comment`를 바꿔 보내면 응답의 `review`와 DB 행에 요청 값(`comment`는 trim한 값)이 저장된다 — 검증: Rust 통합 테스트(실 PostgreSQL, DB 행 직접 조회) [제안 후 승인]
- DoD-2: `reviews.update` 후에도 검토의 `id`와 `createdAt`은 수정 전과 같다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- DoD-3: `reviews.update`가 성공하면 `updatedAt`이 수정 전보다 이후 시각으로 갱신된다. 값이 바뀌지 않은 요청도 같다 — 검증: Rust 통합 테스트(실 PostgreSQL, 동일 값 재저장 포함) [제안 후 승인]
- DoD-4: `reviews.update` 후 검토의 근거는 요청한 `ready` 자료 ID 집합과 정확히 같고 빠진 자료는 `review_evidence`에 남지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, `review_evidence` 행 직접 조회) [제안 후 승인]
- DoD-5: `reviews.update` 후에도 해당 투자자·기준의 `reviews` 행은 1개다 — 검증: Rust 통합 테스트(실 PostgreSQL, 행 수 조회) [제안 후 승인]
- DoD-6: `reviews.update` 직후 `reviews.list`가 수정된 값과 근거를 반환한다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- DoD-7: 기업 담당자의 `reviews.update`는 입력 검증보다 먼저 403으로 거부되고 기존 검토는 바뀌지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 잘못된 입력을 함께 보내 권한 검사 순서 확인) [제안 후 승인]
- DoD-8: 투자자의 `reviews.update`는 다른 투자자(`investor-peer`)의 같은 기준 검토를 바꾸지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 두 투자자 모두 저장한 상태) [제안 후 승인]
- DoD-9: 해당 투자자가 저장한 검토가 없는 기준에 `reviews.update`를 보내면 404 `not_found`가 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 다른 투자자만 저장한 기준 포함) [제안 후 승인]
- DoD-10: 저장된 기준 카드의 `검토 수정` 버튼을 누르면 `○○ 검토 수정` 모달이 열리고 저장된 결과·의견·근거가 채워져 있다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-11: 수정 모달에서 값을 바꿔 저장하면 모달이 닫히고 `/`로 돌아간다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-12: 수정 저장 후 해당 카드에 새 의견·근거 칩이 표시되고 `최종 수정` 시각이 수정 전보다 이후로 바뀐다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-13: 최초 작성 저장에 성공해도 모달이 닫히고 `/`로 돌아가며 카드에 저장한 내용이 표시된다 — 검증: Playwright E2E(실 API·DB) [제안 후 승인]
- DoD-14: 저장된 기준을 열면 읽기 전용 상세 모달 대신 값이 채워진 수정 모달이 열린다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-15: 근거 목록의 `자료 제목으로 검색` 입력으로 제목이 일치하는 자료만 목록에 표시된다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-16: 검색으로 목록에서 가려진 자료도 이미 선택했다면 선택 상태가 유지되어 저장 요청에 포함된다 — 검증: Playwright E2E(실 API·DB, 요청 본문 확인) [사용자 결정]
- DoD-17: `make gen-ts-docker` 후 `make check-docker`의 gen-ts 일치 검사가 통과하고 Plugin UI가 생성된 `UpdateReview*` 타입을 소비한다 — 검증: `make check-docker` 실행 [제안 후 승인]

## 4. 인터페이스 계약
- API: `POST /api/plugins/rpc`의 `pluginId: "review"`에 method `reviews.update`를 추가한다. `reviews.create`의 중복 저장 409는 그대로 유지한다. 요청·응답·오류 형식은 기존 형식을 따른다. [제안 후 승인]
- `reviews.update` 요청 `params`는 `{ "criterionId": "string", "status": "satisfied" | "needs_information", "comment": "string", "evidenceDocumentIds": ["string"] }`이고 네 필드 모두 필수이며 camelCase, 알 수 없는 필드는 거부한다. 응답 `result`는 `UpdateReviewResponse { "review": Review }`이고 `Review`는 `reviews.list`와 같은 모양이다. [제안 후 승인]
- 식별: 검토는 `criterionId`와 서버가 확인한 `CurrentUser`로 정한다. 요청에 `reviewId`·투자자 ID를 받지 않는다. [제안 후 승인]
- 입력 규칙은 `reviews.create`와 같다. `comment`는 trim 후 1~2000자(문자 수 기준)이고 `evidenceDocumentIds`는 같은 workspace의 `ready` 자료 ID이며 1개 이상, 중복 불가이다. [제안 후 승인]
- 검증 순서: `reviews.update`는 `workspaceId` 불일치 403, 기업 담당자 403, 입력 형식 400(필드·`status`·`comment`), 존재하지 않는 기준 404, 근거 자료 400, 저장된 검토 없음 404 순으로 판정한다. [제안 후 승인]
- 서버가 정하는 값: 검토 `id`와 `createdAt`은 유지하고 `updatedAt`은 갱신 문장을 실행하는 시점의 DB 시각(트랜잭션 시작 시각이 아님)으로 갱신한다. 투자자와 workspace는 서버가 정한다. [제안 후 승인]
- 오류 응답은 400 `invalid_input`, 401(미인증, 기존 extractor), 403 `forbidden`, 404 `not_found`(존재하지 않는 기준 또는 저장된 검토 없음), 500 `storage_error`로 구분한다. `reviews.update`에는 409가 없다. [제안 후 승인]
- 데이터 스키마: 새 마이그레이션은 추가하지 않는다. 기존 `reviews`의 `reviews_investor_criterion_key` 유일 제약과 `updated_at`, `review_evidence`를 사용한다. [제안 후 승인]
- DTO는 `plugins/review/server/types.rs`에 ts-rs로 `UpdateReviewRequest`를 정의하고 TS 타입은 `make gen-ts-docker`로 생성한다. `api-client/`는 직접 수정하지 않는다. [제안 후 승인]
- Plugin 화면 경로는 기존 `/`와 `/criteria/:id` 2종을 유지한다. 저장된 기준의 `/criteria/:id`는 값이 채워진 수정 모달이고 읽기 전용 상세 모달(`ReviewDetail`)은 제거한다. 근거 미리보기 모달은 입력 모달 위에 겹치는 기존 방식을 유지한다. [사용자 결정]

## 5. 엣지 케이스와 실패 시나리오

### 5.1 서버 입력 검증
- EC-1: `comment`가 비어 있거나 공백뿐이면 400 `invalid_input`이 반환되고 기존 검토·근거는 바뀌지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 기존 행 직접 조회) [제안 후 승인]
- EC-2: `comment`가 trim 후 2000자(문자 수 기준)를 넘으면 400 `invalid_input`이 반환되고 기존 검토·근거는 바뀌지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 경계값 확인) [제안 후 승인]
- EC-3: `evidenceDocumentIds`가 비어 있거나 중복·없는 자료·다른 workspace 자료·`processing`/`failed` 자료를 포함하면 400 `invalid_input`이 반환되고 기존 검토·근거는 바뀌지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 입력별 확인, 시드 `doc-pipeline`·`doc-revenue`) [제안 후 승인]
- EC-4: 알 수 없는 필드나 허용되지 않은 `status`는 400 `invalid_input`이 반환되고 기존 검토·근거는 바뀌지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]

### 5.2 권한
- EC-5: 요청 `workspaceId`가 사용자 workspace와 다르면 403이 반환되고 기존 검토는 바뀌지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- EC-6: 로그인하지 않은 `reviews.update` 요청은 401로 거부된다 — 검증: 테스트 설계 단계에서 확정 [제안 후 승인]

### 5.3 중간 실패
- EC-7: 근거 교체 중 DB 오류가 나면 전체가 롤백되어 기존 의견·결과·근거와 `updatedAt`이 그대로이고 500 `storage_error`가 반환된다 — 검증: 테스트 설계 단계에서 확정(실패 유발 방식 포함) [제안 후 승인]

### 5.4 동시성
- EC-8: 같은 검토를 두 `reviews.update` 요청이 동시에 수정하면 검토 행은 1개이고 최종 근거 목록은 두 요청 중 하나의 목록과 정확히 같다 — 검증: Rust 통합 테스트(실 PostgreSQL, 서로 다른 근거 집합으로 동시 호출) [제안 후 승인]

### 5.5 화면 실패 처리
- EC-9: 수정 저장 요청이 실패하면 모달이 열린 채 오류가 표시되고 결과·의견·근거 선택이 보존되어 다시 저장할 수 있다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-10: 저장 요청 중에는 입력과 저장 버튼이 비활성화되어 이중 제출이 막힌다 — 검증: Playwright E2E(응답 지연 유발 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-11: 수정 모달이 열려 있는 동안 `reviews.list`가 다시 조회되어도 편집 중인 값은 덮어써지지 않는다 — 검증: Playwright E2E(재조회 유발 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-12: 공백뿐인 의견, 근거 0건, 2000자 초과로 저장하면 요청을 보내지 않고 해당 입력 옆에 안내가 표시된다 — 검증: Playwright E2E(`page.on("request")`로 요청 수 확인) [제안 후 승인]
- EC-13: `reviews.list` 조회가 로딩 중이거나 실패하면 `검토 수정` 버튼으로 수정 모달을 열 수 없다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-14: 기업 담당자 화면은 기존과 같이 사용 불가 안내와 읽기 전용 기준 목록만 표시하고 수정 진입점이 없으며 `criteria.list` 외의 요청이 나가지 않는다 — 검증: Playwright E2E(`page.on("request")`로 요청 수 확인) [제안 후 승인]

- EC-17: 수정 모달은 X·취소·Esc·바깥 클릭 어느 쪽으로 닫아도 저장하지 않고 `/`로 돌아가며 입력은 폐기되고 미저장 경고는 표시되지 않는다 — 검증: Playwright E2E(실 API·DB, 닫기 방식별 확인) [제안 후 승인]

### 5.6 근거 검색
- EC-15: 검색 결과가 없어도 이미 선택한 자료의 선택 상태는 유지된다 — 검증: Playwright E2E(실 API·DB) [제안 후 승인]
- EC-16: 검색은 제목만 대상으로 하고 대소문자를 구분하지 않으며 입력 앞뒤 공백은 무시한다 — 검증: Playwright E2E(입력별 확인, 대소문자 표본은 시드 자료 제목이 한글뿐이라 mock 사용 여부를 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-18: 저장 요청 중에는 검색 입력도 비활성화된다 — 검증: Playwright E2E(응답 지연 유발 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-19: 검색어는 근거 미리보기 모달을 열었다 닫아도 유지되고 수정 모달을 닫았다 다시 열면 초기화된다 — 검증: Playwright E2E(실 API·DB) [제안 후 승인]
- EC-20: `processing`·`failed` 자료도 제목이 검색어와 일치하면 목록에 표시되고 선택 불가 표시는 유지된다 — 검증: Playwright E2E(시드 `doc-pipeline`·`doc-revenue`) [제안 후 승인]
- EC-21: 검색 결과가 없을 때 안내 문구는 "일치하는 자료가 없습니다"이다 — 검증: Playwright E2E(실 API·DB) [제안 후 승인]

## 미결정 사항
없음
