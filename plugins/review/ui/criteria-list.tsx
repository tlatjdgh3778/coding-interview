import { Button, Card, CardContent, CardHeader, CardTitle } from "@biyard/components";
import type { PluginProps } from "@interview/plugin-sdk/react";
import type { Review } from "@interview/api-types/Review";
import { LoadingNotice, NotFound, QueryError, StatusBadge } from "./common";
import { CriterionModal } from "./criterion-page";
import { useCriteria, useDocuments, useReviews } from "./hooks";
import { criterionPath } from "./route";
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
  const criteriaData = criteria.data?.criteria;
  const reviewsData = reviews.data?.reviews;
  const active = activeId === null ? null : criteriaData?.find((item) => item.id === activeId);

  if (activeId !== null && criteriaData && reviewsData && !active) {
    return <NotFound text={text} onBack={() => host.navigate("/")} />;
  }

  return (
    <section className="space-y-4">
      <h1 className="text-heading-4 font-semibold">{text.title}</h1>
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
                    {review ? <SavedSummary host={host} context={context} review={review} /> : null}
                    <Button
                      variant="outline"
                      className="min-h-11"
                      aria-label={`${criterion.title} ${review ? text.view : text.write}`}
                      onClick={() => host.navigate(criterionPath(criterion.id))}
                    >
                      {review ? text.view : text.write}
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
    </section>
  );
}

function SavedSummary({ host, context, review }: PluginProps & { review: Review }) {
  const documents = useDocuments({ host, context });
  const titles = new Map((documents.data?.documents ?? []).map((doc) => [doc.id, doc.title]));
  return (
    <div className="w-full space-y-2">
      <p className="line-clamp-2 whitespace-pre-wrap break-words text-muted-foreground">
        {review.comment}
      </p>
      <ul className="flex flex-wrap gap-2">
        {review.evidenceDocumentIds.map((id) => (
          <li
            key={id}
            className="max-w-full break-all rounded-full bg-secondary px-2.5 py-1 text-caption text-secondary-foreground"
          >
            {titles.get(id) ?? id}
          </li>
        ))}
      </ul>
    </div>
  );
}
