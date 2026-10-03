// 대상 스펙: docs/specs/review-update.md (검토 수정, Review Plugin)
// 이 파일의 DoD-N·EC-N은 위 스펙의 번호이며, tests/review-write.spec.ts(docs/specs/review-write.md)의 번호와 다르다.
//
// mock 허용 경계(계획 docs/plans/review-update.md T-5): EC-9, EC-10, EC-18, EC-11, EC-13 및 EC-16의 대소문자 표본은
// `page.route`로 응답을 흉내 낸다. EC-6은 mock 없이 실제 서버·DB를 쓴다. 나머지도 실제 API·DB를 쓴다.
// mock으로 통과한 case는 실제 서버가 그 응답을 내는지를 증명하지 않는다.
//
// 데이터 격리(계획, 구현 단계에서 본문으로 작성): 검토는 삭제할 수 없고 초기화는 `make reset-db`뿐이다.
// 저장 슬롯은 desktop `business`, mobile `team`이며 이 파일은 기존 review-write.spec.ts 뒤(이름순)에 실행된다.
// 저장된 슬롯이 없으면 `beforeAll`에서 API로 만들고 409는 무시한다.
// `revenue`와 `investor-peer`는 저장하지 않는다.
//
// DoD-13은 기존 파일 tests/review-write.spec.ts의 `[DoD-10][DoD-11][DoD-24]` case(review-write.md의 DoD-10·11·24)가 맡는다(제외, 사용자 확정).
// EC-14는 기존 파일의 review-write.md DoD-14·DoD-23·EC-28이 맡는다(제외, 사용자 확정).
// 사람이 확정한 mock 대상: EC-9, EC-10·EC-18, EC-11, EC-13, EC-16 대소문자 표본.
// 유발 방식이 확정된 것: EC-9는 `reviews.update` 응답을 400·403·404·500 상태 코드와 네트워크 중단으로 대체(409 없음),
// EC-10·EC-18은 `reviews.update` 응답을 수동 지연, EC-13은 `reviews.list`를 지연(로딩)시키거나 500으로 대체,
// EC-11은 `page.clock`으로 staleTime(15초)을 넘기고 창 `focus`/`visibilitychange` 이벤트로 재조회를 일으키며
// `reviews.list` 재조회 응답만 편집 중인 값과 다른 값으로 바꾼다. 재조회 요청 발생은 본문이 관찰해 공허 통과를 막는다.
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
  type Route,
  type TestInfo,
} from "@playwright/test";
import { INVESTOR, PASSWORD, login } from "./helpers/auth";

const WORKSPACE = "lighthouse";
const PLUGIN = `/workspace/${WORKSPACE}/plugins/review`;
const PLUGIN_LIST = new RegExp(`${PLUGIN}/?$`);
const PLUGIN_RPC = "**/api/plugins/rpc";
const DATAROOM_RPC = "**/api/dataroom/rpc";
const SERVER_MESSAGE = "서버 내부 메시지 SECRET";
/** 5xx 조회는 앱이 한 번 재시도하므로 오류 표시까지 기본 5초보다 여유를 둔다. */
const QUERY_ERROR_TIMEOUT = 15_000;

type ReviewStatus = "satisfied" | "needs_information";
type ReviewRow = {
  id: string;
  criterionId: string;
  status: ReviewStatus;
  comment: string;
  evidenceDocumentIds: string[];
  createdAt: string;
  updatedAt: string;
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  satisfied: "확인함",
  needs_information: "추가 확인 필요",
};
const flip = (status: ReviewStatus): ReviewStatus =>
  status === "satisfied" ? "needs_information" : "satisfied";

/** 시드의 ready 자료. 근거로 고를 수 있는 것은 이 둘뿐이다. */
const READY = [
  { id: "doc-business", title: "회사 소개" },
  { id: "doc-team", title: "팀 소개" },
];

/** 저장 슬롯: desktop은 `business`, mobile은 `team`. `revenue`는 어디서도 저장하지 않는다. */
const SLOTS = {
  desktop: {
    criterionId: "business",
    title: "사업 이해",
    status: "satisfied" as ReviewStatus,
    comment: "desktop 수정 case 준비용 검토 의견",
  },
  mobile: {
    criterionId: "team",
    title: "팀 구성",
    status: "needs_information" as ReviewStatus,
    comment: "mobile 수정 case 준비용 검토 의견",
  },
};
const slotOf = (testInfo: TestInfo) =>
  testInfo.project.name === "mobile" ? SLOTS.mobile : SLOTS.desktop;
type Slot = ReturnType<typeof slotOf>;

