# 계획: 검토 수정 (Review Plugin)

- 상태: 승인
- 스펙: docs/specs/review-update.md
- 기준 코드: 작업 트리 (adf785a 기반)
- 최종 갱신: 2026-10-03

## 1. 구현 전략

- 서버는 새 핸들러나 모듈을 만들지 않고 `plugins/review/server/mod.rs`의 `dispatch` match에 `reviews.update` 분기를 더한다. 분기 안의 판정 순서는 기존 `reviews.create` 분기와 같게 두고(역할 검사가 params 역직렬화보다 앞), 마지막에 저장된 검토 없음 404를 둔다. 근거: `plugins/review/server/mod.rs`, `CLAUDE.md`.
- 저장은 `models.rs`에 `update_review`를 추가한다. 한 트랜잭션에서 첫 문장을 `reviews` UPDATE(`RETURNING`, 결과 없음이면 `ApiError::not_found`)로 두어 행 잠금으로 동시 수정을 직렬화하고, 이어서 해당 검토의 `review_evidence`를 지우고 다시 넣는다. 갱신 시각은 문장 실행 시점의 DB 시각으로 쓴다(스펙 §4). 근거 검증(`count_ready_documents`)은 `create`와 같이 트랜잭션 밖 pool 호출을 유지한다. 근거: `plugins/review/server/models.rs`의 `create_review`, 스펙 §4.
- DTO는 `types.rs`에 `UpdateReviewRequest`(`CreateReviewRequest`와 같은 어트리뷰트, `deny_unknown_fields`)와 `UpdateReviewResponse`를 추가한다. `#[path]`로 포함된 모듈이라 `export_bindings_` 테스트가 자동으로 TS 타입을 내보낸다. 마이그레이션과 새 의존성은 없다. 근거: `plugins/review/server/types.rs`, `scripts/export-ts.sh`, `api/migrations/0005_reviews.sql`.
- UI는 `CriterionModal`이 가르던 상세/작성 분기를 없애고 `ReviewForm` 하나를 작성·수정 겸용으로 쓴다. 초기값은 `useState` 초기값으로 한 번만 채워 모달 `key` 단위 마운트와 함께 재조회가 편집값을 덮지 않게 한다. 저장 성공 시 기존 `useCreateReview`처럼 invalidate 완료까지 pending을 유지한 뒤 `host.navigate("/")`로 닫는다. 근거: `plugins/review/ui/criterion-page.tsx`, `plugins/review/ui/hooks.ts`.
- 근거 검색은 서버 계약 없이 `EvidencePicker`에서 `documents.list` 결과를 제목으로 거르는 클라이언트 필터다. 선택 상태는 폼이 소유하므로 필터와 독립이다. 버튼 접근 이름(기준 제목 포함), 시각 표시(`Intl` 포맷), 상태 코드별 고정 오류 문구는 기존 규칙을 따른다. 근거: `plugins/review/ui/evidence-picker.tsx`, `plugins/review/ui/criteria-list.tsx`, `plugins/review/ui/text.ts`.
- 계약 생성은 서버 로직(T-1)이 컴파일되는 상태에서 `make gen-ts-docker`로 한다. `api-client/`는 직접 수정하지 않는다. 근거: `CLAUDE.md`, `scripts/gen-ts.sh`.
- Rust 테스트는 `api/tests/review_update.rs`를 새로 두고 `review_common`의 헬퍼를 재사용한다. 기존 `review_write.rs`는 create·list 동작이 바뀌지 않아 수정하지 않는다. 근거: `api/tests/review_common/mod.rs`.
- E2E는 두 스펙의 `DoD-N`·`EC-N` 번호가 겹치므로 파일을 스펙마다 나눈다. 수정 case는 새 파일 `tests/review-write.update.spec.ts`에 두고, 기존 `tests/review-write.spec.ts`는 갱신된 `review-write.md`에 맞게 별도 Task로 고친다. Playwright는 파일을 이름순으로 실행하므로(`--list`로 확인) 새 파일이 기존 파일 뒤에 실행되어 최초 저장 case를 깨뜨리지 않는다. 새 파일은 저장된 슬롯이 없으면 `beforeAll`에서 API로 `reviews.create`를 호출하고 409는 무시한다. 근거: `playwright.config.ts`, `tests/review-write.spec.ts`.
- 기존 스펙 `docs/specs/review-write.md`는 이 계획에 앞서 갱신했다(수정 범위 이관, 저장 후 모달 닫힘, 읽기 전용 상세 제거). 기존 E2E 골격의 재동결은 계획 `docs/plans/review-write.md`의 테스트 설계 증거에서 다룬다.

