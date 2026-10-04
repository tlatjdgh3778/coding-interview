# 계획: 검토 현황 (Review Plugin)

- 상태: 승인
- 스펙: docs/specs/review-status.md
- 기준 코드: 작업 트리 (9fc8d8f 기반)
- 최종 갱신: 2026-10-04

## 1. 구현 전략

- 서버·`api-client/`·마이그레이션·`web/`·`plugin-sdk/`는 바꾸지 않는다. 집계는 `useCriteria`·`useReviews`(이미 `scopedKey`를 쓰는 기존 훅)의 결과로 계산하는 순수 함수이며, 저장 후 `reviews` invalidate가 이미 있어 별도 갱신 코드가 없다. 근거: `plugins/review/ui/hooks.ts`, `CLAUDE.md`.
- 요약 카드는 새 파일 `plugins/review/ui/summary.tsx`에 둔다. 마운트는 `CriteriaList`(투자자 경로)의 제목(h1)과 기준 목록 사이이고 `app.tsx`의 기업 분기와 `company-criteria.tsx`는 건드리지 않는다. 로딩 표시는 `isPending`일 때만 쓰고 `isFetching`은 쓰지 않는다(저장 직후 재조회 때 숫자가 깜박이지 않게). 근거: `plugins/review/ui/criteria-list.tsx`, `plugins/review/ui/app.tsx`.
- 요약 카드 오류 처리는 숫자를 렌더하지 않는 것으로 끝낸다. 기존 `criteria-list.tsx`의 `QueryError`가 `role="alert"` 하나를 이미 띄우고 기존 E2E가 strict로 그 하나를 단언하므로 카드는 alert·`ul/li`를 쓰지 않는다. 근거: `plugins/review/ui/criteria-list.tsx`, `tests/review-write.spec.ts`.
- 근거 칩은 `SavedSummary`의 li 텍스트 칩을 버튼으로 바꾼다. 미리보기 상태(`{id,label}|null`)는 `CriteriaList`가 소유하고 기존 `DocumentPreview`를 목록 레벨에서 렌더한다. `useDocuments`는 목록 레벨에서 한 번 호출해 칩에 로딩·오류 상태와 함께 내려준다. 접근 이름은 기존 `text.previewOpen` 패턴을 따르고, 칩 오류에는 `role="alert"`를 쓰지 않는다. 근거: `plugins/review/ui/criteria-list.tsx`, `plugins/review/ui/document-view.tsx`, `plugins/review/ui/evidence-picker.tsx`.
- `criterion-page.tsx`의 폼 내부 미리보기 흐름과 `document-view.tsx`·`modal.tsx`는 재사용만 하고 바꾸지 않는다. 근거: 스펙 §2 비목표.
- `text.ts`는 ko/en 키가 같아야(en 타입이 ko 키를 따른다) `pnpm typecheck`가 통과한다. 요약·안내·칩(불러오는 중, 제목 오류, 중립 미리보기 제목) 키를 T-1이 한 번에 추가해 T-2와 수정 파일이 겹치지 않게 한다. 근거: `plugins/review/ui/text.ts`.
- 숫자 4개 항목은 모바일에서 `grid-cols-2 sm:grid-cols-4` 같은 반응형으로 두고 칩 버튼은 기존 `min-h-11` 관례를 따른다. 근거: `plugins/review/ui/common.tsx`, `plugins/review/ui/criteria-list.tsx`.
- 요약 카드의 라벨(`미작성`·`확인함`·`추가 확인 필요`)이 기존 `tests/review-write.spec.ts`의 페이지 전체 텍스트 개수 단언과 충돌한다. 텍스트나 버튼이 나오는지만 확인하는 UI 렌더링 단언은 의미가 없다는 것이 사용자 판단이므로, 그런 단언은 제거하거나 동작·결과 단언(저장 요청 본문, 저장 후 상태, 요청 발생 여부 등)으로 바꾸는 Task를 둔다. 근거: `tests/review-write.spec.ts`.
- E2E는 스펙마다 파일을 나눈다. 신규 `tests/review-write.update.status.spec.ts`는 이름순으로 `review-write.update.spec.ts` 뒤에 실행되어 앞선 spec의 저장 슬롯을 재사용한다(`pnpm exec playwright test --list`로 확인). 기대 숫자는 하드코딩하지 않고 `reviews.list` API 값에서 계산한다(desktop·mobile이 같은 DB를 순차로 공유하고 앞선 spec이 상태를 바꾸기 때문). 근거: `playwright.config.ts`, `tests/review-write.update.spec.ts`.

## 2. Task

### T-1 — 요약 카드·집계·text 키

