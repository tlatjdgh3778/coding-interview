# 계획: 자료 등록 화면·기능

- 상태: 승인
- 스펙: docs/specs/dataroom-document-register.md
- 기준 코드: 작업 트리 (6ee3993 기반)
- 최종 갱신: 2026-10-02

## 1. 구현 전략

- 서버는 새 REST 핸들러를 만들지 않고 기존 `dataroom::dispatch`의 method 분기에 `documents.create`를 더한다. 권한(역할) 검사는 이 분기 안에서 params 역직렬화보다 먼저 한다. `UserRole`은 `PartialEq`가 없으므로 `matches!`로 비교한다. 근거: `api/src/dataroom/mod.rs`, `api/src/types.rs`.
- 요청 DTO `CreateDocumentRequest`는 기존 `GetDocumentRequest`와 같은 어트리뷰트(`camelCase`, `deny_unknown_fields`, `ts-bridge`)로 `api/src/dataroom/types.rs`에 둔다. 응답은 기존 `DocumentDetail`·`GetDocumentResponse`를 재사용한다. 근거: `api/src/dataroom/types.rs`.
- 저장은 `sqlx::query_as` 런타임 쿼리와 바인딩으로 하며 `query!` 매크로는 쓰지 않는다. 시각은 기존처럼 SQL에서 문자열로 만든다. 중복은 `UNIQUE` 제약 충돌을 409로 바꿔 판정하고 `id` 충돌은 기존 `storage` 매핑으로 둔다. 근거: `api/src/dataroom/models.rs`, `api/src/error.rs`.
- 새 의존성은 추가하지 않는다. `Cargo.lock`이 `./api:ro` 마운트 안에 있고 컨테이너 명령이 `--locked`라서 lock 갱신이 막힌다. id는 이미 있는 `rand`로 만들고 해시는 PostgreSQL 내장 함수로 계산한다. 근거: `api/Cargo.toml`, `compose.yaml`.
- `api/migrations/0004_*.sql`은 새 파일로만 추가하며 적용된 `0001~0003`은 수정하지 않는다. 근거: `CLAUDE.md`.
- 의존 순서는 CLAUDE.md의 "백엔드 계약 → `make gen-ts-docker` → 프론트"를 따른다. 생성은 크레이트가 컴파일되는 상태에서 해야 하므로 서버 로직(T-2) 뒤에 둔다.
- 화면은 `DataroomApp` 내부 상대 `Routes`에 등록 라우트를 추가하고 `main.tsx`·`shell.tsx`는 수정하지 않는다. 등록은 `useMutation`, 성공 시 `[userId, workspaceId, "documents"]` 접두어로 무효화한다(`staleTime` 15초라 필수). 모달은 `@biyard/components`에 dialog가 없어 네이티브 dialog 요소를 쓴다. 근거: `web/src/dataroom/app.tsx`, `web/src/api/hooks/use-documents.ts`, `web/src/api/query-client.ts`, `web/src/auth/login.tsx`.
- 파일은 `arrayBuffer()` + `TextDecoder("utf-8", { fatal: true })`로 읽는다(기본 설정이 선행 BOM을 제거한다). 오류 분기는 `ApiError.status`로 하고, `ApiError`가 아닌 예외는 네트워크 오류로 본다. 413은 본문 형식이 달라도 상태로 잡힌다. 근거: `api-client/src/runtime/client.ts`.
- Rust 통합 테스트는 기존 `#[sqlx::test]` 방식으로 `dispatch`를 직접 호출한다. 기존 `dataroom_documents.rs`는 수정하지 않고, 새 파일과 공용 `api/tests/common/mod.rs`(별도 테스트 타깃으로 컴파일되지 않음)를 둔다. 근거: `api/tests/dataroom_documents.rs`.
- E2E는 `tests/`의 Playwright(desktop, mobile)로 실제 서버·DB를 쓴다. 기존 `tests/documents.spec.ts`와 `tests/helpers/auth.ts`는 수정하지 않고 재사용만 한다. 근거: `playwright.config.ts`, `tests/helpers/auth.ts`.

## 2. Task

### T-1 — 마이그레이션 0004·409 오류·요청 DTO

