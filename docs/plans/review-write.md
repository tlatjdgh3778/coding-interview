# 계획: 검토 작성·조회 (Review Plugin)

- 상태: 승인
- 스펙: docs/specs/review-write.md
- 기준 코드: 작업 트리 (84f33d3 기반)
- 최종 갱신: 2026-10-03

## 1. 구현 전략

- 서버는 새 REST 핸들러를 만들지 않고 `api/src/plugins/mod.rs`의 `plugin_id` 분기가 넘기는 `plugins/review/server/mod.rs`의 `dispatch`에 method 분기를 더한다. 첫 줄의 workspace 불일치 403을 유지하고, 역할 검사(`matches!`, `UserRole`에 `PartialEq`가 없다)는 params 역직렬화보다 앞에 둔다. 근거: `plugins/review/server/mod.rs`, `api/src/dataroom/mod.rs`, `api/src/handlers/plugin_rpc.rs`.
- DTO는 `ReviewHealthResponse`와 같은 어트리뷰트(`camelCase`, 요청은 `deny_unknown_fields`, `ts-bridge`)로 `plugins/review/server/types.rs`에 둔다. `#[path]`로 포함된 모듈이라 `export_bindings_` 테스트가 자동으로 타입을 내보낸다. 근거: `plugins/review/server/types.rs`, `scripts/export-ts.sh`, `api/src/plugins/mod.rs`.
- 저장은 `sqlx::query_as` 런타임 쿼리와 바인딩으로 하고 `query!` 매크로는 쓰지 않는다. 시각은 기존처럼 SQL `to_char`로 문자열을 만든다. 검토와 근거 INSERT는 `pool.begin()` 한 트랜잭션이며 오류는 drop 롤백에 맡기고 메모리 저장소로 대체하지 않는다. 근거: `api/src/dataroom/models.rs`, `CLAUDE.md`.
- 재저장 409는 사전 SELECT가 아니라 `UNIQUE` 제약에 대한 `ON CONFLICT ON CONSTRAINT ... DO NOTHING RETURNING` + `fetch_optional().ok_or_else(ApiError::conflict)`로 판정해 동시 요청에서도 1건만 성공하게 한다. 근거: 자료 등록의 `create_document`(`api/src/dataroom/models.rs`).
- 근거 검증은 빈 배열·중복을 먼저 거른 뒤 `workspace_id`·`status='ready'`·`id = ANY($n)` 일치 개수를 입력 개수와 비교하는 쿼리로 처리해, 없는 자료·다른 workspace 자료·`processing`·`failed`가 같은 400이 되게 한다. 스펙의 검증 순서(§4)를 따른다. 근거: `api/src/dataroom/models.rs`의 바인딩 쿼리 패턴.
- `criteria.list`·`reviews.list`의 `params`는 기존 `documents.list`처럼 null과 `{}`를 허용하는 방식을 따른다(스펙에 명시가 없어 구현 확인 항목). 검토 id는 `new_document_id`와 같은 방식으로 만들며 형식은 스펙이 정하지 않는다. 새 의존성은 추가하지 않는다(`Cargo.lock`이 `:ro`이고 `--locked`). 근거: `api/src/dataroom/mod.rs`, `api/Cargo.toml`.
- `api/migrations/0005_*.sql`은 새 파일로만 추가하고 `0001`~`0004`는 수정하지 않는다. 컬럼 구성(workspace 컬럼, FK, `ON DELETE`)은 스펙이 정한 제약 밖에서 기존 마이그레이션 관례를 따른다. 근거: `api/migrations/0003_documents.sql`, `CLAUDE.md`.
- 의존 순서는 "백엔드 계약 → `make gen-ts-docker` → 프론트"를 따른다. 생성은 크레이트가 컴파일되는 상태에서 해야 하므로 서버 로직(T-2) 뒤에 둔다. 근거: `CLAUDE.md`, `scripts/gen-ts.sh`.
- Plugin 화면은 `plugins/review/ui/` 안에서 `context.location`을 직접 파싱해 2개 경로(`/`, `/criteria/:id`)를 분기하고 `/criteria/:id`는 목록 위 모달로 표시한다. `react-router`와 본체 `web/` 모듈은 가져오지 않고, 이동은 `host.navigate`(Plugin 내부 경로)만 쓴다. 쿼리 키는 `scopedKey`로 만들고 저장 성공 시 검토 목록 접두어를 무효화한다(`staleTime` 15초). 근거: `plugin-sdk/index.ts`, `plugin-sdk/react.tsx`, `web/src/plugins/navigation.ts`, `eslint.config.mjs`.
- 문구는 기존 Plugin처럼 `context.locale`로 ko/en 인라인 객체를 쓴다. ui-kit은 `@biyard/components`로 가져오며 Plugin에서 쓴 선례가 없어 `pnpm build:plugins`로 자기완결 검사를 처음 확인한다. 타입은 `@interview/api-types/*`를 `import type`으로만 가져온다. 근거: `plugins/review/ui/app.tsx`, `scripts/build-plugins.mjs`, `plugins/review/ui/styles.css`.
- 기업 사용자 분기는 `App` 최상단에서 `role`로 가르고, 기업 경로에서는 사용 불가 안내와 `criteria.list`로 조회한 읽기 전용 기준 목록 컴포넌트만 마운트한다. `reviews.list`·`reviews.create`·`documents.*` 조회·저장 훅은 투자자 전용 컴포넌트 안에서만 호출해 기업 경로에서 요청이 생기지 않게 한다. 근거: `plugin-sdk/index.ts`의 `PluginContext`, `CLAUDE.md`.
- 근거 선택 목록과 근거 미리보기 모달은 `host.call("documents.list" | "documents.get", ..., { target: "dataroom" })`로 조회한다. 근거: `web/src/plugins/host-call.ts`, `api/src/dataroom/mod.rs`.
- 작성 폼·근거 미리보기 모달은 네이티브 dialog 요소와 `showModal()`로 만든다(`@biyard/components`에 dialog가 없고 자료 등록 화면도 같은 방식이다). 근거 미리보기는 경로 없이 로컬 상태의 중첩 모달이라 아래 모달의 입력 상태를 유지한다. 근거: `web/src/dataroom/document-register.tsx`.
- Rust 통합 테스트는 `#[sqlx::test]`로 `dataroom_api::plugins::dispatch`를 `pluginId: "review"`로 직접 호출해 라우팅까지 통과시킨다. 기존 `api/tests/common/mod.rs`는 수정하지 않고 새 헬퍼 모듈을 둔다. 근거: `api/tests/common/mod.rs`, `api/src/lib.rs`, `api/src/plugins/mod.rs`.
- E2E는 `tests/`의 Playwright(desktop, mobile)로 실제 서버·DB를 쓰고 `login(page, email)` 헬퍼를 재사용한다. `peer` 이메일은 새 spec 안의 로컬 상수로 두어 `tests/helpers/auth.ts`를 수정하지 않는다. 근거: `tests/helpers/auth.ts`, `playwright.config.ts`.