## 2. Task

### T-1 — `reviews.update` 서버

- 사이드: 백엔드
- 상태: 완료
- 목적: `reviews.update` 요청·응답 DTO, 분기, 저장 쿼리를 구현한다.
- 선행: 없음
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-4, DoD-5, DoD-6, DoD-7, DoD-8, DoD-9, EC-1, EC-2, EC-3, EC-4, EC-5, EC-7, EC-8
- 수정 대상: `plugins/review/server/types.rs` — 요청·응답 DTO 추가. `plugins/review/server/mod.rs` — `reviews.update` 분기. `plugins/review/server/models.rs` — `update_review`
- 따라야 할 패턴: `reviews.create` 분기의 판정 순서와 오류 변환, 바인딩 쿼리, `ReviewRow` 변환 재사용 — 근거: `plugins/review/server/mod.rs`, `plugins/review/server/models.rs`
- 완료 조건: 연결 항목 충족. 역할 검사가 params 역직렬화보다 앞이고 검토 없음 404가 근거 400보다 뒤다. 검토 갱신과 근거 교체가 한 트랜잭션이며 DB 오류를 성공이나 메모리 저장으로 바꾸지 않는다. `reviews.create`의 409와 `health`·`criteria.list`·`reviews.list` 동작은 그대로다 — 검증: T-3의 통합 테스트
- 실행 명령: `docker compose run --rm --no-deps api sh -c 'rustup component add rustfmt && cargo fmt --manifest-path api/Cargo.toml -- --check && cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features'`
- 수정 금지: `api/migrations/`, `api/src/error.rs`, `api/src/types.rs`, `api/tests/`, `api-client/`

### T-2 — api-client 타입 재생성

- 사이드: 백엔드
- 상태: 완료
- 목적: 새 DTO의 TS 타입을 생성해 프론트가 쓰게 한다.
- 선행: T-1
- 연결 항목: DoD-17
- 수정 대상: `api-client/src/types/**` — 생성물(직접 수정 금지)
- 따라야 할 패턴: 생성은 `make gen-ts-docker`로만 한다 — 근거: `CLAUDE.md`
- 완료 조건: 새 요청·응답 타입이 `api-client/`에 생성되고 생성물 일치 검사가 통과한다. `make check-docker` 전체 통과 판정은 검증 단계에서 직접 실행한다 — 검증: `make check-gen-ts-docker`
- 실행 명령: `make gen-ts-docker`, `make check-gen-ts-docker`
- 수정 금지: `api-client/` 직접 편집, `api/src/`, `plugins/`, `scripts/`

### T-3 — 검토 수정 Rust 통합 테스트

