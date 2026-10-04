// 대상 스펙: docs/specs/review-status.md (검토 현황, Review Plugin)
// 이 파일의 DoD-N·EC-N은 위 스펙의 번호이며, 다른 spec 파일의 번호와 다르다.
// 본문 구현 완료(살 모드). 태그와 case 서술은 골격 그대로다.
//
// mock 허용 경계(계획 docs/plans/review-status.md T-4): EC-1(`criteria.list`·`reviews.list` 실패),
// EC-2·EC-4(응답 지연), EC-3(`documents.list` 실패),
// EC-5(`documents.list` 실패, `documents.get` 실패, 조회 전 제목을 보기 위한 `documents.get` 응답 지연),
// EC-6(`reviews.list` 3건 응답)만 `page.route`로 mock한다. 실패·로딩·경계 상태를 실제 서버로 만들 수 없기 때문이다.
// DoD-1~DoD-7은 실제 API·DB를 쓴다.
// mock으로 통과한 case는 실제 서버가 그 응답을 내는지, 실제 서버 장애에서도 같은 화면이 나오는지를 증명하지 않는다.
// (mock PASS는 실제 서버 PASS가 아니다.)
//
// 데이터 격리(계획): 검토는 삭제할 수 없고 초기화는 `make reset-db`뿐이다.
// - `peer`(검토 0건)는 읽기 전용으로 DoD-1에만 쓰며 저장하지 않는다.
// - `investor`는 이 파일이 이름순으로 review-write.update.spec.ts 뒤에 실행되어 앞선 spec의 저장 슬롯
//   (desktop `business`, mobile `team`)을 재사용하고, `revenue`는 저장하지 않는다.
// - `needs_information` 슬롯이 없으면 `beforeAll`에서 `reviews.update`로 만든다(409 무시).
// - 기대 숫자는 하드코딩하지 않고 `reviews.list` API 값에서 계산한다(desktop·mobile이 같은 DB를 순차로 공유하고
//   앞선 spec이 상태를 바꾸기 때문).
// - 갱신 확인은 `page.reload` 없이 한다.
//
// 검증 방식(헤더에 모은 메타 정보):
// - DoD-8: make check-docker와 diff로 검증, E2E 제외(사용자 확정).
// - DoD-2: 기대 숫자는 `reviews.list` API 값에서 계산한다.
// - DoD-6: 모달을 열기 전 현황 숫자를 기억해 두었다가 닫은 뒤와 비교한다.
// - DoD-7: 요청 발생 여부는 `page.on("request")`로 기록해 확인한다.
// - DoD-3: 저장 전후 현황 숫자는 `reviews.list` API 값에서 계산한 값과 비교한다.
// - EC-2·EC-4: 사용자 확정: 상태 전이로 검증(지연 중 상태 -> 응답 후 계산값·제목).
// - EC-3·EC-4: 정확한 문구 일치가 아니라 raw ID가 보이지 않고 지정된 대체 표시(오류 문구 / 불러오는 중)가 있는지를 본다.
// - EC-5 case 1: 조회 전 중립 제목은 `documents.get` 응답 지연 mock으로 관찰한다.
// - EC-9: 사용자 확정. 두 페이지 A·B, B가 실제 API로 같은 슬롯 저장, A에서 `page.clock`으로 staleTime(15초) 경과 후
//   focus·visibilitychange로 `reviews` 재조회 유발(tests/review-write.update.spec.ts의 EC-11 패턴), 재조회 요청 발생 관찰,
//   mock 없음. 동시 저장의 last-write-wins는 기존 동작 설명이며 이 case가 단언하지 않는다.
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
import { COMPANY, INVESTOR, PASSWORD, PEER, login } from "./helpers/auth";