## 2. Task

### T-1 — 마이그레이션 0005·DTO

- 사이드: 백엔드
- 상태: 완료
- 목적: 검토·근거 테이블과 제약, 요청·응답 DTO를 추가한다.
- 선행: 없음
- 연결 항목: DoD-3, DoD-4, EC-10, EC-11, EC-12
- 수정 대상: `api/migrations/0005_reviews.sql`(신규) — `reviews`·`review_evidence` 테이블과 제약. `plugins/review/server/types.rs` — 기준·검토 DTO와 요청·응답 타입
- 따라야 할 패턴: 순번 SQL 마이그레이션 — 근거: `api/migrations/0003_documents.sql`, `api/migrations/0004_document_register.sql`. DTO 어트리뷰트 — 근거: `plugins/review/server/types.rs`의 `ReviewHealthResponse`, `api/src/dataroom/types.rs`
- 완료 조건: 연결 항목이 요구하는 제약이 마이그레이션만으로 존재한다. 기존 마이그레이션과 기존 테스트의 INSERT가 수정 없이 동작한다. 요청 DTO는 알 수 없는 필드를 거부한다 — 검증: T-4의 통합 테스트
- 실행 명령: `make reset-db && make db` 후 `docker compose run --rm --no-deps api sh -c 'cargo fmt --manifest-path api/Cargo.toml -- --check && cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features'`
- 수정 금지: 기존 `0001`~`0004` 마이그레이션, `api/src/types.rs`, `api/src/error.rs`