- 사이드: 백엔드
- 상태: 완료
- 목적: 작성자·중복 판정 컬럼과 제약, 409 오류 생성자, 등록 요청 DTO를 추가한다.
- 선행: 없음
- 연결 항목: DoD-7, DoD-8, DoD-9, EC-6, EC-7
- 수정 대상: `api/migrations/0004_document_register.sql`(신규) — 작성자 컬럼, 해시 생성 컬럼, `UNIQUE` 제약. `api/src/error.rs` — 409 `conflict` 생성자. `api/src/dataroom/types.rs` — `CreateDocumentRequest`
- 따라야 할 패턴: 순번 SQL 마이그레이션 — 근거: `api/migrations/0003_documents.sql`. `ApiError` 생성자 형태 — 근거: `api/src/error.rs`. DTO 어트리뷰트 — 근거: `api/src/dataroom/types.rs`의 `GetDocumentRequest`
- 완료 조건: 연결 항목이 요구하는 제약이 마이그레이션만으로 존재한다. 시드 4건이 제약에 걸리지 않고 기존 테스트의 자료 INSERT가 수정 없이 동작한다. 작성자 컬럼에 외래키를 걸지 않는다 — 검증: T-4의 통합 테스트
- 실행 명령: `make reset-db && make db` 후 `docker compose run --rm --no-deps api sh -c 'cargo fmt --manifest-path api/Cargo.toml -- --check && cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features'`
- 수정 금지: 기존 `0001`~`0003` 마이그레이션, `api/src/types.rs`의 기존 DTO

### T-2 — documents.create 서버 로직

- 사이드: 백엔드
- 상태: 완료
- 목적: `dispatch`에 `documents.create` 분기와 저장 쿼리를 구현한다.
- 선행: T-1
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-4, DoD-7, DoD-8, DoD-9, EC-1, EC-2, EC-3, EC-4, EC-6, EC-7, EC-8
- 수정 대상: `api/src/dataroom/mod.rs` — 분기, 역할 검사, 정규화·검증. `api/src/dataroom/models.rs` — 저장 함수(`id`를 인자로 받아 충돌 시험이 가능하게 한다)
- 따라야 할 패턴: workspace 검사 뒤 method match, 역직렬화 실패는 `ApiError::invalid`, 길이는 문자 수 — 근거: `api/src/dataroom/mod.rs`. 쿼리는 바인딩, DB 오류는 `ApiError::storage` — 근거: `api/src/dataroom/models.rs`
- 완료 조건: 연결 항목 충족. 투자자 차단이 입력 검증보다 앞선다. 작성자와 workspace는 세션 값만 쓰고 요청 값을 쓰지 않는다. DB 실패를 성공·빈 결과·메모리 저장으로 바꾸지 않는다. 기존 `documents.list`·`documents.get` 동작은 그대로다 — 검증: T-4의 통합 테스트
- 실행 명령: `docker compose run --rm --no-deps api sh -c 'cargo fmt --manifest-path api/Cargo.toml -- --check && cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features'`
- 수정 금지: `api/migrations/`, `api/src/types.rs`, `plugins/review/server/`, `api/src/error.rs`

### T-3 — api-client 타입 재생성

- 사이드: 백엔드
- 상태: 완료
- 목적: `CreateDocumentRequest` 타입을 `make gen-ts-docker`로 생성해 프론트가 쓰게 한다.
- 선행: T-2
- 연결 항목: DoD-5
- 수정 대상: `api-client/src/types/**` — 생성물(직접 수정 금지)
- 따라야 할 패턴: 생성은 `make gen-ts-docker`로만 한다 — 근거: `CLAUDE.md`
- 완료 조건: 생성된 요청 타입이 `api-client/`에 있고 생성물 일치 검사가 통과한다 — 검증: `make check-gen-ts-docker`
- 실행 명령: `make gen-ts-docker`, `make check-gen-ts-docker`
- 수정 금지: `api-client/` 직접 편집, `api/src/`

### T-4 — 등록 Rust 통합 테스트

- 사이드: 테스트
- 상태: 완료
- 목적: 실제 PostgreSQL로 `documents.create`의 권한·검증·중복·동시성·저장 실패를 검증한다.
- 선행: T-1
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-4, DoD-7, DoD-8, DoD-9, EC-1, EC-2, EC-3, EC-4, EC-6, EC-7, EC-8
- 수정 대상: `api/tests/common/mod.rs`(신규) — 새 테스트가 쓸 헬퍼. `api/tests/dataroom_document_register.rs`(신규) — 통합 테스트
- 따라야 할 패턴: `#[sqlx::test]`, `dispatch` 직접 호출, 한글 `mod` 구조와 `@spec`·`@given/@when/@then` 주석 — 근거: `api/tests/dataroom_documents.rs`. 컴파일 타임 DB 매크로를 쓰지 않는다. 기존 파일의 `DoD-N` 태그가 이전 스펙 번호라 새 파일에서 스펙을 구분할 수 있게 쓴다
- 완료 조건: 연결 항목 각각을 단언하는 테스트가 있다. 동시 요청은 실제로 동시에 호출한다. DoD-9는 응답이 아닌 DB 행으로 확인한다 — 검증: `make test-api`
- 실행 명령: `make test-api`
- 수정 금지: 제품 코드(`api/src/`), `api/migrations/`, 기존 `api/tests/dataroom_documents.rs`
- 테스트 파일·runner: `api/tests/dataroom_document_register.rs`, `cargo test` (`#[sqlx::test]`)
- mock 허용 경계: 없음(실제 PostgreSQL 사용)
- 데이터 격리: `#[sqlx::test]`가 테스트마다 임시 DB를 만들고 마이그레이션(시드 포함)을 적용한다. 다른 사용자·workspace가 필요한 테스트는 그 안에서 INSERT한다. EC-8은 임시 DB의 `documents`에 항상 실패하는 제약을 추가해 저장 실패를 유발하고, `id` 충돌은 서버가 id를 만들어 강제할 수 없어 미검증으로 둔다

