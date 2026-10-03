// 대상 스펙: docs/specs/review-write.md (검토 작성·조회, Review Plugin)
// 이 파일의 DoD-N·EC-N은 위 스펙의 번호이며, 다른 스펙(tests/documents.spec.ts, tests/document-register.spec.ts)의 번호와 다르다.
//
// mock 허용 경계는 계획 T-6에서 확정됐다: EC-14, EC-15(응답 실패 표본뿐이라 전부 mock), EC-16, EC-19, EC-20, EC-21, EC-25, EC-26.
// 나머지는 실제 API·DB를 쓴다. mock으로 통과한 case는 실제 서버가 그 상태·응답 형식을 내는지를 증명하지 않으며,
// 서버 쪽 검증은 api/tests/review_write.rs가 맡는다.
//
// 검토는 삭제할 수 없으므로 저장 case는 재실행 전에 `make reset-db`가 필요하다(계획 T-6 데이터 격리, 확정).
// 저장하는 (투자자, 기준) 슬롯은 desktop `business`, mobile `team`이고 `revenue`는 저장하지 않으며, 아무것도 저장하지 않는 `investor-peer`를 "모두 미작성" 확인에 쓴다(계획 T-6 데이터 격리, 확정).
// DoD-16만 DoD-10·11 case 뒤에 실행된다는 순서 의존이 있다(`workers:1`, 파일 순서). DoD-13은 저장 슬롯이 필요 없다. DoD-21·22는 저장하지 않은 `revenue` 기준을 쓴다.
// Plugin 경로는 `/`와 `/criteria/:id` 2종이고, 작성 폼은 목록 위 모달(저장된 기준의 수정은 review-update 스펙)이며 근거 미리보기는 경로 없는 중첩 모달이다.
import { expect, test, type Page, type Request, type Route, type TestInfo } from "@playwright/test";
import { COMPANY, INVESTOR, PASSWORD, login } from "./helpers/auth";

const PEER = "peer@lighthouse.test";
const WORKSPACE = "lighthouse";
const PLUGIN = `/workspace/${WORKSPACE}/plugins/review`;
const PLUGIN_LIST = new RegExp(`${PLUGIN}/?$`);
const PLUGIN_RPC = "**/api/plugins/rpc";
const DATAROOM_RPC = "**/api/dataroom/rpc";
const SERVER_MESSAGE = "서버 내부 메시지 SECRET";
/** 5xx 조회는 앱이 한 번 재시도하므로 오류 표시까지 기본 5초보다 여유를 둔다. */
const QUERY_ERROR_TIMEOUT = 15_000;

const CRITERIA = [
  {
    id: "business",
    title: "사업 이해",
    question: "사업 모델과 고객·시장에 관한 핵심 내용이 자료로 확인되는가?",
  },
  {
    id: "team",
    title: "팀 구성",
    question: "핵심 역할과 이를 수행할 팀의 역량이 자료로 확인되는가?",
  },
  { id: "revenue", title: "매출 현황", question: "매출 규모·기간·추세를 자료로 확인할 수 있는가?" },
];

/** 저장 슬롯: desktop은 `business`에 `확인함`, mobile은 `team`에 `추가 확인 필요`. `revenue`는 어디서도 저장하지 않는다. */
const SLOTS = {
  desktop: {
    criterionId: "business",
    title: "사업 이해",
    statusLabel: "확인함",
    docId: "doc-business",
    createdDate: "2026-09-03",
    docTitle: "회사 소개",
    fileName: "company-overview.md",
    content: "제조사 재고 관리 구독형 소프트웨어",
    comment: "desktop 검토 의견: 회사 소개 자료로 사업 모델을 확인했습니다.",
  },
  mobile: {
    criterionId: "team",
    title: "팀 구성",
    statusLabel: "추가 확인 필요",
    docId: "doc-team",
    createdDate: "2026-09-02",
    docTitle: "팀 소개",
    fileName: "team.md",
    content: "대표 제조업 운영 8년",
    comment: "mobile 검토 의견: 전담 영업 담당자가 없어 추가 확인이 필요합니다.",
  },
};
const slotOf = (testInfo: TestInfo) =>
  testInfo.project.name === "mobile" ? SLOTS.mobile : SLOTS.desktop;
const REVENUE = CRITERIA[2]!;

