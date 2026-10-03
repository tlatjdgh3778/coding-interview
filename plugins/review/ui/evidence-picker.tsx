import { ExternalLink } from "lucide-react";
import { Button } from "@biyard/components";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ListDocumentsResponse } from "@interview/api-types/ListDocumentsResponse";
import { LoadingNotice, QueryError } from "./common";
import type { Text } from "./text";

export function EvidencePicker({
  documents,
  selected,
  disabled,
  invalid,
  describedBy,
  text,
  onToggle,
  onPreview,
}: {
  documents: UseQueryResult<ListDocumentsResponse>;
  selected: ReadonlySet<string>;
  disabled: boolean;
  invalid: boolean;
  describedBy?: string;
  text: Text;
  onToggle: (id: string, checked: boolean) => void;
  onPreview: (id: string, label: string) => void;
}) {
  if (documents.isPending) return <LoadingNotice text={text} />;
  if (documents.isError || !documents.data) {
    return (
      <QueryError
        message={text.documentsError}
        retryLabel={text.retry}
        onRetry={() => void documents.refetch()}
      />
    );
  }
  const items = documents.data.documents;
  const hasReady = items.some((doc) => doc.status === "ready");
  return (
    <div className="space-y-3">
      {hasReady ? null : <p>{text.noReadyDocuments}</p>}
      <ul className="space-y-2">
        {items.map((doc) => {
          const selectable = doc.status === "ready";
          const inputId = `evidence-${doc.id}`;
          const reasonId = `${inputId}-reason`;
          return (
            <li
              key={doc.id}
              className="flex min-h-11 items-start gap-3 rounded-md border border-border bg-card p-3"
            >
              <input
                id={inputId}
                type="checkbox"
                className="mt-1 h-5 w-5 shrink-0"
                checked={selected.has(doc.id)}
                disabled={disabled || !selectable}
                aria-invalid={invalid || undefined}
                aria-describedby={
                  [!selectable ? reasonId : null, describedBy].filter(Boolean).join(" ") ||
                  undefined
                }
                onChange={(event) => onToggle(doc.id, event.target.checked)}
              />
              <label htmlFor={inputId} className="min-w-0 break-words">
                <span className="block font-semibold">{doc.title}</span>
                <span className="block break-all text-caption text-muted-foreground">
                  {doc.fileName}
                </span>
                {selectable ? null : (
                  <span id={reasonId} className="block text-caption text-muted-foreground">
                    {text.notSelectable(doc.status)}
                  </span>
                )}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto min-h-11 min-w-11 shrink-0"
                aria-label={text.previewOpen(doc.title)}
                onClick={() => onPreview(doc.id, doc.title)}
              >
                <ExternalLink aria-hidden="true" className="h-4 w-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
