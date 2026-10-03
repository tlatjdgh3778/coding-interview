# 스펙: 검토 작성·조회 (Review Plugin)

- 상태: 확정
- 최종 갱신: 2026-10-03

## 1. 목표
투자자가 Review Plugin에서 초기 마이그레이션의 검토 기준(사업 이해·팀 구성·매출 현황)별로 `확인함(satisfied)` 또는 `추가 확인 필요(needs_information)`와 의견, 같은 데이터룸의 `ready` 자료 근거(자료 ID)를 최초 1회 저장하고, 저장한 검토와 근거 자료를 다시 읽는다. 검토 내용과 근거 자료는 구분해 저장하며, 자료 등록 성공만으로 기준이 충족된 것으로 판단하지 않는다. 범위는 기준 조회·검토 조회·검토 작성 RPC, 검토용 DB 마이그레이션, Plugin 화면이다. 기준 작성·근거 자료 미리보기는 모달로 표시하며 저장한 검토의 수정은 `docs/specs/review-update.md`가 다룬다. [사용자 결정]

## 2. 비목표
- 저장한 검토의 수정(수정 화면, update API)은 `docs/specs/review-update.md`가 다루며 이 스펙의 범위가 아니다. 이 스펙의 `reviews.create`는 이미 저장된 기준에 대한 재저장 요청을 거부한다(§5.3 EC-10). [제안 후 승인]
- 기준 생성·수정은 구현하지 않는다. [사용자 결정]
- 수정 이력과 last-write-wins 동시 저장 규칙은 `docs/specs/review-update.md`가 다루며 이 스펙에서는 다루지 않는다. [제안 후 승인]
- 검토 현황(작성·미작성·확인함 집계)은 별도 단계로 남기고 이번 범위에서 제외한다. [제안 후 승인]
- 본체 자료 상세 화면으로의 이동은 구현하지 않는다. 근거 자료는 Plugin 안의 모달로만 보여준다. [사용자 결정]
- 근거 미리보기의 파일 크기·분류 태그·다운로드는 이번 범위에서 제외한다. [사용자 결정]
- 근거 자료 개수 상한은 두지 않는다. [사용자 결정]

