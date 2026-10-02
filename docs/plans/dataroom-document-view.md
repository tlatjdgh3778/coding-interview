# 계획: 자료 조회 화면·기능

- 상태: 승인
- 스펙: docs/specs/dataroom-document-view.md
- 기준 코드: 작업 트리 (bf128fc 기반)
- 최종 갱신: 2026-10-02

## 1. 구현 전략

- 서버는 새 REST 핸들러를 만들지 않고, 기존 `POST /api/dataroom/rpc`의 `dataroom::dispatch` method 분기로 구현한다. 근거: `api/src/dataroom/mod.rs`, `plugins/review/server/mod.rs`(workspace 검사·method match·`RpcResponse` 래핑 선례).
- DTO는 `api/src/dataroom/types.rs`에 `camelCase` + `ts-bridge` 패턴으로 정의하고 `make gen-ts-docker`로 `api-client/`를 재생성한다. `params`·`result`는 `unknown`이므로 프론트가 생성된 DTO 타입으로 캐스트한다. 근거: `api/src/types.rs`, `plugins/review/server/types.rs`.
- 작성 시각은 SQL에서 문자열로 변환해 반환한다(sqlx chrono feature·`Cargo.lock` 변경 불필요). 근거: `api/` 마운트가 compose에서 `:ro`이고 `--locked`를 쓴다.
- 화면은 `web/src/main.tsx`의 `/workspace/:workspaceId/*` splat과 `shell.tsx`의 `DataroomApp` 마운트를 그대로 쓰고, `DataroomApp` 내부의 상대 `Routes`로 목록·상세를 나눈다. `main.tsx`·`shell.tsx`는 수정하지 않는다.
- Rust 통합 테스트는 `#[sqlx::test]`(임시 DB, `./migrations` 자동 적용)로 `dispatch`를 직접 호출한다. 새 의존성은 추가하지 않는다. `AuthenticatedUser`를 직접 생성해 역할·workspace를 지정한다. 근거: `sqlx` features(`macros`, `migrate`), `api/src/auth.rs`.
- E2E는 `tests/`의 Playwright(desktop, mobile)로 실제 서버·DB를 쓰고, EC-9만 `page.route`로 실패 응답을 만든다.
- 환경 주의: `make gen-ts-docker`가 `api-client` `:ro` 등으로 실패하면 환경 대응 시간으로 분리 기록한다.

## 2. Task

### T-1 — documents 마이그레이션·시드

- 사이드: 백엔드
- 상태: 완료
- 목적: `documents` 테이블과 샘플 4건 시드를 새 마이그레이션으로 추가한다.
- 선행: 없음
- 연결 항목: DoD-1, DoD-2, DoD-3
- 수정 대상: `api/migrations/0003_documents.sql` — `documents` 테이블(workspace 연결, `status` CHECK), 조회 인덱스, 시드 4건(일부는 같은 `created_at`)
- 따라야 할 패턴: 기존 마이그레이션의 TEXT PK·시드 INSERT 방식 — 근거: `api/migrations/0001_review_criteria.sql`, `api/migrations/0002_auth.sql`
- 완료 조건: 연결 항목이 요구하는 데이터(시드 4건, 같은 시각 정렬 동률 포함)가 마이그레이션만으로 존재한다. 시드 ID는 샘플 label이다 — 검증: T-5의 통합 테스트
- 실행 명령: `make reset-db && make db` 후 `docker compose run --rm --no-deps api cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features`
- 수정 금지: 기존 `0001`·`0002` 마이그레이션

### T-2 — 계약 DTO와 api-client 재생성

