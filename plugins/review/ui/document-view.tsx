import { isPluginRpcError } from "@interview/plugin-sdk";
import type { PluginProps } from "@interview/plugin-sdk/react";
import { LoadingNotice, QueryError } from "./common";
import { useDocument } from "./hooks";
import { Modal } from "./modal";
import { Badge } from "@biyard/components";
import { getText } from "./text";

/** 근거 자료 미리보기 모달. 열렸을 때만 마운트되어 documents.get을 호출한다. */
export function DocumentPreview({
  host,
  context,
  documentId,
  label,
  onClose,
}: PluginProps & { documentId: string; label: string; onClose: () => void }) {
  const text = getText(context);
  const query = useDocument({ host, context }, documentId);
  const notFound = isPluginRpcError(query.error) && query.error.status === 404;
  const doc = query.data?.document;
  const created = doc
    ? new Intl.DateTimeFormat(context.locale, { dateStyle: "medium", timeStyle: "short" }).format(
        new Date(doc.createdAt),
      )
    : null;

  return (
    <Modal
      labelId="preview-title"
      title={text.previewTitle(doc?.title ?? label)}
      closeLabel={text.close}
      onClose={onClose}
    >
      {query.isPending ? <LoadingNotice text={text} /> : null}
      {query.isError ? (
        <QueryError
          message={notFound ? text.documentNotFound : text.documentError}
          retryLabel={text.retry}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {doc ? (
        <article className="space-y-4">
          <p className="text-lg font-semibold break-words">{doc.title}</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-caption text-muted-foreground">{text.fileName}</dt>
            <dd className="break-all">{doc.fileName}</dd>
            <dt className="text-caption text-muted-foreground">{text.status}</dt>
            <dd>
              <Badge
                variant={
                  doc.status === "ready"
                    ? "success"
                    : doc.status === "failed"
                      ? "danger"
                      : "warning"
                }
              >
                {text.docStatus[doc.status]}
              </Badge>
            </dd>
            <dt className="text-caption text-muted-foreground">{text.createdAt}</dt>
            <dd>
              <time dateTime={doc.createdAt}>{created}</time>
            </dd>
          </dl>
          <div className="space-y-1">
            <h3 className="text-body-sm font-semibold">{text.content}</h3>
            <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-card p-4">
              {doc.content}
            </p>
          </div>
        </article>
      ) : null}
    </Modal>
  );
}