### T-5 — test-api 전체 실행 전환

- 사이드: 백엔드
- 상태: 완료
- 목적: `make test-api`가 테스트 파일 이름에 묶이지 않고 `api/tests/` 전체를 실행하게 한다.
- 선행: 없음
- 연결 항목: DoD-14
- 수정 대상: `Makefile` — `test-api` 타깃의 `--test` 고정 제거
- 따라야 할 패턴: 기존 `test-api`의 `db` 선행과 컨테이너 실행 형태를 유지한다 — 근거: `Makefile`
- 완료 조건: 타깃이 파일 이름을 고정하지 않으며 기존 조회 테스트와 새 테스트가 함께 실행된다 — 검증: `make test-api`
- 실행 명령: `make test-api`
- 수정 금지: `Makefile`의 다른 타깃

### T-6 — 자료 등록 화면

- 사이드: 프론트
- 상태: 완료
- 목적: 등록 폼, 파일 읽기, 내용 보기 모달, 오류 처리와 역할별 진입 제어를 구현한다.
- 선행: T-3
- 연결 항목: DoD-5, DoD-6, DoD-10, DoD-11, DoD-12, EC-9, EC-10, EC-11, EC-12, EC-13, EC-14
- 수정 대상: `web/src/dataroom/document-register.tsx`(신규) — 폼·모달. `web/src/dataroom/app.tsx` — 등록 라우트, role 전달. `web/src/dataroom/document-list.tsx` — 등록 진입 버튼. `web/src/api/hooks/use-documents.ts` — 등록 mutation 훅. `web/src/i18n.tsx` — `en`/`ko` 문구 쌍
- 따라야 할 패턴: `useMutation`·form의 `onSubmit`·`disabled={isPending}`·`role="alert"` — 근거: `web/src/auth/login.tsx`. 쿼리 키 `[user.id, workspaceId, "documents", ...]`와 접두어 무효화 — 근거: `web/src/api/hooks/use-documents.ts`. 문구는 `en`·`ko` 양쪽에 추가(`ko`는 `en` 키 타입을 따른다) — 근거: `web/src/i18n.tsx`. 서버 `message`는 노출하지 않는다
- 완료 조건: 연결 항목 충족. 오류는 상태 코드로 분기하고 네트워크 예외는 별도로 처리한다. 작은 화면·폼 레이블·키보드 접근(모달 열기·닫기 포함)을 지원한다. `@biyard/components`를 쓰고 새 의존성을 추가하지 않는다 — 검증: T-7의 E2E
- 실행 명령: `docker compose run --rm --no-deps web sh -c 'pnpm lint && pnpm build'`, `pnpm typecheck`
- 수정 금지: `web/src/main.tsx`, `web/src/components/shell.tsx`, `api-client/`, `plugins/`, `web/src/dataroom/document-detail.tsx`

### T-7 — 자료 등록 E2E