- 사이드: 테스트
- 상태: 완료
- 목적: 실제 PostgreSQL로 수정 RPC의 값·근거·시각·권한·검증 순서·롤백·동시성을 검증한다.
- 선행: T-1
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-4, DoD-5, DoD-6, DoD-7, DoD-8, DoD-9, EC-1, EC-2, EC-3, EC-4, EC-5, EC-7, EC-8
- 수정 대상: `api/tests/review_update.rs`(신규) — 통합 테스트. `api/tests/review_common/mod.rs` — 필요한 헬퍼만 추가(기존 함수는 수정하지 않는다)
- 따라야 할 패턴: `#[sqlx::test]`, 한글 `mod` 구조, `@spec`·`@given/@when/@then` 주석, `plugins::dispatch` 직접 호출 — 근거: `api/tests/review_write.rs`, `api/tests/review_common/mod.rs`
- 완료 조건: 연결 항목 각각을 단언하는 테스트가 있다. 시각 비교(DoD-3)는 응답 문자열이 아니라 DB의 `updated_at` 값으로 하고, 근거 교체(DoD-4)와 불변 확인(EC-1~EC-5)은 DB 행을 직접 조회한다. 동시 수정(EC-8)은 서로 다른 근거 집합으로 실제 동시에 호출하고 경합이 재현되도록 반복한다 — 검증: `make test-api`
- 실행 명령: `make test-api`
- 수정 금지: 제품 코드, `api/migrations/`, `api/tests/common/mod.rs`, `api/tests/review_write.rs`, 기존 `api/tests/dataroom_*.rs`
- 테스트 파일·runner: `api/tests/review_update.rs`, `cargo test` (`#[sqlx::test]`)
- mock 허용 경계: 없음(실제 PostgreSQL 사용)
- 데이터 격리: `#[sqlx::test]`가 테스트마다 임시 DB를 만들고 시드를 포함한 마이그레이션을 적용한다. 기존 검토는 각 테스트가 `reviews.create`로 직접 만들고, 다른 투자자는 시드 `investor-peer`를 쓴다. EC-7은 기존 검토를 만든 뒤 임시 DB의 `review_evidence`에 항상 실패하는 제약을 주입해 근거 INSERT만 실패시키며, 새 근거는 1개 이상이다(사용자 확정). EC-6(미인증 401)은 `dispatch` 직접 호출로 볼 수 없어 T-5의 E2E가 맡는다

### T-4 — Plugin 수정 모달·카드·검색

- 사이드: 프론트
- 상태: 완료
- 목적: 카드 버튼과 수정 시각, 값이 채워진 수정 모달, 저장 후 닫기, 근거 검색을 구현하고 읽기 전용 상세를 제거한다.
- 선행: T-2
- 연결 항목: DoD-10, DoD-11, DoD-12, DoD-13, DoD-14, DoD-15, DoD-16, DoD-17, EC-9, EC-10, EC-11, EC-12, EC-13, EC-15, EC-16, EC-17, EC-18, EC-19, EC-20, EC-21
- 수정 대상: `plugins/review/ui/hooks.ts` — 수정 mutation 추가. `plugins/review/ui/criterion-page.tsx` — 상세 제거, 폼의 작성·수정 겸용화, 저장 후 닫기. `plugins/review/ui/criteria-list.tsx` — 버튼 문구와 수정 시각. `plugins/review/ui/evidence-picker.tsx` — 제목 검색. `plugins/review/ui/text.ts` — ko/en 문구
- 따라야 할 패턴: `host.call` 제네릭 호출, `scopedKey` 쿼리 키와 invalidate, 로딩 `role="status"`·오류 `role="alert"`, 상태 코드별 고정 문구, 저장 중 `disabled`와 입력 보존 — 근거: `plugins/review/ui/hooks.ts`, `plugins/review/ui/criterion-page.tsx`
- 완료 조건: 연결 항목 충족. 서버 `message`를 렌더하지 않고 조회 실패를 미작성이나 자료 없음으로 표시하지 않는다. 기업 사용자 경로는 `criteria.list` 외의 훅을 호출하지 않는 기존 구조를 유지한다. 새 의존성을 추가하지 않고 번들이 자기완결이다. 모달은 접근 가능한 이름과 포커스 이동·복귀를 지원한다 — 검증: T-5의 E2E, `pnpm build:plugins`
- 실행 명령: `pnpm lint`, `pnpm typecheck`, `pnpm build:plugins`
- 수정 금지: `api-client/`, `web/`, `plugin-sdk/`, `tests/`, `plugins/review/server/`, `plugins/review/manifest.json`

### T-5 — 검토 수정 E2E