### T-2 — 검토 서버 로직

- 사이드: 백엔드
- 상태: 완료
- 목적: `dispatch`에 `criteria.list`·`reviews.list`·`reviews.create` 분기와 저장·조회 쿼리를 구현한다.
- 선행: T-1
- 연결 항목: DoD-1, DoD-3, DoD-4, DoD-5, DoD-6, DoD-7, DoD-8, DoD-9, DoD-18, DoD-19, DoD-20, EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-7, EC-8, EC-9, EC-10, EC-11, EC-12, EC-13, EC-22, EC-23, EC-24, EC-29
- 수정 대상: `plugins/review/server/mod.rs` — method 분기, 권한·검증 순서. `plugins/review/server/models.rs` — 조회·저장 함수
- 따라야 할 패턴: workspace 검사 뒤 method match, 역직렬화 실패는 `ApiError::invalid`, 길이는 문자 수 — 근거: `api/src/dataroom/mod.rs`. 쿼리는 바인딩, DB 오류는 `ApiError::storage` — 근거: `api/src/dataroom/models.rs`
- 완료 조건: 연결 항목 충족. 기업 사용자 차단이 입력 검증보다 앞서고 검증 순서가 스펙 §4와 같다. 작성자와 workspace는 세션 값만 쓴다. 검토와 근거는 한 트랜잭션이며 DB 실패를 성공·빈 결과·메모리 저장으로 바꾸지 않는다. 기존 `health` 동작은 그대로다 — 검증: T-4의 통합 테스트
- 실행 명령: `docker compose run --rm --no-deps api sh -c 'cargo fmt --manifest-path api/Cargo.toml -- --check && cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features'`
- 수정 금지: `api/src/error.rs`, `api/src/types.rs`, `api/migrations/`, `api/tests/`, `plugins/review/server/types.rs`

### T-3 — api-client 타입 재생성

- 사이드: 백엔드
- 상태: 완료
- 목적: 검토 DTO의 TS 타입을 `make gen-ts-docker`로 생성해 프론트가 쓰게 한다.
- 선행: T-2
- 연결 항목: DoD-17
- 수정 대상: `api-client/src/types/**` — 생성물(직접 수정 금지)
- 따라야 할 패턴: 생성은 `make gen-ts-docker`로만 한다 — 근거: `CLAUDE.md`
- 완료 조건: 생성된 검토 타입이 `api-client/`에 있고 생성물 일치 검사가 통과한다 — 검증: `make check-gen-ts-docker`
- 실행 명령: `make gen-ts-docker`, `make check-gen-ts-docker`
- 수정 금지: `api-client/` 직접 편집, `api/src/`, `plugins/`

### T-4 — 검토 Rust 통합 테스트

- 사이드: 테스트
- 상태: 완료
- 목적: 실제 PostgreSQL로 검토 RPC의 권한·검증 순서·근거·중복·동시성·롤백·정렬을 검증한다.
- 선행: T-1
- 연결 항목: DoD-1, DoD-3, DoD-4, DoD-5, DoD-6, DoD-7, DoD-8, DoD-9, DoD-18, DoD-19, DoD-20, EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-7, EC-8, EC-9, EC-10, EC-11, EC-12, EC-13, EC-22, EC-23, EC-24, EC-29
- 수정 대상: `api/tests/review_common/mod.rs`(신규) — 검토 호출·행 수 헬퍼. `api/tests/review_write.rs`(신규) — 통합 테스트
- 따라야 할 패턴: `#[sqlx::test]`, 한글 `mod` 구조와 `@spec`·`@given/@when/@then` 주석 — 근거: `api/tests/dataroom_document_register.rs`. 사용자·호출 헬퍼 재사용 — 근거: `api/tests/common/mod.rs`. 컴파일 타임 DB 매크로를 쓰지 않는다
- 완료 조건: 연결 항목 각각을 단언하는 테스트가 있다. 동시 요청은 실제로 동시에 호출하고 경합이 재현되도록 반복한다. DoD-4·DoD-18·EC-10·EC-24는 응답이 아닌 DB 행으로 확인한다 — 검증: `make test-api`
- 실행 명령: `make test-api`
- 수정 금지: 제품 코드(`api/src/`, `plugins/`), `api/migrations/`, `api/tests/common/mod.rs`, 기존 `api/tests/dataroom_*.rs`
- 테스트 파일·runner: `api/tests/review_write.rs`, `cargo test` (`#[sqlx::test]`)
- mock 허용 경계: 없음(실제 PostgreSQL 사용)
- 데이터 격리: `#[sqlx::test]`가 테스트마다 임시 DB를 만들고 시드 포함 마이그레이션을 적용한다. 다른 workspace 자료는 테스트 안에서 INSERT하고 `investor-peer`는 시드를 쓴다. EC-13은 임시 DB의 `review_evidence`에 항상 실패하는 제약을 추가해 근거 INSERT만 실패시켜 롤백을 확인한다(제안, 사용자 확인 항목)