- 사이드: 백엔드
- 상태: 완료
- 목적: 목록·상세 DTO를 정의하고 `api-client/` 타입을 재생성한다.
- 선행: 없음
- 연결 항목: DoD-5, DoD-6
- 수정 대상: `api/src/dataroom/types.rs` — 목록 요청·항목·응답, 상세 요청·응답 DTO. `api-client/src/types/**` — `make gen-ts-docker`가 생성(직접 수정 금지). `compose.yaml` — web 서비스의 `./api-client:/app/api-client:ro`에서 `:ro` 제거(환경 대응, `make gen-ts-docker`가 `api-client`에 쓰지 못하는 문제. ui-kit의 `051a54e`와 같은 유형. 사용자 확정)
- 따라야 할 패턴: `#[serde(rename_all = "camelCase")]` + `cfg_attr(feature = "ts-bridge", derive(ts_rs::TS), ts(export, export_to = "types/"))`, 요청 DTO는 `deny_unknown_fields` — 근거: `api/src/types.rs`
- 완료 조건: 스펙 4절의 요청 `params`·응답 `result` 형태와 필드명이 DTO 타입으로 표현되고 생성된 타입이 `api-client/`에 존재한다 — 검증: `make check-gen-ts-docker`
- 실행 명령: `make gen-ts-docker`, `make check-gen-ts-docker`
- 수정 금지: `api-client/` 직접 편집, `api/src/types.rs`의 기존 DTO

### T-3 — dataroom RPC 서버 로직

- 사이드: 백엔드
- 상태: 완료
- 목적: `dispatch`에서 `documents.list`·`documents.get`을 구현한다.
- 선행: T-1, T-2
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-4, DoD-5, EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-7
- 수정 대상: `api/src/dataroom/mod.rs` — workspace 검사 후 method 분기. `api/src/dataroom/models.rs` — 조회 행 구조체와 쿼리
- 따라야 할 패턴: `request.workspace_id != user.workspace_id`이면 `ApiError::forbidden()`, 결과는 `RpcResponse { result: serde_json::to_value(dto).map_err(ApiError::storage)? }`, SQL은 `sqlx::query_as` 파라미터 바인딩 — 근거: `plugins/review/server/mod.rs`, `api/src/handlers/auth.rs`
- 완료 조건: 연결 항목 충족. 알 수 없는 method와 DB 실패를 성공·빈 결과로 대체하지 않는다 — 검증: T-5의 통합 테스트
- 실행 명령: `docker compose run --rm --no-deps api sh -c 'cargo fmt --manifest-path api/Cargo.toml -- --check && cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features'`
- 수정 금지: `api/migrations/`, `api/src/types.rs`, `plugins/review/server/`

### T-4 — 자료 목록·검색·상세 화면

- 사이드: 프론트
- 상태: 완료
- 목적: `DataroomApp`에 목록·제목 검색·상세 화면을 구현한다.
- 선행: T-2
- 연결 항목: DoD-6, DoD-7, DoD-8, DoD-9, EC-8, EC-9, EC-10
- 수정 대상: `web/src/dataroom/app.tsx` — 상대 `Routes`. `web/src/dataroom/*.tsx`(신규) — 목록·상세 컴포넌트. `web/src/api/hooks/use-documents.ts`(신규) — 쿼리 훅. `web/src/i18n.tsx` — `en`/`ko` 문구 쌍
- 따라야 할 패턴: `useQuery` 훅 구조 — 근거: `web/src/api/hooks/use-plugins.ts`. 로딩 `role="status"`·오류 `role="alert"` — 근거: `web/src/auth/session.tsx`. ui-kit(`@biyard/components`) 컴포넌트와 Tailwind 토큰 — 근거: `web/src/auth/login.tsx`. 쿼리 키는 `[user.id, workspaceId, "documents", ...]`(스펙 결정 사항이 아니라 CLAUDE.md의 키 격리 지침을 따른다)
- 완료 조건: 연결 항목 충족. 로딩·오류·빈 결과를 구분하고 조회 실패를 "자료 없음"으로 표시하지 않는다. 작은 화면·폼 레이블·키보드 접근을 지원한다 — 검증: T-6의 E2E
- 실행 명령: `docker compose run --rm --no-deps web sh -c 'pnpm lint && pnpm build'`
- 수정 금지: `web/src/main.tsx`, `web/src/components/shell.tsx`, `api-client/`, `plugins/`