- 사이드: E2E
- 상태: 완료
- 목적: 수정 화면 동작을 desktop·mobile에서 검증한다.
- 선행: T-4
- 연결 항목: DoD-10, DoD-11, DoD-12, DoD-14, DoD-15, DoD-16, EC-6, EC-9, EC-10, EC-11, EC-12, EC-13, EC-15, EC-16, EC-17, EC-18, EC-19, EC-20, EC-21
- 수정 대상: `tests/review-write.update.spec.ts`(신규) — 수정·검색 case
- 따라야 할 패턴: role·label·보이는 문구로 요소를 찾고 sleep 대신 자동 대기를 쓴다 — 근거: `.claude/agents/e2e-dev.md`. 로그인은 `login(page, email, password)`, 요청 수는 `page.on("request")`, 오류·지연 유발은 method별 `page.route` — 근거: `tests/helpers/auth.ts`, `tests/review-write.spec.ts`
- 완료 조건: 연결 항목 각각을 단언하는 시나리오가 desktop·mobile 두 프로젝트에서 통과한다. 저장된 슬롯이 없으면 `beforeAll`에서 API로 만들고 409는 무시한다. 수정 시각 비교(DoD-12)는 화면 문구가 아니라 `time` 요소의 `dateTime` 속성 값으로 한다 — 검증: `make test-e2e`
- 실행 명령: `pnpm typecheck`, `docker compose --profile test run --rm --no-deps playwright pnpm test:e2e tests/review-write.update.spec.ts`
- 수정 금지: 제품 코드, `playwright.config.ts`, `tests/helpers/auth.ts`, `tests/review-write.spec.ts`, `tests/documents.spec.ts`, `tests/document-register.spec.ts`
- 테스트 파일·runner: `tests/review-write.update.spec.ts`, Playwright
- mock 허용 경계: (사용자 확정) 정상 서버로 만들 수 없는 수정 저장 실패(EC-9), 응답 지연(EC-10, EC-18), 편집 중 재조회(EC-11), 목록 조회 실패와 로딩(EC-13)은 `page.route`로 응답을 흉내 낸다. EC-16의 대소문자 표본은 시드 ready 자료 제목이 한글뿐이라 `documents.list` 응답만 흉내 낸다. EC-6(미인증 401)은 쿠키 없는 `request`로 실제 서버를 호출하며 mock이 없다. 나머지는 실제 API·DB를 쓴다. mock으로 통과한 case는 실제 서버가 그 응답을 내는지를 증명하지 않는다. 유발 방식은 EC-9는 `reviews.update` 응답을 상태 코드 표본(400, 403, 404, 500)과 네트워크 중단으로 대체, EC-10·EC-18은 응답을 수동으로 지연, EC-13은 `reviews.list`를 지연하거나 500으로 대체, EC-11은 창 포커스 이벤트로 재조회를 일으키고 그 응답만 다른 값으로 바꾸되 `staleTime`(15초) 때문에 `page.clock`으로 시간을 앞당기는 방식이다(재조회가 실제로 일어나는지는 구현 단계에서 확인하고 어려우면 다시 상의한다)
- 데이터 격리: 검토는 삭제할 수 없고 초기화는 `make reset-db`뿐이다. 수정은 반복 실행해도 409가 없다. 저장 슬롯은 기존 파일과 같은 desktop `business`, mobile `team`을 이어 쓰며 `revenue`와 `investor-peer`는 기존 파일의 용도(미저장 폼, 모두 미작성 확인)를 해치지 않도록 이 파일이 저장하지 않는다. 이 파일은 이름순으로 기존 파일 뒤에 실행된다.
- 실행 환경: `make test-e2e`(접속 `http://web:5178`) 또는 호스트 `http://127.0.0.1:5178`. 계정 `investor@lighthouse.test`, 비밀번호 `dataroom`. 사전 데이터는 마이그레이션 시드다

### T-6 — 기존 검토 E2E 갱신