### T-5 — Plugin 화면

- 사이드: 프론트
- 상태: 완료
- 목적: 기준 목록과 작성 폼 모달·근거 선택·근거 미리보기 모달, 기업 사용자 안내를 구현한다.
- 선행: T-3
- 연결 항목: DoD-2, DoD-10, DoD-11, DoD-13, DoD-14, DoD-15, DoD-16, DoD-21, DoD-22, DoD-23, DoD-24, EC-14, EC-15, EC-16, EC-17, EC-18, EC-19, EC-20, EC-21, EC-25, EC-26, EC-27, EC-28
- 수정 대상: `plugins/review/ui/app.tsx` — 역할 분기와 경로 분기. `plugins/review/ui/route.ts`, `text.ts`, `hooks.ts`, `common.tsx`, `criteria-list.tsx`, `criterion-page.tsx`, `evidence-picker.tsx` — 기존 화면 모듈을 모달 전환에 맞게 수정. `plugins/review/ui/modal.tsx`(신규) — 공용 모달. `plugins/review/ui/document-view.tsx` — 경로 화면에서 근거 미리보기 모달로 변경
- 따라야 할 패턴: `createReactPlugin`, `host.call`, `scopedKey` 쿼리 키, 로딩 `role="status"`·오류 `role="alert"` — 근거: `plugins/review/ui/app.tsx`, `plugin-sdk/react.tsx`. 입력 보존·고정 문구·`disabled={isPending}`·재시도 — 근거: `web/src/dataroom/document-register.tsx`, `web/src/dataroom/document-list.tsx`(Plugin은 본체 모듈을 가져오지 않고 패턴만 따른다)
- 완료 조건: 연결 항목 충족. 오류는 상태 코드로 분기하고 서버 `message`를 렌더하지 않는다. 조회 실패를 미작성·자료 없음으로 표시하지 않는다. 기업 사용자 경로에서는 `criteria.list` 외의 조회·저장 훅이 호출되지 않는다. 작은 화면·폼 레이블·키보드 접근을 지원하고 새 의존성을 추가하지 않으며 번들이 자기완결이다. 모달은 접근 가능한 이름과 포커스 이동·복귀를 지원하고 X·취소·Esc·바깥 클릭이 같은 닫기 동작(입력 폐기)이다. 근거 미리보기 모달은 아래 모달의 입력 상태를 건드리지 않는다 — 검증: T-6의 E2E, `pnpm build:plugins`
- 실행 명령: `pnpm lint`, `pnpm typecheck`, `pnpm build:plugins`
- 수정 금지: `api-client/`, `web/`, `plugin-sdk/`, `tests/`, `plugins/review/server/`, `plugins/review/manifest.json`

### T-6 — 검토 E2E

