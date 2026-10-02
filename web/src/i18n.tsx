import { createContext, useContext, useState, type ReactNode } from "react";
import type { Locale } from "@interview/plugin-sdk";
const en = {
  appName: "Dataroom",
  login: "Sign in",
  logout: "Sign out",
  email: "Email",
  password: "Password",
  demoNotice: "Sign in to your workspace.",
  companyAccount: "Company account",
  investorAccount: "Investor account",
  company: "Company",
  investor: "Investor",
  language: "Language",
  loading: "Loading…",
  connectionError: "Could not connect to the API. Check the server and try again.",
  retry: "Try again",
  loginError: "Could not sign in. Check your credentials, then try again.",
  logoutError: "Could not sign out. Please try again.",
  workspace: "Workspace",
  noWorkspace: "No workspace is available for this account.",
  noPlugin: "This plugin is unavailable.",
  pluginError: "Could not load the plugin. Check the bundle and try again.",
  room: "Data room",
  menu: "Plugins",
  documents: "Documents",
  documentSearch: "Search by title",
  documentTitle: "Title",
  documentFileName: "File name",
  documentStatus: "Status",
  documentCreatedAt: "Created",
  documentContent: "Content",
  statusReady: "Ready",
  statusProcessing: "Processing",
  statusFailed: "Failed",
  noDocuments: "There are no documents in this data room yet.",
  noSearchResults: "No documents match your search.",
  documentsError: "Could not load documents. Try again.",
  documentError: "Could not load the document. Try again.",
  documentNotFound: "This document does not exist.",
  backToList: "Back to documents",
  notEvidenceEligible: "Cannot be linked as evidence: only ready documents can be used.",
  registerDocument: "Register document",
  registerSubmit: "Register document",
  registerOnlyCompany: "Only company representatives can register documents.",
  documentFile: "File",
  viewContent: "View content",
  closeContent: "Close",
  titleRequired: "Enter a title.",
  titleTooLong: "The title must be 100 characters or fewer.",
  fileRequired: "Select a file.",
  fileBadEncoding: "The file must be UTF-8 text.",
  fileBadExtension: "Only .txt and .md files are allowed.",
  fileTooLarge: "The file content must be 200 KiB or smaller.",
  fileEmpty: "The file has no content.",
  registerError400: "Check your input.",
  registerError403: "You do not have permission to register documents.",
  registerError409: "This document is already registered.",
  registerError413: "The file is too large.",
  registerErrorDefault: "Could not save. Please try again.",
};
type Strings = Record<keyof typeof en, string>;
const ko: Strings = {
  appName: "Dataroom",
  login: "로그인",
  logout: "로그아웃",
  email: "이메일",
  password: "비밀번호",
  demoNotice: "워크스페이스에 로그인해주세요.",
  companyAccount: "기업 계정",
  investorAccount: "투자자 계정",
  company: "기업 담당자",
  investor: "투자자",
  language: "언어",
  loading: "불러오는 중입니다.",
  connectionError: "API에 연결하지 못했습니다. 서버를 확인하고 다시 시도해주세요.",
  retry: "다시 시도",
  loginError: "로그인하지 못했습니다. 입력한 정보를 확인하고 다시 시도해주세요.",
  logoutError: "로그아웃하지 못했습니다. 다시 시도해주세요.",
  workspace: "워크스페이스",
  noWorkspace: "접근할 수 있는 워크스페이스가 없습니다.",
  noPlugin: "이 플러그인에 접근할 수 없습니다.",
  pluginError: "플러그인을 불러오지 못했습니다. 번들을 확인하고 다시 시도해주세요.",
  room: "데이터룸",
  menu: "플러그인",
  documents: "자료",
  documentSearch: "제목으로 검색",
  documentTitle: "제목",
  documentFileName: "파일명",
  documentStatus: "상태",
  documentCreatedAt: "작성 시각",
  documentContent: "본문",
  statusReady: "사용 가능",
  statusProcessing: "처리 중",
  statusFailed: "실패",
  noDocuments: "아직 등록된 자료가 없습니다.",
  noSearchResults: "검색 결과가 없습니다.",
  documentsError: "자료를 불러오지 못했습니다. 다시 시도해주세요.",
  documentError: "자료를 불러오지 못했습니다. 다시 시도해주세요.",
  documentNotFound: "존재하지 않는 자료입니다.",
  backToList: "자료 목록으로",
  notEvidenceEligible: "근거로 연결할 수 없음: 사용 가능 상태의 자료만 근거로 쓸 수 있습니다.",
  registerDocument: "자료 등록",
  registerSubmit: "자료 등록",
  registerOnlyCompany: "기업 담당자만 등록할 수 있습니다",
  documentFile: "파일",
  viewContent: "내용 보기",
  closeContent: "닫기",
  titleRequired: "제목을 입력해 주세요.",
  titleTooLong: "제목은 100자 이하로 입력해 주세요.",
  fileRequired: "파일을 선택해 주세요.",
  fileBadEncoding: "UTF-8 텍스트 파일만 사용할 수 있습니다.",
  fileBadExtension: ".txt, .md 파일만 사용할 수 있습니다.",
  fileTooLarge: "파일 본문은 200KiB 이하여야 합니다.",
  fileEmpty: "파일에 본문이 없습니다.",
  registerError400: "입력값을 확인해 주세요",
  registerError403: "자료를 등록할 권한이 없습니다",
  registerError409: "이미 등록된 자료입니다",
  registerError413: "파일이 너무 큽니다",
  registerErrorDefault: "저장하지 못했습니다. 다시 시도해 주세요",
};
const Context = createContext<{
  locale: Locale;
  setLocale(value: Locale): void;
  t: Strings;
} | null>(null);
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setValue] = useState<Locale>("ko");
  return (
    <Context.Provider
      value={{
        locale,
        t: locale === "ko" ? ko : en,
        setLocale(value) {
          document.documentElement.lang = value;
          setValue(value);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useI18n() {
  const context = useContext(Context);
  if (!context) throw new Error("LocaleProvider is missing");
  return context;
}