- 사이드: E2E
- 상태: 완료
- 목적: 갱신된 `review-write.md`와 새 화면 동작에 맞게 기존 E2E 본문을 고친다.
- 선행: T-4
- 연결 항목: DoD-11, DoD-13, DoD-14
- 수정 대상: `tests/review-write.spec.ts` — 저장 후 닫힘, 버튼 문구(`검토 작성`·`검토 수정`), 읽기 전용 상세 제거에 맞춰 locator와 단언 갱신
- 따라야 할 패턴: 기존 파일의 헬퍼와 describe 구조 유지, 골자(`@spec`·`@given`·`@when`·`@then`)는 동결된 값을 바꾸지 않는다 — 근거: `tests/review-write.spec.ts`, `docs/plans/review-write.md`의 테스트 설계 증거
- 완료 조건: 기존 스펙의 모든 case가 새 화면 동작에서 desktop·mobile 두 프로젝트로 통과한다. `[DoD-10][DoD-11][DoD-24]` case의 본문은 저장 후 모달이 닫힌 뒤 카드에 저장한 의견과 근거 표시까지 확인한다(새 스펙 DoD-13은 이 case가 맡는다). 새 수정 case는 이 파일에 넣지 않는다 — 검증: `make test-e2e`
- 실행 명령: `pnpm typecheck`, `docker compose --profile test run --rm --no-deps playwright pnpm test:e2e tests/review-write.spec.ts`
- 수정 금지: 제품 코드, `playwright.config.ts`, `tests/helpers/auth.ts`, `tests/review-write.update.spec.ts`, `tests/documents.spec.ts`, `tests/document-register.spec.ts`
- 테스트 파일·runner: `tests/review-write.spec.ts`, Playwright
- mock 허용 경계: 기존 파일의 확정된 경계를 그대로 따른다(`docs/plans/review-write.md`의 테스트 설계 증거)
- 데이터 격리: 기존 파일의 확정된 슬롯과 `make reset-db` 한계를 그대로 따른다
- 실행 환경: `make test-e2e`. 계정과 사전 데이터는 기존 파일과 같다

## 3. 항목 coverage

- DoD-1: T-1, T-3
- DoD-2: T-1, T-3
- DoD-3: T-1, T-3
- DoD-4: T-1, T-3
- DoD-5: T-1, T-3
- DoD-6: T-1, T-3
- DoD-7: T-1, T-3
- DoD-8: T-1, T-3
- DoD-9: T-1, T-3
- DoD-10: T-4, T-5
- DoD-11: T-4, T-5, T-6
- DoD-12: T-4, T-5
- DoD-13: T-4, T-6
- DoD-14: T-4, T-5, T-6
- DoD-15: T-4, T-5
- DoD-16: T-4, T-5
- DoD-17: T-2, T-4
- EC-1: T-1, T-3
- EC-2: T-1, T-3
- EC-3: T-1, T-3
- EC-4: T-1, T-3
- EC-5: T-1, T-3
- EC-6: T-5
- EC-7: T-1, T-3
- EC-8: T-1, T-3
- EC-9: T-4, T-5
- EC-10: T-4, T-5
- EC-11: T-4, T-5
- EC-12: T-4, T-5
- EC-13: T-4, T-5
- EC-14: 제외 — 기업 담당자 화면은 이번에 바뀌지 않으며 기존 review-write.md의 DoD-14·DoD-23·EC-28이 같은 화면을 검증한다
- EC-15: T-4, T-5
- EC-16: T-4, T-5
- EC-17: T-4, T-5
- EC-18: T-4, T-5
- EC-19: T-4, T-5
- EC-20: T-4, T-5
- EC-21: T-4, T-5

## 4. 실행 순서

- 1구간: T-1 단독. DTO와 서버 분기가 이후 Task의 선행이다.
- 2구간(병렬): T-2, T-3. 둘 다 T-1 뒤이며 수정 파일이 겹치지 않는다(`api-client/src/types/**` 대 `api/tests/`).
- 3구간: T-4. 생성된 타입(T-2)이 있어야 한다. T-3과는 파일이 겹치지 않아 병렬로 진행할 수 있다.
- 4구간(병렬): T-5, T-6. 둘 다 화면(T-4)이 있어야 본문을 채울 수 있고 수정 파일이 겹치지 않는다(`tests/review-write.update.spec.ts` 대 `tests/review-write.spec.ts`). 실행은 두 파일 모두 이름순으로 기존 파일이 먼저다.
- 테스트 Task(T-3, T-5, T-6)는 구현 단계에서 동결된 골격의 본문만 채우고 실행하지 않는다. 실행·판정은 검증 단계에서 한다.
- 검증 단계에서 `make check-docker`, `make test-api`, `make test-e2e`를 실행한다(DoD-17).

## 5. 차단 사항