## 3. 완료의 정의
- DoD-1: 투자자가 `criteria.list`를 호출하면 사업 이해·팀 구성·매출 현황 3건이 `display_order` 순으로 id·제목·검토 질문과 함께 반환된다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- DoD-2: 투자자가 Plugin 첫 화면(`/`)을 열면 기준 3개가 검토 질문과 함께 표시되고 저장 전 기준에는 `미작성` 배지가 표시된다 — 검증: Playwright E2E(실 API·DB) [제안 후 승인]
- DoD-3: 투자자가 `reviews.create`로 기준 ID·상태·의견·`ready` 자료 ID 1개 이상을 보내면 검토가 저장되고 응답에 id·기준 ID·상태·의견·근거 자료 ID 목록·작성 시각·수정 시각이 담긴다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- DoD-4: 저장된 근거는 파일명이 아닌 자료 ID로 `review_evidence`에 연결되며 `reviews`와 별도 행으로 저장된다 — 검증: Rust 통합 테스트(실 PostgreSQL, DB 행 직접 조회) [사용자 결정]
- DoD-5: 투자자가 `reviews.list`를 호출하면 본인이 저장한 검토가 근거 자료 ID와 함께 반환된다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- DoD-6: `reviews.list`는 다른 투자자의 검토를 반환하지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, `investor-user`·`investor-peer`) [제안 후 승인]
- DoD-7: 기업 담당자의 `reviews.list`는 빈 목록을 반환한다 — 검증: Rust 통합 테스트(실 PostgreSQL, 투자자가 저장한 검토가 있는 상태) [사용자 결정]
- DoD-8: 기업 담당자의 `reviews.create`는 입력 검증보다 먼저 403으로 거부되고 DB에 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 잘못된 입력을 함께 보내 권한 검사 순서 확인) [사용자 결정]
- DoD-9: 요청 `workspaceId`가 사용자 workspace와 다르면 `criteria.list`·`reviews.list`·`reviews.create` 모두 403이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- DoD-10: 투자자가 미작성 기준을 열면 목록 위에 작성 폼 모달(`/criteria/:id`)이 표시되고, 상태·의견·`ready` 근거를 입력해 저장하면 모달이 닫히고 `/`로 돌아간다 — 검증: Playwright E2E(실 API·DB, mock 없음) [제안 후 승인]
- DoD-11: 저장에 성공하면 첫 화면(`/`)의 해당 기준 배지가 저장한 상태(`확인함` 또는 `추가 확인 필요`)로 표시된다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-13: 작성 폼 모달에서 근거 자료의 미리보기를 열면 작성 폼 모달 위에 근거 미리보기 모달이 열려 자료 제목·파일명·상태·작성일·본문이 읽기 전용으로 표시된다 — 검증: Playwright E2E(실 API·DB, `target:"dataroom"` 조회) [제안 후 승인]
- DoD-14: 기업 담당자가 Plugin을 열면 사용 불가 안내가 표시되고 `reviews.list`·`reviews.create`·`documents.*` 요청이 한 건도 나가지 않는다 — 검증: Playwright E2E(`page.on("request")`로 요청 수 확인) [사용자 결정]
- DoD-15: 기업 담당자가 자료를 등록해도 투자자 화면의 모든 기준 배지는 `미작성`으로 유지된다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-16: 투자자가 검토를 저장한 뒤 다른 투자자로 로그인해 Plugin에 들어가면 이전 투자자의 검토·캐시·입력이 보이지 않는다 — 검증: Playwright E2E(`investor`→`peer` 전환) [제안 후 승인]
- DoD-17: `make check-docker`, `make test-api`, `make test-e2e`가 통과한다 — 검증: 세 명령 실행 [제안 후 승인]
- DoD-18: 앞뒤에 공백이 있는 `comment`로 저장하면 trim한 값이 DB에 저장되고 `reviews.create` 응답과 `reviews.list`에 같은 값으로 반환된다 — 검증: Rust 통합 테스트(실 PostgreSQL, DB 행 직접 조회) [사용자 결정]
- DoD-19: `reviews.list`는 검토를 기준의 `display_order` 순으로, 각 검토의 `evidenceDocumentIds`를 자료 ID 오름차순으로 반환한다 — 검증: Rust 통합 테스트(실 PostgreSQL, 기준 3건을 역순으로 저장하고 근거를 역순으로 요청) [사용자 결정]
- DoD-20: 기업 담당자의 `criteria.list`는 기준 3건을 `display_order` 순으로 반환한다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- DoD-21: 작성 폼 모달에서 상태·의견·근거를 입력한 채 근거 미리보기 모달을 열었다 닫으면 선택한 상태·입력한 의견·선택한 근거가 그대로 유지된다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-22: 작성 폼 모달을 저장 없이 닫으면(X 버튼, 취소, Esc, 바깥 클릭) 모달이 닫혀 `/`로 돌아가고 입력은 폐기되어 같은 기준을 다시 열면 빈 폼이 표시된다 — 검증: Playwright E2E(실 API·DB, 닫기 방식별 확인) [사용자 결정]
- DoD-23: 기업 담당자가 Plugin을 열면 사용 불가 안내 아래에 기준 3개가 번호·제목·검토 질문과 함께 읽기 전용으로 표시되고 상태 배지·작성 버튼·상세 버튼·모달은 없다 — 검증: Playwright E2E(실 API·DB) [사용자 결정]
- DoD-24: 투자자가 검토를 저장해 모달이 닫히면 첫 화면(`/`)의 해당 기준 카드에 저장한 의견과 근거 자료 제목이 표시된다 — 검증: Playwright E2E(실 API·DB) [제안 후 승인]

