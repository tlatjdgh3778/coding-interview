import { useState } from "react";
import { Button, Label, Textarea } from "@biyard/components";
import { isPluginRpcError } from "@interview/plugin-sdk";
import type { PluginProps } from "@interview/plugin-sdk/react";
import type { Criterion } from "@interview/api-types/Criterion";
import type { Review } from "@interview/api-types/Review";
import type { ReviewStatus } from "@interview/api-types/ReviewStatus";
import { QueryError, StatusBadge } from "./common";
import { DocumentPreview } from "./document-view";
import { Modal } from "./modal";
import { EvidencePicker } from "./evidence-picker";
import { useCreateReview, useDocuments } from "./hooks";
import { getText, type Text } from "./text";

type Preview = { id: string; label: string };

/** 작성 폼·읽기 전용 상세를 같은 모달에 담는다. 미리보기 모달은 형제로 겹쳐 아래 입력 상태를 건드리지 않는다. */
export function CriterionModal({
  host,
  context,
  criterion,
  review,
  onClose,
}: PluginProps & { criterion: Criterion; review: Review | undefined; onClose: () => void }) {
  const text = getText(context);
  const [preview, setPreview] = useState<Preview | null>(null);
  const openPreview = (id: string, label: string) => setPreview({ id, label });

  return (
    <>
      <Modal
        labelId="criterion-title"
        title={review ? text.detailTitle(criterion.title) : text.writeTitle(criterion.title)}
        closeLabel={text.close}
        onClose={onClose}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p>
            <span className="font-semibold">{text.question}: </span>
            {criterion.reviewQuestion}
          </p>
          <StatusBadge status={review?.status ?? null} text={text} />
        </div>
        {review ? (
          <ReviewDetail host={host} context={context} review={review} onPreview={openPreview} />
        ) : (
          <ReviewForm
            host={host}
            context={context}
            criterion={criterion}
            onCancel={onClose}
            onPreview={openPreview}
          />
        )}
      </Modal>
      {preview ? (
        <DocumentPreview
          host={host}
          context={context}
          documentId={preview.id}
          label={preview.label}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </>
  );
}

function ReviewDetail({
  host,
  context,
  review,
  onPreview,
}: PluginProps & { review: Review; onPreview: (id: string, label: string) => void }) {
  const text = getText(context);
  const documents = useDocuments({ host, context });
  const titles = new Map((documents.data?.documents ?? []).map((doc) => [doc.id, doc.title]));
  const savedAt = new Intl.DateTimeFormat(context.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(review.updatedAt));

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h3 className="text-body-sm font-semibold">{text.comment}</h3>
        <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-card p-4">
          {review.comment}
        </p>
      </div>
      <p className="text-caption text-muted-foreground">
        {text.savedAt}: <time dateTime={review.updatedAt}>{savedAt}</time>
      </p>
      <div className="space-y-2">
        <h3 className="text-body-sm font-semibold">{text.evidenceList}</h3>
        {documents.isError ? (
          <QueryError
            message={text.documentTitlesError}
            retryLabel={text.retry}
            onRetry={() => void documents.refetch()}
          />
        ) : null}
        <ul className="space-y-2">
          {review.evidenceDocumentIds.map((id) => {
            const label = titles.get(id) ?? id;
            return (
              <li key={id}>
                <Button
                  variant="outline"
                  className="min-h-11 max-w-full whitespace-normal break-all text-left"
                  aria-label={text.openDocument(label)}
                  onClick={() => onPreview(id, label)}
                >
                  {label}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function saveErrorMessage(error: unknown, text: Text): string {
  if (isPluginRpcError(error)) {
    if (error.status === 400) return text.saveErrors[400];
    if (error.status === 403) return text.saveErrors[403];
    if (error.status === 404) return text.saveErrors[404];
    if (error.status === 409) return text.saveErrors[409];
  }
  return text.saveErrors.other;
}

function ReviewForm({
  host,
  context,
  criterion,
  onCancel,
  onPreview,
}: PluginProps & {
  criterion: Criterion;
  onCancel: () => void;
  onPreview: (id: string, label: string) => void;
}) {
  const text = getText(context);
  const documents = useDocuments({ host, context });
  const create = useCreateReview({ host, context });
  const [status, setStatus] = useState<ReviewStatus | null>(null);
  const [comment, setComment] = useState("");
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [submitted, setSubmitted] = useState(false);

  const trimmed = comment.trim();
  const length = Array.from(trimmed).length;
  const statusError = submitted && status === null ? text.statusRequired : null;
  const commentError = submitted
    ? length === 0
      ? text.commentRequired
      : length > 2000
        ? text.commentTooLong
        : null
    : null;
  const evidenceError = submitted && selected.size === 0 ? text.evidenceRequired : null;
  const hasReady = documents.data?.documents.some((doc) => doc.status === "ready") ?? false;
  const pending = create.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (status === null || length === 0 || length > 2000 || selected.size === 0) return;
    create.mutate({
      criterionId: criterion.id,
      status,
      comment: trimmed,
      evidenceDocumentIds: Array.from(selected),
    });
  };

  const options: { value: ReviewStatus; label: string }[] = [
    { value: "satisfied", label: text.satisfied },
    { value: "needs_information", label: text.needsInformation },
  ];

  return (
    <form className="space-y-6" onSubmit={submit} noValidate aria-busy={pending}>
      <fieldset
        className="space-y-2"
        disabled={pending}
        aria-invalid={statusError ? true : undefined}
        aria-describedby={statusError ? "status-error" : undefined}
      >
        <legend className="text-body-sm font-semibold">{text.status}</legend>
        <div className="flex flex-col gap-2 sm:flex-row">
          {options.map((option) => (
            <label
              key={option.value}
              className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-3"
            >
              <input
                type="radio"
                name="review-status"
                value={option.value}
                className="h-5 w-5"
                checked={status === option.value}
                disabled={pending}
                onChange={() => setStatus(option.value)}
              />
              <span>
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-caption text-muted-foreground">
                  {text.statusDesc[option.value]}
                </span>
              </span>
            </label>
          ))}
        </div>
        {statusError ? (
          <p id="status-error" className="text-caption text-destructive">
            {statusError}
          </p>
        ) : null}
      </fieldset>

      <div className="space-y-2">
        <Label htmlFor="review-comment">{text.comment}</Label>
        <Textarea
          id="review-comment"
          value={comment}
          disabled={pending}
          aria-invalid={commentError ? true : undefined}
          aria-describedby={commentError ? "comment-count comment-error" : "comment-count"}
          onChange={(event) => setComment(event.target.value)}
        />
        <p id="comment-count" className="text-caption text-muted-foreground">
          {text.commentCount(length)}
        </p>
        {commentError ? (
          <p id="comment-error" className="text-caption text-destructive">
            {commentError}
          </p>
        ) : null}
      </div>

      <fieldset className="space-y-2" disabled={pending}>
        <legend className="text-body-sm font-semibold">
          {text.evidence}
          <span className="ml-2 font-normal text-muted-foreground">
            {text.atLeastOne} · {text.selectedCount(selected.size)}
          </span>
        </legend>
        <p className="text-caption text-muted-foreground">{text.evidenceHint}</p>
        <EvidencePicker
          documents={documents}
          selected={selected}
          disabled={pending}
          invalid={evidenceError !== null}
          describedBy={evidenceError ? "evidence-error" : undefined}
          text={text}
          onPreview={onPreview}
          onToggle={(id, checked) =>
            setSelected((current) => {
              const next = new Set(current);
              if (checked) next.add(id);
              else next.delete(id);
              return next;
            })
          }
        />
        {evidenceError ? (
          <p id="evidence-error" className="text-caption text-destructive">
            {evidenceError}
          </p>
        ) : null}
      </fieldset>

      {create.isError ? <p role="alert">{saveErrorMessage(create.error, text)}</p> : null}
      {pending ? <p role="status">{text.saving}</p> : null}
      <p className="text-caption text-muted-foreground">{text.private}</p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" className="min-h-11" onClick={onCancel}>
          {text.cancel}
        </Button>
        <Button type="submit" className="min-h-11" disabled={pending || !hasReady}>
          {text.save}
        </Button>
      </div>
    </form>
  );
}
