import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers/auth";

const LIST = "/workspace/lighthouse";
const detail = (id: string) => `${LIST}/documents/${id}`;
const NOT_EVIDENCE = "근거로 연결할 수 없음";

test.beforeEach(async ({ page }) => {
  await login(page);
});

async function expectSeedDetail(
  page: Page,
  title: string,
  fileName: string,
  status: string,
  content: string,
) {
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const article = page.getByRole("article");
  await expect(article).toContainText(fileName);
  await expect(article).toContainText(status);
  await expect(article).toContainText(content);
}

test.describe("자료 조회 — 같은 데이터룸의 자료를 목록, 제목 검색, 상세로 확인한다", () => {
  test.describe("목록", () => {
    /**
     * @spec DoD-6
     * @given 투자자로 로그인했다
     * @when 데이터룸 목록 화면(/workspace/:id)을 연다
     * @then 각 자료의 제목·파일명·상태·작성 시각(브라우저 로컬 포맷)이 표시된다
     */
    test("[DoD-6] 목록에 자료의 제목·파일명·상태·작성 시각이 표시된다", async ({ page }) => {
      await page.goto(LIST);
      const link = page.getByRole("link", { name: /회사 소개/ });
      await expect(link).toBeVisible();
      await expect(link).toContainText("company-overview.md");
      await expect(link).toContainText("사용 가능");
      const time = link.locator("time");
      await expect(time).toBeVisible();
      // 시간대·포맷에 의존하지 않고, ISO 원문이 그대로 노출되지 않는지만 확인한다.
      await expect(time).not.toHaveText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      await expect(time).toHaveText(/\d/);
      const failed = page.getByRole("link", { name: /매출 자료/ });
      await expect(failed).toContainText("revenue.txt");
      await expect(failed).toContainText("실패");
      const processing = page.getByRole("link", { name: /고객 인터뷰/ });
      await expect(processing).toContainText("customer-interviews.md");
      await expect(processing).toContainText("처리 중");
    });
  });

  test.describe("검색", () => {
    /**
     * @spec DoD-7
     * @given 투자자로 로그인했고 데이터룸 목록 화면을 열었다
     * @when 검색어를 입력한다
     * @then 제목이 일치하는 자료만 목록에 남고 URL의 ?q=에 검색어가 반영된다
     */
    test("[DoD-7] 검색어와 일치하는 자료만 남고 URL에 ?q=가 반영된다", async ({ page }) => {
      await page.goto(LIST);
      await expect(page.getByRole("link", { name: /회사 소개/ })).toBeVisible();
      await page.getByLabel("제목으로 검색").fill("팀 소개");
      await expect(page).toHaveURL(/[?&]q=/);
      expect(new URL(page.url()).searchParams.get("q")).toBe("팀 소개");
      await expect(page.getByRole("link", { name: /팀 소개/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /회사 소개/ })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /매출 자료/ })).toHaveCount(0);
    });
  });

  test.describe("상세", () => {
    /**
     * @spec DoD-8
     * @given 투자자로 로그인했고 데이터룸 목록 화면을 열었다
     * @when 목록에서 자료를 선택한다
     * @then /workspace/:id/documents/:documentId로 이동하고 제목·파일명·상태·본문이 표시된다
     */
    test("[DoD-8] 목록에서 선택하면 상세로 이동해 제목·파일명·상태·본문이 표시된다", async ({ page }) => {
      await page.goto(LIST);
      await page.getByRole("link", { name: /회사 소개/ }).click();
      await expect(page).toHaveURL(new RegExp(`${detail("doc-business")}$`));
      await expectSeedDetail(
        page,
        "회사 소개",
        "company-overview.md",
        "사용 가능",
        "제조사 재고 관리 구독형 소프트웨어",
      );
    });

    /**
     * @spec DoD-9
     * @given 투자자로 로그인했고 자료 상세 화면을 열었다
     * @when 새로고침한다
     * @then 같은 자료의 상세가 표시된다
     */
    test("[DoD-9] 상세 화면에서 새로고침해도 같은 상세가 표시된다", async ({ page }) => {
      await page.goto(detail("doc-team"));
      await expectSeedDetail(page, "팀 소개", "team.md", "사용 가능", "전담 영업 담당자는 없음");
      await page.reload();
      await expect(page).toHaveURL(new RegExp(`${detail("doc-team")}$`));
      await expectSeedDetail(page, "팀 소개", "team.md", "사용 가능", "전담 영업 담당자는 없음");
    });

    /**
     * @spec DoD-9
     * @given 투자자로 로그인했다
     * @when 자료 상세 주소로 직접 진입한다
     * @then 같은 자료의 상세가 표시된다
     */
    test("[DoD-9] 상세 주소로 직접 진입해도 같은 상세가 표시된다", async ({ page }) => {
      await page.goto(detail("doc-business"));
      await expect(page).toHaveURL(new RegExp(`${detail("doc-business")}$`));
      await expectSeedDetail(
        page,
        "회사 소개",
        "company-overview.md",
        "사용 가능",
        "제조사 재고 관리 구독형 소프트웨어",
      );
    });

    /**
     * @spec EC-8
     * @given 투자자로 로그인했다
     * @when 상태가 processing인 자료의 상세 화면을 연다
     * @then "근거로 연결할 수 없음" 안내가 표시된다
     */
    test("[EC-8] processing 자료의 상세에 근거로 연결할 수 없음 안내가 표시된다", async ({ page }) => {
      await page.goto(detail("doc-pipeline"));
      await expectSeedDetail(
        page,
        "고객 인터뷰",
        "customer-interviews.md",
        "처리 중",
        "아직 준비되지 않았습니다.",
      );
      await expect(page.getByRole("note")).toContainText(NOT_EVIDENCE);
    });

    /**
     * @spec EC-8
     * @given 투자자로 로그인했다
     * @when 상태가 failed인 자료의 상세 화면을 연다
     * @then "근거로 연결할 수 없음" 안내가 표시된다
     */
    test("[EC-8] failed 자료의 상세에 근거로 연결할 수 없음 안내가 표시된다", async ({ page }) => {
      await page.goto(detail("doc-revenue"));
      await expectSeedDetail(page, "매출 자료", "revenue.txt", "실패", "자료를 읽지 못했습니다.");
      await expect(page.getByRole("note")).toContainText(NOT_EVIDENCE);
    });
  });

  test.describe("목록 조회 실패", () => {
    /**
     * @spec EC-9
     * @given 투자자로 로그인했고 검색어를 입력했으며 목록 조회 요청이 오류 응답으로 실패한다
     * @when 목록 화면에서 자료를 조회한다
     * @then "자료 없음"이 아닌 오류가 표시되고 입력한 검색어가 보존된다
     */
    test("[EC-9] 목록 조회가 실패하면 오류가 표시되고 검색어가 보존된다", async ({ page }) => {
      // 목록 조회(documents.list)만 500으로 실패시키고 나머지 요청은 실제 서버로 보낸다.
      await page.route("**/api/dataroom/rpc", async (route) => {
        const body = route.request().postDataJSON() as { method?: string } | null;
        if (body?.method === "documents.list") {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({ kind: "storage_error", message: "mocked failure" }),
          });
        } else {
          await route.continue();
        }
      });
      await page.goto(LIST);
      const search = page.getByLabel("제목으로 검색");
      await search.fill("팀 소개");
      await expect(page).toHaveURL(/[?&]q=/);
      // 재시도를 거친 뒤 오류가 표시된다.
      await expect(page.getByRole("alert")).toContainText("자료를 불러오지 못했습니다", {
        timeout: 20_000,
      });
      await expect(page.getByText("아직 등록된 자료가 없습니다.")).toHaveCount(0);
      await expect(page.getByText("검색 결과가 없습니다.")).toHaveCount(0);
      await expect(search).toHaveValue("팀 소개");
    });
  });

  test.describe("빈 검색 결과", () => {
    /**
     * @spec EC-10
     * @given 투자자로 로그인했고 데이터룸 목록 화면을 열었다
     * @when 어떤 자료의 제목과도 일치하지 않는 검색어를 입력한다
     * @then 오류나 로딩이 아닌 빈 결과 문구가 표시된다
     */
    test("[EC-10] 검색 결과가 없으면 빈 결과 문구가 표시된다", async ({ page }) => {
      await page.goto(LIST);
      await expect(page.getByRole("link", { name: /회사 소개/ })).toBeVisible();
      await page.getByLabel("제목으로 검색").fill("zzz-일치하는-자료-없음");
      await expect(page.getByText("검색 결과가 없습니다.")).toBeVisible();
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(page.getByRole("link", { name: /회사 소개/ })).toHaveCount(0);
    });
  });
});