## 4. 인터페이스 계약
- API 경로: `POST /api/plugins/rpc`에 `pluginId: "review"`로 호출하고 method 분기로 `criteria.list`, `reviews.list`, `reviews.create`를 제공한다. 요청·응답·오류 형식은 기존 형식(`{ "workspaceId", "method", "params" }`, `{ "result" }`, `{ "kind", "message" }`)을 따른다. [제안 후 승인]
- 권한: `criteria.list`는 기업 담당자·투자자 모두 가능하다. `reviews.list`는 투자자에게 본인 검토만, 기업 담당자에게 빈 목록을 반환한다. `reviews.create`는 투자자만 가능하다. 사용자 ID·역할은 서버가 확인한 `CurrentUser`만 사용하고 요청 값을 신뢰하지 않는다. [사용자 결정]
- 기업 담당자 화면은 사용 불가 안내와 `criteria.list`로 조회한 읽기 전용 기준 목록만 표시하며 `criteria.list` 외의 검토·자료 요청은 보내지 않는다. [사용자 결정]
- `criteria.list` 응답 `result`는 `{ "criteria": [{ "id": "string", "title": "string", "reviewQuestion": "string" }] }`이다. [사용자 결정]
- `reviews.list` 응답 `result`는 `{ "reviews": [Review] }`이다. `Review`는 `{ "id": "string", "criterionId": "string", "status": "satisfied" | "needs_information", "comment": "string", "evidenceDocumentIds": ["string"], "createdAt": "string", "updatedAt": "string" }`이고 시각은 ISO 8601 UTC 문자열이다. [사용자 결정]
- `reviews.create` 요청 `params`는 `{ "criterionId": "string", "status": "satisfied" | "needs_information", "comment": "string", "evidenceDocumentIds": ["string"] }`이고 네 필드 모두 필수이며 camelCase, 알 수 없는 필드는 거부한다. 응답 `result`는 `{ "review": Review }`이다. [사용자 결정]
- 입력 규칙: `comment`는 trim 후 1~2000자(문자 수 기준)이며 trim한 값을 저장·반환한다. `evidenceDocumentIds`는 같은 workspace의 `ready` 자료 ID이며 1개 이상, 중복 불가이며 개수 상한은 없다. [사용자 결정]
- 검증 순서: `reviews.create`는 `workspaceId` 불일치 403, 기업 담당자 403, 입력 형식 400(필드·`status`·`comment`), 존재하지 않는 기준 404, 근거 자료 400, 재저장 409 순으로 판정한다. [사용자 결정]
- 정렬: `reviews.list`는 검토를 기준의 `display_order` 순으로, `evidenceDocumentIds`는 자료 ID 오름차순으로 반환한다. 요청 시 선택 순서는 보존하지 않는다. [사용자 결정]
- 서버가 정하는 값: 검토 `id`, `createdAt`·`updatedAt`(DB `NOW()`), 작성 투자자(`CurrentUser`), workspace는 서버가 정하며 요청 본문으로 바꿀 수 없다. [제안 후 승인]
- 오류 응답은 400 `invalid_input`(입력·근거 검증 실패), 401(미인증, 기존 extractor), 403 `forbidden`(기업 담당자의 `reviews.create` 또는 `workspaceId` 불일치), 404 `not_found`(존재하지 않는 기준), 409 `conflict`(같은 투자자·기준의 재저장), 500 `storage_error`(DB 오류)로 구분한다. 서버 `message`는 정적 문자열이다. [제안 후 승인]
- 데이터 스키마: `api/migrations/0005_*.sql`로 `reviews`(투자자·기준 유니크, `status` CHECK `IN ('satisfied','needs_information')`, 기준은 `review_criteria.id` 참조)와 `review_evidence`(검토와 `documents.id` 연결, 같은 검토 안 자료 중복 불가) 테이블을 추가한다. 적용된 마이그레이션은 수정하지 않는다. [사용자 결정]
- DTO는 `plugins/review/server/types.rs`에 ts-rs로 정의하고 TS 타입은 `make gen-ts-docker`로 생성한다. `api-client/`는 직접 수정하지 않는다. [제안 후 승인]
- Plugin 화면 경로(Plugin 내부 경로)는 기준 목록 `/`와 기준 작성 `/criteria/:id` 2종이다(저장된 기준의 `/criteria/:id`는 `docs/specs/review-update.md`가 정한다). `/criteria/:id`는 목록 위에 모달로 표시하고 새로고침하면 복원하며 닫으면 `/`로 돌아간다. 근거 자료 미리보기는 경로 없이 로컬 상태의 모달(작성 폼 모달 위에 겹침)이며 제목·파일명·상태·작성일·본문을 읽기 전용으로 표시한다. 근거 자료 조회는 `host.call("documents.get", { documentId }, { target: "dataroom" })`로 하고 Plugin은 본체 화면 구조를 알지 못한다. [사용자 결정]

## 5. 엣지 케이스와 실패 시나리오

### 5.1 서버 입력 검증
- EC-1: `status`가 `satisfied`·`needs_information` 이외의 값이면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- EC-2: `comment`가 비어 있거나 공백뿐이거나 trim 후 2000자(문자 수 기준)를 넘으면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 입력별·경계값 확인) [사용자 결정]
- EC-3: 알 수 없는 필드가 있으면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- EC-4: 존재하지 않는 `criterionId`는 404 `not_found`가 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- EC-29: `reviews.create` 요청에서 `criterionId`·`status`·`comment`·`evidenceDocumentIds` 중 하나라도 빠지면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 누락 필드별 확인) [사용자 결정]

### 5.2 근거 자료 검증
- EC-5: `evidenceDocumentIds`가 비어 있으면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- EC-6: `evidenceDocumentIds`에 중복 ID가 있으면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- EC-7: 존재하지 않는 자료 ID가 있으면 400 `invalid_input`이 반환되고 검토·근거 행이 모두 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- EC-8: 다른 workspace의 자료 ID가 있으면 존재하지 않는 자료와 같은 400 `invalid_input`이 반환되고 검토·근거 행이 모두 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 테스트 안에서 다른 workspace 자료 INSERT) [사용자 결정]
- EC-9: `processing`·`failed` 자료 ID가 있으면 400 `invalid_input`이 반환되고 검토·근거 행이 모두 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 시드 `doc-pipeline`·`doc-revenue`) [사용자 결정]

