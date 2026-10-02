# 스펙: 자료 조회 화면·기능

- 상태: 완료
- 최종 갱신: 2026-10-02

## 1. 목표
기업 담당자와 투자자가 같은 데이터룸(workspace)의 자료를 목록, 제목 검색, 상세로 조회한다. 투자자는 이 자료를 근거로 검토를 작성한다. 샘플 시드 데이터가 있으므로 등록보다 조회를 먼저 구현한다. 범위는 DB 마이그레이션·시드(샘플 4건), `dataroom` RPC(목록/상세), 화면(목록·검색·상세)이다. [사용자 결정]

## 2. 비목표
- 자료 등록은 이번 범위에서 제외한다. [제안 후 승인]
- Review 플러그인의 근거 자료 읽기 전용 화면은 이번 범위에서 제외한다. [제안 후 승인]
- 자료 상태 자동 전환은 구현하지 않는다. [제안 후 승인]

## 3. 완료의 정의
- DoD-1: 투자자가 `documents.list`를 호출하면 시드 4건이 반환된다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- DoD-2: 기업 담당자가 `documents.list`를 호출해도 시드 4건이 반환된다 — 검증: Rust 통합 테스트(실 PostgreSQL) [제안 후 승인]
- DoD-3: 목록은 `created_at` 내림차순, 같은 시각이면 ID 오름차순으로 정렬된다 — 검증: Rust 통합 테스트(실 PostgreSQL, 같은 시각 시드 포함) [제안 후 승인]
- DoD-4: 검색어를 주면 제목에 대소문자 무시 부분 일치하는 자료만 반환된다 — 검증: Rust 통합 테스트 [사용자 결정]
- DoD-5: `documents.get`은 제목·파일명·상태·본문을 반환한다 — 검증: Rust 통합 테스트 [사용자 결정]
- DoD-6: 목록 화면(`/workspace/:id`)에 자료의 제목·파일명·상태·작성 시각(브라우저 로컬 포맷)이 표시된다 — 검증: Playwright E2E(desktop, mobile) [사용자 결정]
- DoD-7: 검색어를 입력하면 일치하는 자료만 목록에 남고 URL의 `?q=`에 반영된다 — 검증: Playwright E2E(desktop, mobile) [사용자 결정]
- DoD-8: 목록에서 자료를 선택하면 `/workspace/:id/documents/:documentId`로 이동해 제목·파일명·상태·본문이 표시된다 — 검증: Playwright E2E(desktop, mobile) [사용자 결정]
- DoD-9: 상세 주소에서 새로고침하거나 직접 진입해도 같은 상세가 표시된다 — 검증: Playwright E2E(desktop, mobile) [사용자 결정]
- DoD-10: `make check-docker`, `make test-api`(Makefile에 신설, DB를 띄운 뒤 Rust 통합 테스트 실행), `make test-e2e`가 통과한다 — 검증: 세 명령 실행 [사용자 결정]

## 4. 인터페이스 계약
- 데이터 스키마: `api/migrations/0003_*.sql`로 `documents` 테이블을 추가한다. 자료 ID는 TEXT이고 시드 ID는 샘플 label(`doc-business`, `doc-team`, `doc-revenue`, `doc-pipeline`)이며, `status`는 CHECK 제약(`ready`/`processing`/`failed`)을 둔다. [제안 후 승인]
- API 경로: `POST /api/dataroom/rpc`의 method 분기로 `documents.list`, `documents.get`을 제공한다. [제안 후 승인]
- 요청은 기존 형식 `{ "workspaceId": "string", "method": "string", "params": ... }`, 응답은 `{ "result": ... }`, 오류는 `{ "kind": "string", "message": "string" }`를 따른다. [제안 후 승인]
- `documents.list` 요청 `params`는 `{ "query": "string" }`이고 `query`는 생략할 수 있으며 `params`가 `null`이어도 전체 목록을 반환한다. [제안 후 승인]
- `documents.list` 응답 `result`는 `{ "documents": [ { "id": "string", "title": "string", "fileName": "string", "status": "ready|processing|failed", "createdAt": "string" } ] }`이고 항목에 본문은 없다. [제안 후 승인]
- `documents.get` 요청 `params`는 `{ "documentId": "string" }`이다. [제안 후 승인]
- `documents.get` 응답 `result`는 `{ "document": { "id": "string", "title": "string", "fileName": "string", "status": "ready|processing|failed", "content": "string", "createdAt": "string" } }`이다. [사용자 결정]
- 오류 응답은 400 `invalid_input`(검색어 trim 후 100자 초과), 401 `not_authenticated`(미인증), 403 `forbidden`(요청 `workspaceId` 불일치), 404 `not_found`(없는 자료 ID 또는 다른 workspace의 자료 ID), 500 `storage_error`(DB 오류)로 구분한다. [제안 후 승인]
- 작성 시각은 ISO 8601 UTC 문자열로 반환한다. [사용자 결정]
- 화면 URL은 목록 `/workspace/:id`, 상세 `/workspace/:id/documents/:documentId`이고, 검색어는 `?q=`로 유지한다. [사용자 결정]

## 5. 엣지 케이스와 실패 시나리오
- EC-1: 검색어가 공백뿐이면 전체 목록을 반환한다 — 검증: Rust 통합 테스트 [사용자 결정]
- EC-2: 검색어의 `%`·`_`·`\`는 와일드카드가 아닌 글자로 검색된다 — 검증: Rust 통합 테스트 [사용자 결정]
- EC-3: 검색어가 trim 후 100자(문자 수 기준)를 넘으면 400 `invalid_input`이 반환된다 — 검증: Rust 통합 테스트 [사용자 결정]
- EC-4: 요청 `workspaceId`가 사용자 workspace와 다르면 403이 반환된다 — 검증: Rust 통합 테스트 [제안 후 승인]
- EC-5: 없는 자료 ID로 `documents.get`을 호출하면 404가 반환된다 — 검증: Rust 통합 테스트 [사용자 결정]
- EC-6: 다른 workspace의 자료 ID로 `documents.get`을 호출하면 404가 반환된다 — 검증: Rust 통합 테스트 [사용자 결정]
- EC-7: `processing`/`failed` 자료도 `documents.get`으로 조회된다 — 검증: Rust 통합 테스트 [사용자 결정]
- EC-8: `ready`가 아닌 자료의 상세 화면에 "근거로 연결할 수 없음" 안내가 표시된다 — 검증: Playwright E2E(desktop, mobile) [사용자 결정]
- EC-9: 목록 조회가 실패하면 "자료 없음"이 아닌 오류가 표시되고 입력한 검색어가 보존된다 — 검증: Playwright E2E(mock으로 실패 응답) [제안 후 승인]
- EC-10: 검색 결과가 없으면 오류나 로딩이 아닌 빈 결과 문구가 표시된다 — 검증: Playwright E2E(desktop, mobile) [제안 후 승인]

## 미결정 사항
없음