function unique(testInfo: TestInfo, label: string) {
  return `${label}-${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rpcBody(request: Request) {
  try {
    return request.postDataJSON() as { method?: string; pluginId?: string } | null;
  } catch {
    return null;
  }
}

/** 검토 Plugin 요청(`/api/plugins/rpc`의 review)과 본체 `documents.*` 요청의 method를 모은다. */
function watchReviewRequests(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const { pathname } = new URL(request.url());
    const body = rpcBody(request);
    if (typeof body?.method !== "string") return;
    if (pathname === "/api/plugins/rpc" && body.pluginId === "review") seen.push(body.method);
    else if (pathname === "/api/dataroom/rpc" && body.method.startsWith("documents."))
      seen.push(body.method);
  });
  return seen;
}

/** 지정한 method의 요청만 handle로 넘기고 나머지는 실제 서버로 보낸다. */
async function interceptMethod(
  page: Page,
  endpoint: string,
  method: string,
  handle: (route: Route) => Promise<void>,
) {
  await page.route(endpoint, async (route) => {
    if (rpcBody(route.request())?.method === method) await handle(route);
    else await route.continue();
  });
}

const failWith = (route: Route, status: number) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify({ kind: "mocked", message: SERVER_MESSAGE }),
  });

const succeedWith = (route: Route, result: unknown) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ result }) });

const documentItem = (
  id: string,
  title: string,
  fileName: string,
  status: "processing" | "failed",
) => ({
  id,
  title,
  fileName,
  status,
  createdAt: "2026-09-01T09:00:00Z",
});

// 라디오의 접근 가능한 이름에는 상태 설명이 함께 들어 있어 부분 일치로 찾는다.
const statusRadio = (page: Page, label: string) => page.getByRole("radio", { name: label });
// 중첩 모달에서는 아래 dialog가 inert라 접근성 트리에서 빠질 수 있으므로 includeHidden으로 이름을 찾는다.
const dialogNamed = (page: Page, name: string) =>
  page.getByRole("dialog", { name, exact: true, includeHidden: true });
const commentBox = (page: Page) => page.getByLabel("의견", { exact: true });
const evidenceBox = (page: Page, docTitle: string) =>
  page.getByRole("checkbox", { name: new RegExp(docTitle) });
const saveButton = (page: Page) => page.getByRole("button", { name: "저장", exact: true });
const criterionCard = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ hasText: title });

/** 기준 작성 폼을 직접 주소로 열고 폼이 그려질 때까지 기다린다. */
async function openForm(page: Page, criterionId: string) {
  await page.goto(`${PLUGIN}/criteria/${criterionId}`);
  await expect(commentBox(page)).toBeVisible();
}

async function fillForm(page: Page, statusLabel: string, comment: string, docTitle: string) {
  await statusRadio(page, statusLabel).check();
  await commentBox(page).fill(comment);
  await evidenceBox(page, docTitle).check();
}

test.describe("검토 작성 — 투자자가 기준별 검토를 근거 자료와 함께 저장하고 다시 읽으며 기업 담당자는 사용할 수 없다", () => {
  test.describe("기준 목록을 여는 경우", () => {
    /**
     * @spec DoD-2
     * @given 아무 검토도 저장하지 않은 투자자 계정으로 로그인했다
     * @when Plugin 첫 화면(/)을 연다
     * @then 기준 3개가 검토 질문과 함께 표시된다
     * @then 저장 전 기준에는 `미작성` 배지가 표시된다
     */
    test("[DoD-2] 첫 화면에 기준 3개와 검토 질문, 미작성 배지가 표시된다", async ({ page }) => {
      await login(page, PEER, PASSWORD);
      await page.goto(PLUGIN);

      for (const criterion of CRITERIA) {
        const card = criterionCard(page, criterion.title);
        await expect(card).toBeVisible();
        await expect(card).toContainText(criterion.question);
        await expect(card.getByText("미작성", { exact: true })).toBeVisible();
      }
      await expect(page.getByRole("listitem").filter({ hasText: "검토 질문" })).toHaveCount(3);
      await expect(page.getByText("미작성", { exact: true })).toHaveCount(3);
    });

    /**
     * @spec DoD-15
     * @given 아무 검토도 저장하지 않은 투자자 계정이 있고, 기업 담당자가 자료를 등록했다
     * @when 그 투자자가 Plugin 첫 화면(/)을 연다
     * @then 모든 기준 배지가 `미작성`으로 유지된다
     */
    test("[DoD-15] 기업 담당자가 자료를 등록해도 모든 기준 배지는 미작성이다", async ({
      page,
    }, testInfo) => {
      await login(page, COMPANY);
      const created = await page.request.post("/api/dataroom/rpc", {
        data: {
          workspaceId: WORKSPACE,
          method: "documents.create",
          params: {
            title: unique(testInfo, "검토무관등록"),
            fileName: `${unique(testInfo, "unrelated")}.md`,
            content: "기업 담당자가 등록한 자료 본문",
          },
        },
      });
      expect(created.ok()).toBeTruthy();

      await login(page, PEER, PASSWORD);
      await page.goto(PLUGIN);
      for (const criterion of CRITERIA) {
        await expect(
          criterionCard(page, criterion.title).getByText("미작성", { exact: true }),
        ).toBeVisible();
      }
      await expect(page.getByText("미작성", { exact: true })).toHaveCount(3);
      await expect(page.getByText("확인함", { exact: true })).toHaveCount(0);
      await expect(page.getByText("추가 확인 필요", { exact: true })).toHaveCount(0);
    });

    /**
     * @spec EC-14
     * @given 투자자로 로그인했고 기준 목록 조회 응답이 실패한다
     * @when Plugin 첫 화면(/)을 연다
     * @then `role="alert"` 오류와 재시도 버튼이 표시된다
     * @then `미작성` 배지나 빈 목록은 표시되지 않는다
     */
    test("[EC-14] 기준 목록 조회가 실패하면 오류와 재시도 버튼이 보이고 미작성이나 빈 목록은 보이지 않는다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      await interceptMethod(page, PLUGIN_RPC, "criteria.list", (route) => failWith(route, 500));
      await page.goto(PLUGIN);

      const alert = page.getByRole("alert");
      await expect(alert).toContainText("검토 기준을 불러오지 못했습니다.", {
        timeout: QUERY_ERROR_TIMEOUT,
      });
      await expect(alert.getByRole("button", { name: "재시도" })).toBeVisible();
      await expect(page.getByText("미작성", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("listitem")).toHaveCount(0);
    });

    /**
     * @spec EC-25
     * @given 투자자로 로그인했고 검토 목록(`reviews.list`) 조회 응답이 실패한다
     * @when Plugin 첫 화면(/)을 연다
     * @then `role="alert"` 오류와 재시도 버튼이 표시된다
     * @then `미작성` 배지로 표시되지 않는다
     */
    test("[EC-25] 검토 목록 조회가 실패하면 오류와 재시도 버튼이 보이고 미작성 배지는 보이지 않는다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      await interceptMethod(page, PLUGIN_RPC, "reviews.list", (route) => failWith(route, 500));
      await page.goto(PLUGIN);

      const alert = page.getByRole("alert");
      await expect(alert).toContainText("저장한 검토를 불러오지 못했습니다.", {
        timeout: QUERY_ERROR_TIMEOUT,
      });
      await expect(alert.getByRole("button", { name: "재시도" })).toBeVisible();
      await expect(page.getByText("미작성", { exact: true })).toHaveCount(0);
    });
  });

  test.describe("투자자가 검토를 저장하고 다시 읽는 경우", () => {
    /**
     * @spec DoD-10 DoD-11 DoD-24
     * @given 투자자가 미작성 기준을 열었고 목록 위에 작성 폼 모달(`/criteria/:id`)이 표시된다. 프로젝트별로 서로 다른 상태 하나씩(`satisfied`와 `needs_information`)을 저장하여 두 상태가 모두 검증된다
     * @when 상태·의견·`ready` 근거를 입력해 저장한다
     * @then 모달이 닫히고 `/`로 돌아간다
     * @then 첫 화면(/)의 해당 기준 배지가 저장한 상태(`확인함` 또는 `추가 확인 필요`)로 표시된다
     * @then 첫 화면(/)의 해당 기준 카드에 저장한 의견과 근거 자료 제목이 표시된다
     */
    test("[DoD-10][DoD-11][DoD-24] 저장하면 모달이 닫히고 첫 화면 카드에 배지·의견·근거가 표시된다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      await page.goto(PLUGIN);
      await page.getByRole("button", { name: `${slot.title} 검토 작성` }).click();

      // 목록 위에 작성 폼 모달이 열린다.
      await expect(page).toHaveURL(new RegExp(`${PLUGIN}/criteria/${slot.criterionId}$`));
      const formDialog = dialogNamed(page, `${slot.title} 검토 작성`);
      await expect(formDialog).toBeVisible();
      await expect(evidenceBox(page, slot.docTitle)).toBeEnabled();
      await fillForm(page, slot.statusLabel, slot.comment, slot.docTitle);
      await saveButton(page).click();

      // 저장하면 모달이 닫히고 `/`로 돌아온다.
      await expect(formDialog).toHaveCount(0);
      await expect(page).toHaveURL(PLUGIN_LIST);

      // 해당 기준 카드에 저장한 상태 배지·의견·근거 자료 제목이 표시된다.
      const card = criterionCard(page, slot.title);
      await expect(card.getByText(slot.statusLabel, { exact: true })).toBeVisible();
      await expect(card.getByText("미작성", { exact: true })).toHaveCount(0);
      await expect(card.getByText(slot.comment)).toBeVisible();
      await expect(card.getByText(slot.docTitle, { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: `${slot.title} 검토 수정` })).toBeVisible();
      await expect(page.getByRole("button", { name: `${slot.title} 검토 작성` })).toHaveCount(0);
    });

    /**
     * @spec DoD-13
     * @given 투자자가 미작성 기준의 작성 폼 모달을 열었고 선택할 수 있는 근거 자료 목록이 보인다
     * @when 근거 자료의 미리보기를 연다
     * @then 작성 폼 모달 위에 근거 미리보기 모달이 열린다
     * @then 자료 제목·파일명·상태·작성일·본문이 읽기 전용으로 표시된다
     */
    test("[DoD-13] 작성 폼 모달에서 근거 자료 미리보기를 열면 그 위에 미리보기 모달에 제목·파일명·상태·작성일·본문이 읽기 전용으로 보인다", async ({
      page,
    }) => {
      // 저장하지 않는다. 시드 ready 자료 `doc-business`(회사 소개)를 쓴다.
      const doc = SLOTS.desktop;
      await login(page, INVESTOR);
      await openForm(page, REVENUE.id);
      const formDialog = dialogNamed(page, `${REVENUE.title} 검토 작성`);
      await expect(evidenceBox(page, doc.docTitle)).toBeEnabled();
      await formDialog.getByRole("button", { name: `${doc.docTitle} 미리보기 열기` }).click();

      // 작성 폼 모달 위에 미리보기 모달이 열리고 경로는 바뀌지 않는다.
      const preview = dialogNamed(page, `${doc.docTitle} 미리보기`);
      await expect(preview).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${PLUGIN}/criteria/${REVENUE.id}$`));
      await expect(formDialog).toBeVisible();
      const article = preview.getByRole("article");
      await expect(article.locator("p").first()).toHaveText(doc.docTitle);
      await expect(preview.getByText(doc.fileName, { exact: true })).toBeVisible();
      await expect(preview.getByText("준비 완료", { exact: true })).toBeVisible();
      await expect(preview.getByText("작성일", { exact: true })).toBeVisible();
      await expect(preview.locator("time")).toHaveAttribute(
        "datetime",
        new RegExp(`^${doc.createdDate}`),
      );
      await expect(preview.getByText(doc.content)).toBeVisible();
      await expect(preview.getByRole("textbox")).toHaveCount(0);

      // 비목표: 다운로드·파일 크기·분류 태그는 없고 메타 항목은 파일명·상태·작성일뿐이다.
      await expect(preview.getByRole("button", { name: /다운로드/ })).toHaveCount(0);
      await expect(preview.getByRole("link", { name: /다운로드/ })).toHaveCount(0);
      await expect(preview.getByText("다운로드")).toHaveCount(0);
      const meta = preview.locator("dl");
      await expect(meta.locator("dt")).toHaveText(["파일명", "상태", "작성일"]);
      await expect(meta.locator("dd")).toHaveCount(3);
      await expect(meta).not.toContainText(/\d\s?(B|KB|MB|GB|KiB|MiB)\b/i);
      await expect(preview.getByRole("list")).toHaveCount(0);
    });

    /**
     * @spec DoD-16
     * @given 투자자(`investor`)가 DoD-10·DoD-11 case가 저장한 검토를 사용하고(같은 프로젝트의 같은 기준, 같은 투자자이며 같은 (투자자, 기준)에 다시 저장하지 않고 앞선 저장을 재사용한다. 재저장은 409), 다른 기준의 작성 폼에 저장하지 않은 입력을 남겨 둔 채, 같은 브라우저에서 페이지를 새로 불러오지 않는 앱 내 이동으로(로그아웃 버튼으로 로그아웃한 뒤 로그인 화면에서) 다른 투자자(`peer`)로 로그인했다
     * @when 다른 투자자가 Plugin에 들어간다
     * @then 이전 투자자의 검토가 보이지 않는다
     * @then 이전 투자자의 캐시·입력이 보이지 않는다
     */
    test("[DoD-16] 다른 투자자로 로그인하면 이전 투자자의 검토·캐시·입력이 보이지 않는다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      const leftover = "이전 투자자가 남긴 저장하지 않은 의견";
      await login(page, INVESTOR);
      await page.goto(PLUGIN);
      // 저장된 검토가 캐시에 올라오고, 다른 기준의 작성 폼에 저장하지 않은 입력이 남는다.
      await expect(
        criterionCard(page, slot.title).getByText(slot.statusLabel, { exact: true }),
      ).toBeVisible();
      await page.getByRole("button", { name: `${REVENUE.title} 검토 작성` }).click();
      await expect(commentBox(page)).toBeVisible();
      await statusRadio(page, "확인함").check();
      await commentBox(page).fill(leftover);

      // 페이지를 새로 불러오지 않고 화면 조작만으로 다른 투자자로 전환한다.
      // 작성 폼 모달이 열려 있으면 헤더가 inert라 실제 클릭이 막히므로, 입력을 남긴 채 같은 버튼의 click 핸들러만 실행한다.
      await page
        .getByRole("button", { name: "로그아웃", includeHidden: true })
        .dispatchEvent("click");
      await page.getByLabel("이메일").fill(PEER);
      await page.getByLabel("비밀번호").fill(PASSWORD);
      await page.getByRole("button", { name: "로그인", exact: true }).click();
      await page.getByRole("link", { name: "검토", exact: true }).click();

      await expect(page).toHaveURL(PLUGIN_LIST);
      for (const criterion of CRITERIA) {
        await expect(
          criterionCard(page, criterion.title).getByText("미작성", { exact: true }),
        ).toBeVisible();
      }
      await expect(page.getByText("미작성", { exact: true })).toHaveCount(3);
      await expect(page.getByText("확인함", { exact: true })).toHaveCount(0);
      await expect(page.getByText("추가 확인 필요", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: `${slot.title} 검토 작성` })).toBeVisible();
      await expect(page.getByRole("button", { name: `${slot.title} 검토 수정` })).toHaveCount(0);

      // 이전 투자자가 남긴 입력은 새 폼에 없고, 저장된 검토의 의견도 보이지 않는다.
      await page.getByRole("button", { name: `${REVENUE.title} 검토 작성` }).click();
      await expect(commentBox(page)).toHaveValue("");
      await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
      await expect(page.getByText(leftover)).toHaveCount(0);
      await expect(page.getByText(slot.comment)).toHaveCount(0);
    });
  });

  test.describe("작성 폼 모달에서 근거를 미리 보거나 저장 없이 닫는 경우", () => {
    /**
     * @spec DoD-21
     * @given 투자자가 아직 저장하지 않은 `revenue` 기준의 작성 폼 모달에서 상태·의견·근거를 입력했다(저장 슬롯을 소모하지 않는다)
     * @when 근거 미리보기 모달을 열었다 닫는다
     * @then 선택한 상태가 그대로 유지된다
     * @then 입력한 의견이 그대로 유지된다
     * @then 선택한 근거가 그대로 유지된다
     */
    test("[DoD-21] 근거 미리보기를 열었다 닫아도 작성 폼의 상태·의견·근거가 유지된다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const comment = "미리보기를 열었다 닫아도 유지되어야 하는 의견";
      await openForm(page, REVENUE.id);
      const formDialog = dialogNamed(page, `${REVENUE.title} 검토 작성`);
      await expect(evidenceBox(page, "회사 소개")).toBeEnabled();
      await fillForm(page, "추가 확인 필요", comment, "회사 소개");

      await formDialog.getByRole("button", { name: "회사 소개 미리보기 열기" }).click();
      const preview = dialogNamed(page, "회사 소개 미리보기");
      await expect(preview).toBeVisible();
      await expect(preview.getByText("제조사 재고 관리 구독형 소프트웨어")).toBeVisible();
      // 미리보기가 열려 있는 동안 아래 작성 폼 모달은 닫히지 않고 경로도 그대로다.
      await expect(formDialog).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${PLUGIN}/criteria/${REVENUE.id}$`));

      await preview.getByRole("button", { name: "닫기" }).click();
      await expect(preview).toHaveCount(0);
      await expect(formDialog).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${PLUGIN}/criteria/${REVENUE.id}$`));
      await expect(statusRadio(page, "추가 확인 필요")).toBeChecked();
      await expect(commentBox(page)).toHaveValue(comment);
      await expect(evidenceBox(page, "회사 소개")).toBeChecked();
    });

    /**
     * @spec DoD-22
     * @given 투자자가 아직 저장하지 않은 `revenue` 기준의 작성 폼 모달을 열어 입력했다(저장 슬롯을 소모하지 않는다). 표본은 닫기 방식 X 버튼, 취소, Esc, 바깥 클릭이며 하나씩 반복한다
     * @when 작성 폼 모달을 저장 없이 닫는다
     * @then 모달이 닫혀 `/`로 돌아간다
     * @then 입력은 폐기되어 같은 기준을 다시 열면 빈 폼이 표시된다
     */
    test("[DoD-22] 작성 폼 모달을 저장 없이 닫으면 `/`로 돌아가고 입력이 폐기되어 다시 열면 빈 폼이 보인다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const samples: { label: string; close: () => Promise<void> }[] = [
        {
          label: "X 버튼",
          close: () =>
            dialogNamed(page, `${REVENUE.title} 검토 작성`)
              .getByRole("button", { name: "닫기" })
              .click(),
        },
        {
          label: "취소",
          close: () =>
            dialogNamed(page, `${REVENUE.title} 검토 작성`)
              .getByRole("button", { name: "취소" })
              .click(),
        },
        { label: "Esc", close: () => page.keyboard.press("Escape") },
        // 뷰포트 모서리는 dialog 바깥의 backdrop 영역이다.
        { label: "바깥 클릭", close: () => page.mouse.click(2, 2) },
      ];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          await openForm(page, REVENUE.id);
          const formDialog = dialogNamed(page, `${REVENUE.title} 검토 작성`);
          await expect(evidenceBox(page, "회사 소개")).toBeEnabled();
          await fillForm(page, "확인함", `${sample.label}로 닫으면 폐기되는 의견`, "회사 소개");

          await sample.close();
          await expect(formDialog).toHaveCount(0);
          await expect(page).toHaveURL(PLUGIN_LIST);

          // 같은 기준을 다시 열면 빈 폼이다.
          await page.getByRole("button", { name: `${REVENUE.title} 검토 작성` }).click();
          await expect(formDialog).toBeVisible();
          await expect(page).toHaveURL(new RegExp(`${PLUGIN}/criteria/${REVENUE.id}$`));
          await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
          await expect(commentBox(page)).toHaveValue("");
          await expect(page.getByRole("checkbox", { checked: true })).toHaveCount(0);
        });
      }
    });
  });

  test.describe("근거 자료를 고르는 경우", () => {
    /**
     * @spec EC-17
     * @given 투자자가 미작성 기준의 작성 폼을 열었고, 시드에 `processing` 자료(`doc-pipeline`)와 `failed` 자료(`doc-revenue`)가 있다
     * @when 근거 선택 목록을 본다
     * @then `processing`·`failed` 자료가 목록에 표시된다
     * @then 그 자료들은 선택할 수 없다
     * @then 선택 불가 사유가 함께 표시된다
     */
    test("[EC-17] processing·failed 자료는 목록에 보이지만 선택할 수 없고 사유가 표시된다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      await openForm(page, REVENUE.id);

      const processing = evidenceBox(page, "고객 인터뷰");
      const failed = evidenceBox(page, "매출 자료");
      await expect(processing).toBeVisible();
      await expect(failed).toBeVisible();
      await expect(processing).toBeDisabled();
      await expect(failed).toBeDisabled();
      await expect(page.getByText("처리 중인 자료라 선택할 수 없습니다.")).toBeVisible();
      await expect(page.getByText("처리에 실패한 자료라 선택할 수 없습니다.")).toBeVisible();
      await expect(processing).toHaveAccessibleDescription("처리 중인 자료라 선택할 수 없습니다.");
      await expect(failed).toHaveAccessibleDescription("처리에 실패한 자료라 선택할 수 없습니다.");
    });

    /**
     * @spec EC-16
     * @given 투자자가 미작성 기준의 작성 폼을 열었고, `ready` 자료가 하나도 없다. 표본은 (a) 자료 목록 응답이 빈 목록이다, (b) 자료 목록 응답에 `processing`·`failed` 자료만 있고 `ready` 자료가 없다이며 하나씩 반복한다
     * @when 근거 선택 영역을 본다
     * @then 빈 안내가 표시된다
     * @then 저장할 수 없다
     */
    test("[EC-16] ready 자료가 없으면 빈 안내가 보이고 저장할 수 없다", async ({ page }) => {
      await login(page, INVESTOR);
      const samples = [
        { label: "빈 목록", documents: [] as ReturnType<typeof documentItem>[] },
        {
          label: "processing·failed만 있는 목록",
          documents: [
            documentItem("doc-pipeline", "고객 인터뷰", "customer-interviews.md", "processing"),
            documentItem("doc-revenue", "매출 자료", "revenue.txt", "failed"),
          ],
        },
      ];
      let current = samples[0]!;
      await interceptMethod(page, DATAROOM_RPC, "documents.list", (route) =>
        succeedWith(route, { documents: current.documents }),
      );

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          current = sample;
          await page.goto(`${PLUGIN}/criteria/${REVENUE.id}`);
          await expect(page.getByText("선택할 수 있는 준비 완료 자료가 없습니다.")).toBeVisible();
          await expect(saveButton(page)).toBeDisabled();
        });
      }
    });

    /**
     * @spec EC-26
     * @given 투자자가 미작성 기준의 작성 폼을 여는데 `documents.list` 조회 응답이 실패한다
     * @when 근거 선택 영역을 본다
     * @then `role="alert"` 오류와 재시도 버튼이 표시된다
     * @then 자료 없음 빈 안내로 표시되지 않는다
     */
    test("[EC-26] 자료 조회가 실패하면 오류와 재시도 버튼이 보이고 자료 없음 안내는 보이지 않는다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      await interceptMethod(page, DATAROOM_RPC, "documents.list", (route) => failWith(route, 500));
      await page.goto(`${PLUGIN}/criteria/${REVENUE.id}`);

      const alert = page.getByRole("alert");
      await expect(alert).toContainText("자료 목록을 불러오지 못했습니다.", {
        timeout: QUERY_ERROR_TIMEOUT,
      });
      await expect(alert.getByRole("button", { name: "재시도" })).toBeVisible();
      await expect(page.getByText("선택할 수 있는 준비 완료 자료가 없습니다.")).toHaveCount(0);
    });
  });

  test.describe("잘못된 입력으로 저장하는 경우", () => {
    /**
     * @spec EC-18
     * @given 투자자가 미작성 기준의 작성 폼을 열었다. 표본은 상태 미선택, 공백뿐인 의견, 근거 0건이며 하나씩 반복한다
     * @when 그 입력으로 저장한다
     * @then 요청을 보내지 않는다
     * @then 해당 입력 옆에 안내가 표시된다
     */
    test("[EC-18] 상태 미선택·공백 의견·근거 0건이면 요청 없이 입력 옆에 안내가 보인다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const seen = watchReviewRequests(page);
      const creates = () => seen.filter((method) => method === "reviews.create");

      await test.step("상태 미선택", async () => {
        await openForm(page, REVENUE.id);
        await expect(evidenceBox(page, "회사 소개")).toBeEnabled();
        await commentBox(page).fill("상태만 고르지 않은 의견");
        await evidenceBox(page, "회사 소개").check();
        await saveButton(page).click();
        await expect(page.getByText("상태를 선택해 주세요.")).toBeVisible();
        await expect(page.getByRole("group", { name: "상태" })).toHaveAccessibleDescription(
          "상태를 선택해 주세요.",
        );
      });

      await test.step("공백뿐인 의견", async () => {
        await openForm(page, REVENUE.id);
        await expect(evidenceBox(page, "회사 소개")).toBeEnabled();
        await statusRadio(page, "확인함").check();
        await commentBox(page).fill("     ");
        await evidenceBox(page, "회사 소개").check();
        await saveButton(page).click();
        await expect(page.getByText("의견을 입력해 주세요.")).toBeVisible();
        await expect(commentBox(page)).toHaveAccessibleDescription(/의견을 입력해 주세요\./);
      });

      await test.step("근거 0건", async () => {
        await openForm(page, REVENUE.id);
        await expect(evidenceBox(page, "회사 소개")).toBeEnabled();
        await statusRadio(page, "확인함").check();
        await commentBox(page).fill("근거를 고르지 않은 의견");
        await saveButton(page).click();
        await expect(page.getByText("근거 자료를 1개 이상 선택해 주세요.")).toBeVisible();
        await expect(evidenceBox(page, "회사 소개")).toHaveAccessibleDescription(
          "근거 자료를 1개 이상 선택해 주세요.",
        );
      });

      expect(creates()).toHaveLength(0);
    });
  });

  test.describe("저장 요청이 실패하거나 진행 중인 경우", () => {
    /**
     * @spec EC-19 EC-20
     * @given 투자자가 상태·의견·근거를 입력했고 저장 요청이 400, 403, 404, 409, 500으로 각각 실패하며(하나씩 반복) 응답 `message`에 서버 내부 문구가 들어 있다
     * @when 저장한다
     * @then 선택한 상태·입력한 의견·선택한 근거가 보존된다
     * @then 같은 화면에서 다시 저장할 수 있다
     * @then 서버 오류가 `role="alert"`에 상태 코드별 고정 문구로 표시된다
     * @then 서버 `message`는 노출되지 않는다
     */
    test("[EC-19][EC-20] 저장이 실패하면 입력이 보존되고 고정 문구만 표시되며 다시 저장할 수 있다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const comment = "실패해도 보존되어야 하는 의견";
      const samples = [
        {
          status: 400,
          text: "입력 내용이 올바르지 않습니다. 상태, 의견, 근거 자료를 확인해 주세요.",
        },
        { status: 403, text: "검토를 저장할 권한이 없습니다." },
        { status: 404, text: "검토 기준을 찾을 수 없습니다." },
        { status: 409, text: "이미 저장한 검토입니다." },
        { status: 500, text: "검토를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      ];
      let current = samples[0]!;
      await interceptMethod(page, PLUGIN_RPC, "reviews.create", (route) =>
        failWith(route, current.status),
      );

      await openForm(page, REVENUE.id);
      await expect(evidenceBox(page, "회사 소개")).toBeEnabled();
      await fillForm(page, "추가 확인 필요", comment, "회사 소개");

      for (const sample of samples) {
        await test.step(String(sample.status), async () => {
          current = sample;
          await saveButton(page).click();
          const alert = page.getByRole("alert");
          await expect(alert).toHaveText(sample.text);
          await expect(alert).not.toContainText(SERVER_MESSAGE);
          await expect(page.getByText(SERVER_MESSAGE)).toHaveCount(0);
          // 입력 보존과 재저장 가능 상태
          await expect(statusRadio(page, "추가 확인 필요")).toBeChecked();
          await expect(commentBox(page)).toHaveValue(comment);
          await expect(evidenceBox(page, "회사 소개")).toBeChecked();
          await expect(commentBox(page)).toBeEnabled();
          await expect(saveButton(page)).toBeEnabled();
          await expect(page).toHaveURL(new RegExp(`${PLUGIN}/criteria/${REVENUE.id}$`));
        });
      }
    });

    /**
     * @spec EC-21
     * @given 투자자가 상태·의견·근거를 입력했고 저장 응답이 지연된다
     * @when 저장한다
     * @then 저장 요청 중에는 입력이 비활성화된다
     * @then 저장 요청 중에는 저장 버튼이 비활성화된다
     */
    test("[EC-21] 저장 요청 중에는 입력과 저장 버튼이 비활성화된다", async ({ page }) => {
      await login(page, INVESTOR);
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await interceptMethod(page, PLUGIN_RPC, "reviews.create", async (route) => {
        await gate;
        await failWith(route, 500);
      });

      await openForm(page, REVENUE.id);
      await expect(evidenceBox(page, "회사 소개")).toBeEnabled();
      await fillForm(page, "확인함", "지연 중 비활성화를 확인하는 의견", "회사 소개");
      await saveButton(page).click();

      // 응답을 받기 전까지 입력과 저장 버튼이 모두 비활성화돼 있다.
      await expect(saveButton(page)).toBeDisabled();
      await expect(commentBox(page)).toBeDisabled();
      await expect(statusRadio(page, "확인함")).toBeDisabled();
      await expect(statusRadio(page, "추가 확인 필요")).toBeDisabled();
      await expect(evidenceBox(page, "회사 소개")).toBeDisabled();

      // 응답을 풀어 주면 다시 활성화된다.
      release();
      await expect(page.getByRole("alert")).toHaveText(
        "검토를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      await expect(saveButton(page)).toBeEnabled();
      await expect(commentBox(page)).toBeEnabled();
    });
  });

  test.describe("근거 자료 미리보기 모달을 여는 경우", () => {
    /**
     * @spec EC-15
     * @given 투자자가 근거 자료 미리보기 모달을 연다. 표본은 미리보기 조회 응답이 실패한다(404 포함)이다
     * @when 미리보기 모달을 연다
     * @then 모달 안에 오류 안내가 표시된다
     * @then 자료 없음·빈 본문으로 표시되지 않는다
     */
    test("[EC-15] 근거 자료 미리보기 조회가 실패하면 모달 안에 오류 안내가 보이고 자료 없음·빈 본문으로 보이지 않는다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const samples = [
        { status: 404, text: "근거 자료를 찾을 수 없습니다." },
        { status: 500, text: "근거 자료를 불러오지 못했습니다." },
      ];
      let current = samples[0]!;
      await interceptMethod(page, DATAROOM_RPC, "documents.get", (route) =>
        failWith(route, current.status),
      );

      await openForm(page, REVENUE.id);
      const formDialog = dialogNamed(page, `${REVENUE.title} 검토 작성`);
      await expect(evidenceBox(page, "회사 소개")).toBeEnabled();

      for (const sample of samples) {
        await test.step(String(sample.status), async () => {
          current = sample;
          await formDialog.getByRole("button", { name: "회사 소개 미리보기 열기" }).click();
          const preview = dialogNamed(page, "회사 소개 미리보기");
          const alert = preview.getByRole("alert");
          await expect(alert).toContainText(sample.text, { timeout: QUERY_ERROR_TIMEOUT });
          await expect(alert.getByRole("button", { name: "재시도" })).toBeVisible();
          await expect(preview.getByRole("article")).toHaveCount(0);
          await expect(preview.getByRole("heading", { name: "본문" })).toHaveCount(0);
          await preview.getByRole("button", { name: "닫기" }).click();
          await expect(preview).toHaveCount(0);
        });
      }
    });
  });

  test.describe("기업 담당자가 Plugin을 여는 경우", () => {
    /**
     * @spec DoD-14
     * @given 기업 담당자로 로그인했다
     * @when Plugin을 연다
     * @then 사용 불가 안내가 표시된다
     * @then `reviews.list`·`reviews.create`·`documents.*` 요청이 한 건도 나가지 않는다
     */
    test("[DoD-14] 기업 담당자에게는 사용 불가 안내가 보이고 검토·자료 요청이 나가지 않는다", async ({
      page,
    }) => {
      await login(page, COMPANY);
      const seen = watchReviewRequests(page);
      await page.goto(PLUGIN);

      await expect(page.getByText("검토 기능은 투자자만 사용할 수 있습니다.")).toBeVisible();
      // 기업 담당자는 criteria.list만 호출할 수 있다. 기준 목록이 그려질 때까지 기다려 요청이 모두 나간 뒤 센다.
      await expect(page.getByRole("heading", { level: 3, name: CRITERIA[0]!.title })).toBeVisible();
      await page.waitForLoadState("networkidle");
      expect(seen.filter((method) => method !== "criteria.list")).toEqual([]);
    });

    /**
     * @spec DoD-23
     * @given 기업 담당자로 로그인했다
     * @when Plugin 첫 화면을 연다
     * @then 사용 불가 안내 아래에 기준 3개가 번호·제목·검토 질문과 함께 읽기 전용으로 표시된다
     * @then 상태 배지·작성 버튼·상세 버튼·모달은 없다
     */
    test("[DoD-23] 기업 담당자에게는 사용 불가 안내 아래에 기준 3개가 읽기 전용으로 보인다", async ({
      page,
    }) => {
      await login(page, COMPANY);
      await page.goto(PLUGIN);

      await expect(page.getByText("검토 기능은 투자자만 사용할 수 있습니다.")).toBeVisible();
      const list = page.getByRole("region", { name: "검토 기준" });
      await expect(list.getByRole("listitem")).toHaveCount(3);
      for (const [index, criterion] of CRITERIA.entries()) {
        const item = list.getByRole("listitem").nth(index);
        await expect(
          item.getByText(String(index + 1).padStart(2, "0"), { exact: true }),
        ).toBeVisible();
        await expect(item.getByRole("heading", { level: 3, name: criterion.title })).toBeVisible();
        await expect(item).toContainText(criterion.question);
      }

      // 읽기 전용: 배지·작성/상세 버튼·모달이 없다.
      const main = page.getByRole("main");
      await expect(main.getByRole("button")).toHaveCount(0);
      await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
      for (const badge of ["미작성", "확인함", "추가 확인 필요"]) {
        await expect(main.getByText(badge, { exact: true })).toHaveCount(0);
      }
      await expect(main.getByText("검토 작성")).toHaveCount(0);
      await expect(main.getByText("검토 수정")).toHaveCount(0);
    });

    /**
     * @spec EC-28
     * @given 기업 담당자로 로그인했다
     * @when `/criteria/:id`로 직접 들어간다
     * @then 모달 없이 사용 불가 안내와 읽기 전용 기준 목록이 표시된다
     * @then `reviews.list`·`reviews.create`·`documents.*` 요청이 한 건도 나가지 않는다
     */
    test("[EC-28] 기업 담당자가 기준 경로로 직접 들어와도 모달 없이 사용 불가 안내와 기준 목록만 보이고 요청이 나가지 않는다", async ({
      page,
    }) => {
      await login(page, COMPANY);
      const seen = watchReviewRequests(page);
      await page.goto(`${PLUGIN}/criteria/business`);

      await expect(page.getByText("검토 기능은 투자자만 사용할 수 있습니다.")).toBeVisible();
      const list = page.getByRole("region", { name: "검토 기준" });
      await expect(list.getByRole("listitem")).toHaveCount(3);
      await expect(page.getByRole("dialog", { includeHidden: true })).toHaveCount(0);
      await expect(page.getByLabel("의견", { exact: true })).toHaveCount(0);
      await page.waitForLoadState("networkidle");
      expect(seen.filter((method) => method !== "criteria.list")).toEqual([]);
    });
  });

  test.describe("알 수 없는 경로를 여는 경우", () => {
    /**
     * @spec EC-27
     * @given 투자자로 로그인했다. 표본은 존재하지 않는 기준 id의 `/criteria/:id`와 Plugin 경로 2종(`/`, `/criteria/:id`) 밖의 경로(예: 옛 `/documents/:id`나 임의 경로)이며 하나씩 반복한다
     * @when 그 경로를 연다
     * @then "찾을 수 없음" 안내가 표시된다
     * @then 기준 목록(`/`)으로 가는 버튼이 표시된다
     */
    test("[EC-27] 없는 기준 id나 Plugin 경로 2종 밖을 열면 찾을 수 없음 안내와 목록으로 가는 버튼이 보인다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const samples = [
        { label: "존재하지 않는 기준 id", path: `${PLUGIN}/criteria/no-such-criterion` },
        { label: "옛 /documents/:id 경로", path: `${PLUGIN}/documents/doc-business` },
        { label: "임의 경로", path: `${PLUGIN}/unknown/path` },
      ];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          await page.goto(sample.path);
          await expect(page.getByRole("heading", { level: 1, name: "찾을 수 없음" })).toBeVisible();
          const back = page.getByRole("button", { name: "기준 목록으로" });
          await expect(back).toBeVisible();
          await back.click();
          await expect(page).toHaveURL(PLUGIN_LIST);
          await expect(page.getByRole("heading", { level: 1, name: "투자 검토" })).toBeVisible();
          for (const criterion of CRITERIA) {
            await expect(criterionCard(page, criterion.title)).toBeVisible();
          }
          await expect(page.getByRole("heading", { name: "찾을 수 없음" })).toHaveCount(0);
        });
      }
    });
  });
});