### 5.3 재저장·동시성
- EC-10: 같은 투자자가 이미 검토를 저장한 기준에 `reviews.create`를 다시 보내면 409 `conflict`가 반환되고 기존 검토와 근거는 바뀌지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 기존 행 직접 조회) [사용자 결정]
- EC-11: 같은 투자자·같은 기준의 `reviews.create` 요청 2개가 동시에 오면 1건만 저장되고 한 요청은 성공하며 다른 요청은 409 `conflict`가 반환된다 — 검증: Rust 통합 테스트(동시 호출) [사용자 결정]
- EC-12: 다른 투자자는 같은 기준에 각자 검토를 저장할 수 있다 — 검증: Rust 통합 테스트(실 PostgreSQL, `investor-user`·`investor-peer`) [제안 후 승인]

### 5.4 저장 실패
- EC-13: DB 오류는 500 `storage_error`로 반환되고 검토와 근거가 모두 롤백되어 어느 쪽도 남지 않으며 메모리 저장소로 대체하지 않는다 — 검증: 테스트 설계 단계에서 확정 [제안 후 승인]

### 5.5 화면 실패 처리
- EC-14: 기준 목록 조회가 실패하면 `role="alert"` 오류와 재시도 버튼이 표시되고 `미작성` 배지나 빈 목록으로 표시되지 않는다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [사용자 결정]
- EC-15: 근거 자료 미리보기 모달의 조회가 실패하면(404 포함) 모달 안에 오류 안내가 표시되고 자료 없음·빈 본문으로 표시되지 않는다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-16: `ready` 자료가 하나도 없으면 근거 선택 영역에 빈 안내가 표시되고 저장할 수 없다 — 검증: Playwright E2E(자료가 없는 상태를 만드는 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-17: `processing`·`failed` 자료는 근거 선택 목록에 표시되지만 선택할 수 없고 선택 불가 사유가 함께 표시된다 — 검증: Playwright E2E(시드 `doc-pipeline`·`doc-revenue`) [사용자 결정]
- EC-18: 상태 미선택, 공백뿐인 의견, 근거 0건으로 저장하면 요청을 보내지 않고 해당 입력 옆에 안내가 표시된다 — 검증: Playwright E2E(`page.on("request")`로 요청 수 확인) [제안 후 승인]
- EC-19: 저장 요청이 실패하면 선택한 상태·입력한 의견·선택한 근거가 보존되고 같은 화면에서 다시 저장할 수 있다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [사용자 결정]
- EC-20: 서버 오류는 `role="alert"`에 상태 코드별 고정 문구로 표시되고 서버 `message`는 노출되지 않는다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-21: 저장 요청 중에는 입력과 저장 버튼이 비활성화된다 — 검증: Playwright E2E(응답 지연 유발 방식은 테스트 설계 단계에서 확정) [제안 후 승인]
- EC-25: `reviews.list` 조회가 실패하면 `role="alert"` 오류와 재시도 버튼이 표시되고 `미작성` 배지로 표시되지 않는다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [사용자 결정]
- EC-26: 작성 폼의 `documents.list` 조회가 실패하면 `role="alert"` 오류와 재시도 버튼이 표시되고 자료 없음 빈 안내로 표시되지 않는다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [사용자 결정]
- EC-27: 존재하지 않는 기준 id(`/criteria/:id`)나 Plugin 경로 2종(`/`, `/criteria/:id`) 밖의 경로를 열면 "찾을 수 없음" 안내와 기준 목록(`/`)으로 가는 버튼이 표시된다 — 검증: Playwright E2E [사용자 결정]
- EC-28: 기업 담당자가 `/criteria/:id`로 직접 들어와도 모달 없이 사용 불가 안내와 읽기 전용 기준 목록이 표시되고 `reviews.list`·`reviews.create`·`documents.*` 요청이 한 건도 나가지 않는다 — 검증: Playwright E2E(`page.on("request")`로 요청 수 확인) [사용자 결정]

### 5.6 검증 순서
- EC-22: 입력 형식 오류와 존재하지 않는 기준이 함께 성립하면 400 `invalid_input`이 반환된다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- EC-23: 존재하지 않는 기준과 잘못된 근거가 함께 성립하면 404 `not_found`가 반환된다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- EC-24: 잘못된 근거와 이미 저장된 기준이 함께 성립하면 400 `invalid_input`이 반환되고 기존 검토와 근거는 바뀌지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 기존 행 직접 조회) [사용자 결정]

## 미결정 사항
없음
