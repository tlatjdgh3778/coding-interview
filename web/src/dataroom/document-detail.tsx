import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "@biyard/components";
import { useDocument } from "../api/hooks/use-documents";
import { useI18n } from "../i18n";
import { StatusBadge } from "./status-badge";

export function DocumentDetail({ userId, workspaceId }: { userId: string; workspaceId: string }) {
  const { t } = useI18n();
  const { documentId = "" } = useParams();
  const location = useLocation();
  const document = useDocument(userId, workspaceId, documentId);
  const back = `/workspace/${encodeURIComponent(workspaceId)}${
    (location.state as { search?: string } | null)?.search ?? ""
  }`;
  const doc = document.data;
  const notFound = (document.error as { status?: number } | null)?.status === 404;
  return (
    <section className="space-y-6">
      <Link to={back} className="inline-flex min-h-11 items-center underline">
        {t.backToList}
      </Link>
      {document.isPending ? (
        <p role="status">{t.loading}</p>
      ) : notFound ? (
        <p role="alert">{t.documentNotFound}</p>
      ) : document.isError ? (
        <div role="alert" className="flex flex-col items-start gap-4">
          <p>{t.documentError}</p>
          <Button variant="outline" onClick={() => document.refetch()}>
            {t.retry}
          </Button>
        </div>
      ) : doc ? (
        <article className="space-y-4">
          <h1 className="text-heading-3 font-semibold break-words">{doc.title}</h1>
          <dl className="grid gap-2">
            <div>
              <dt className="text-caption text-muted-foreground">{t.documentFileName}</dt>
              <dd className="break-all">{doc.fileName}</dd>
            </div>
            <div>
              <dt className="text-caption text-muted-foreground">{t.documentStatus}</dt>
              <dd>
                <StatusBadge status={doc.status} />
              </dd>
            </div>
          </dl>
          {doc.status !== "ready" ? (
            <p role="note" className="rounded-md border border-border bg-card p-3">
              {t.notEvidenceEligible}
            </p>
          ) : null}
          <div>
            <h2 className="text-caption text-muted-foreground">{t.documentContent}</h2>
            <p className="whitespace-pre-wrap break-words">{doc.content}</p>
          </div>
        </article>
      ) : null}
    </section>
  );
}