- 없음. EC-11의 재조회 유발이 구현 후에도 가능한지는 구현 단계에서 확인한다.
- 기존 E2E 골격 재동결(`docs/plans/review-write.md`의 테스트 설계 증거 갱신)이 이 계획의 테스트 설계보다 먼저 끝나야 T-6이 골자를 바꾸지 않고 본문만 고칠 수 있다.

## 테스트 설계 증거

- 상태: PASS (2026-10-03, reviewer 7라운드 + 사람 확정 1건). 7라운드에서 새 reviewer가 TD-01~08을 판정했고 결함 finding은 없었으며 사람이 확정할 항목 1건(EC-11 재조회 유발 방식)만 남았다. 사용자가 그 방식을 확정했고 헤더 주석만 고쳤다(골자 digest 불변). 1~6라운드는 모두 NEEDS-FIX였고 3라운드를 넘긴 4·5라운드와 5라운드 이후 재검토 생략은 사용자가 승인했다. 6라운드 지적(Low, Rust 최상위 `mod` 구조)은 반영했고 7라운드가 수정본을 재검토해 충족으로 판정했다.
- 기준 스펙: docs/specs/review-update.md (구현중, DoD-1~17·EC-1~21). 2026-10-03 사용자 결정으로 순수 화면 표시 항목 3개(저장된 카드의 `검토 수정` 버튼, `최종 수정` 시각 표시, 미저장 카드의 `검토 작성` 버튼)를 삭제하고 번호를 당겼다. `최종 수정` 시각은 DoD-12(수정 후 시각이 이전보다 이후로 바뀜)에 흡수했다. 번호 매핑(기존 → 새): 13→10, 14→11, 15→12, 16→13, 17→14, 18→15, 19→16, 20→17. 이 변경으로 이전 증거(digest `b41668e0445f871c`)는 폐기했다.
- 골자 digest: `56101447ecaed18a` (case 29개: Rust 14, E2E 15). 제외 3개: DoD-13, DoD-17, EC-14. 폐기한 digest: `b41668e0445f871c`(번호 변경 전), `8242fa5d4a6b23e3`, 그 이전의 `6b251a582bfd0786`, `8fc1918fa6644cba`, `aa239bb0ea0a9a58` 등.
- 골격 파일: `api/tests/review_update.rs`(14개), `tests/review-write.update.spec.ts`(15개). 두 파일 모두 본문이 채워져 있고 `#[ignore]`·`test.fixme` 잔존은 0개다. 동결 대상은 골자(태그)이며 본문은 대상이 아니다.
- 기계 검사: `check-skeleton.py --spec docs/specs/review-update.md --files api/tests/review_update.rs tests/review-write.update.spec.ts --exempt DoD-13,DoD-17,EC-14`. 본문이 채워져 "미구현 표기 없음"·"assertion" 위반이 나오지만 그 외 위반(`@spec` ID 오류, 연결 누락, 태그 누락)은 0건이다. 골자 digest는 `--frozen`으로 읽는다.
- reviewer: 새 `general-purpose` 에이전트, 7라운드. 라운드마다 앞선 지적이 해소되었음을 독립적으로 확인했고 새 Low~Med 지적이 이어졌다. 6라운드는 TD-02에 Low 1건(Rust 최상위 `mod` 구조), 7라운드는 TD-01~08 모두 충족(TD-06은 EC-11 유발 방식 사람 확정 대기 1건)이었고 약화·부풀림·고아 case 지적은 없었다. 관찰로만 남은 것: DoD-3 `@then`의 응답 표기 세부, DoD-16·EC-15 순차 합본, 스펙 §4 판정 순서 중 항목 없는 부분. 모든 라운드에서 reviewer가 파일을 수정하지 않았음을 `git status`로 확인했다.
- 사람 확정:
  - 제외 3건: DoD-13(최초 작성 저장 후 모달 닫힘·카드 반영)은 기존 스펙 `review-write.md`의 DoD-10·11·24를 달고 있는 `tests/review-write.spec.ts`의 case가 맡는다(그 골격은 별도로 재동결·PASS). DoD-17은 명령 항목이라 검증 단계에서 `make check-docker`를 직접 실행한다. EC-14는 기존 DoD-14·DoD-23·EC-28이 같은 기업 화면을 검증한다.
  - DoD 항목 삭제·번호 압축: 사용자 결정(화면 표시만 보는 항목은 사용자 흐름 항목이 간접으로 확인한다). 삭제 후 요구가 남아야 할 곳은 새 DoD-12(`최종 수정` 시각 변화)와 DoD-10·14(`검토 수정` 버튼을 눌러 수정 모달을 여는 흐름)이다.
  - EC-6(미인증 401)은 Rust의 `dispatch` 직접 호출로는 볼 수 없어 E2E의 쿠키 없는 request로 실제 서버를 호출한다(mock 없음).
  - EC-7은 임시 DB의 `review_evidence`에 항상 실패하는 NOT VALID CHECK 제약을 주입해 근거 INSERT만 실패시킨다. 새 근거는 1개 이상이다.
  - EC-2는 거부 case와 허용 case(한글 2000자, trim 후 정확히 2000자)를 분리한다.
  - E2E mock 경계: EC-9(저장 실패), EC-10·EC-18(지연), EC-11(재조회), EC-13(목록 실패·로딩), EC-16의 대소문자 표본(`documents.list`)만 `page.route`로 흉내 내고 나머지는 실제 API·DB를 쓴다. 유발 방식은 EC-9·10·18·13과 EC-11 모두 확정이다. EC-11은 `page.clock`으로 `staleTime`을 넘기고 창 `focus`/`visibilitychange` 이벤트로 재조회를 일으키며 그 응답만 다른 값으로 바꾼다(2026-10-03 사용자 확정, 구현 후 재조회가 실제로 일어나 통과했고 재조회 요청 발생을 단언해 공허 통과를 막는다).
  - E2E 파일 분리: 두 스펙의 번호가 겹치므로 수정 case는 새 파일 `tests/review-write.update.spec.ts`에 두고, 이름순으로 기존 파일 뒤에 실행된다.
  - 5라운드 이후 재검토 생략(사용자 승인). 이후 7라운드를 돌려 PASS로 정리했다.