- 사이드: E2E
- 상태: 완료
- 목적: desktop·mobile에서 등록 흐름, 모달, 역할별 진입, 오류·보존·비활성화와 요청 크기 초과를 검증한다.
- 선행: T-6
- 연결 항목: DoD-5, DoD-6, DoD-10, DoD-11, DoD-12, EC-5, EC-9, EC-10, EC-11, EC-12, EC-13, EC-14
- 수정 대상: `tests/document-register.spec.ts`(신규)
- 따라야 할 패턴: role·label·보이는 문구로 요소를 찾고 sleep 대신 자동 대기를 쓴다 — 근거: `.claude/agents/e2e-dev.md`. 로그인은 `login(page, email, password)` 헬퍼를 쓰며 기업 계정은 `COMPANY` — 근거: `tests/helpers/auth.ts`. 오류 응답 유발은 `page.route`로 method별 처리 — 근거: `tests/documents.spec.ts`
- 완료 조건: 연결 항목 각각을 단언하는 시나리오가 desktop·mobile 두 프로젝트에서 통과한다. 목록 최상단 확인은 검색어 없는 목록 기준이다. 기존 `tests/documents.spec.ts`가 계속 통과한다 — 검증: `make test-e2e`
- 실행 명령: `pnpm typecheck`, `docker compose --profile test run --rm --no-deps playwright pnpm test:e2e tests/document-register.spec.ts`
- 수정 금지: 제품 코드, `playwright.config.ts`, `tests/documents.spec.ts`, `tests/helpers/auth.ts`
- 테스트 파일·runner: `tests/document-register.spec.ts`, Playwright
- mock 허용 경계: 서버 오류별 문구와 입력 보존, 제출 중 비활성화에 한해 등록 요청 응답을 `page.route`로 실패·지연시킨다(정상 서버로 만들 수 없음). 사용자 확인 항목. 나머지(EC-5의 413 확인 포함)는 실제 API·DB를 쓴다
- 데이터 격리: 실행마다 고유한 제목(프로젝트 이름과 시각·난수 포함, 시드 검색어와 겹치지 않음)을 쓰고 만든 자료는 정리하지 않는다. 초기화는 `make reset-db`다. 중복을 확인하는 시나리오만 같은 값을 두 번 보낸다
- 실행 환경: `make test-e2e`(접속 `http://web:5178`) 또는 호스트 `http://127.0.0.1:5178`. 계정 `company@lighthouse.test`, `investor@lighthouse.test`, 비밀번호 `dataroom`. 사전 데이터는 마이그레이션 시드이며 0004는 서버 기동 시 적용된다

## 3. 항목 coverage

- DoD-1: T-2, T-4
- DoD-2: T-2, T-4
- DoD-3: T-2, T-4
- DoD-4: T-2, T-4
- DoD-5: T-3, T-6, T-7
- DoD-6: T-6, T-7
- DoD-7: T-1, T-2, T-4
- DoD-8: T-1, T-2, T-4
- DoD-9: T-1, T-2, T-4
- DoD-10: T-6, T-7
- DoD-11: T-6, T-7
- DoD-12: T-6, T-7
- DoD-13: 제외 — 구현 Task가 아니며 검증 단계에서 세 명령을 직접 실행해 판정한다
- DoD-14: T-5
- EC-1: T-2, T-4
- EC-2: T-2, T-4
- EC-3: T-2, T-4
- EC-4: T-2, T-4
- EC-5: T-7
- EC-6: T-1, T-2, T-4
- EC-7: T-1, T-2, T-4
- EC-8: T-2, T-4
- EC-9: T-6, T-7
- EC-10: T-6, T-7
- EC-11: T-6, T-7
- EC-12: T-6, T-7
- EC-13: T-6, T-7
- EC-14: T-6, T-7

## 4. 실행 순서

- 1구간(병렬): T-1, T-5. 수정 파일이 겹치지 않는다(마이그레이션·`error.rs`·`types.rs` vs `Makefile`).
- 2구간(병렬): T-2, T-4. 둘 다 T-1 뒤이며 수정 파일이 겹치지 않는다(`api/src/dataroom/mod.rs`·`models.rs` vs `api/tests/`).
- 3구간: T-3. 크레이트가 컴파일되는 T-2 뒤에 타입을 생성한다.
- 4구간: T-6. 생성된 타입(T-3)이 있어야 한다.
- 5구간: T-7. 화면(T-6)이 있어야 본문을 채울 수 있다.
- 테스트 Task(T-4, T-7)는 구현 단계에서 동결된 골격의 본문만 채우고 실행하지 않는다. 실행·판정은 검증 단계에서 한다.
- 검증 단계에서 `make check-docker`, `make test-api`, `make test-e2e`를 실행한다(DoD-13).

## 5. 차단 사항

- 없음. EC-11~13의 실패·지연 유발 방식은 차단이 아니며 테스트 설계 단계에서 확정한다.

## 테스트 설계 증거