- 사이드: E2E
- 상태: 완료
- 목적: desktop·mobile에서 작성·근거 화면·역할별 분기·실패와 빈 상태를 검증한다.
- 선행: T-5
- 연결 항목: DoD-2, DoD-10, DoD-11, DoD-13, DoD-14, DoD-15, DoD-16, DoD-21, DoD-22, DoD-23, DoD-24, EC-14, EC-15, EC-16, EC-17, EC-18, EC-19, EC-20, EC-21, EC-25, EC-26, EC-27, EC-28
- 수정 대상: `tests/review-write.spec.ts`(신규)
- 따라야 할 패턴: role·label·보이는 문구로 요소를 찾고 sleep 대신 자동 대기를 쓴다 — 근거: `.claude/agents/e2e-dev.md`. 로그인은 `login(page, email, password)` 헬퍼, 요청 수는 `page.on("request")`, 오류 유발은 method별 `page.route` — 근거: `tests/helpers/auth.ts`, `tests/document-register.spec.ts`
- 완료 조건: 연결 항목 각각을 단언하는 시나리오가 desktop·mobile 두 프로젝트에서 통과한다. 기존 `tests/documents.spec.ts`·`tests/document-register.spec.ts`가 계속 통과한다 — 검증: `make test-e2e`
- 실행 명령: `pnpm typecheck`, `docker compose --profile test run --rm --no-deps playwright pnpm test:e2e tests/review-write.spec.ts`
- 수정 금지: 제품 코드, `playwright.config.ts`, `tests/helpers/auth.ts`, `tests/documents.spec.ts`, `tests/document-register.spec.ts`
- 테스트 파일·runner: `tests/review-write.spec.ts`, Playwright
- mock 허용 경계: 정상 서버로 만들 수 없는 조회 실패·저장 실패·응답 지연·자료 없음 상태에 한해 `page.route`로 응답을 흉내 낸다(EC-14, EC-15, EC-16, EC-19, EC-20, EC-21, EC-25, EC-26). 사용자 확인 항목. 나머지(DoD-2, DoD-10~16, DoD-21~23, EC-17, EC-18, EC-27, EC-28)는 실제 API·DB를 쓴다
- 데이터 격리: 검토는 삭제할 수 없고 Playwright 컨테이너에는 DB 접속이 없어 초기화는 `make reset-db`뿐이다. 저장하는 (투자자, 기준) 조합은 desktop은 `business`, mobile은 `team`으로 나누고 `revenue`는 저장하지 않아 실패·지연 mock이 폼을 열게 한다. "모두 미작성" 확인(DoD-2, DoD-15)은 아무것도 저장하지 않는 `investor-peer` 계정을 쓴다(제안, 사용자 확인 항목). 자료 등록은 실행마다 고유한 제목을 쓴다
- 실행 환경: `make test-e2e`(접속 `http://web:5178`) 또는 호스트 `http://127.0.0.1:5178`. 계정 `company@lighthouse.test`, `investor@lighthouse.test`, `peer@lighthouse.test`, 비밀번호 `dataroom`. 사전 데이터는 마이그레이션 시드이며 0005는 서버 기동 시 적용된다

## 3. 항목 coverage

- DoD-1: T-2, T-4
- DoD-2: T-5, T-6
- DoD-3: T-1, T-2, T-4
- DoD-4: T-1, T-2, T-4
- DoD-5: T-2, T-4
- DoD-6: T-2, T-4
- DoD-7: T-2, T-4
- DoD-8: T-2, T-4
- DoD-9: T-2, T-4
- DoD-10: T-5, T-6
- DoD-11: T-5, T-6
- DoD-13: T-5, T-6
- DoD-14: T-5, T-6
- DoD-15: T-5, T-6
- DoD-16: T-5, T-6
- DoD-17: T-3 (생성물 일치 부분만 선행 보장하며 세 명령 통과 판정은 검증 단계에서 직접 실행한다)
- DoD-18: T-2, T-4
- DoD-19: T-2, T-4
- DoD-20: T-2, T-4
- DoD-21: T-5, T-6
- DoD-22: T-5, T-6
- DoD-23: T-5, T-6
- DoD-24: T-5, T-6
- EC-1: T-2, T-4
- EC-2: T-2, T-4
- EC-3: T-2, T-4
- EC-4: T-2, T-4
- EC-5: T-2, T-4
- EC-6: T-2, T-4
- EC-7: T-2, T-4
- EC-8: T-2, T-4
- EC-9: T-2, T-4
- EC-10: T-1, T-2, T-4
- EC-11: T-1, T-2, T-4
- EC-12: T-1, T-2, T-4
- EC-13: T-2, T-4
- EC-14: T-5, T-6
- EC-15: T-5, T-6
- EC-16: T-5, T-6
- EC-17: T-5, T-6
- EC-18: T-5, T-6
- EC-19: T-5, T-6
- EC-20: T-5, T-6
- EC-21: T-5, T-6
- EC-22: T-2, T-4
- EC-23: T-2, T-4
- EC-24: T-2, T-4
- EC-25: T-5, T-6
- EC-26: T-5, T-6
- EC-27: T-5, T-6
- EC-28: T-5, T-6
- EC-29: T-2, T-4