### T-5 — Rust 통합 테스트와 test-api 타깃

- 사이드: 테스트
- 상태: 완료
- 목적: 실제 PostgreSQL로 `dispatch`를 검증하고 `make test-api`를 신설한다.
- 선행: T-1, T-2
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-4, DoD-5, DoD-10, EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-7
- 수정 대상: `api/tests/dataroom_documents.rs`(신규) — 통합 테스트. `Makefile` — `test-api` 타깃(`db` 선행, `cargo test` 실행)
- 따라야 할 패턴: 컴파일 타임 DB 매크로(`sqlx::query!`)를 쓰지 않는다 — 근거: 기존 코드의 런타임 `query_as`
- 완료 조건: 연결 항목 각각을 단언하는 테스트가 있고 `make test-api`로 실행된다 — 검증: `make test-api`
- 실행 명령: `make test-api`
- 수정 금지: 제품 코드(`api/src/`), `api/migrations/`
- 테스트 파일·runner: `api/tests/dataroom_documents.rs`, `cargo test --test dataroom_documents` (`#[sqlx::test]`)
- mock 허용 경계: 없음(실제 PostgreSQL 사용)
- 데이터 격리: `#[sqlx::test]`가 테스트마다 임시 DB를 만들고 `./migrations`를 적용한다. EC-6의 두 번째 workspace와 자료는 해당 테스트 안에서 INSERT한다

### T-6 — 자료 조회 E2E

- 사이드: E2E
- 상태: 완료
- 목적: desktop·mobile에서 목록·검색·상세·새로고침·오류·빈 결과 흐름을 검증한다.
- 선행: T-4
- 연결 항목: DoD-6, DoD-7, DoD-8, DoD-9, EC-8, EC-9, EC-10
- 수정 대상: `tests/documents.spec.ts`(신규), `tests/helpers/auth.ts`(신규) — 로그인 헬퍼
- 따라야 할 패턴: role·label·보이는 문구로 요소를 찾고 sleep 대신 자동 대기를 쓴다 — 근거: `.claude/agents/e2e-dev.md`. 로그인은 UI 폼 또는 `page.request.post('/api/auth/login')` — 근거: `web/src/auth/login.tsx`
- 완료 조건: 연결 항목 각각을 단언하는 시나리오가 desktop·mobile 두 프로젝트에서 통과한다. 시각 표시는 시간대에 영향받지 않게 느슨하게 단언한다 — 검증: `make test-e2e`
- 실행 명령: `pnpm typecheck`, `pnpm exec playwright test tests/documents.spec.ts --project=desktop`
- 수정 금지: 제품 코드, `playwright.config.ts`
- 테스트 파일·runner: `tests/documents.spec.ts`, Playwright
- mock 허용 경계: EC-9에 한해 `documents.list` 응답을 `page.route`로 500 실패시킨다(실패를 정상 서버로 만들 수 없음). 나머지는 실제 API·DB를 쓴다
- 데이터 격리: 읽기 전용 흐름이라 쓰기 격리가 필요 없다. 시드가 고정이며 초기화는 `make reset-db`다. 단언은 시드 자료의 존재 여부 중심으로 쓴다
- 실행 환경: `make test-e2e`(접속 `http://web:5178`) 또는 호스트 `http://127.0.0.1:5178`. 계정 `company@lighthouse.test`, `investor@lighthouse.test`, 비밀번호 `dataroom`. 사전 데이터는 마이그레이션 시드

## 3. 항목 coverage

