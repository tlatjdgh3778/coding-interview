import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@biyard/components";
import type { PluginProps } from "@interview/plugin-sdk/react";
import type { Review } from "@interview/api-types/Review";
import { LoadingNotice, NotFound, QueryError, StatusBadge } from "./common";
import { CriterionModal } from "./criterion-page";
import { DocumentPreview } from "./document-view";
import { useCriteria, useDocuments, useReviews } from "./hooks";
import { criterionPath } from "./route";
import { ReviewSummary } from "./summary";
import { getText } from "./text";

/** 기준 목록. activeId가 있으면 목록을 그대로 렌더한 채 그 위에 모달을 연다. */
export function CriteriaList({
  host,
  context,
  activeId,
}: PluginProps & { activeId: string | null }) {
  const text = getText(context);
  const criteria = useCriteria({ host, context });
  const reviews = useReviews({ host, context });
  const documents = useDocuments({ host, context });
  const [preview, setPreview] = useState<{ id: string; label: string } | null>(null);
  const titles = new Map((documents.data?.documents ?? []).map((doc) => [doc.id, doc.title]));
  const criteriaData = criteria.data?.criteria;
  const reviewsData = reviews.data?.reviews;
  const active = activeId === null ? null : criteriaData?.find((item) => item.id === activeId);

  if (activeId !== null && criteriaData && reviewsData && !active) {
    return <NotFound text={text} onBack={() => host.navigate("/")} />;
  }

  return (
    <section className="space-y-4">
      <h1 className="text-heading-4 font-semibold">{text.title}</h1>
      <ReviewSummary host={host} context={context} />
      {criteria.isError ? (
        <QueryError
          message={text.criteriaError}
          retryLabel={text.retry}
          onRetry={() => void criteria.refetch()}
        />
      ) : null}
      {reviews.isError ? (
        <QueryError
          message={text.reviewsError}
          retryLabel={text.retry}
          onRetry={() => void reviews.refetch()}
        />
      ) : null}
      {criteria.isPending || reviews.isPending ? (
        criteria.isError || reviews.isError ? null : (
          <LoadingNotice text={text} />
        )
      ) : criteriaData && reviewsData ? (
        <ul className="space-y-3">
          {criteriaData.map((criterion, index) => {
            const review = reviewsData.find((item) => item.criterionId === criterion.id);
            return (
              <li key={criterion.id}>
                <Card>
                  <CardHeader className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="text-heading-5 font-semibold text-muted-foreground"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <CardTitle>{criterion.title}</CardTitle>
                    </div>
                    <StatusBadge status={review?.status ?? null} text={text} />
                  </CardHeader>
                  <CardContent className="flex flex-col items-start gap-3">
                    <p>
                      <span className="sr-only">{text.question}: </span>
                      {criterion.reviewQuestion}
                    </p>
                    {review ? (
                      <SavedSummary
                        context={context}
                        review={review}
                        titles={titles}
                        documentsPending={documents.isPending}
                        onPreview={setPreview}
                      />
                    ) : null}
                    <Button
                      variant="outline"
                      className="min-h-11"
                      aria-label={`${criterion.title} ${review ? text.edit : text.write}`}
                      onClick={() => host.navigate(criterionPath(criterion.id))}
                    >
                      {review ? text.edit : text.write}
                    </Button>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
      {active && reviewsData ? (
        <CriterionModal
          key={active.id}
          host={host}
          context={context}
          criterion={active}
          review={reviewsData.find((item) => item.criterionId === active.id)}
          onClose={() => host.navigate("/")}
        />
      ) : null}
      {preview ? (
        <DocumentPreview
          host={host}
          context={context}
          documentId={preview.id}
          label={preview.label}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </section>
  );
}

function SavedSummary({
  context,
  review,
  titles,
  documentsPending,
  onPreview,
}: Pick<PluginProps, "context"> & {
  review: Review;
  titles: Map<string, string>;
  documentsPending: boolean;
  onPreview: (target: { id: string; label: string }) => void;
}) {
  const text = getText(context);
  const updatedAt = new Intl.DateTimeFormat(context.locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(review.updatedAt));
  return (
    <div className="w-full space-y-2">
      <p className="line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">
        {review.comment}
      </p>
      <ul className="flex flex-wrap gap-2">
        {review.evidenceDocumentIds.map((id) => {
          const title = titles.get(id);
          const shown =
            title ?? (documentsPending ? text.evidenceLoading : text.evidenceTitleUnavailable);
          return (
            <li key={id} className="max-w-full">
              <button
                type="button"
                aria-label={text.previewOpen(shown)}
                onClick={() => onPreview({ id, label: title ?? text.evidencePreviewTitle })}
                className="min-h-11 max-w-full break-all rounded-full bg-secondary px-2.5 py-1 text-caption text-secondary-foreground"
              >
                {shown}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-caption text-muted-foreground">
        {text.lastModified}: <time dateTime={review.updatedAt}>{updatedAt}</time>
      </p>
    </div>
  );
}