## 4. 실행 순서

- 1구간: T-1 단독. 마이그레이션과 DTO가 이후 모든 Task의 선행이다.
- 2구간(병렬): T-2, T-4. 둘 다 T-1 뒤이며 수정 파일이 겹치지 않는다(`plugins/review/server/{mod,models}.rs` vs `api/tests/`).
- 3구간: T-3. 크레이트가 컴파일되는 T-2 뒤에 타입을 생성한다.
- 4구간: T-5. 생성된 타입(T-3)이 있어야 한다.
- 5구간: T-6. 화면(T-5)이 있어야 본문을 채울 수 있다.
- 테스트 Task(T-4, T-6)는 구현 단계에서 동결된 골격의 본문만 채우고 실행하지 않는다. 실행·판정은 검증 단계에서 한다.
- 검증 단계에서 `make check-docker`, `make test-api`, `make test-e2e`를 실행한다(DoD-17).

## 5. 차단 사항

- 없음. EC-13의 저장 실패 유발 방식과 EC-14~16·19~21·25·26의 실패·지연·빈 상태 유발 방식, E2E 데이터 슬롯 배분은 차단이 아니며 테스트 설계 단계에서 사용자가 확정한다.

## 테스트 설계 증거

- 상태: PASS (골격 재동결, 2026-10-03, update 3회). 검토 수정 기능(`docs/specs/review-update.md`)을 별도 스펙으로 분리하면서 이 스펙이 바뀌어 이전 증거(digest `6355f26c3fc6d204`)는 폐기했다.
- 기준 스펙: docs/specs/review-write.md (확정, DoD-1~23·EC-1~29)
- 골자 digest: `f97a803b711c571e` (case 48개: Rust 28, E2E 20). 폐기한 digest: `6355f26c3fc6d204`(수정 기능 분리 전), `57137ab17381c6bb`(기업 화면 변경 전), `5ae18627a59e61af`(모달 전환 전), 그 이전의 `92b8b0e345afbde2`, `2ac15ca1e7f1a348`, `309452727d40f910`.
- 갱신 사유: (1) 2026-10-03 사용자 결정으로 작성 폼·상세·근거 미리보기를 모달로 바꿨다(경로 `/`와 `/criteria/:id` 2종, `/documents/:id` 삭제, DoD-10·12·13·EC-15·27·28 수정, DoD-21·22 신설). (2) 같은 날 사용자 결정으로 기업 담당자 화면이 사용 불가 안내와 `criteria.list`로 조회한 읽기 전용 기준 목록을 보이게 했다(README 권한 표의 기준 조회 권한과 일치, DoD-14·EC-28 수정, DoD-23 신설, §4 한 줄 추가). (3) 2026-10-03 검토 수정 기능을 `review-update.md`로 분리했다: §2 재수정 제외를 이관 문구로 바꾸고, DoD-10을 저장 후 모달 닫힘으로 바꾸고, DoD-12(상세에 수정 진입점 없음)를 삭제하고, DoD-13을 작성 폼 모달에서의 근거 미리보기로 바꾸고, DoD-24(저장 후 카드에 의견·근거 자료 제목 표시)를 신설했다. DoD-24는 새 스펙의 DoD-13 제외를 이 스펙의 case가 실제로 강제하게 하려는 것이다.
- 골격 파일: `api/tests/review_write.rs`(28개, 무변경, 본문 채워짐), `tests/review-write.spec.ts`(20개). E2E 20개 중 `test.fixme` 골격은 2개(`[DoD-10][DoD-11][DoD-24]`, `[DoD-13]`)이고 나머지 18개는 본문이 채워져 있다. 동결 대상은 골자(태그·case 서술)이며 채워진 본문은 변경된 화면에 맞게 구현 단계(T-6)에서 다시 확인한다.
- 기계 검사: `check-skeleton.py --spec docs/specs/review-write.md --files api/tests/review_write.rs tests/review-write.spec.ts --exempt DoD-17`의 비-frozen 실행은 본문이 채워진 case 때문에 "미구현 표기 없음"과 "assertion" 위반을 낸다. 이 두 유형 외의 위반(`@spec` ID 오류, 항목-case 연결 누락, 태그 누락)은 0건이고 DoD-17만 제외다. 골자 digest는 `--frozen`으로 읽는다.
- reviewer: 새 `general-purpose` update 3라운드. 1라운드·2라운드는 골격 finding 없이 계획 문서 문구(삭제된 DoD-12 연결, "상세" 잔존) 지적으로 NEEDS-FIX였고 고쳤다. DoD-24 신설 후 3라운드는 PASS(TD-01~08 충족, finding 0건; 선택 관찰로 계획의 mock 경계 문장의 범위 표기 정리가 있었다). 모든 라운드에서 reviewer가 파일을 수정하지 않았음을 `git status`로 확인했다.
- 사람 확정:
  - 스펙 변경(2026-10-03): 모달 경로는 `/criteria/:id` 유지(새로고침 시 복원, 닫으면 `/`), 근거 미리보기는 경로 없는 로컬 상태 모달, 미리보기 표시 항목은 제목·파일명·상태·작성일·본문만(크기·분류 태그·다운로드 제외), 작성 폼 모달을 저장 없이 닫으면 입력 폐기.
  - mock 경계: E2E에서 `page.route`로 응답을 흉내 내는 case는 EC-14, EC-15(전부), EC-16, EC-19, EC-20, EC-21, EC-25, EC-26이다. EC-15는 실서버 표본이 없어 전부 mock임을 2026-10-03에 사용자가 확정했다. 나머지(DoD-2, DoD-10~16, DoD-21·22, EC-17, EC-18, EC-27, EC-28)는 실제 API·DB를 쓴다. Rust 통합 테스트는 mock이 없다(실제 PostgreSQL).
  - 기업 화면 변경(2026-10-03): 기업 담당자는 `criteria.list`만 호출하고 `reviews.list`·`reviews.create`·`documents.*` 요청은 0건이다. 기업 화면은 사용 불가 안내와 읽기 전용 기준 목록(번호·제목·검토 질문)이며 배지·작성·상세 버튼·모달은 없다. `/criteria/:id` 직접 진입도 모달 없이 같은 화면이다. DoD-23은 실제 API·DB이고 mock 경계는 바뀌지 않았다. 이 변경까지 반영한 뒤 한 번에 커밋한다.
  - DoD-17은 case 없이 제외한다. 검증 단계에서 `make check-docker`, `make test-api`, `make test-e2e`를 직접 실행해 판정한다.
  - EC-13 유발 방식: 임시 DB의 `review_evidence`에 항상 실패하는 CHECK 제약을 추가해 검토 INSERT는 성공하고 근거 INSERT만 실패시킨다. 골격의 `@given`은 결과 언어이며 주입 방식은 헤더 주석에 있다.
  - E2E 데이터 격리: 검토는 삭제할 수 없고 Playwright 컨테이너에는 DB 접속이 없다. 저장 슬롯은 desktop `business`·mobile `team`이고 `revenue`는 저장하지 않으며(실패·지연 mock과 DoD-21·22가 `revenue`의 작성 폼을 쓴다), 모두 미작성 확인(DoD-2, DoD-15)에는 아무것도 저장하지 않는 `investor-peer`를 쓴다. 저장 case는 재실행 전에 `make reset-db`가 필요하며 제출 문서에 한계로 기록한다.
  - 표본 유지: EC-1의 `Satisfied`(대소문자) 표본과 EC-2의 허용 case는 스펙 범위 안이다.
  - 수정 기능 분리(2026-10-03): 저장한 검토의 수정은 `docs/specs/review-update.md`가 다룬다. 새 스펙의 DoD-13(최초 작성 저장 후 모달 닫힘·카드 반영)은 이 스펙의 `[DoD-10][DoD-11][DoD-24]` case가 맡는 것으로 사용자가 확정했다. 이 case의 본문은 카드에 저장한 의견과 근거 자료 제목 표시까지 확인한다.