- 사이드: 프론트
- 상태: 완료
- 목적: 집계 함수와 요약 카드 컴포넌트를 만들고 요약·안내·칩에 필요한 ko/en 문구를 모두 추가한다.
- 선행: 없음
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-7, DoD-8, EC-1, EC-2, EC-6
- 수정 대상: `plugins/review/ui/summary.tsx`(신규) — 집계 함수와 요약 카드. `plugins/review/ui/text.ts` — 요약·안내·칩 관련 ko/en 키(T-2가 쓸 키 포함)
- 따라야 할 패턴: 집계는 기준과 매칭되는 검토만 센다. 로딩·오류·성공 분기와 `LoadingNotice` 재사용, `ul/li`·alert 미사용 — 근거: `plugins/review/ui/criteria-list.tsx`, `plugins/review/ui/common.tsx`
- 완료 조건: 연결 항목 충족. 카드는 `CriteriaList` 밖에서 마운트되지 않고 판정·완료 문구가 없으며, 오류일 때 숫자와 별도 오류 표시가 없다 — 검증: `pnpm lint`, `pnpm typecheck`, T-4의 E2E
- 실행 명령: `pnpm lint`, `pnpm typecheck`, `pnpm build:plugins`
- 수정 금지: `plugins/review/ui/criteria-list.tsx`, `app.tsx`, `company-criteria.tsx`, `criterion-page.tsx`, `document-view.tsx`, `hooks.ts`, `common.tsx`, `modal.tsx`, `evidence-picker.tsx`, `plugins/review/server/`, `api-client/`, `api/`, `tests/`

### T-2 — 목록 통합·근거 칩 버튼화·목록 레벨 미리보기

- 사이드: 프론트
- 상태: 완료
- 목적: 목록 화면에 요약 카드를 붙이고 근거 칩을 버튼으로 바꿔 목록 레벨에서 근거 미리보기 모달을 연다.
- 선행: T-1
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-5, DoD-6, DoD-8, EC-3, EC-4, EC-5
- 수정 대상: `plugins/review/ui/criteria-list.tsx` — 요약 카드 마운트, `SavedSummary` 칩 버튼화, 미리보기 상태 소유와 `DocumentPreview` 렌더, `documents.list` 로딩·오류 상태 전달
- 따라야 할 패턴: 미리보기 모달은 기존 `DocumentPreview`를 재사용하고 `/criteria/:id`로 이동하지 않는다. 칩 접근 이름은 기존 `text.previewOpen` 패턴 — 근거: `plugins/review/ui/document-view.tsx`, `plugins/review/ui/evidence-picker.tsx`
- 완료 조건: 연결 항목 충족. 칩이 button 요소이고 `documents.list` 실패·로딩 중에도 클릭해 열린다. 칩 오류에 `role="alert"`를 쓰지 않으며 `git diff --stat -- plugins/review/server api-client api/migrations`가 빈 출력이다 — 검증: `pnpm lint`, `pnpm typecheck`, `make check-docker`, T-4의 E2E
- 실행 명령: `pnpm lint`, `pnpm typecheck`, `pnpm build:plugins`, `make check-docker`
- 수정 금지: `plugins/review/ui/text.ts`, `summary.tsx`, `document-view.tsx`, `criterion-page.tsx`, `modal.tsx`, `app.tsx`, `plugins/review/server/`, `api-client/`, `api/`, `tests/`

### T-3 — 기존 E2E의 페이지 전체 텍스트 단언 정정

- 사이드: E2E
- 상태: 완료
- 목적: `tests/review-write.spec.ts`에서 텍스트·버튼이 보이는지, 페이지 전체에 몇 개 있는지만 확인하는 렌더링 단언을 제거하거나 동작·결과 단언으로 바꿔 요약 카드 라벨과의 충돌을 없앤다.
- 선행: T-2
- 연결 항목: DoD-1
- 수정 대상: `tests/review-write.spec.ts` — `미작성`·`확인함`·`추가 확인 필요`·`listitem` 개수처럼 렌더링 존재만 확인하는 단언을 제거하거나 동작·결과 단언으로 대체. case 전체가 렌더링 확인뿐이어서 골자(describe/it 조건 서술) 변경이 필요하면 임의로 지우지 않고 보고한다
- 따라야 할 패턴: 기존 `criterionCard` 헬퍼와 프로젝트별 슬롯 방식 — 근거: `tests/review-write.spec.ts`
- 완료 조건: 남은 단언은 동작·결과(요청, 저장 상태, 이동·모달 동작)를 확인하고 텍스트·요소 존재나 페이지 전체 개수에 의존하지 않는다. 요약 카드가 있어도 통과한다 — 검증: `pnpm exec playwright test tests/review-write.spec.ts --project=desktop`와 `--project=mobile`
- 실행 명령: `pnpm exec playwright test tests/review-write.spec.ts --project=desktop`, `pnpm exec playwright test tests/review-write.spec.ts --project=mobile`
- 수정 금지: 제품 코드, `tests/review-write.update.spec.ts`, 다른 spec, `tests/helpers/auth.ts`
- 테스트 파일·runner: `tests/review-write.spec.ts`, Playwright (`playwright.config.ts`의 desktop·mobile)
- mock 허용 경계: 기존 spec의 경계를 그대로 유지한다(변경 없음)
- 데이터 격리: 기존 슬롯 방식을 유지한다. 저장 case는 `make reset-db`가 필요한 기존 제약이 그대로다
- 실행 환경: `make test-e2e`와 같은 환경(`PLAYWRIGHT_BASE_URL` 또는 `http://127.0.0.1:5178`), `investor@lighthouse.test`·`peer@lighthouse.test`, 비밀번호 `dataroom`, 시드는 `make reset-db`

