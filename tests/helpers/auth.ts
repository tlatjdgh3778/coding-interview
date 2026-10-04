import { expect, type Page } from "@playwright/test";

export const PASSWORD = "dataroom";
export const INVESTOR = "investor@lighthouse.test";
export const COMPANY = "company@lighthouse.test";
export const PEER = "peer@lighthouse.test";

/** 로그인 API로 세션 쿠키(dr_session)를 받는다. 쿠키는 page의 컨텍스트에 저장된다. */
export async function login(page: Page, email: string = INVESTOR, password: string = PASSWORD) {
  const response = await page.request.post("/api/auth/login", { data: { email, password } });
  expect(response.ok()).toBeTruthy();
}