- 미검증·검증 불가:
  - mock case(EC-14, EC-15, EC-16, EC-19, EC-20, EC-21, EC-25, EC-26)는 실제 서버가 그 상태 코드·응답 형식을 내는지 증명하지 못한다. 특히 EC-15는 실제 `documents.get`의 404가 미리보기 모달의 오류 안내로 이어지는 경로가 미검증이고, EC-20의 400·403·404·409·500 문구는 전부 mock이다. 서버 쪽은 Rust 통합 테스트가 맡는다.
  - Rust 통합 테스트는 `dataroom_api::plugins::dispatch`를 직접 호출하므로 HTTP 라우팅, `CurrentUser` extractor, 401은 검증하지 않는다.
  - EC-11 동시성은 경합 재현이 반복에 의존해 비결정적일 수 있다.
  - `--project=desktop`만 실행하면 DoD-11의 `추가 확인 필요` 배지는 확인되지 않는다(desktop은 `satisfied`, mobile은 `needs_information`을 저장한다).
  - 컨테이너 재시작 후 검토 보존은 통합 테스트의 DB 저장까지만 확인하고 재시작은 확인하지 않는다.
  - DoD-16은 작성 폼 모달이 열려 있으면 헤더의 로그아웃 버튼이 inert라 실제 클릭이 불가능하다. 2026-10-03 사용자가 골자를 유지하고 `dispatchEvent("click")`로 로그아웃 버튼의 핸들러만 실행하는 우회를 수용했다. 사용자 조작이 아니라는 한계가 있고, 같은 코드 경로(세션 만료, 쿼리 캐시 초기화, 사용자별 key)를 검증한다. 모달이 열린 채 입력이 남는 실제 경로는 세션 만료(401)뿐이다.