const WORKSPACE = "lighthouse";
const PLUGIN = `/workspace/${WORKSPACE}/plugins/review`;
const PLUGIN_LIST = new RegExp(`${PLUGIN}/?$`);
const PLUGIN_RPC = "**/api/plugins/rpc";
const DATAROOM_RPC = "**/api/dataroom/rpc";
const SERVER_MESSAGE = "서버 내부 메시지 SECRET";
/** 5xx 조회는 앱이 한 번 재시도하므로 오류 표시까지 기본 5초보다 여유를 둔다. */
const QUERY_ERROR_TIMEOUT = 15_000;
const NEUTRAL_PREVIEW = "근거 자료 미리보기";
const TITLE_UNAVAILABLE = "자료 제목을 불러오지 못했습니다";
const TITLE_LOADING = "불러오는 중";

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
type Counts = {
  total: number;
  written: number;
  satisfied: number;
  needs: number;
  unwritten: number;
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  satisfied: "확인함",
  needs_information: "추가 확인 필요",
};
const flip = (status: ReviewStatus): ReviewStatus =>
  status === "satisfied" ? "needs_information" : "satisfied";

/** 시드의 ready 자료. */
const READY = [
  { id: "doc-business", title: "회사 소개" },
  { id: "doc-team", title: "팀 소개" },
];
const titleOf = (id: string) => READY.find((doc) => doc.id === id)!.title;

/** 저장 슬롯: desktop은 `business`, mobile은 `team`. `revenue`는 어디서도 저장하지 않는다. */
const SLOTS = {
  desktop: {
    criterionId: "business",
    title: "사업 이해",
    status: "satisfied" as ReviewStatus,
    comment: "desktop 현황 case 준비용 검토 의견",
  },
  mobile: {
    criterionId: "team",
    title: "팀 구성",
    status: "needs_information" as ReviewStatus,
    comment: "mobile 현황 case 준비용 검토 의견",
  },
};
const slotOf = (testInfo: TestInfo) =>
  testInfo.project.name === "mobile" ? SLOTS.mobile : SLOTS.desktop;
type Slot = ReturnType<typeof slotOf>;

function rpcBody(request: Request) {
  try {
    return request.postDataJSON() as {
      method?: string;
      pluginId?: string;
      params?: { documentId?: string };
    } | null;
  } catch {
    return null;
  }
}

