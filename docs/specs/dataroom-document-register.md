# 스펙: 자료 등록 화면·기능

- 상태: 완료
- 최종 갱신: 2026-10-03

## 1. 목표
기업 담당자가 제목과 UTF-8 `.txt`/`.md` 파일을 데이터룸(workspace)에 자료로 등록한다. 브라우저가 파일을 UTF-8 문자열로 읽어 파일명·본문과 함께 JSON으로 전송하며(multipart 없음), 전체 요청은 256KiB 제한 안에서 더 엄격한 제약을 둔다. 등록된 자료는 `ready` 상태로 저장되어 투자자가 근거로 연결할 수 있다. 범위는 `documents.create` RPC, 등록용 DB 마이그레이션, 등록 화면이다. [제안 후 승인]

## 2. 비목표
- 자료 수정은 이번 범위에서 제외한다. [사용자 결정]
- 다중 파일 동시 등록은 이번 범위에서 제외한다. [사용자 결정]
- 길이 CHECK 제약은 추가하지 않고 서버 검증만 사용한다. [사용자 결정]
- 응답에 작성자를 노출하지 않는다. [제안 후 승인]
- AI 검토 초안은 이번 범위에서 제외한다. [제안 후 승인]
- 자료 삭제, 실제 파일 스토리지, PDF·OCR·파일 변환, 비동기 처리·재시도는 구현하지 않는다. [제안 후 승인]
- 클라이언트가 만드는 멱등성 키와 시간 범위 방식의 중복 판정은 채택하지 않는다. [사용자 결정]
- 409 응답에 기존 자료의 id를 담지 않으며 공용 오류 형식 `{ "kind", "message" }`는 바꾸지 않는다. [제안 후 승인]

## 3. 완료의 정의
- DoD-1: 기업 담당자가 `documents.create`로 제목·파일명·본문을 보내면 `ready` 자료가 저장되고 응답에 id·제목·파일명·상태·본문·작성 시각이 담긴다 — 검증: Rust 통합 테스트(실 PostgreSQL, `#[sqlx::test]`) [제안 후 승인]
- DoD-2: 등록한 자료를 `documents.get`으로 조회하면 등록한 값과 같고, `documents.list`에서 작성 시각 내림차순 규칙대로 최상단에 나온다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- DoD-3: 투자자의 `documents.create`는 입력 검증보다 먼저 403으로 거부되고 DB에 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 잘못된 입력을 함께 보내 권한 검사 순서 확인) [사용자 결정]
- DoD-4: 요청 `workspaceId`가 사용자 workspace와 다르면 403이 반환되고, 저장된 자료는 요청자의 workspace에만 속한다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- DoD-5: 기업 담당자가 등록 화면에서 제목을 입력하고 파일을 선택해 등록하면 새 자료의 상세 화면(`/workspace/:id/documents/:documentId`)으로 이동해 제목·파일명·상태·본문이 표시된다 — 검증: Playwright E2E(실 API·DB, mock 없음) [제안 후 승인]
- DoD-6: 투자자에게는 목록 화면의 "자료 등록" 버튼이 보이지 않는다 — 검증: Playwright E2E [제안 후 승인]
- DoD-7: 같은 사용자가 같은 제목·파일명·본문으로 다시 등록하면 409 `conflict`가 반환되고 새 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- DoD-8: 다른 사용자가 같은 내용을 등록하거나, 같은 사용자가 제목·파일명·본문 중 하나만 달리해 등록하면 별개 자료로 저장된다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- DoD-9: 저장된 자료의 작성자는 세션에서 확인한 사용자 id이고 요청 본문으로 바꿀 수 없다 — 검증: Rust 통합 테스트(실 PostgreSQL, `createdBy` 필드는 §5.1 EC-4와 일치) [사용자 결정]
- DoD-10: 파일을 선택한 뒤 "내용 보기"를 누르면 모달(HTML 기본 dialog 요소)에 파일명과 본문 전체(BOM 제거 후, 줄바꿈 유지)가 읽기 전용으로 표시된다 — 검증: Playwright E2E [사용자 결정]
- DoD-11: 등록에 성공하면 자료 목록 최상단에 새 자료가 표시된다 — 검증: Playwright E2E(실 API·DB) [제안 후 승인]
- DoD-12: 투자자가 `/workspace/:id/documents/new`에 직접 접근하면 폼 대신 "기업 담당자만 등록할 수 있다"는 안내가 표시된다 — 검증: Playwright E2E [제안 후 승인]
- DoD-13: `make check-docker`, `make test-api`, `make test-e2e`가 통과한다 — 검증: 세 명령 실행 [제안 후 승인]
- DoD-14: `make test-api`는 `api/tests/` 아래의 모든 통합 테스트 파일을 실행한다 — 검증: Makefile에서 `--test` 파일 고정 제거 확인 후 `make test-api` 실행 [사용자 결정]

