import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "@interview/api-client/runtime/client";
import { Button, Input } from "@biyard/components";
import { useCreateDocument } from "../api/hooks/use-documents";
import { useI18n } from "../i18n";

const MAX_BYTES = 204_800;
const MAX_TITLE = 100;

type Props = { userId: string; workspaceId: string; role?: string };
type FileErrorKey = "fileBadEncoding" | "fileBadExtension" | "fileTooLarge" | "fileEmpty";
type TitleErrorKey = "titleRequired" | "titleTooLong" | "fileRequired";

export function DocumentRegister({ userId, workspaceId, role }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const create = useCreateDocument(userId, workspaceId);
  const [title, setTitle] = useState("");
  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState<string | null>(null);
  const [fileError, setFileError] = useState<FileErrorKey | "fileRequired" | null>(null);
  const [titleError, setTitleError] = useState<TitleErrorKey | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const readToken = useRef(0);
  const base = `/workspace/${encodeURIComponent(workspaceId)}/documents`;

  if (role !== "company") {
    return (
      <section className="space-y-6">
        <Link
          to={`/workspace/${encodeURIComponent(workspaceId)}`}
          className="inline-flex min-h-11 items-center underline"
        >
          {t.backToList}
        </Link>
        <p role="note" className="rounded-md border border-border bg-card p-3">
          {t.registerOnlyCompany}
        </p>
      </section>
    );
  }

  function reject(key: FileErrorKey) {
    setFileError(key);
    setFileName("");
    setContent(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function pickFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const token = ++readToken.current;
    setFileError(null);
    if (!file) {
      setFileName("");
      setContent(null);
      return;
    }
    if (!/\.(txt|md)$/i.test(file.name)) return reject("fileBadExtension");
    let text: string;
    try {
      // 기본 설정이 선행 BOM 하나를 제거한다.
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      if (token === readToken.current) reject("fileBadEncoding");
      return;
    }
    if (token !== readToken.current) return;
    if (new TextEncoder().encode(text).length > MAX_BYTES) return reject("fileTooLarge");
    if (text.trim() === "") return reject("fileEmpty");
    setFileName(file.name);
    setContent(text);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    const nextTitleError: TitleErrorKey | null =
      trimmed === ""
        ? "titleRequired"
        : Array.from(trimmed).length > MAX_TITLE
          ? "titleTooLong"
          : null;
    setTitleError(nextTitleError);
    if (content === null) setFileError((current) => current ?? "fileRequired");
    if (nextTitleError || content === null) return;
    create.mutate(
      { title, fileName, content },
      { onSuccess: (document) => navigate(`${base}/${encodeURIComponent(document.id)}`) },
    );
  }

  const status = create.error instanceof ApiError ? create.error.status : null;
  const serverError =
    status === 400
      ? t.registerError400
      : status === 403
        ? t.registerError403
        : status === 409
          ? t.registerError409
          : status === 413
            ? t.registerError413
            : t.registerErrorDefault;
  const pending = create.isPending;
  return (
    <section className="space-y-6">
      <Link
        to={`/workspace/${encodeURIComponent(workspaceId)}`}
        className="inline-flex min-h-11 items-center underline"
      >
        {t.backToList}
      </Link>
      <form onSubmit={submit} noValidate className="max-w-xl space-y-6">
        <h1 className="text-heading-3 font-semibold">{t.registerDocument}</h1>
        {create.isError ? (
          <p role="alert" className="text-destructive">
            {serverError}
          </p>
        ) : null}
        <div className="flex flex-col gap-2">
          <label htmlFor="document-title">{t.documentTitle}</label>
          <Input
            id="document-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={pending}
            aria-invalid={titleError ? true : undefined}
            aria-describedby={titleError ? "document-title-error" : undefined}
          />
          {titleError ? (
            <p id="document-title-error" className="text-caption text-destructive">
              {t[titleError]}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="document-file">{t.documentFile}</label>
          <input
            id="document-file"
            ref={fileInput}
            type="file"
            accept=".txt,.md"
            onChange={pickFile}
            disabled={pending}
            aria-invalid={fileError ? true : undefined}
            aria-describedby={fileError ? "document-file-error" : undefined}
            className="min-h-11 text-body"
          />
          {fileError ? (
            <p id="document-file-error" className="text-caption text-destructive">
              {t[fileError]}
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="min-h-11 self-start"
            disabled={pending || content === null}
            onClick={() => dialog.current?.showModal()}
          >
            {t.viewContent}
          </Button>
        </div>
        <Button type="submit" disabled={pending} className="min-h-11">
          {t.registerSubmit}
        </Button>
      </form>
      <dialog
        ref={dialog}
        aria-labelledby="content-dialog-title"
        className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl open:flex flex-col gap-4 rounded-lg border border-border bg-card p-6 text-foreground"
      >
        <h2 id="content-dialog-title" className="break-all font-semibold">
          {fileName}
        </h2>
        <pre
          tabIndex={0}
          aria-label={t.documentContent}
          className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words"
        >
          {content}
        </pre>
        <Button
          type="button"
          variant="outline"
          className="min-h-11 self-end"
          onClick={() => dialog.current?.close()}
        >
          {t.closeContent}
        </Button>
      </dialog>
    </section>
  );
}