- 미검증·검증 불가:
  - mock case(EC-9, EC-10, EC-18, EC-11, EC-13, EC-16 대소문자)는 실제 서버가 그 응답을 내는지 증명하지 못한다. 서버 쪽 상태 코드는 Rust 통합 테스트가 실제 DB로 보완한다.
  - 스펙 §4의 존재하지 않는 기준 404, 근거 400이 검토 없음 404보다 먼저라는 판정 순서, 네 필드 필수는 대응하는 DoD·EC 항목이 없어 case가 없다. `updatedAt`이 문장 실행 시점이라는 요구는 단일 문장 갱신에서 DoD-3으로 구분되지 않는다.
  - 검색의 "일치"가 부분 문자열인지 전체 일치인지는 스펙에 없다. 부분 문자열(포함) 일치로 구현했고 골자의 "일부 자료 제목" 표본과 같은 의미다.
  - E2E의 수정 시각 비교는 응답 시각이 초 단위여서 같은 초에 저장하면 올바른 구현도 실패할 수 있어 본문에서 1초 이상 간격을 보장한다.
  - Rust 통합 테스트는 `dispatch`를 직접 호출하므로 HTTP 라우팅과 `CurrentUser` extractor는 보지 않는다.
  - 모달 포커스 이동·복귀는 자동 테스트로 직접 단언하지 못했다.
- 구현 단계에서 확인된 사항:
  - 기존 E2E 골격 재동결(`docs/plans/review-write.md`의 테스트 설계 증거)이 먼저 끝났고 T-6은 골자를 바꾸지 않고 본문만 고쳤다. 기존 `[DoD-10][DoD-11][DoD-24]` case의 본문은 카드에 저장한 의견과 근거 표시까지 확인한다.
  - 첫 전체 E2E 실행에서 본문의 데이터 가정 결함 2건(자료 개수 하드코딩, mock case의 모달 준비 대기 조건)이 드러나 본문만 고쳤다. 골자는 바뀌지 않았다.
