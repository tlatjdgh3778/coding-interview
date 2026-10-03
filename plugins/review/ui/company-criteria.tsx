import { Card, CardContent, CardHeader, CardTitle } from "@biyard/components";
import type { PluginProps } from "@interview/plugin-sdk/react";
import { LoadingNotice, QueryError } from "./common";
import { useCriteria } from "./hooks";
import { getText } from "./text";

/** 기업 담당자용 읽기 전용 기준 목록. criteria.list만 호출하며 배지·버튼·모달이 없다. */
export function CompanyCriteria({ host, context }: PluginProps) {
  const text = getText(context);
  const criteria = useCriteria({ host, context });

  return (
    <section aria-labelledby="company-criteria-heading" className="space-y-3">
      <h2 id="company-criteria-heading" className="text-heading-5 font-semibold">
        {text.criteriaHeading}
      </h2>
      {criteria.isPending ? <LoadingNotice text={text} /> : null}
      {criteria.isError ? (
        <QueryError
          message={text.criteriaError}
          retryLabel={text.retry}
          onRetry={() => void criteria.refetch()}
        />
      ) : null}
      {criteria.data ? (
        <ul className="space-y-3">
          {criteria.data.criteria.map((criterion, index) => (
            <li key={criterion.id}>
              <Card>
                <CardHeader className="flex items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="text-heading-5 font-semibold text-muted-foreground"
                  >
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <CardTitle>{criterion.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p>
                    <span className="sr-only">{text.question}: </span>
                    {criterion.reviewQuestion}
                  </p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
