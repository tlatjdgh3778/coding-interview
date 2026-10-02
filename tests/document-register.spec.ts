// 대상 스펙: docs/specs/dataroom-document-register.md (자료 등록)
// 이 파일의 DoD-N·EC-N은 위 스펙의 번호이며, tests/documents.spec.ts(자료 조회 스펙)의 번호와 다르다.
import { expect, test, type Page, type Route, type TestInfo } from "@playwright/test";
import { COMPANY, INVESTOR, login } from "./helpers/auth";

const WORKSPACE = "lighthouse";
const LIST = `/workspace/${WORKSPACE}`;
const NEW = `${LIST}/documents/new`;
const DETAIL = new RegExp(`${LIST}/documents/doc-[0-9a-f]{16}$`);
const BOM = "﻿";
const SERVER_MESSAGE = "서버 내부 메시지 SECRET";

/** 프로젝트·시각·난수가 들어간 고유 값. 시드 검색어와 겹치지 않는다. */
function unique(testInfo: TestInfo, label: string) {
  return `${label}-${testInfo.project.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function textFile(name: string, text: string) {
  return { name, mimeType: "text/markdown", buffer: Buffer.from(text, "utf-8") };
}

/** 목록 화면을 연 뒤 "자료 등록" 버튼으로 등록 화면에 들어간다. */
async function openRegisterFromList(page: Page) {
  await page.goto(LIST);
  await page.getByRole("button", { name: "자료 등록", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "자료 등록" })).toBeVisible();
}

const titleInput = (page: Page) => page.getByLabel("제목", { exact: true });
const fileInput = (page: Page) => page.getByLabel("파일", { exact: true });
const submitButton = (page: Page) => page.getByRole("button", { name: "자료 등록", exact: true });
const viewButton = (page: Page) => page.getByRole("button", { name: "내용 보기" });

/** 선택된 파일 이름 목록(선택이 없으면 빈 배열). */
const selectedFiles = (page: Page) =>
  fileInput(page).evaluate((el) =>
    Array.from((el as HTMLInputElement).files ?? []).map((file) => file.name),
  );

/** 내용 보기 모달을 열어 파일명과 본문(정확히 일치)을 확인하고 닫는다. */
async function expectModalContent(page: Page, fileName: string, body: string) {
  await viewButton(page).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: fileName })).toBeVisible();
  const pre = dialog.getByLabel("본문");
  await expect.poll(() => pre.textContent()).toBe(body);
  await dialog.getByRole("button", { name: "닫기" }).click();
  await expect(dialog).toBeHidden();
}

/** 등록 요청(documents.create)만 handle로 넘기고 나머지 요청은 실제 서버로 보낸다. */
async function interceptCreate(page: Page, handle: (route: Route) => Promise<void>) {
  await page.route("**/api/dataroom/rpc", async (route) => {
    const body = route.request().postDataJSON() as { method?: string } | null;
    if (body?.method === "documents.create") await handle(route);
    else await route.continue();
  });
}

test.describe("자료 등록 — 기업 담당자가 제목과 파일로 자료를 등록하고 투자자는 등록할 수 없다", () => {
  test.describe("기업 담당자가 등록에 성공하는 경우", () => {
    /**
     * @spec DoD-5 DoD-11
     * @given 기업 담당자로 로그인해 목록 화면을 연 뒤 "자료 등록" 버튼으로 등록 화면에 진입했고, 제목을 입력하고 파일을 선택했다
     * @when 등록한다
     * @then 새 자료의 상세 화면(/workspace/:id/documents/:documentId)으로 이동한다
     * @then 상세 화면에 제목·파일명·상태·본문이 표시된다
     * @then 상세 화면에서 목록 화면으로 돌아오면 자료 목록(검색어 없음) 최상단에 새 자료가 표시된다
     */
    test("[DoD-5][DoD-11] 등록하면 상세 화면으로 이동하고 목록 최상단에 새 자료가 보인다", async ({ page }, testInfo) => {
      await login(page, COMPANY);
      const title = unique(testInfo, "등록성공");
      const fileName = `${unique(testInfo, "file")}.md`;
      const body = "# 등록 본문\n둘째 줄 내용";

      await openRegisterFromList(page);
      await titleInput(page).fill(title);
      await fileInput(page).setInputFiles(textFile(fileName, body));
      await submitButton(page).click();

      await expect(page).toHaveURL(DETAIL);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      const article = page.getByRole("article");
      await expect(article).toContainText(fileName);
      await expect(article).toContainText("사용 가능");
      await expect(article).toContainText("# 등록 본문");
      await expect(article).toContainText("둘째 줄 내용");

      await page.getByRole("link", { name: "자료 목록으로" }).click();
      await expect(page).toHaveURL(new RegExp(`${LIST}$`));
      const first = page.getByRole("listitem").first();
      await expect(first).toContainText(title);
      await expect(first).toContainText(fileName);
    });

    /**
     * @spec DoD-10
     * @given 기업 담당자로 로그인해 등록 화면에서 검사를 통과하는 BOM이 있는 충분히 긴 여러 줄 파일을 선택했다
     * @when "내용 보기"를 누른다
     * @then 모달(HTML 기본 dialog 요소)에 파일명이 표시된다
     * @then 모달에 본문 전체(BOM 제거 후, 줄바꿈 유지)가 읽기 전용으로 표시된다
     */
    test("[DoD-10] 내용 보기를 누르면 모달에 파일명과 본문 전체가 읽기 전용으로 표시된다", async ({ page }, testInfo) => {
      await login(page, COMPANY);
      const fileName = `${unique(testInfo, "modal")}.md`;
      const body = Array.from({ length: 300 }, (_, i) => `${i + 1}번째 줄 본문 내용입니다`).join("\n");

      await page.goto(NEW);
      await fileInput(page).setInputFiles(textFile(fileName, BOM + body));
      await viewButton(page).click();

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("heading", { name: fileName })).toBeVisible();
      const pre = dialog.getByLabel("본문");
      // 선행 BOM이 없고 줄바꿈이 유지된 전체 본문(마지막 줄 포함)이어야 한다.
      await expect.poll(() => pre.textContent()).toBe(body);
      // <pre>는 입력 요소가 아니므로 toBeEditable 대신 DOM 속성으로 편집 불가를 확인한다.
      await expect.poll(() => pre.evaluate((el) => (el as HTMLElement).isContentEditable)).toBe(false);
      await expect(pre).not.toHaveAttribute("contenteditable", /.*/);
      await expect(dialog.getByRole("textbox")).toHaveCount(0);
    });
  });

  test.describe("투자자가 등록 진입을 시도하는 경우", () => {
    /**
     * @spec DoD-6
     * @given 투자자로 로그인했다
     * @when 자료 목록 화면을 연다
     * @then "자료 등록" 버튼이 보이지 않는다
     */
    test("[DoD-6] 투자자에게는 목록 화면의 자료 등록 버튼이 보이지 않는다", async ({ page }) => {
      await login(page, INVESTOR);
      await page.goto(LIST);
      // 목록이 로드된 뒤에 버튼 부재를 확인한다.
      await expect(page.getByRole("link", { name: /회사 소개/ })).toBeVisible();
      await expect(page.getByRole("button", { name: "자료 등록" })).toHaveCount(0);
    });

    /**
     * @spec DoD-12
     * @given 투자자로 로그인했다
     * @when /workspace/:id/documents/new 에 직접 접근한다
     * @then 폼 대신 "기업 담당자만 등록할 수 있다"는 안내가 표시된다
     */
    test("[DoD-12] 투자자가 등록 주소에 직접 접근하면 폼 대신 기업 담당자만 등록할 수 있다는 안내가 보인다", async ({ page }) => {
      await login(page, INVESTOR);
      await page.goto(NEW);
      await expect(page.getByRole("note")).toContainText("기업 담당자만 등록할 수");
      await expect(titleInput(page)).toHaveCount(0);
      await expect(fileInput(page)).toHaveCount(0);
      await expect(submitButton(page)).toHaveCount(0);
    });
  });

  test.describe("입력 검사에 실패하는 경우", () => {
    /**
     * @spec EC-9
     * @given 기업 담당자로 로그인해 등록 화면에서 파일을 선택한다. 표본을 하나씩 반복한다: 비 UTF-8 파일, 확장자 불가 파일, 200KiB 초과 파일(문자 수는 한도 이하이나 UTF-8 바이트가 204,800을 넘는 다바이트 파일 포함), 빈 본문 파일(BOM만 있는 파일 포함. 크기와 빈 본문은 선행 BOM 하나를 제거한 본문 기준)
     * @when 검사에 실패하는 파일을 선택한다
     * @then 안내가 표시된다
     * @then 파일 선택이 해제된다
     * @then "내용 보기"가 비활성화된다
     */
    test("[EC-9] 검사에 실패한 파일은 안내가 표시되고 선택이 해제되며 내용 보기가 비활성화된다", async ({ page }) => {
      await login(page, COMPANY);
      await page.goto(NEW);
      await expect(viewButton(page)).toBeDisabled();

      const samples = [
        {
          label: "비 UTF-8",
          file: { name: "bad-encoding.txt", mimeType: "text/plain", buffer: Buffer.from([0x80, 0xff, 0xc3, 0x28]) },
          message: "UTF-8 텍스트 파일만 사용할 수 있습니다.",
        },
        {
          label: "확장자 불가",
          file: { name: "document.pdf", mimeType: "application/pdf", buffer: Buffer.from("본문", "utf-8") },
          message: ".txt, .md 파일만 사용할 수 있습니다.",
        },
        {
          // 68,267자 x 3바이트 = 204,801 bytes. 문자 수는 204,800 이하다.
          label: "200KiB 초과(다바이트)",
          file: textFile("too-large.txt", "가".repeat(68_267)),
          message: "파일 본문은 200KiB 이하여야 합니다.",
        },
        {
          label: "BOM만 있는 빈 본문",
          file: { name: "empty.txt", mimeType: "text/plain", buffer: Buffer.from(BOM, "utf-8") },
          message: "파일에 본문이 없습니다.",
        },
      ];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          await fileInput(page).setInputFiles(sample.file);
          await expect(fileInput(page)).toHaveAccessibleDescription(sample.message);
          await expect.poll(() => selectedFiles(page)).toEqual([]);
          await expect(viewButton(page)).toBeDisabled();
        });
      }
    });

    /**
     * @spec EC-10
     * @given 기업 담당자로 로그인해 등록 화면에서 파일을 선택했다. 제목 표본을 하나씩 반복한다: 빈 제목, 공백뿐인 제목, trim 후 100자를 넘는 제목
     * @when 등록한다
     * @then 등록 요청을 보내지 않는다
     * @then 제목 옆에 안내가 표시된다
     */
    test("[EC-10] 제목이 비었거나 trim 후 100자를 넘으면 요청 없이 제목 옆에 안내가 보인다", async ({ page }, testInfo) => {
      await login(page, COMPANY);
      let createRequests = 0;
      page.on("request", (request) => {
        const data = request.method() === "POST" ? request.postData() : null;
        if (data?.includes('"documents.create"')) createRequests += 1;
      });

      await page.goto(NEW);
      await fileInput(page).setInputFiles(textFile(`${unique(testInfo, "title")}.md`, "본문"));
      await expect(viewButton(page)).toBeEnabled();

      const samples = [
        { label: "빈 제목", title: "", message: "제목을 입력해 주세요." },
        { label: "공백뿐인 제목", title: "     ", message: "제목을 입력해 주세요." },
        { label: "trim 후 100자 초과", title: `  ${"가".repeat(101)}  `, message: "제목은 100자 이하로 입력해 주세요." },
      ];

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          await titleInput(page).fill(sample.title);
          await submitButton(page).click();
          await expect(titleInput(page)).toHaveAccessibleDescription(sample.message);
          await expect(page).toHaveURL(new RegExp(`${NEW}$`));
        });
      }
      expect(createRequests).toBe(0);
    });

    /**
     * @spec EC-14
     * @given 기업 담당자가 등록 화면에서 제목을 입력했고 파일은 선택하지 않았다
     * @when 등록한다
     * @then 요청이 전송되지 않는다
     * @then 파일 입력 옆에 안내가 표시된다
     */
    test("[EC-14] 파일을 선택하지 않고 제출하면 요청 없이 파일 입력 옆에 안내가 보인다", async ({ page }, testInfo) => {
      await login(page, COMPANY);
      let createRequests = 0;
      page.on("request", (request) => {
        const data = request.method() === "POST" ? request.postData() : null;
        if (data?.includes('"documents.create"')) createRequests += 1;
      });

      await page.goto(NEW);
      await titleInput(page).fill(unique(testInfo, "파일없음"));
      await submitButton(page).click();

      await expect(fileInput(page)).toHaveAccessibleDescription("파일을 선택해 주세요.");
      await expect(page).toHaveURL(new RegExp(`${NEW}$`));
      expect(createRequests).toBe(0);
    });
  });

  test.describe("서버 요청이 실패하는 경우", () => {
    /**
     * @spec EC-11 EC-12
     * @given 기업 담당자로 로그인해 제목을 입력하고 파일을 선택했다. 등록 요청이 실패한다. 응답 표본을 하나씩 반복한다: 400, 403, 413, 401, 404, 5xx, 네트워크 오류(서버 응답에 message가 담겨 있다)
     * @when 등록한다
     * @then 폼 상단 role="alert"에 고정 문구가 표시된다: 400 "입력값을 확인해 주세요", 403 "자료를 등록할 권한이 없습니다", 413 "파일이 너무 큽니다", 그 밖의 모든 오류(401, 404, 5xx, 네트워크) "저장하지 못했습니다. 다시 시도해 주세요"
     * @then 서버 message는 노출되지 않는다
     * @then 제목·선택한 파일·읽은 본문이 보존된다
     * @then 같은 화면에서 다시 제출할 수 있다
     */
    test("[EC-11][EC-12] 서버 오류는 고정 문구로 표시되고 입력이 보존되어 같은 화면에서 다시 제출할 수 있다", async ({ page }, testInfo) => {
      await login(page, COMPANY);
      const title = unique(testInfo, "실패보존");
      const fileName = `${unique(testInfo, "keep")}.md`;
      const body = "보존할 본문\n둘째 줄";
      const fallback = "저장하지 못했습니다. 다시 시도해 주세요";
      const samples: { label: string; status: number | null; text: string }[] = [
        { label: "400", status: 400, text: "입력값을 확인해 주세요" },
        { label: "403", status: 403, text: "자료를 등록할 권한이 없습니다" },
        { label: "413", status: 413, text: "파일이 너무 큽니다" },
        { label: "401", status: 401, text: fallback },
        { label: "404", status: 404, text: fallback },
        { label: "500", status: 500, text: fallback },
        { label: "네트워크 오류", status: null, text: fallback },
      ];

      // 현재 표본이 있으면 실패시키고, 없으면 실제 서버로 보낸다.
      let current: (typeof samples)[number] | null = null;
      await interceptCreate(page, async (route) => {
        if (current === null) {
          await route.continue();
        } else if (current.status === null) {
          await route.abort("failed");
        } else {
          await route.fulfill({
            status: current.status,
            contentType: "application/json",
            body: JSON.stringify({ kind: "mocked", message: SERVER_MESSAGE }),
          });
        }
      });

      await page.goto(NEW);
      await titleInput(page).fill(title);
      await fileInput(page).setInputFiles(textFile(fileName, body));

      for (const sample of samples) {
        await test.step(sample.label, async () => {
          current = sample;
          await submitButton(page).click();
          const alert = page.getByRole("alert");
          await expect(alert).toHaveText(sample.text);
          await expect(alert).not.toContainText(SERVER_MESSAGE);
          await expect(page).toHaveURL(new RegExp(`${NEW}$`));
          // 입력 보존과 재제출 가능 상태
          await expect(titleInput(page)).toHaveValue(title);
          await expect.poll(() => selectedFiles(page)).toEqual([fileName]);
          await expectModalContent(page, fileName, body);
          await expect(titleInput(page)).toBeEnabled();
          await expect(submitButton(page)).toBeEnabled();
        });
      }

      // 같은 화면에서 다시 제출하면 보존된 값으로 실제 등록된다.
      current = null;
      await submitButton(page).click();
      await expect(page).toHaveURL(DETAIL);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect(page.getByRole("article")).toContainText(fileName);
    });

    /**
     * @spec EC-11 EC-12
     * @given 기업 담당자로 로그인해 같은 제목·파일·본문의 자료를 이미 한 번 등록했다
     * @when 등록 화면에서 같은 제목·파일·본문으로 다시 등록한다
     * @then 폼 상단 role="alert"에 "이미 등록된 자료입니다"가 표시된다
     * @then 서버 message는 노출되지 않는다
     * @then 상세 화면으로 이동하지 않는다
     * @then 제목·선택한 파일·읽은 본문이 보존되고 같은 화면에서 다시 제출할 수 있다
     */
    test("[EC-11][EC-12] 같은 제목·파일·본문을 두 번 등록하면 이미 등록된 자료입니다가 표시되고 이동하지 않는다", async ({ page }, testInfo) => {
      await login(page, COMPANY);
      const title = unique(testInfo, "중복");
      const fileName = `${unique(testInfo, "dup")}.md`;
      const body = "중복 확인용 본문\n둘째 줄";

      // 첫 번째 등록은 성공해 상세 화면으로 이동한다.
      await page.goto(NEW);
      await titleInput(page).fill(title);
      await fileInput(page).setInputFiles(textFile(fileName, body));
      await submitButton(page).click();
      await expect(page).toHaveURL(DETAIL);

      // 같은 값으로 다시 등록한다.
      await page.goto(NEW);
      await titleInput(page).fill(title);
      await fileInput(page).setInputFiles(textFile(fileName, body));
      await submitButton(page).click();

      const alert = page.getByRole("alert");
      await expect(alert).toHaveText("이미 등록된 자료입니다");
      await expect(alert).not.toContainText("Resource already exists");
      await expect(page).toHaveURL(new RegExp(`${NEW}$`));
      await expect(titleInput(page)).toHaveValue(title);
      await expect.poll(() => selectedFiles(page)).toEqual([fileName]);
      await expectModalContent(page, fileName, body);
      await expect(titleInput(page)).toBeEnabled();
      await expect(submitButton(page)).toBeEnabled();

      // 같은 화면에서 다시 제출할 수 있다(같은 값이므로 다시 409).
      await submitButton(page).click();
      await expect(page.getByRole("alert")).toHaveText("이미 등록된 자료입니다");
      await expect(page).toHaveURL(new RegExp(`${NEW}$`));
    });
  });

  test.describe("요청 전체 크기가 한도를 넘는 경우", () => {
    /**
     * @spec EC-5
     * @given 기업 담당자로 인증된 상태에서 전체 크기가 256KiB(262,144 bytes)를 근소하게 넘는 등록 요청이 있다
     * @when 실제 서버에 그 요청을 보낸다
     * @then 413 상태가 반환된다
     */
    test("[EC-5] 전체 크기가 256KiB를 넘는 등록 요청은 413 상태가 반환된다", async ({ page }, testInfo) => {
      await login(page, COMPANY);
      const LIMIT = 256 * 1024;
      const make = (content: string) => ({
        workspaceId: WORKSPACE,
        method: "documents.create",
        params: { title: unique(testInfo, "과대요청"), fileName: "oversize.md", content },
      });
      // 직렬화한 전체 요청이 한도보다 정확히 1 byte 크도록 본문 길이를 맞춘다.
      const overhead = Buffer.byteLength(JSON.stringify(make("")));
      const request = make("a".repeat(LIMIT + 1 - overhead));
      expect(Buffer.byteLength(JSON.stringify(request))).toBe(LIMIT + 1);

      const response = await page.request.post("/api/dataroom/rpc", { data: request });
      expect(response.status()).toBe(413);
    });
  });

  test.describe("제출이 진행 중인 경우", () => {
    /**
     * @spec EC-13
     * @given 기업 담당자로 로그인해 제목을 입력하고 파일을 선택했다. 등록 요청의 응답이 지연된다
     * @when 등록한다
     * @then 응답을 받기 전까지 입력과 등록 버튼이 비활성화된다
     */
    test("[EC-13] 제출 중에는 입력과 등록 버튼이 비활성화된다", async ({ page }, testInfo) => {
      await login(page, COMPANY);
      const title = unique(testInfo, "지연");
      const fileName = `${unique(testInfo, "slow")}.md`;

      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await interceptCreate(page, async (route) => {
        await gate;
        await route.continue();
      });

      await page.goto(NEW);
      await titleInput(page).fill(title);
      await fileInput(page).setInputFiles(textFile(fileName, "지연 확인 본문"));
      await submitButton(page).click();

      // 응답이 오기 전에는 입력과 등록 버튼이 모두 비활성화돼 있다.
      await expect(submitButton(page)).toBeDisabled();
      await expect(titleInput(page)).toBeDisabled();
      await expect(fileInput(page)).toBeDisabled();
      await expect(page).toHaveURL(new RegExp(`${NEW}$`));

      // 응답을 풀어 주면 등록이 끝나고 상세 화면으로 이동한다.
      release();
      await expect(page).toHaveURL(DETAIL);
    });
  });
});