## 4. 인터페이스 계약
- API 경로: `POST /api/dataroom/rpc`의 method 분기로 `documents.create`를 제공한다. 요청·응답·오류 형식은 기존 형식(`{ "workspaceId", "method", "params" }`, `{ "result" }`, `{ "kind", "message" }`)을 따른다. [제안 후 승인]
- `documents.create` 요청 `params`는 `{ "title": "string", "fileName": "string", "content": "string" }`이고 세 필드 모두 필수이며 camelCase, 알 수 없는 필드는 거부한다. [사용자 결정]
- `documents.create` 응답 `result`는 `documents.get` 응답과 같은 형태 `{ "document": { "id": "string", "title": "string", "fileName": "string", "status": "ready", "content": "string", "createdAt": "string" } }`이고 기존 `DocumentDetail` 타입을 재사용한다. 새 DTO는 요청용 `CreateDocumentRequest` 하나이며 TS 타입은 `make gen-ts-docker`로 생성한다. [제안 후 승인]
- 서버가 정하는 값: `status`는 `ready`, `createdAt`은 DB `NOW()`(ISO 8601 UTC 문자열로 반환), `id`는 `doc-` + 임의 hex 16자리, `workspace_id`와 작성자는 세션에서 확인한 값이다. [제안 후 승인]
- 오류 응답은 400 `invalid_input`(입력 검증 실패), 401(미인증, 기존 extractor), 403 `forbidden`(투자자 또는 `workspaceId` 불일치), 409 `conflict`(같은 사용자의 동일 제목·파일명·본문 재등록), 500 `storage_error`(DB 오류)로 구분한다. `ApiError`에 409 생성자를 추가한다. 서버 `message`는 정적 문자열이다. [제안 후 승인]
- 데이터 스키마: `api/migrations/0004_*.sql`로 `documents.created_by`(TEXT, nullable, 시드 4건은 NULL, 값은 로그인한 사용자 id)를 추가하고 `UNIQUE (workspace_id, created_by, content_hash)`를 둔다. `created_by`에는 외래키를 걸지 않는다. 길이 CHECK는 추가하지 않는다. [사용자 결정]
- 중복 판정용 `content_hash`는 제목·파일명·본문을 각각 길이 접두와 함께 이어 붙인 값의 `md5`를 GENERATED STORED 컬럼으로 둔다(생성 컬럼에 쓸 수 있는 내장 해시가 `md5`뿐이다). [제안 후 승인]
- 화면 URL은 등록 `/workspace/:id/documents/new`이며 `dataroom/app.tsx`에만 라우트를 추가하고 `main.tsx`·`shell.tsx`는 수정하지 않는다. [제안 후 승인]

## 5. 엣지 케이스와 실패 시나리오