### T-4 — 검토 현황 E2E

- 사이드: E2E
- 상태: 완료
- 목적: 요약 카드 숫자·갱신·안내, 근거 칩 미리보기, 기업 사용자 요청, 조회 실패·로딩 처리를 화면에서 검증한다.
- 선행: T-2
- 연결 항목: DoD-1, DoD-2, DoD-3, DoD-5, DoD-6, DoD-7, EC-1, EC-2, EC-3, EC-4, EC-5, EC-6, EC-9
- 수정 대상: `tests/review-write.update.status.spec.ts`(신규). 로그인 상수가 부족하면 `tests/helpers/auth.ts`에 `PEER` 상수만 추가한다
- 따라야 할 패턴: 파일 상단 주석에 mock 경계를 적고, 로그인 헬퍼와 `beforeAll`의 create-if-missing(409 무시), `page.route`·`page.on("request")` 패턴을 따른다 — 근거: `tests/review-write.update.spec.ts`, `tests/helpers/auth.ts`
- 완료 조건: 연결 항목 각각을 단언하는 case가 있고 텍스트·버튼이 나오는지만 보는 단언은 쓰지 않는다. 기대 숫자는 `reviews.list` API 값에서 계산하고 `page.reload` 없이 갱신을 확인한다. `peer`는 저장하지 않는다. EC-9의 검증 방식은 테스트 설계 단계에서 확정한다 — 검증: `pnpm exec playwright test tests/review-write.update.status.spec.ts --project=desktop`와 `--project=mobile`
- 실행 명령: `pnpm exec playwright test tests/review-write.update.status.spec.ts --project=desktop`, `pnpm exec playwright test tests/review-write.update.status.spec.ts --project=mobile`, `pnpm exec playwright test --list`
- 수정 금지: 제품 코드, 기존 spec(`tests/review-write.spec.ts`, `tests/review-write.update.spec.ts` 등)
- 테스트 파일·runner: `tests/review-write.update.status.spec.ts`, Playwright
- mock 허용 경계: EC-1(`criteria.list`·`reviews.list` 실패), EC-2·EC-4(응답 지연), EC-3(`documents.list` 실패), EC-5(`documents.list` 실패, `documents.get` 실패, 조회 전 제목을 보기 위한 `documents.get` 응답 지연), EC-6(`reviews.list` 3건 응답)만 `page.route`로 mock한다. 실패·로딩·경계 상태를 실제 서버로 만들 수 없기 때문이다. DoD-1~DoD-7은 실제 API·DB를 쓴다
- 데이터 격리: `peer`(검토 0건)는 읽기 전용으로 DoD-1에 쓴다. `investor`는 desktop `business`, mobile `team` 저장 슬롯을 재사용하고 `revenue`는 저장하지 않는다. DoD-2는 `needs_information` 슬롯이 없으면 `beforeAll`에서 `reviews.update`로 만든다(검토는 삭제 불가). DoD-3은 같은 슬롯의 status를 UI로 뒤집어 전후 차이를 본다
- 실행 환경: `make test-e2e`와 같은 환경(`PLAYWRIGHT_BASE_URL` 또는 `http://127.0.0.1:5178`), `peer@lighthouse.test`·`investor@lighthouse.test`·`company@lighthouse.test`, 비밀번호 `dataroom`, 사전 데이터는 `make reset-db` 후 선행 spec 실행

## 3. 항목 coverage

