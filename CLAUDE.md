# CLAUDE.md

기업이 투자 검토 자료를 등록하고, 투자자가 자료를 근거로 기준별 검토를 작성한다. React/Vite + Rust Axum/SQLx + PostgreSQL. 요구사항 원문은 `README.md`.

## 명령어 (가장 중요)

```
실행 : make dev # http://localhost:5178 (포트 충돌 시 WEB_PORT/DB_PORT)
계약 재생성 : make gen-ts-docker # Rust API 계약 변경 후 필수
검증 : make check-docker # gen-ts 일치 + lint + 타입 + 빌드 + cargo fmt/check
E2E : make test-e2e # tests/ , desktop + mobile
단일 E2E : pnpm exec playwright test tests/<파일> --project=desktop -g "<제목>"
DB 초기화 : make reset-db
```
테스트 계정(비밀번호 `dataroom`): `company@lighthouse.test`(기업), `investor@lighthouse.test`, `peer@lighthouse.test`(투자자).  

## 철칙

- `api-client/`는 생성물이다. 직접 수정하지 말고 Rust DTO/핸들러를 바꾼 뒤 `make gen-ts-docker`.
- 적용된 마이그레이션(`api/migrations/`)은 수정하지 말고 새 파일로 추가한다.
- 사용자 ID·역할은 서버가 확인한 `CurrentUser`만 신뢰한다. 쓰기 권한 없는 요청은 입력 검증 **전에** 403.
- SQL은 파라미터 바인딩. DB 실패를 메모리 저장소 등으로 대체하지 않는다.
- 검토 수정 + 근거 교체는 한 트랜잭션. 근거는 같은 workspace의 `ready` 자료 ID만 허용.
- Plugin 번들은 자기완결이어야 한다(외부 import 불가). React Query 키는 `scopedKey()`로 만든다.

## 지침 (판단이 필요한 것)

- 구조: 자료 관리는 본체(`web/`, `api/src/dataroom/`), 검토는 Review Plugin(`plugins/review/{ui,server}`). 서버 호출은 `host.call`로만 하고 Plugin이 본체 화면 구조를 알게 만들지 않는다. Plugin `navigate`는 Plugin 내부 경로만 가능하므로 근거 자료는 Plugin 안의 근거 미리보기 모달(경로 없음, 작성 폼·상세 모달 위에 겹침) + `target: "dataroom"` 조회로 보여준다(사용자 확정).
- 기업 사용자: 검토 조회는 빈 목록, 현황·저장은 403. 화면은 사용 불가 안내와 읽기 전용 검토 기준 목록(`criteria.list`)만 띄우고 `criteria.list` 외의 검토·자료 API는 호출하지 않는다.
- 현황: `추가 확인 필요`도 작성으로 센다. 작성 수/미작성 수와 별도로 확인함 수를 집계한다. 회사 합의·승인 상태가 아니다.
- 수정 이력은 두지 않는다(최신 내용 + 수정 시각). 동시 저장은 last-write-wins.
- 구현 순서: 자료 조회 → 등록 → 기준 조회 → 검토 작성 → 조회 → 수정 → 현황. 기능마다 테스트를 함께 작성한다.
- 로딩/오류/빈 결과를 구분하고, 실패 시 입력을 보존한다.  

## 제출 문서 (GitHub에 남길 것, 작업하며 기록)

- 실행·계정·DB 초기화 방법, 완료/미완료 범위, 작업 시간과 **별도의 환경 대응 시간**(예: `ui-kit` `:ro`로 web 컨테이너 실패, `gen-ts-docker`가 `api-client` `:ro`로 실패)을 분리해 기록한다.
- 서비스 이해가 바뀐 지점과 근거, 주요 설계 판단과 대안. Plugin·Gen-TS·API·DB·UI 연결은 실제 코드 경로로 설명한다.
- 테스트는 실행 명령·결과·한계를 적고, mock과 실제 API·DB 검증을 구분한다.
- AI 활용 사례 2~3개: 제공한 맥락, 실제 입력·응답 일부 또는 변경, 채택·수정 판단, 검증 근거.
- 평가 비중(Plugin·Gen-TS 35 / API·DB 설계 35 / UI·사용자 흐름 30)을 우선순위로 삼는다.

## 상세는 참조로

- 구현 전: `README.md`의 "필수 기능"(권한 표, 자료·검토·현황 규칙)과 "공통 완료 조건"
- 제출 문서·테스트 보고·평가 비중: `README.md`의 "진행·제출·평가" (위 "제출 문서" 요약이 낡으면 README 기준으로 갱신)
- Gen-TS 파이프라인: `scripts/gen-ts.sh`, `scripts/export-ts.sh`
- Plugin 계약: `plugin-sdk/index.ts`, 로더는 `web/src/plugins/`, 빌드는 `scripts/build-plugins.mjs`
- 서버 RPC 분기: `api/src/dataroom/mod.rs`, `api/src/plugins/mod.rs` (Review 서버는 `#[path]`로 포함)
- 개발 파이프라인·에이전트 라우팅: `.claude/skills/dev-pipeline/SKILL.md`, `.claude/agents/`
- 스타일은 여기 적지 않는다: prettier/eslint가 강제한다(`pnpm lint`).
- `ui-kit`의 `:ro` 제거 사유는 커밋 `051a54e` 참고(의도된 설정이면 해당 커밋만 되돌린다).