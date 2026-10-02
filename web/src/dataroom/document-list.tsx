import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button, Input } from "@biyard/components";
import { useDocuments } from "../api/hooks/use-documents";
import { useI18n } from "../i18n";
import { StatusBadge } from "./status-badge";

export function DocumentList({
  userId,
  workspaceId,
  role,
}: {
  userId: string;
  workspaceId: string;
  role?: string;
}) {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const urlQuery = params.get("q") ?? "";
  const [input, setInput] = useState(urlQuery);
  const documents = useDocuments(userId, workspaceId, urlQuery.trim());

  useEffect(() => {
    if (input === urlQuery) return;
    const timer = setTimeout(() => {
      setParams(input ? { q: input } : {}, { replace: true });
    }, 250);
    return () => clearTimeout(timer);
  }, [input, urlQuery, setParams]);

  const base = `/workspace/${encodeURIComponent(workspaceId)}/documents`;
  const format = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" });
  const items = documents.data ?? [];
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-heading-3 font-semibold">{t.documents}</h1>
        {role === "company" ? (
          <Button variant="outline" className="min-h-11" onClick={() => navigate(`${base}/new`)}>
            {t.registerDocument}
          </Button>
        ) : null}
      </div>
      <label className="flex max-w-md flex-col gap-2">
        {t.documentSearch}
        <Input type="search" value={input} onChange={(event) => setInput(event.target.value)} />
      </label>
      {documents.isPending ? (
        <p role="status">{t.loading}</p>
      ) : documents.isError ? (
        <div role="alert" className="flex flex-col items-start gap-4">
          <p>{t.documentsError}</p>
          <Button variant="outline" onClick={() => documents.refetch()}>
            {t.retry}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p>{urlQuery.trim() ? t.noSearchResults : t.noDocuments}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((doc) => (
            <li key={doc.id}>
              <Link
                to={`${base}/${encodeURIComponent(doc.id)}`}
                className="flex min-h-11 flex-col gap-2 rounded-lg border border-border bg-card p-4 hover:bg-accent md:flex-row md:items-center md:justify-between"
              >
                <span className="min-w-0 break-words">
                  <span className="block font-semibold">{doc.title}</span>
                  <span className="block break-all text-caption text-muted-foreground">
                    {doc.fileName}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-3">
                  <StatusBadge status={doc.status} />
                  <time dateTime={doc.createdAt} className="text-caption text-muted-foreground">
                    {format.format(new Date(doc.createdAt))}
                  </time>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