- DoD-1: T-1, T-2, T-3, T-4
- DoD-2: T-1, T-2, T-4
- DoD-3: T-1, T-2, T-4
- DoD-5: T-2, T-4
- DoD-6: T-2, T-4
- DoD-7: T-1, T-4
- DoD-8: T-1, T-2
- EC-1: T-1, T-4
- EC-2: T-1, T-4
- EC-3: T-2, T-4
- EC-4: T-2, T-4
- EC-5: T-2, T-4
- EC-6: T-1, T-4
- EC-9: T-4

## 4. 실행 순서

- T-1 → T-2 순차(둘 다 `plugins/review/ui` 수정, T-2가 T-1의 컴포넌트·문구를 쓴다).
- T-3과 T-4는 T-2 이후 병렬 가능(서로 다른 파일: `tests/review-write.spec.ts` vs `tests/review-write.update.status.spec.ts`와 `tests/helpers/auth.ts`).
- 골격은 `test-design`에서 먼저 고정하고, 구현(T-1·T-2) 뒤에 T-3·T-4의 본문을 채운다.

## 5. 차단 사항

- 없음

## 테스트 설계 증거

- 상태: 동결 (2026-10-04)
- 기준 스펙: `docs/specs/review-status.md` (DoD-4, EC-7, EC-8은 빈 번호)
- 골자 digest: `20757a7d5d071559` (`check-skeleton.py --exempt DoD-8`, 항목 14개 중 case 연결 13개, 제외 1개, case 14개)
- 골격 파일: `tests/review-write.update.status.spec.ts` (T-4, case 14개 전부 `test.fixme`). T-3은 기존 `tests/review-write.spec.ts`의 본문(단언)만 고치는 Task라 골격을 새로 만들지 않고 기존 골자를 유지한다
- 기계 검사: 통과 (digest 동일, `--frozen`으로 재확인)
- reviewer: 새 `general-purpose` 5라운드. 1라운드 NEEDS-DECISION(Med 4건), 2·3·4라운드 NEEDS-FIX(Low만, 문구 정리), 5라운드 PASS(finding 없음). 자동 반복 한도(3회)를 넘겨 4·5라운드는 사용자 승인으로 진행했다. PASS는 같은 digest에서 기계 검사와 reviewer가 모두 통과한 결과다
- 사람 확정 (mock 경계): mock은 EC-1(`criteria.list`·`reviews.list` 실패), EC-2·EC-4(응답 지연), EC-3(`documents.list` 실패), EC-5(`documents.get` 실패, 조회 전 제목을 보기 위한 `documents.get` 응답 지연), EC-6(`reviews.list` 3건 응답)에만 쓴다. DoD-1·2·3·5·6·7, EC-9는 실제 API·DB를 쓴다. mock PASS는 실제 서버 장애·지연의 PASS가 아니다
- 사람 확정 (제외·삭제): DoD-8은 스펙의 검증이 `make check-docker`와 diff 확인이라 E2E 제외. DoD-4(안내 문구 표시)는 UI 렌더링 존재 확인뿐이라 스펙·계획·골격에서 삭제. EC-8은 네이티브 dialog가 보장하는 동작이라 삭제. EC-7은 non-ready 근거가 이 앱에서 생기지 않아 삭제
- 사람 확정 (검증 방식): EC-2·EC-4는 지연 중 상태에서 응답 후 상태로의 전이로 검증. EC-3·EC-4는 문구 일치가 아니라 raw ID 비노출과 대체 표시 중심. EC-9는 두 페이지, B가 실제 API로 저장, A에서 staleTime(15초) 경과 후 focus·visibilitychange로 재조회 요청 발생을 관찰, mock 없음
- 미검증·검증 불가: 스펙 §4 "기준과 매칭되는 검토만 센다"는 확인 항목이 없다(사용자 확정). DoD-3은 기존 슬롯 status만 뒤집어 미작성에서 작성으로 가는 전이(`작성 N` 증가)를 검증하지 못한다. EC-9는 last-write-wins 자체를 검증하지 않는다. mock case(EC-1~6)의 PASS는 실제 서버 PASS가 아니다. UI 렌더링 존재만 확인하는 DoD-4는 어떤 테스트도 덮지 않는다(삭제)
- 구현 단계 본문 확인 항목: EC-9의 `page.clock`이 실제 API 호출·세션에 주는 영향(desktop·mobile), DoD-2와 DoD-3·EC-9가 같은 슬롯을 바꾸므로 매 실행 전 `needs_information` 슬롯 보장, `beforeAll`의 근거 연결 검토 보장, DoD-7 "카드 없음"은 목록 렌더 완료 후 판정, EC-6 mock의 기준 ID가 실제 `criteria.list` 3건과 일치, DoD-1은 각 항목의 숫자 값 단언으로 채우기, `tests/helpers/auth.ts`의 `PEER` 상수 추가 여부
