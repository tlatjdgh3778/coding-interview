import { Card, CardContent, CardHeader, CardTitle } from "@biyard/components";
import type { Criterion } from "@interview/api-types/Criterion";
import type { PluginProps } from "@interview/plugin-sdk/react";
import type { Review } from "@interview/api-types/Review";
import { useCriteria, useReviews } from "./hooks";
import { getText } from "./text";

export interface ReviewCounts {
  total: number;
  written: number;
  satisfied: number;
  needsInformation: number;
  unwritten: number;
}

/** 기준과 매칭되는 검토만 센다. `추가 확인 필요`도 작성으로 센다. */
export function summarizeReviews(criteria: Criterion[], reviews: Review[]): ReviewCounts {
  const byCriterion = new Map(reviews.map((review) => [review.criterionId, review]));
  let written = 0;
  let satisfied = 0;
  let needsInformation = 0;
  for (const criterion of criteria) {
    const review = byCriterion.get(criterion.id);
    if (!review) continue;
    written += 1;
    if (review.status === "satisfied") satisfied += 1;
    else if (review.status === "needs_information") needsInformation += 1;
  }
  return {
    total: criteria.length,
    written,
    satisfied,
    needsInformation,
    unwritten: criteria.length - written,
  };
}

/** 목록 상단 요약 카드. 오류일 때는 숫자도 별도 오류 표시도 없이 아무것도 그리지 않는다. */
export function ReviewSummary({ host, context }: PluginProps) {
  const text = getText(context);
  const criteria = useCriteria({ host, context });
  const reviews = useReviews({ host, context });

  if (criteria.isError || reviews.isError) return null;

  const criteriaData = criteria.data?.criteria;
  const reviewsData = reviews.data?.reviews;
  const counts = criteriaData && reviewsData ? summarizeReviews(criteriaData, reviewsData) : null;

  const items = counts
    ? [
        { key: "written", label: text.summaryWritten, value: `${counts.written}/${counts.total}` },
        { key: "satisfied", label: text.satisfied, value: String(counts.satisfied) },
        {
          key: "needsInformation",
          label: text.needsInformation,
          value: String(counts.needsInformation),
        },
        { key: "unwritten", label: text.unwritten, value: String(counts.unwritten) },
      ]
    : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{text.summaryTitle}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3" aria-busy={!counts}>
        {counts ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {items.map((item) => (
              <div key={item.key} className="flex flex-col gap-1">
                <span className="text-caption text-muted-foreground">{item.label}</span>{" "}
                <span className="text-heading-5 font-semibold">{item.value}</span>
              </div>
            ))}
          </div>
        ) : criteria.isPending || reviews.isPending ? (
          <p>{text.loading}</p>
        ) : null}
        <p className="text-caption text-muted-foreground">{text.summaryNote}</p>
      </CardContent>
    </Card>
  );
}
