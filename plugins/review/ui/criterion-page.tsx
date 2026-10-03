import { useState } from "react";
import { Button, Label, Textarea } from "@biyard/components";
import { isPluginRpcError } from "@interview/plugin-sdk";
import type { PluginProps } from "@interview/plugin-sdk/react";
import type { Criterion } from "@interview/api-types/Criterion";
import type { Review } from "@interview/api-types/Review";
import type { ReviewStatus } from "@interview/api-types/ReviewStatus";
import { StatusBadge } from "./common";
import { DocumentPreview } from "./document-view";
import { Modal } from "./modal";
import { EvidencePicker } from "./evidence-picker";
import { useCreateReview, useDocuments, useUpdateReview } from "./hooks";
import { getText, type Text } from "./text";

type Preview = { id: string; label: string };

/** 작성·수정 폼을 한 모달에 담는다. 미리보기 모달은 형제로 겹쳐 아래 입력 상태를 건드리지 않는다. */
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
        title={review ? text.editTitle(criterion.title) : text.writeTitle(criterion.title)}
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
        <ReviewForm
          host={host}
          context={context}
          criterion={criterion}
          review={review}
          onCancel={onClose}
          onPreview={openPreview}
        />
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
  review,
  onCancel,
  onPreview,
}: PluginProps & {
  criterion: Criterion;
  review: Review | undefined;
  onCancel: () => void;
  onPreview: (id: string, label: string) => void;
}) {
  const text = getText(context);
  const documents = useDocuments({ host, context });
  const create = useCreateReview({ host, context });
  const update = useUpdateReview({ host, context });
  const saveMutation = review ? update : create;
  // 초기값은 한 번만 채운다. reviews.list가 다시 조회돼도 편집 중인 값은 덮어쓰지 않는다.
  const [status, setStatus] = useState<ReviewStatus | null>(review?.status ?? null);
  const [comment, setComment] = useState(review?.comment ?? "");
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(review?.evidenceDocumentIds ?? []),
  );
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
  const pending = saveMutation.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setSubmitted(true);
    if (status === null || length === 0 || length > 2000 || selected.size === 0) return;
    const request = {
      criterionId: criterion.id,
      status,
      comment: trimmed,
      evidenceDocumentIds: Array.from(selected),
    };
    // 성공하면 invalidate가 끝난 뒤 모달을 닫는다(작성·수정 공통).
    const onSuccess = () => host.navigate("/");
    if (review) update.mutate(request, { onSuccess });
    else create.mutate(request, { onSuccess });
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

      {saveMutation.isError ? (
        <p role="alert">{saveErrorMessage(saveMutation.error, text)}</p>
      ) : null}
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