- 상태: PASS (골격 동결, 2026-10-03, update)
- 기준 스펙: docs/specs/dataroom-document-register.md (확정, 구현중)
- 골자 digest: `a913f36d5561ac90` (case 22개). 2026-10-02의 이전 digest `64766d0f999fe87d`는 스펙 변경으로 폐기했다.
- 갱신 사유: 2026-10-03 사용자 결정으로 스펙 EC-1에 제목 NUL 표본을 추가하고 EC-14(파일 없이 제출 시 요청 없이 안내)를 신설했다.
- 골격 파일: `api/tests/dataroom_document_register.rs`(11개, `#[sqlx::test]`), `tests/document-register.spec.ts`(11개, EC-14만 `test.fixme`). 두 파일은 이전 구현 단계에서 본문이 채워져 있으며 동결 대상은 골자(태그·case 서술)다.
- 기계 검사: 본문이 채워진 파일이라 순수 골격 검사는 쓰지 않고 `--frozen` 모드로 골자만 비교한다. 비-frozen 실행에서 항목-case 연결 위반은 없었다(28개 항목 중 연결 26개, 제외 2개: `--exempt DoD-13,DoD-14`).
- reviewer: 최초 설계 새 `general-purpose` 3라운드(1·2라운드 NEEDS-FIX, 3라운드 PASS, digest `64766d0f999fe87d`). update에서 새 `general-purpose` 1라운드 PASS(finding 0건, digest `a913f36d5561ac90` 일치).
- 사람 확정:
  - DoD-13(세 `make` 명령 통과)은 case 없이 제외하고 검증 단계에서 `make check-docker`, `make test-api`, `make test-e2e`를 직접 실행해 판정한다.
  - DoD-14(Makefile 전체 실행 전환)는 case 없이 제외한다. T-5로 구현하고 `make test-api` 실행으로 판정한다.
  - EC-5(413)는 E2E에서 mock 없이 실제 서버에 256KiB를 근소하게 넘는 요청을 보내 상태 코드만 확인한다(응답 본문 형식은 단언하지 않는다).
  - EC-8은 임시 DB의 `documents`에 항상 실패하는 제약을 추가해 `dispatch`로 등록하는 방식으로 시험한다. `id` 충돌은 서버가 id를 만들어 강제할 수 없어 미검증으로 둔다.
  - mock 경계는 계획대로다. Rust 통합 테스트는 mock 없음(실제 PostgreSQL). E2E는 EC-11(409 제외)·EC-12 mock 응답 case·EC-13에 한해 등록 요청 응답을 실패·지연시키고, 나머지(DoD-5·6·10·11·12, EC-5, EC-9, EC-10, EC-11의 409, EC-14)는 실제 API·DB를 쓴다.
  - 경계값 허용 case(정확히 100자·255자·204,800 bytes, `.MD` 등)는 만들지 않는다. 스펙에서 제거된 항목(제목 trim 저장, 파일명 그대로 저장, BOM 제거 저장, CRLF 보존)도 case로 만들지 않는다.
  - 2026-10-03 확정: 제목 NUL은 400으로 막는다(EC-1, 사용자 결정 A). 파일 없이 제출하면 안내하는 동작은 유지하고 EC-14로 스펙에 기록한다.
  - 같은 규칙의 입력 표본은 `@given` 표본 목록으로 묶고, 같은 요청·상태의 결과는 한 case의 `@then` 여러 줄로 합친다. 병합 case는 DoD-1·2·4·9, DoD-7·EC-6, DoD-8·EC-6이다.
- 미검증·검증 불가:
  - EC-8의 `id` 충돌은 미검증이다.
  - EC-11의 400·403·413·5xx 문구와 EC-13의 응답 지연은 응답을 흉내 낸 것이어서 실제 서버가 그 상태를 내보내는지는 증명하지 못한다. 서버 쪽은 Rust 통합 테스트와 EC-5의 실서버 413 case가 일부를 덮는다.
  - EC-5는 413 응답 본문 형식을 검증하지 않는다.
  - 컨테이너 재시작 후 자료 보존은 통합 테스트의 DB 저장까지만 확인하고 재시작은 확인하지 않는다.
- 구현 단계 선행 조건·주의:
  - Rust EC-1 case 본문에 NUL 제목 표본을 반영한다(T-4). 태그는 이미 갱신돼 있다.
  - E2E EC-14 case는 `test.fixme` 골격이며 T-7이 본문을 채우고 `test`로 바꾼다.
  - 기존 `api/tests/dataroom_documents.rs`와 `tests/documents.spec.ts`의 `DoD-N` 태그는 이전 스펙(자료 조회) 번호이며 수정하지 않는다.
  - EC-7은 동시 호출을 한 번만 하면 경합이 항상 재현되지 않을 수 있어 반복 호출을 유지한다.
  - `tests/`는 `pnpm lint` 대상이 아니므로 `pnpm typecheck`로 확인하고, Playwright 실행은 `make test-e2e`(컨테이너)로 한다.