### 5.1 서버 입력 검증
- EC-1: 제목이 비어 있거나 공백뿐이거나 NUL(`\u0000`)을 포함하거나 trim 후 100자(문자 수 기준)를 넘으면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 입력별 확인) [사용자 결정]
- EC-2: 파일명이 `.txt`/`.md`(대소문자 무시)로 끝나지 않거나, 앞뒤에 공백이 있거나(trim하지 않는다), 확장자만 있거나, 공백뿐이거나, 유니코드 제어문자(C0·DEL·C1)·`/`·`\`를 포함하거나, 255자를 넘으면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 입력별 확인) [제안 후 승인]
- EC-3: 선행 BOM(U+FEFF) 하나를 제거한 본문이(BOM만 있는 본문은 빈 본문이다) 비어 있거나 공백뿐이거나 NUL(`\u0000`)을 포함하거나 UTF-8 200KiB(204,800 bytes)를 넘으면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL, 입력별·경계값 확인) [사용자 결정]
- EC-4: 알 수 없는 필드(`id`, `status`, `createdAt`, `createdBy` 등)가 있으면 400 `invalid_input`이 반환되고 행이 생기지 않는다 — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]

### 5.2 요청 크기
- EC-5: 전체 요청이 256KiB를 넘으면 axum이 413을 반환한다(응답이 `{kind, message}` 형식이 아닐 수 있다) — 검증: 테스트 설계 단계에서 확정 [제안 후 승인]

### 5.3 중복·동시성
- EC-6: 중복은 정규화한 제목·파일명·본문이 모두 같을 때만 성립해 409 `conflict`가 반환된다(제목 앞뒤 공백과 본문 BOM 유무 차이는 같은 자료로, 필드 경계만 다르게 이어 붙여지는 조합은 다른 자료로 판정한다) — 검증: Rust 통합 테스트(실 PostgreSQL) [사용자 결정]
- EC-7: 같은 사용자의 동일 내용 요청 2개가 동시에 오면 1건만 저장되고 한 요청은 성공하며 다른 요청은 409 `conflict`가 반환된다 — 검증: Rust 통합 테스트(동시 호출) [사용자 결정]

### 5.4 저장 실패
- EC-8: DB 오류와 중복 판정이 아닌 `id` 충돌은 재시도 없이 500 `storage_error`로 반환되고 행이 생기지 않으며 메모리 저장소로 대체하지 않는다 — 검증: 테스트 설계 단계에서 확정 [제안 후 승인]

### 5.5 화면 실패 처리
- EC-9: 파일 선택 시 검사에 실패하면(비 UTF-8, 확장자 불가, 200KiB 초과, 빈 본문이며 크기와 빈 본문은 선행 BOM 하나를 제거한 본문 기준이다) 안내가 표시되고 선택이 해제되며 "내용 보기"가 비활성화된다 — 검증: Playwright E2E(경우별 확인) [사용자 결정]
- EC-10: 제목이 비어 있거나 공백뿐이거나 trim 후 100자를 넘으면 요청을 보내지 않고 제목 옆에 안내가 표시된다 — 검증: Playwright E2E [사용자 결정]
- EC-11: 서버 오류는 폼 상단 `role="alert"`에 고정 문구로 표시되고 서버 `message`는 노출되지 않는다: 400 "입력값을 확인해 주세요", 403 "자료를 등록할 권한이 없습니다", 409 "이미 등록된 자료입니다"(상세 화면으로 이동하지 않음), 413 "파일이 너무 큽니다", 그 밖의 모든 오류(401, 404, 5xx, 네트워크) "저장하지 못했습니다. 다시 시도해 주세요" — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정, 409는 같은 제목·파일·본문을 두 번 등록) [사용자 결정]
- EC-12: 서버 요청이 실패해도 제목·선택한 파일·읽은 본문이 보존되고 같은 화면에서 다시 제출할 수 있다 — 검증: Playwright E2E(실패 응답 유발 방식은 테스트 설계 단계에서 확정) [사용자 결정]
- EC-13: 제출 중에는 입력과 등록 버튼이 비활성화된다 — 검증: Playwright E2E(응답 지연 유발 방식은 테스트 설계 단계에서 확정) [사용자 결정]
- EC-14: 파일을 선택하지 않고 제출하면 요청을 보내지 않고 파일 입력 옆에 안내가 표시된다 — 검증: Playwright E2E [사용자 결정]

## 미결정 사항
없음