function unique(testInfo: TestInfo, label: string) {
  return `${label}-${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function rpcBody(request: Request) {
  try {
    return request.postDataJSON() as {
      method?: string;
      pluginId?: string;
      params?: { evidenceDocumentIds?: string[] };
    } | null;
  } catch {
    return null;
  }
}

/** 검토 Plugin RPC 요청의 method를 요청 순서대로 모은다. */
function watchReviewMethods(page: Page) {
  const seen: string[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    if (new URL(request.url()).pathname !== "/api/plugins/rpc") return;
    const body = rpcBody(request);
    if (body?.pluginId === "review" && typeof body.method === "string") seen.push(body.method);
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

/** 실제 API로 검토 Plugin RPC를 호출한다. 세션 쿠키가 있는 request 컨텍스트를 넘긴다. */
function rpc(request: APIRequestContext, method: string, params: unknown) {
  return request.post("/api/plugins/rpc", {
    data: { pluginId: "review", workspaceId: WORKSPACE, method, params },
  });
}

async function listReviews(request: APIRequestContext): Promise<ReviewRow[]> {
  const response = await rpc(request, "reviews.list", null);
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { result: { reviews: ReviewRow[] } }).result.reviews;
}

/** 슬롯의 현재 저장 값. 앞선 case가 슬롯을 수정하므로 기대 값은 항상 여기서 읽는다. */
async function currentReview(request: APIRequestContext, slot: Slot): Promise<ReviewRow> {
  const found = (await listReviews(request)).find((item) => item.criterionId === slot.criterionId);
  expect(found, `${slot.criterionId} 슬롯에 저장된 검토가 있어야 한다`).toBeDefined();
  return found!;
}

/** 현재 근거와 다른 ready 자료 하나를 새 근거 집합으로 고른다. */
const otherEvidence = (current: string[]) =>
  current.length === 1 && current[0] === "doc-business" ? ["doc-team"] : ["doc-business"];

const titleOf = (id: string) => READY.find((doc) => doc.id === id)!.title;

// 라디오의 접근 가능한 이름에는 상태 설명이 함께 들어 있어 부분 일치로 찾는다.
const statusRadio = (page: Page, label: string) => page.getByRole("radio", { name: label });
// 중첩 모달에서는 아래 dialog가 inert라 접근성 트리에서 빠질 수 있으므로 includeHidden으로 이름을 찾는다.
const dialogNamed = (page: Page, name: string) =>
  page.getByRole("dialog", { name, exact: true, includeHidden: true });
const commentBox = (page: Page) => page.getByLabel("의견", { exact: true });
const searchBox = (page: Page) => page.getByLabel("자료 제목으로 검색");
const evidenceBox = (page: Page, docTitle: string) =>
  page.getByRole("checkbox", { name: new RegExp(docTitle) });
const saveButton = (page: Page) => page.getByRole("button", { name: "저장", exact: true });
const criterionCard = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ hasText: title });
const editButton = (page: Page | Locator, title: string) =>
  page.getByRole("button", { name: `${title} 검토 수정`, exact: true });
const editDialog = (page: Page, slot: Slot) => dialogNamed(page, `${slot.title} 검토 수정`);

/** 기준 목록에서 슬롯의 `검토 수정` 버튼으로 수정 모달을 열고 폼과 자료 목록이 그려질 때까지 기다린다. */
async function openEdit(page: Page, slot: Slot, readyTitle: string = READY[0]!.title) {
  await page.goto(PLUGIN);
  await editButton(page, slot.title).click();
  const dialog = editDialog(page, slot);
  await expect(dialog).toBeVisible();
  await expect(commentBox(page)).toBeVisible();
  await expect(evidenceBox(page, readyTitle)).toBeEnabled();
  return dialog;
}

/** 수정 모달의 결과·의견·근거(ready 자료 선택)를 지정한 값으로 맞춘다. */
async function applyEdit(
  page: Page,
  edit: { status: ReviewStatus; comment: string; evidence: string[] },
) {
  await statusRadio(page, STATUS_LABEL[edit.status]).check();
  await commentBox(page).fill(edit.comment);
  for (const doc of READY)
    await evidenceBox(page, doc.title).setChecked(edit.evidence.includes(doc.id));
}

async function expectFormValues(
  page: Page,
  values: { status: ReviewStatus; comment: string; evidence: string[] },
) {
  await expect(statusRadio(page, STATUS_LABEL[values.status])).toBeChecked();
  await expect(statusRadio(page, STATUS_LABEL[flip(values.status)])).not.toBeChecked();
  await expect(commentBox(page)).toHaveValue(values.comment);
  for (const doc of READY) {
    const box = evidenceBox(page, doc.title);
    if (values.evidence.includes(doc.id)) await expect(box).toBeChecked();
    else await expect(box).not.toBeChecked();
  }
}

const documentItem = (id: string, title: string, fileName: string) => ({
  id,
  title,
  fileName,
  status: "ready" as const,
  createdAt: "2026-09-01T09:00:00Z",
});

test.describe("검토 수정 — 투자자가 저장한 검토를 같은 검토로 수정한다", () => {
  // 슬롯에 저장된 검토가 없으면 API로 만든다. 기존 파일이 먼저 저장했다면 409이므로 그대로 쓴다.
  test.beforeAll(async ({ browser }, testInfo) => {
    const slot = slotOf(testInfo);
    const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
    try {
      const signIn = await context.request.post("/api/auth/login", {
        data: { email: INVESTOR, password: PASSWORD },
      });
      expect(signIn.ok()).toBeTruthy();
      const saved = (await listReviews(context.request)).some(
        (item) => item.criterionId === slot.criterionId,
      );
      if (saved) return;
      const created = await rpc(context.request, "reviews.create", {
        criterionId: slot.criterionId,
        status: slot.status,
        comment: slot.comment,
        evidenceDocumentIds: ["doc-business"],
      });
      expect([200, 409]).toContain(created.status());
    } finally {
      await context.close();
    }
  });

  test.describe("저장된 기준을 여는 경우", () => {
    /**
     * @spec DoD-10 DoD-14
     * @given 투자자가 저장한 검토가 있는 기준 카드가 보인다
     * @when `검토 수정` 버튼을 누른다
     * @then 읽기 전용 상세 모달 대신 `○○ 검토 수정` 모달이 열리고 저장된 결과·의견·근거가 채워져 있다
     */
    test("[DoD-10][DoD-14] 검토 수정 버튼을 누르면 값이 채워진 수정 모달이 열린다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      // 앞선 case가 슬롯을 수정하므로 기대 값은 현재 API 값에서 읽는다.
      const saved = await currentReview(page.request, slot);
      await page.goto(PLUGIN);
      await editButton(page, slot.title).click();

      await expect(editDialog(page, slot)).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${PLUGIN}/criteria/${slot.criterionId}$`));
      // 읽기 전용 상세 대신 편집 가능한 수정 모달이다.
      await expect(dialogNamed(page, `${slot.title} 검토 작성`)).toHaveCount(0);
      await expect(commentBox(page)).toBeEditable();
      await expect(evidenceBox(page, READY[0]!.title)).toBeEnabled();
      await expectFormValues(page, {
        status: saved.status,
        comment: saved.comment,
        evidence: saved.evidenceDocumentIds,
      });
    });
  });

  test.describe("수정 모달에서 값을 바꿔 저장하는 경우", () => {
    /**
     * @spec DoD-11 DoD-12
     * @given 저장된 기준의 수정 모달이 열려 있다
     * @when 결과·의견·근거를 바꿔 저장한다
     * @then 모달이 닫히고 `/`로 돌아간다
     * @then 해당 카드에 새 의견과 새 근거 칩이 표시된다
     * @then 표시된 `최종 수정` 시각이 수정 전보다 이후다
     */
    test("[DoD-11][DoD-12] 수정 저장 후 모달이 닫히고 카드에 새 내용과 갱신된 시각이 보인다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);
      const edit = {
        status: flip(saved.status),
        comment: unique(testInfo, "수정한 의견"),
        evidence: otherEvidence(saved.evidenceDocumentIds),
      };

      await page.goto(PLUGIN);
      const card = criterionCard(page, slot.title);
      const before = await card.locator("time").getAttribute("datetime");
      expect(before).toBe(saved.updatedAt);

      await editButton(page, slot.title).click();
      await expect(evidenceBox(page, READY[0]!.title)).toBeEnabled();
      await applyEdit(page, edit);
      // 서버 시각이 초 단위로 갱신되므로 같은 초에 두 번 저장되지 않게 1초 이상 띄운다(고정 대기는 이 한 곳뿐).
      await page.waitForTimeout(1100);
      await saveButton(page).click();

      await expect(editDialog(page, slot)).toHaveCount(0);
      await expect(page).toHaveURL(PLUGIN_LIST);
      await expect(card.getByText(edit.comment)).toBeVisible();
      await expect(card.getByText(STATUS_LABEL[edit.status], { exact: true })).toBeVisible();
      for (const doc of READY) {
        const chip = card.getByText(doc.title, { exact: true });
        if (edit.evidence.includes(doc.id)) await expect(chip).toBeVisible();
        else await expect(chip).toHaveCount(0);
      }
      const after = await card.locator("time").getAttribute("datetime");
      expect(Date.parse(after!)).toBeGreaterThan(Date.parse(before!));
    });
  });

  test.describe("수정 저장 요청이 실패하거나 진행 중인 경우", () => {
    /**
     * @spec EC-9
     * @given 수정 모달에서 값을 바꿨고 `reviews.update` 응답을 대체한다. 표본은 400·403·404·500 상태 코드와 네트워크 중단이며 하나씩 반복한다(409 없음)
     * @when 저장한다
     * @then 모달이 열린 채 오류가 표시된다
     * @then 결과·의견·근거 선택이 보존된다
     * @then 다시 저장할 수 있다
     */
    test("[EC-9] 저장 실패 시 모달이 열린 채 오류가 보이고 입력이 보존된다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const seen = watchReviewMethods(page);
      const updates = () => seen.filter((method) => method === "reviews.update").length;
      const saved = await currentReview(page.request, slot);
      const samples: { label: string; status: number | null; text: string }[] = [
        {
          label: "400",
          status: 400,
          text: "입력 내용이 올바르지 않습니다. 상태, 의견, 근거 자료를 확인해 주세요.",
        },
        { label: "403", status: 403, text: "검토를 저장할 권한이 없습니다." },
        { label: "404", status: 404, text: "검토 기준을 찾을 수 없습니다." },
        {
          label: "500",
          status: 500,
          text: "검토를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
        {
          label: "네트워크 중단",
          status: null,
          text: "검토를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        },
      ];
      let current = samples[0]!;
      await interceptMethod(page, PLUGIN_RPC, "reviews.update", (route) =>
        current.status === null ? route.abort("failed") : failWith(route, current.status),
      );

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          current = sample;
          const edit = {
            status: flip(saved.status),
            comment: unique(testInfo, `실패 표본 ${sample.label}`),
            evidence: otherEvidence(saved.evidenceDocumentIds),
          };
          const dialog = await openEdit(page, slot);
          await applyEdit(page, edit);
          const sent = updates();
          await saveButton(page).click();

          await expect(dialog.getByRole("alert")).toContainText(sample.text);
          await expect(page.getByText(SERVER_MESSAGE)).toHaveCount(0);
          await expect(dialog).toBeVisible();
          await expectFormValues(page, edit);

          // 다시 저장할 수 있다: 저장 버튼이 다시 활성화되고 두 번째 저장 요청이 나간다.
          await expect(saveButton(page)).toBeEnabled();
          await saveButton(page).click();
          await expect.poll(updates).toBe(sent + 2);
          await expect(dialog.getByRole("alert")).toContainText(sample.text);
          await expectFormValues(page, edit);
        });
      }
    });

    /**
     * @spec EC-10 EC-18
     * @given 수정 모달에서 값을 바꿨고 `reviews.update` 응답을 수동으로 지연시켜 저장 중 상태를 만들었다
     * @when 저장한다
     * @then 저장 요청 중에는 입력과 저장 버튼이 비활성화되어 이중 제출이 막힌다
     * @then 저장 요청 중에는 검색 입력도 비활성화된다
     */
    test("[EC-10][EC-18] 저장 요청 중에는 입력·저장 버튼·검색 입력이 비활성화된다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const seen = watchReviewMethods(page);
      const updates = () => seen.filter((method) => method === "reviews.update").length;
      const saved = await currentReview(page.request, slot);

      // 응답을 수동으로 붙잡아 저장 중 상태를 만든다. 풀어 줄 때는 실패 응답으로 닫아 슬롯을 바꾸지 않는다.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await interceptMethod(page, PLUGIN_RPC, "reviews.update", async (route) => {
        await gate;
        await failWith(route, 500);
      });

      const dialog = await openEdit(page, slot);
      await applyEdit(page, {
        status: flip(saved.status),
        comment: unique(testInfo, "저장 중 의견"),
        evidence: otherEvidence(saved.evidenceDocumentIds),
      });
      await saveButton(page).click();

      try {
        await expect(page.getByText("저장하고 있습니다.")).toBeVisible();
        await expect(saveButton(page)).toBeDisabled();
        await expect(commentBox(page)).toBeDisabled();
        for (const radio of await page.getByRole("radio").all()) await expect(radio).toBeDisabled();
        for (const box of await page.getByRole("checkbox").all()) await expect(box).toBeDisabled();
        await expect(searchBox(page)).toBeDisabled();
        // 이중 제출 시도: 비활성 버튼을 강제로 눌러도 요청이 늘지 않는다.
        await saveButton(page).click({ force: true });
      } finally {
        release();
      }
      await expect(dialog.getByRole("alert")).toBeVisible();
      expect(updates()).toBe(1);
    });
  });

  test.describe("수정 모달이 열려 있는 동안 검토 목록이 다시 조회되는 경우", () => {
    /**
     * @spec EC-11
     * @given 수정 모달에서 값을 바꾸는 중이다
     * @when 편집 중 `reviews.list`가 다시 조회되고 그 응답이 편집 중인 값과 다르다
     * @then 편집 중인 값은 덮어써지지 않는다
     */
    test("[EC-11] 재조회되어도 편집 중인 값이 유지된다", async ({ page }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);
      const seen = watchReviewMethods(page);
      const lists = () => seen.filter((method) => method === "reviews.list").length;
      const serverComment = unique(testInfo, "재조회로 바뀐 의견");

      // 재조회 응답만 편집 중인 값과 다른 값으로 바꾼다(결과는 원래 값, 의견·근거는 다른 값).
      let diverge = false;
      await interceptMethod(page, PLUGIN_RPC, "reviews.list", async (route) => {
        if (!diverge) return route.continue();
        const response = await route.fetch();
        const json = (await response.json()) as { result: { reviews: ReviewRow[] } };
        json.result.reviews = json.result.reviews.map((item) =>
          item.criterionId === slot.criterionId
            ? { ...item, comment: serverComment, evidenceDocumentIds: saved.evidenceDocumentIds }
            : item,
        );
        await route.fulfill({ response, json });
      });
      // staleTime(15초)을 넘기려 시계를 앞당긴다.
      await page.clock.install();

      const edit = {
        status: flip(saved.status),
        comment: unique(testInfo, "편집 중 의견"),
        evidence: otherEvidence(saved.evidenceDocumentIds),
      };
      await openEdit(page, slot);
      await applyEdit(page, edit);

      const before = lists();
      diverge = true;
      await page.clock.fastForward(20_000);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
      // 재조회가 실제로 일어나 모달 뒤 카드에 반영됐는지 확인해 공허 통과를 막는다.
      await expect.poll(lists).toBeGreaterThan(before);
      await expect(page.getByText(serverComment)).toBeAttached();

      await expectFormValues(page, edit);
    });
  });

  test.describe("잘못된 입력으로 저장하는 경우", () => {
    /**
     * @spec EC-12
     * @given 수정 모달이 열려 있다. 입력 표본은 공백뿐인 의견, 근거 0건, 2000자 초과 의견이며 하나씩 반복한다
     * @when 저장한다
     * @then 요청을 보내지 않는다 (`page.on("request")`로 요청 수 확인)
     * @then 해당 입력 옆에 안내가 표시된다
     */
    test("[EC-12] 잘못된 입력은 요청 없이 해당 입력 옆에 안내가 보인다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const seen = watchReviewMethods(page);
      const updates = () => seen.filter((method) => method === "reviews.update").length;
      const samples = [
        {
          label: "공백뿐인 의견",
          message: "의견을 입력해 주세요.",
          setup: () => commentBox(page).fill("   \n  "),
        },
        {
          label: "근거 0건",
          message: "근거 자료를 1개 이상 선택해 주세요.",
          setup: async () => {
            for (const doc of READY) await evidenceBox(page, doc.title).uncheck();
          },
        },
        {
          label: "2000자 초과",
          message: "의견은 2000자 이하로 입력해 주세요.",
          setup: () => commentBox(page).fill("가".repeat(2001)),
        },
      ];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          const dialog = await openEdit(page, slot);
          await sample.setup();
          await saveButton(page).click();
          await expect(dialog.getByText(sample.message)).toBeVisible();
          await expect(dialog).toBeVisible();
          expect(updates()).toBe(0);
        });
      }
    });
  });

  test.describe("검토 목록 조회가 로딩 중이거나 실패한 경우", () => {
    /**
     * @spec EC-13
     * @given `reviews.list` 응답을 지연시켜 로딩 중이거나 500으로 대체해 실패한 상태다. 표본은 로딩 중과 500 실패이며 하나씩 반복한다
     * @when 기준 목록을 본다
     * @then `검토 수정` 버튼으로 수정 모달을 열 수 없다
     */
    test("[EC-13] 목록이 로딩 중이거나 실패하면 수정 모달을 열 수 없다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const anyEditButton = page.getByRole("button", { name: /검토 수정$/ });
      const anyDialog = page.getByRole("dialog", { includeHidden: true });

      await test.step("로딩 중", async () => {
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        await page.route(PLUGIN_RPC, async (route) => {
          if (rpcBody(route.request())?.method === "reviews.list") await gate;
          await route.continue();
        });
        await page.goto(PLUGIN);
        try {
          await expect(page.getByRole("status")).toContainText("불러오고 있습니다.");
          await expect(anyEditButton).toHaveCount(0);
          await expect(anyDialog).toHaveCount(0);
        } finally {
          release();
        }
        // 조회가 끝나면 같은 버튼으로 열 수 있다(막힌 이유가 로딩 때문임을 확인한다).
        await editButton(page, slot.title).click();
        await expect(editDialog(page, slot)).toBeVisible();
        await page.unroute(PLUGIN_RPC);
      });

      await test.step("500 실패", async () => {
        await interceptMethod(page, PLUGIN_RPC, "reviews.list", (route) => failWith(route, 500));
        await page.goto(PLUGIN);
        await expect(page.getByRole("alert")).toContainText("저장한 검토를 불러오지 못했습니다.", {
          timeout: QUERY_ERROR_TIMEOUT,
        });
        await expect(anyEditButton).toHaveCount(0);
        await expect(anyDialog).toHaveCount(0);
      });
    });
  });

  test.describe("로그인하지 않고 검토 수정을 요청하는 경우", () => {
    /**
     * @spec EC-6
     * @given 로그인하지 않은(쿠키 없는) 요청이다
     * @when `reviews.update`를 `POST /api/plugins/rpc`로 호출한다
     * @then 401이 반환된다
     */
    test("[EC-6] 로그인하지 않은 reviews.update 요청은 401로 거부된다", async ({
      playwright,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      // 쿠키가 없는 새 request 컨텍스트로 호출한다(실제 서버·DB, mock 없음).
      const anonymous = await playwright.request.newContext({
        baseURL: testInfo.project.use.baseURL,
      });
      try {
        const response = await rpc(anonymous, "reviews.update", {
          criterionId: slot.criterionId,
          status: "satisfied",
          comment: "로그인 없이 보낸 수정 요청",
          evidenceDocumentIds: ["doc-business"],
        });
        expect(response.status()).toBe(401);
      } finally {
        await anonymous.dispose();
      }
    });
  });

  test.describe("수정 모달을 저장 없이 닫는 경우", () => {
    /**
     * @spec EC-17
     * @given 수정 모달에서 값을 바꿨다. 닫기 방식 표본은 X, 취소, Esc, 바깥 클릭이며 하나씩 반복한다
     * @when 저장하지 않고 닫는다
     * @then 저장하지 않고 `/`로 돌아간다
     * @then 입력은 폐기되고 미저장 경고는 표시되지 않는다
     */
    test("[EC-17] 어느 방식으로 닫아도 저장 없이 /로 돌아가고 경고가 없다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const seen = watchReviewMethods(page);
      const browserDialogs: string[] = [];
      page.on("dialog", (dialog) => {
        browserDialogs.push(dialog.message());
        void dialog.dismiss();
      });
      const saved = await currentReview(page.request, slot);
      const samples: { label: string; close: () => Promise<void> }[] = [
        {
          label: "X 버튼",
          close: () => editDialog(page, slot).getByRole("button", { name: "닫기" }).click(),
        },
        {
          label: "취소",
          close: () => editDialog(page, slot).getByRole("button", { name: "취소" }).click(),
        },
        { label: "Esc", close: () => page.keyboard.press("Escape") },
        // 뷰포트 모서리는 dialog 바깥의 backdrop 영역이다.
        { label: "바깥 클릭", close: () => page.mouse.click(2, 2) },
      ];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          const dialog = await openEdit(page, slot);
          await applyEdit(page, {
            status: flip(saved.status),
            comment: unique(testInfo, `${sample.label}로 닫으면 폐기되는 의견`),
            evidence: otherEvidence(saved.evidenceDocumentIds),
          });

          await sample.close();
          await expect(dialog).toHaveCount(0);
          await expect(page).toHaveURL(PLUGIN_LIST);
          await expect(page.getByRole("alert")).toHaveCount(0);
          await expect(page.getByRole("alertdialog", { includeHidden: true })).toHaveCount(0);
          expect(browserDialogs).toEqual([]);
          expect(seen.filter((method) => method === "reviews.update")).toEqual([]);

          // 입력은 폐기되어 다시 열면 저장된 값이 보인다.
          await editButton(page, slot.title).click();
          await expect(editDialog(page, slot)).toBeVisible();
          await expectFormValues(page, {
            status: saved.status,
            comment: saved.comment,
            evidence: saved.evidenceDocumentIds,
          });
        });
      }
    });
  });

  test.describe("근거 자료를 제목으로 검색하는 경우", () => {
    /**
     * @spec DoD-15 EC-16
     * @given 수정 모달의 근거 목록에 여러 자료가 있다. 입력 표본은 일부 자료 제목과 앞뒤 공백이 붙은 자료 제목이며 하나씩 반복한다
     * @when `자료 제목으로 검색`에 표본을 입력한다
     * @then 제목이 일치하는 자료만 목록에 표시된다
     * @then 앞뒤 공백은 무시되어 공백 없이 입력한 것과 같은 자료가 표시된다
     */
    test("[DoD-15][EC-16] 제목이 일치하는 자료만 목록에 보인다", async ({ page }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      await openEdit(page, slot);
      // 표본: 일부 자료 제목, 앞뒤 공백이 붙은 자료 제목. 공백 표본은 공백 없는 제목과 같은 결과여야 한다.
      const samples = [
        { label: "일부 제목", query: "회사", shown: "회사 소개" },
        { label: "앞뒤 공백이 붙은 제목", query: "  회사 소개  ", shown: "회사 소개" },
        { label: "앞뒤 공백이 붙은 다른 제목", query: "\t팀 소개 ", shown: "팀 소개" },
      ];
      const allTitles = ["회사 소개", "팀 소개", "고객 인터뷰", "매출 자료"];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          await searchBox(page).fill(sample.query);
          await expect(evidenceBox(page, sample.shown)).toBeVisible();
          for (const title of allTitles.filter((item) => item !== sample.shown))
            await expect(evidenceBox(page, title)).toHaveCount(0);
          await expect(page.getByRole("checkbox")).toHaveCount(1);
        });
      }
    });

    /**
     * @spec DoD-16 EC-15
     * @given 근거 자료를 선택한 상태다
     * @when 이미 선택한 자료를 가리는 검색어를 입력하고, 이어서 결과가 없는 검색어를 입력한 뒤 저장한다
     * @then 두 상태 모두에서 선택한 자료의 선택 상태가 유지된다
     * @then 저장 요청 본문에 가려진 자료가 포함된다 (요청 본문 확인)
     */
    test("[DoD-16][EC-15] 검색으로 가려진 자료도 선택이 유지되어 저장 요청에 포함된다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);

      let body: string[] | undefined;
      await interceptMethod(page, PLUGIN_RPC, "reviews.update", async (route) => {
        body = rpcBody(route.request())?.params?.evidenceDocumentIds;
        await route.continue();
      });

      const dialog = await openEdit(page, slot);
      // 선택한 근거는 `회사 소개` 하나다.
      await applyEdit(page, {
        status: saved.status,
        comment: saved.comment,
        evidence: ["doc-business"],
      });
      await expect(dialog.getByText("1개 선택")).toBeVisible();

      // 1) 선택한 자료를 가리는 검색어
      await searchBox(page).fill("팀");
      await expect(evidenceBox(page, "회사 소개")).toHaveCount(0);
      await expect(evidenceBox(page, "팀 소개")).toBeVisible();
      await expect(dialog.getByText("1개 선택")).toBeVisible();

      // 2) 결과가 없는 검색어
      await searchBox(page).fill("일치하는자료없음검색어");
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(dialog.getByText("일치하는 자료가 없습니다")).toBeVisible();
      await expect(dialog.getByText("1개 선택")).toBeVisible();

      await saveButton(page).click();
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(PLUGIN_LIST);
      expect(body).toEqual(["doc-business"]);
      expect((await currentReview(page.request, slot)).evidenceDocumentIds).toEqual([
        "doc-business",
      ]);
    });

    /**
     * @spec EC-16 EC-21
     * @given 근거 목록이 있다. 자료 제목에는 없고 파일명에만 있는 단어(예: 시드 자료의 파일명 company-overview.md의 'overview'처럼 제목에 없는 단어)를 검색어로 쓴다
     * @when `자료 제목으로 검색`에 그 검색어를 입력한다
     * @then 목록에 자료가 없다
     * @then `일치하는 자료가 없습니다` 안내가 표시된다
     */
    test("[EC-16][EC-21] 제목에 없는 파일명 단어는 검색되지 않고 일치하는 자료가 없다는 안내가 보인다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      await openEdit(page, slot);

      // 'overview'는 파일명(company-overview.md)에만 있고 어떤 제목에도 없다.
      await searchBox(page).fill("overview");
      await expect(page.getByRole("checkbox")).toHaveCount(0);
      await expect(page.getByText("일치하는 자료가 없습니다")).toBeVisible();
    });

    /**
     * @spec EC-16
     * @given mock으로 흉내 낸 영문 제목이 대소문자가 섞여 있다. 검색어는 제목과 다른 대소문자(소문자 검색어→대문자 포함 제목, 대문자 검색어→소문자 포함 제목 양방향)로 입력하며 하나씩 반복한다
     * @when `자료 제목으로 검색`에 표본을 입력한다
     * @then 대소문자를 구분하지 않고 제목이 일치하는 자료가 표시된다
     */
    test("[EC-16] 검색은 대소문자를 구분하지 않는다 (documents.list mock)", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      // 자료 목록 응답만 대소문자가 섞인 영문 제목으로 대체한다.
      await interceptMethod(page, DATAROOM_RPC, "documents.list", (route) =>
        succeedWith(route, {
          documents: [
            documentItem("doc-business", "Annual REPORT 2026", "annual.md"),
            documentItem("doc-team", "team handbook", "handbook.md"),
          ],
        }),
      );
      await openEdit(page, slot, "Annual REPORT 2026");
      const samples = [
        {
          label: "소문자 검색어 → 대문자 포함 제목",
          query: "annual report",
          shown: "Annual REPORT 2026",
          hidden: "team handbook",
        },
        {
          label: "대문자 검색어 → 소문자 포함 제목",
          query: "TEAM HANDBOOK",
          shown: "team handbook",
          hidden: "Annual REPORT 2026",
        },
      ];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          await searchBox(page).fill(sample.query);
          await expect(evidenceBox(page, sample.shown)).toBeVisible();
          await expect(evidenceBox(page, sample.hidden)).toHaveCount(0);
        });
      }
    });

    /**
     * @spec EC-19
     * @given 검색어를 입력했다
     * @when 근거 미리보기 모달을 열었다 닫은 뒤, 수정 모달을 닫았다 다시 연다
     * @then 미리보기 모달을 열었다 닫아도 검색어는 유지된다
     * @then 수정 모달을 닫았다 다시 열면 검색어가 초기화된다
     */
    test("[EC-19] 검색어는 미리보기 후에도 유지되고 모달을 다시 열면 초기화된다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const formDialog = await openEdit(page, slot);
      // 자료 수는 다른 spec이 등록한 자료로 늘어나므로 검색 전 개수를 기억해 둔다.
      const allCount = await page.getByRole("checkbox").count();
      expect(allCount).toBeGreaterThanOrEqual(4);
      await searchBox(page).fill("회사");
      await expect(page.getByRole("checkbox")).toHaveCount(1);

      // 근거 미리보기 모달을 열었다 닫아도 검색어가 유지된다.
      await formDialog.getByRole("button", { name: "회사 소개 미리보기 열기" }).click();
      const preview = dialogNamed(page, "회사 소개 미리보기");
      await expect(preview.getByRole("article")).toBeVisible();
      await preview.getByRole("button", { name: "닫기" }).click();
      await expect(preview).toHaveCount(0);
      await expect(searchBox(page)).toHaveValue("회사");
      await expect(page.getByRole("checkbox")).toHaveCount(1);

      // 수정 모달을 닫았다 다시 열면 검색어가 초기화된다.
      await formDialog.getByRole("button", { name: "닫기" }).click();
      await expect(formDialog).toHaveCount(0);
      await expect(page).toHaveURL(PLUGIN_LIST);
      await editButton(page, slot.title).click();
      await expect(editDialog(page, slot)).toBeVisible();
      await expect(searchBox(page)).toHaveValue("");
      await expect(page.getByRole("checkbox")).toHaveCount(allCount);
    });

    /**
     * @spec EC-20
     * @given 시드 `processing`·`failed` 자료(`doc-pipeline`·`doc-revenue`)가 있다
     * @when 그 자료 제목과 일치하는 검색어를 입력한다
     * @then 해당 자료가 목록에 표시된다
     * @then 선택 불가 표시는 유지된다
     */
    test("[EC-20] processing·failed 자료도 검색되며 선택 불가 표시가 유지된다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      await openEdit(page, slot);
      const samples = [
        {
          label: "processing",
          query: "고객",
          title: "고객 인터뷰",
          reason: "처리 중인 자료라 선택할 수 없습니다.",
        },
        {
          label: "failed",
          query: "매출",
          title: "매출 자료",
          reason: "처리에 실패한 자료라 선택할 수 없습니다.",
        },
      ];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          await searchBox(page).fill(sample.query);
          const box = evidenceBox(page, sample.title);
          await expect(box).toBeVisible();
          await expect(box).toBeDisabled();
          await expect(page.getByText(sample.reason)).toBeVisible();
          await expect(box).toHaveAccessibleDescription(sample.reason);
          await expect(page.getByRole("checkbox")).toHaveCount(1);
        });
      }
    });
  });
});