- DoD-1: T-1, T-3, T-5
- DoD-2: T-1, T-3, T-5
- DoD-3: T-1, T-3, T-5
- DoD-4: T-3, T-5
- DoD-5: T-2, T-3, T-5
- DoD-6: T-2, T-4, T-6
- DoD-7: T-4, T-6
- DoD-8: T-4, T-6
- DoD-9: T-4, T-6
- DoD-10: T-5
- EC-1: T-3, T-5
- EC-2: T-3, T-5
- EC-3: T-3, T-5
- EC-4: T-3, T-5
- EC-5: T-3, T-5
- EC-6: T-3, T-5
- EC-7: T-3, T-5
- EC-8: T-4, T-6
- EC-9: T-4, T-6
- EC-10: T-4, T-6

## 4. 실행 순서

- 1구간(병렬): T-1, T-2. 수정 파일이 겹치지 않는다(`api/migrations/` vs `api/src/dataroom/types.rs`·`api-client/`).
- 2구간(병렬): T-3, T-4, T-5. 수정 파일이 겹치지 않는다(`api/src/dataroom/mod.rs`·`models.rs` vs `web/` vs `api/tests/`·`Makefile`).
- 3구간: T-6. 화면(T-4)이 있어야 본문을 채울 수 있다.
- 검증 단계에서 `make check-docker`, `make test-api`, `make test-e2e`를 실행한다(DoD-10).

## 5. 차단 사항

- 없음

## 테스트 설계 증거

- 상태: PASS (골격 동결, 2026-10-02)
- 기준 스펙: docs/specs/dataroom-document-view.md (확정)
- 골자 digest: `91f4c2bc257c56fe` (case 24개)
- 골격 파일: `api/tests/dataroom_documents.rs`(15개, `#[test]` + `#[ignore = "skeleton"]`), `tests/documents.spec.ts`(9개, `test.fixme`)
- 기계 검사: 통과 (`check-skeleton.py --exempt DoD-10`, 항목 20개 중 case 연결 19개, 제외 1개)
- reviewer: 새 `general-purpose` 4라운드. 1~3라운드 NEEDS-FIX(EC-2·3·4·7·8, DoD-1·2·4 보완), 3라운드 후 사용자 결정으로 이어서 4라운드 PASS. PASS 시점의 골격 해시는 digest 일치.
- 사람 확정:
  - DoD-10(세 명령 통과)은 case 없이 제외하고 검증 단계에서 `make check-docker`, `make test-api`, `make test-e2e`를 직접 실행해 판정한다.
  - mock 경계는 계획대로다. Rust 통합 테스트는 mock 없음(실제 PostgreSQL), E2E는 EC-9에 한해 `documents.list` 응답을 `page.route`로 500 처리한다.
  - EC-8에 "ready 자료에는 안내가 없다" case를 추가하지 않는다.
  - 계약 세부(`params` null·`query` 생략, 목록 항목 필드 형태, `createdAt` ISO 형식, 401·500 계약)는 DoD·EC가 요구하지 않으므로 case로 덮지 않는다. DoD-1·2만 시드 ID 4개를 명시한다.
  - EC-2는 case 하나로 유지하되 `%`·`_`·`\` 세 글자 각각을 명시한다.
- 미검증·검증 불가:
  - EC-9의 mock PASS는 서버의 실제 500(`storage_error`) 처리를 증명하지 않는다.
  - EC-8은 ready 자료에 안내가 없음을 검증하지 않는다(항상 안내를 띄우는 구현도 통과).
  - 골격은 실행하지 않았고 모든 case는 `skeleton` 상태라 통과로 세지 않는다.
- 구현 단계 선행 조건·주의:
  - Rust case의 `#[test]`는 본문 단계에서 `#[sqlx::test]`로 바꾼다(허용되는 본문 변경). 시드에 같은 `created_at`이 있어야 DoD-3이 성립한다.
  - E2E 작성 중 호스트 환경에서 `playwright` 명령을 찾지 못했다(수집·타입 검사 미확인). 실행은 `make test-e2e`(컨테이너) 기준으로 하고, `tests/`는 `pnpm lint` 대상이 아니므로 `pnpm typecheck`로 확인한다.