/** 지정한 method 요청만 handle로 넘기고 나머지는 같은 endpoint의 다른 route나 실제 서버로 보낸다. */
async function routeMethod(
  page: Page,
  endpoint: string,
  method: string,
  handle: (route: Route) => Promise<void>,
) {
  await page.route(endpoint, async (route) => {
    if (rpcBody(route.request())?.method === method) await handle(route);
    else await route.fallback();
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

/** 열 때까지 응답을 붙잡아 두는 문. `release()`로 풀고, 풀기 전에는 route handler가 대기한다. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release };
}

/** 지정한 method의 응답을 문이 열릴 때까지 지연시킨 뒤 실제 서버로 보낸다. */
function delayMethod(
  page: Page,
  endpoint: string,
  method: string,
  door: { opened: Promise<void> },
) {
  return routeMethod(page, endpoint, method, async (route) => {
    await door.opened;
    await route.fallback();
  });
}

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

async function listCriterionIds(request: APIRequestContext): Promise<string[]> {
  const response = await rpc(request, "criteria.list", null);
  expect(response.ok()).toBeTruthy();
  const json = (await response.json()) as { result: { criteria: { id: string }[] } };
  return json.result.criteria.map((item) => item.id);
}

/** 기대 숫자는 API 값(`criteria.list`·`reviews.list`)에서 계산한다. 기준과 매칭되는 검토만 센다. */
async function expectedCounts(request: APIRequestContext): Promise<Counts> {
  const ids = await listCriterionIds(request);
  const reviews = (await listReviews(request)).filter((item) => ids.includes(item.criterionId));
  const satisfied = reviews.filter((item) => item.status === "satisfied").length;
  const needs = reviews.filter((item) => item.status === "needs_information").length;
  return {
    total: ids.length,
    written: reviews.length,
    satisfied,
    needs,
    unwritten: ids.length - reviews.length,
  };
}

async function currentReview(request: APIRequestContext, slot: Slot): Promise<ReviewRow> {
  const found = (await listReviews(request)).find((item) => item.criterionId === slot.criterionId);
  expect(found, `${slot.criterionId} 슬롯에 저장된 검토가 있어야 한다`).toBeDefined();
  return found!;
}

/** 슬롯을 다른 status로 저장한다(근거·의견은 그대로). 실제 API를 쓴다. */
async function saveStatus(request: APIRequestContext, review: ReviewRow, status: ReviewStatus) {
  const response = await rpc(request, "reviews.update", {
    criterionId: review.criterionId,
    status,
    comment: review.comment,
    evidenceDocumentIds: review.evidenceDocumentIds,
  });
  expect(response.ok()).toBeTruthy();
}

/** `추가 확인 필요` 검토가 하나도 없으면 슬롯을 그 상태로 만든다(검토는 삭제할 수 없다). */
async function ensureNeedsInformation(request: APIRequestContext, slot: Slot) {
  const reviews = await listReviews(request);
  if (reviews.some((item) => item.status === "needs_information")) return;
  await saveStatus(request, await currentReview(request, slot), "needs_information");
}

/** 요약 카드. 제목과 안내 문구를 함께 가진 가장 안쪽 div다. */
const summaryCard = (page: Page) =>
  page
    .locator("div")
    .filter({ has: page.getByText("검토 현황", { exact: true }) })
    .filter({ has: page.getByText(/회사의 합의/) })
    .last();
/** 요약 카드 안의 라벨 옆 값. */
const metric = (card: Locator, label: string) =>
  card.getByText(label, { exact: true }).locator("xpath=following-sibling::span[1]");

async function expectCounts(card: Locator, counts: Counts) {
  await expect(metric(card, "작성")).toHaveText(`${counts.written}/${counts.total}`);
  await expect(metric(card, "확인함")).toHaveText(String(counts.satisfied));
  await expect(metric(card, "추가 확인 필요")).toHaveText(String(counts.needs));
  await expect(metric(card, "미작성")).toHaveText(String(counts.unwritten));
}

const criterionCard = (page: Page, title: string) =>
  page.getByRole("listitem").filter({ hasText: title });
const chips = (card: Locator) => card.getByRole("button", { name: /미리보기 열기$/ });
const chipFor = (card: Locator, shown: string) =>
  card.getByRole("button", { name: `${shown} 미리보기 열기`, exact: true });
const dialogNamed = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });

/** 서버 오류 mock 응답에서 재시도가 일어나는 5xx 조회가 실패로 굳을 때까지의 대기. */
const FAILED = { timeout: QUERY_ERROR_TIMEOUT };

test.describe("검토 현황 — 투자자가 목록 화면 상단에서 자신의 검토 진행 현황을 보고 근거 자료로 이동한다", () => {
  // 슬롯에 저장된 검토가 없으면 API로 만들고(409 무시), `추가 확인 필요` 검토가 없으면 슬롯을 그 상태로 만든다.
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
      if (!saved) {
        const created = await rpc(context.request, "reviews.create", {
          criterionId: slot.criterionId,
          status: slot.status,
          comment: slot.comment,
          evidenceDocumentIds: ["doc-business"],
        });
        expect([200, 409]).toContain(created.status());
      }
      await ensureNeedsInformation(context.request, slot);
    } finally {
      await context.close();
    }
  });

  test.describe("현황 숫자를 계산하는 경우", () => {
    /**
     * @spec DoD-1
     * @given 검토가 없는 `investor-peer`(peer@lighthouse.test)로 로그인했다
     * @when 목록 화면(`/`)을 연다
     * @then 상단 요약 카드에 `작성 0/3`, `확인함 0`, `추가 확인 필요 0`, `미작성 3` 4개 항목이 따로 보인다
     */
    test("[DoD-1] 검토가 없는 투자자는 작성 0/3, 확인함 0, 추가 확인 필요 0, 미작성 3을 본다", async ({
      page,
    }) => {
      await login(page, PEER);
      await page.goto(PLUGIN);
      const card = summaryCard(page);
      await expectCounts(card, { total: 3, written: 0, satisfied: 0, needs: 0, unwritten: 3 });
    });

    /**
     * @spec DoD-2
     * @given 저장 슬롯에 `추가 확인 필요` 검토가 있는 investor로 로그인했다
     * @when 목록 화면을 연다
     * @then `추가 확인 필요` 검토는 작성 수에 포함된다
     * @then `추가 확인 필요` 검토는 확인함 수에 포함되지 않는다
     */
    test("[DoD-2] 추가 확인 필요 검토는 작성 수에 포함되고 확인함 수에는 포함되지 않는다", async ({
      page,
    }, testInfo) => {
      await login(page, INVESTOR);
      await ensureNeedsInformation(page.request, slotOf(testInfo));
      const counts = await expectedCounts(page.request);
      expect(counts.needs, "`추가 확인 필요` 검토가 있어야 한다").toBeGreaterThan(0);

      await page.goto(PLUGIN);
      const card = summaryCard(page);
      await expectCounts(card, counts);
      // 작성 수는 확인함과 `추가 확인 필요`의 합이고, 확인함에는 `추가 확인 필요`가 들어 있지 않다.
      await expect(metric(card, "작성")).toHaveText(
        `${counts.satisfied + counts.needs}/${counts.total}`,
      );
      await expect(metric(card, "확인함")).not.toHaveText(String(counts.written));
    });

    /**
     * @spec EC-6
     * @given `reviews.list`가 모든 기준(3건)을 작성했지만 확인함이 더 적은 응답(`작성 3/3`, 확인함 1, 추가 확인 필요 2)을 준다
     * @when 목록 화면을 연다
     * @then 숫자 4개(`작성 3/3`, `확인함 1`, `추가 확인 필요 2`, `미작성 0`)만 표시한다
     * @then "완료"·"모두 확인" 같은 판정 문구는 없다
     */
    test("[EC-6] 모두 작성했지만 확인함이 더 적어도 숫자 4개만 표시하고 판정 문구는 없다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const ids = await listCriterionIds(page.request);
      expect(ids).toHaveLength(3);
      const statuses: ReviewStatus[] = ["satisfied", "needs_information", "needs_information"];
      const reviews: ReviewRow[] = ids.map((criterionId, index) => ({
        id: `mock-review-${index}`,
        criterionId,
        status: statuses[index]!,
        comment: `mock 의견 ${index}`,
        evidenceDocumentIds: ["doc-business"],
        createdAt: "2026-09-10T09:00:00Z",
        updatedAt: "2026-09-10T09:00:00Z",
      }));
      await routeMethod(page, PLUGIN_RPC, "reviews.list", (route) =>
        succeedWith(route, { reviews }),
      );

      await page.goto(PLUGIN);
      const card = summaryCard(page);
      await expectCounts(card, { total: 3, written: 3, satisfied: 1, needs: 2, unwritten: 0 });
      // 숫자 4개만 보이고 판정 문구는 없다.
      await expect(card.getByText(/^\d+(\/\d+)?$/)).toHaveCount(4);
      await expect(card).not.toContainText(/완료|모두 확인/);
    });
  });

  test.describe("검토를 저장하는 경우", () => {
    /**
     * @spec DoD-3
     * @given investor가 저장 슬롯의 검토를 보고 있다
     * @when 같은 슬롯의 status를 UI로 뒤집어 저장하고 목록으로 돌아온다
     * @then 목록으로 돌아온 화면의 현황 숫자가 새로고침 없이 저장한 결과가 반영된 숫자로 갱신된다
     */
    test("[DoD-3] 검토를 저장하면 목록 현황 숫자가 새로고침 없이 갱신된다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const before = await expectedCounts(page.request);
      const saved = await currentReview(page.request, slot);

      await page.goto(PLUGIN);
      const card = summaryCard(page);
      await expectCounts(card, before);

      // 같은 슬롯의 status를 UI로 뒤집어 저장한다(근거·의견은 그대로).
      await page.getByRole("button", { name: `${slot.title} 검토 수정`, exact: true }).click();
      const dialog = dialogNamed(page, `${slot.title} 검토 수정`);
      await expect(dialog).toBeVisible();
      await expect(page.getByLabel("의견", { exact: true })).toHaveValue(saved.comment);
      await page.getByRole("radio", { name: STATUS_LABEL[flip(saved.status)] }).check();
      await page.getByRole("button", { name: "저장", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(PLUGIN_LIST);

      // 새로고침 없이 같은 페이지의 숫자가 저장 결과로 바뀐다.
      const after = await expectedCounts(page.request);
      expect(after).not.toEqual(before);
      expect(after.written).toBe(before.written);
      await expectCounts(card, after);
    });

    /**
     * @spec EC-9
     * @given 같은 investor가 두 페이지(A, B)에서 같은 목록 화면을 보고 있고, B가 같은 슬롯의 status를 저장해 `reviews.list` 결과를 바꾼다
     * @when A 페이지의 reviews 쿼리가 재조회되게 한다
     * @then 재조회 요청이 발생한다
     * @then A의 현황 숫자가 `reviews.list` 최신 값에서 계산한 값으로 바뀐다
     */
    test("[EC-9] 다른 곳에서 저장되어 reviews 쿼리가 다시 조회되면 현황 숫자가 최신 값으로 바뀐다", async ({
      page,
      browser,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);
      const before = await expectedCounts(page.request);
      const lists: string[] = [];
      page.on("request", (request) => {
        const body = request.method() === "POST" ? rpcBody(request) : null;
        if (body?.pluginId === "review" && body.method === "reviews.list") lists.push(body.method);
      });
      // staleTime(15초)을 넘기려 시계를 앞당긴다.
      await page.clock.install();
      await page.goto(PLUGIN);
      const card = summaryCard(page);
      await expectCounts(card, before);

      // 페이지 B(같은 investor)가 실제 API로 같은 슬롯의 status를 저장한다.
      const contextB = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
      try {
        const pageB = await contextB.newPage();
        await login(pageB, INVESTOR);
        await pageB.goto(PLUGIN);
        await saveStatus(pageB.request, saved, flip(saved.status));
      } finally {
        await contextB.close();
      }
      const after = await expectedCounts(page.request);
      expect(after).not.toEqual(before);

      const requestedBefore = lists.length;
      await page.clock.fastForward(20_000);
      await page.evaluate(() => {
        window.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new Event("focus"));
      });
      // 재조회가 실제로 일어났는지 확인해 공허 통과를 막는다.
      await expect.poll(() => lists.length).toBeGreaterThan(requestedBefore);
      await expectCounts(card, after);
    });
  });

  test.describe("조회가 실패하거나 로딩 중인 경우", () => {
    /**
     * @spec EC-2
     * @given 응답을 지연시킨다: `criteria.list` 응답을 지연시킨다 / `reviews.list` 응답을 지연시킨다 — 각각 하나씩 반복한다
     * @when 목록 화면을 연다
     * @then 로딩 중에는 요약 카드가 숫자 대신 로딩 상태를 보여주고 0/미작성 숫자로 보이지 않는다
     * @then 응답이 오면 `reviews.list` 값에서 계산한 숫자로 바뀐다
     */
    test("[EC-2] 조회가 로딩 중이면 숫자 대신 로딩 상태를 보이다가 응답이 오면 계산한 숫자로 바뀐다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const counts = await expectedCounts(page.request);
      for (const method of ["criteria.list", "reviews.list"]) {
        await test.step(`${method} 응답 지연`, async () => {
          const door = gate();
          await delayMethod(page, PLUGIN_RPC, method, door);
          await page.goto(PLUGIN);
          const card = summaryCard(page);
          try {
            // 로딩 중에는 숫자 대신 로딩 상태이고 0/미작성 숫자로 보이지 않는다.
            await expect(card.locator('[aria-busy="true"]')).toBeVisible();
            await expect(card.getByText("불러오고 있습니다.")).toBeVisible();
            for (const label of ["작성", "확인함", "추가 확인 필요", "미작성"])
              await expect(card.getByText(label, { exact: true })).toHaveCount(0);
            await expect(card.getByText(/^\d+(\/\d+)?$/)).toHaveCount(0);
          } finally {
            door.release();
          }
          await expectCounts(card, counts);
          await expect(card.locator('[aria-busy="false"]')).toBeVisible();
          await expect(card.getByText("불러오고 있습니다.")).toHaveCount(0);
          await page.unroute(PLUGIN_RPC);
        });
      }
    });

    /**
     * @spec EC-4
     * @given 근거 자료가 연결된 검토가 있는 investor이고 `documents.list` 응답을 지연시킨다
     * @when 목록 화면을 연다
     * @then 로딩 중에는 근거 칩에 raw ID가 보이지 않고 "불러오는 중" 표시가 있다
     * @then 응답이 오면 칩이 자료 제목으로 바뀐다
     */
    test("[EC-4] documents.list가 로딩 중이면 근거 칩이 불러오는 중으로 보이다가 응답이 오면 자료 제목으로 바뀐다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);
      const door = gate();
      await delayMethod(page, DATAROOM_RPC, "documents.list", door);
      await page.goto(PLUGIN);
      const card = criterionCard(page, slot.title);
      try {
        // 로딩 중 칩은 raw ID 대신 "불러오는 중" 표시다.
        await expect(chips(card)).toHaveCount(saved.evidenceDocumentIds.length);
        for (const chip of await chips(card).all()) await expect(chip).toHaveText(TITLE_LOADING);
        for (const id of saved.evidenceDocumentIds) await expect(card.getByText(id)).toHaveCount(0);
      } finally {
        door.release();
      }
      for (const id of saved.evidenceDocumentIds)
        await expect(chipFor(card, titleOf(id))).toBeVisible();
      await expect(card.getByText(TITLE_LOADING)).toHaveCount(0);
    });

    /**
     * @spec EC-1
     * @given `criteria.list` 실패 응답, `reviews.list` 실패 응답을 각각 하나씩 반복한다
     * @when 목록 화면을 연다
     * @then 요약 카드는 숫자를 표시하지 않는다(0건·미작성으로 표시하지 않는다)
     * @then 요약 카드의 별도 오류 표시 없이 기존 목록의 오류 표시 하나만 보인다
     */
    test("[EC-1] criteria.list 또는 reviews.list가 실패하면 숫자 없이 기존 오류 표시 하나만 보인다", async ({
      page,
    }) => {
      await login(page, INVESTOR);
      const samples = [
        { method: "criteria.list", message: "검토 기준을 불러오지 못했습니다." },
        { method: "reviews.list", message: "저장한 검토를 불러오지 못했습니다." },
      ];
      for (const sample of samples) {
        await test.step(`${sample.method} 실패`, async () => {
          await routeMethod(page, PLUGIN_RPC, sample.method, (route) => failWith(route, 500));
          await page.goto(PLUGIN);
          // 기존 목록의 오류 표시 하나만 있다.
          await expect(page.getByRole("alert")).toContainText(sample.message, FAILED);
          await expect(page.getByRole("alert")).toHaveCount(1);
          // 요약 카드는 숫자를 표시하지 않는다(0건·미작성으로도 표시하지 않는다).
          await expect(page.getByText(/^\d+(\/\d+)?$/)).toHaveCount(0);
          await expect(page.getByText("검토 현황", { exact: true })).toHaveCount(0);
          await page.unroute(PLUGIN_RPC);
        });
      }
    });

    /**
     * @spec EC-3
     * @given 근거 자료가 연결된 검토가 있는 investor이고 `documents.list`가 실패 응답을 준다
     * @when 목록 화면을 연다
     * @then 현황 숫자는 그대로 표시된다
     * @then 근거 칩에 raw ID가 보이지 않고 자료 제목을 불러오지 못했다는 대체 표시가 있다
     */
    test("[EC-3] documents.list가 실패해도 현황 숫자는 그대로이고 근거 칩은 raw ID 대신 대체 표시를 보인다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);
      const counts = await expectedCounts(page.request);
      await routeMethod(page, DATAROOM_RPC, "documents.list", (route) => failWith(route, 500));
      await page.goto(PLUGIN);

      const card = criterionCard(page, slot.title);
      await expect(chips(card)).toHaveCount(saved.evidenceDocumentIds.length);
      for (const chip of await chips(card).all())
        await expect(chip).toHaveText(TITLE_UNAVAILABLE, FAILED);
      for (const id of saved.evidenceDocumentIds) await expect(card.getByText(id)).toHaveCount(0);
      // 현황 숫자는 그대로 표시된다.
      await expectCounts(summaryCard(page), counts);
    });
  });

  test.describe("근거 칩을 눌러 근거 미리보기를 여는 경우", () => {
    /**
     * @spec DoD-5
     * @given 근거 자료가 있는 저장된 검토가 있는 investor이다
     * @when 기준별 카드의 근거 칩을 누른다
     * @then 기준 상세·수정 모달 없이 목록 화면에서 해당 자료의 근거 미리보기 모달이 열린다
     * @then 모달은 `target: "dataroom"` `documents.get` 응답의 자료를 표시한다
     */
    test("[DoD-5] 근거 칩을 누르면 목록 화면에서 해당 자료의 근거 미리보기 모달이 열린다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);
      const id = saved.evidenceDocumentIds[0]!;
      await page.goto(PLUGIN);
      const card = criterionCard(page, slot.title);
      const chip = chipFor(card, titleOf(id));
      await expect(chip).toBeVisible();

      const fetched = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/dataroom/rpc") &&
          rpcBody(response.request())?.method === "documents.get" &&
          rpcBody(response.request())?.params?.documentId === id,
      );
      await chip.click();
      const document = (
        (await (await fetched).json()) as {
          result: { document: { title: string; fileName: string } };
        }
      ).result.document;

      // 목록 화면에서 근거 미리보기 모달이 열린다(기준 상세·수정 모달은 없다).
      const dialog = dialogNamed(page, `${document.title} 미리보기`);
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(document.fileName)).toBeVisible();
      await expect(page).toHaveURL(PLUGIN_LIST);
      await expect(page.getByRole("dialog", { name: /검토 (수정|작성)$/ })).toHaveCount(0);
    });

    /**
     * @spec DoD-6
     * @given 목록 화면에서 근거 미리보기 모달이 열려 있다
     * @when 근거 미리보기 모달을 닫는다
     * @then 목록 화면으로 돌아온다
     * @then 현황 숫자가 그대로 보인다
     */
    test("[DoD-6] 근거 미리보기 모달을 닫으면 목록 화면으로 돌아오고 현황 숫자가 그대로다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);
      const counts = await expectedCounts(page.request);
      await page.goto(PLUGIN);
      const card = summaryCard(page);
      await expectCounts(card, counts);

      const title = titleOf(saved.evidenceDocumentIds[0]!);
      await chipFor(criterionCard(page, slot.title), title).click();
      const dialog = dialogNamed(page, `${title} 미리보기`);
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "닫기", exact: true }).click();

      await expect(dialog).toHaveCount(0);
      await expect(page).toHaveURL(PLUGIN_LIST);
      await expectCounts(card, counts);
    });

    /**
     * @spec EC-5
     * @given `documents.list`가 실패하고 `documents.get`은 실제 서버를 쓰되 응답을 지연시킨다
     * @when 근거 칩을 누른다
     * @then 미리보기가 `documents.get`으로 자체 조회해 열린다
     * @then 조회 전 모달 제목은 중립 제목 "근거 자료"이다
     * @then 응답이 오면 모달 제목이 실제 자료 제목으로 바뀐다
     */
    test("[EC-5] documents.list 실패 후에도 근거 칩을 누르면 documents.get으로 자체 조회해 열린다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      const saved = await currentReview(page.request, slot);
      const id = saved.evidenceDocumentIds[0]!;
      const door = gate();
      const gets: (string | undefined)[] = [];
      page.on("request", (request) => {
        const body = request.method() === "POST" ? rpcBody(request) : null;
        if (
          new URL(request.url()).pathname === "/api/dataroom/rpc" &&
          body?.method === "documents.get"
        )
          gets.push(body.params?.documentId);
      });
      // documents.list는 실패시키고, documents.get은 실제 서버로 보내되 응답을 지연시킨다.
      await page.route(DATAROOM_RPC, async (route) => {
        const method = rpcBody(route.request())?.method;
        if (method === "documents.list") return failWith(route, 500);
        if (method === "documents.get") await door.opened;
        return route.fallback();
      });
      await page.goto(PLUGIN);
      const card = criterionCard(page, slot.title);
      const chip = chips(card).first();
      await expect(chip).toHaveText(TITLE_UNAVAILABLE, FAILED);

      await chip.click();
      try {
        // 조회 전 모달 제목은 중립 제목이고, documents.get으로 자체 조회한다.
        await expect(dialogNamed(page, NEUTRAL_PREVIEW)).toBeVisible();
        await expect.poll(() => gets).toContain(id);
      } finally {
        door.release();
      }
      // 응답이 오면 실제 자료 제목으로 바뀐다.
      await expect(dialogNamed(page, `${titleOf(id)} 미리보기`)).toBeVisible();
    });

    /**
     * @spec EC-5
     * @given `documents.list`가 실패하고 `documents.get`도 실패 응답을 준다
     * @when 근거 칩을 눌러 미리보기를 연다
     * @then 조회 실패 시 모달 제목은 중립 제목 "근거 자료"이다
     * @then 재시도할 수 있고, 재시도하면 `documents.get`이 다시 요청된다
     */
    test("[EC-5] documents.get 조회가 실패하면 중립 제목 모달에서 재시도할 수 있다", async ({
      page,
    }, testInfo) => {
      const slot = slotOf(testInfo);
      await login(page, INVESTOR);
      await currentReview(page.request, slot);
      let gets = 0;
      page.on("request", (request) => {
        const body = request.method() === "POST" ? rpcBody(request) : null;
        if (
          new URL(request.url()).pathname === "/api/dataroom/rpc" &&
          body?.method === "documents.get"
        )
          gets += 1;
      });
      await page.route(DATAROOM_RPC, async (route) => {
        const method = rpcBody(route.request())?.method;
        if (method === "documents.list" || method === "documents.get") return failWith(route, 500);
        return route.fallback();
      });
      await page.goto(PLUGIN);
      const chip = chips(criterionCard(page, slot.title)).first();
      await expect(chip).toHaveText(TITLE_UNAVAILABLE, FAILED);

      await chip.click();
      const dialog = dialogNamed(page, NEUTRAL_PREVIEW);
      // 조회가 실패해도 모달 제목은 중립 제목이고 오류와 재시도가 보인다.
      await expect(dialog.getByRole("alert")).toBeVisible(FAILED);
      await expect(dialog).toBeVisible();

      const before = gets;
      await dialog.getByRole("button", { name: "재시도", exact: true }).click();
      await expect.poll(() => gets).toBeGreaterThan(before);
      await expect(dialogNamed(page, NEUTRAL_PREVIEW)).toBeVisible();
    });
  });

  test.describe("기업 담당자가 목록 화면을 여는 경우", () => {
    /**
     * @spec DoD-7
     * @given company@lighthouse.test(기업 담당자)로 로그인했다
     * @when Review Plugin 화면을 연다
     * @then 요약 카드가 없다
     * @then Review Plugin의 `criteria.list` 외 RPC 요청이 나가지 않는다
     * @then dataroom RPC 요청이 나가지 않는다
     */
    test("[DoD-7] 기업 담당자 화면에는 요약 카드가 없고 criteria.list 외 RPC와 dataroom RPC 요청이 나가지 않는다", async ({
      page,
    }) => {
      await login(page, COMPANY);
      const reviewMethods: string[] = [];
      const dataroom: string[] = [];
      page.on("request", (request) => {
        if (request.method() !== "POST") return;
        const path = new URL(request.url()).pathname;
        if (path === "/api/dataroom/rpc") dataroom.push(request.url());
        if (path === "/api/plugins/rpc") {
          const body = rpcBody(request);
          if (body?.pluginId === "review" && body.method) reviewMethods.push(body.method);
        }
      });
      await page.goto(PLUGIN);
      // 목록 렌더가 끝난 뒤(기준 목록이 그려진 뒤) 판정한다.
      await expect(page.getByRole("listitem").first()).toBeVisible();
      await page.waitForLoadState("networkidle");

      await expect(page.getByText("검토 현황", { exact: true })).toHaveCount(0);
      expect(reviewMethods).toContain("criteria.list");
      expect(reviewMethods.filter((method) => method !== "criteria.list")).toEqual([]);
      expect(dataroom).toEqual([]);
    });
  });
});