- 구현 단계 선행 조건·주의:
  - 두 골격 파일 헤더의 "사용자 확정 전" 문구를 "확정"으로 고친다(골자가 아닌 주석이다). E2E 헤더에는 EC-15 전부 mock과 모달 구조(경로 2종)도 반영한다.
  - 본문이 채워진 E2E 18개 case 중 기업 담당자를 쓰는 case와 모달 구조에 기대는 case의 요소 이름·URL 가정을 다시 확인하고 본문 결함만 고친다(골자는 바꾸지 않는다). DoD-14·EC-28은 `reviews.list`·`reviews.create`·`documents.*` 요청 0건이며 `criteria.list`는 허용한다. DoD-23은 기준 3개의 번호·제목·검토 질문과 배지·버튼·모달 부재를 단언한다.
  - DoD-16 본문은 `page.goto` 없이 화면 조작(로그아웃 → 로그인 화면 → `peer` 로그인)으로 전환한다. 전체 새로고침이 있으면 캐시 누수 검증이 무효가 된다.
  - DoD-16은 DoD-10·11 case가 저장한 검토에 의존한다(DoD-13은 저장 슬롯이 필요 없다). DoD-21·22는 저장하지 않은 `revenue` 기준의 작성 폼을 쓰며 같은 (투자자, 기준)에 다시 저장하지 않는다(재저장은 409). DoD-22의 닫기 표본은 X 버튼, 취소, Esc, 바깥 클릭이며 각각 새 폼을 열어 시험한다.
  - DoD-8은 잘못된 입력 표본에 존재하지 않는 `criterionId`와 존재하지 않는 자료 ID를 함께 넣은 요청을 포함한다. EC-24의 잘못된 근거 표본은 존재하지 않는 자료 ID, 빈 배열, 중복 ID, `processing` 자료, 다른 workspace 자료다. EC-11은 (투자자, 기준) 조합 6개가 반복 상한이다.
  - `PEER` 이메일은 `tests/review-write.spec.ts` 안의 로컬 상수로 둔다(`tests/helpers/auth.ts`는 수정하지 않는다). 기존 `api/tests/common/mod.rs`, `dataroom_*.rs`, `tests/documents.spec.ts`, `tests/document-register.spec.ts`도 수정하지 않는다.
  - `tests/`는 `pnpm lint` 대상 여부와 긴 `test.fixme` 줄의 prettier 통과를 `make check-docker`로 확인한다.
