import { Circle, CircleAlert, CircleCheck } from "lucide-react";
import { Badge, Button } from "@biyard/components";
import type { ReviewStatus } from "@interview/api-types/ReviewStatus";
import type { Text } from "./text";

export function StatusBadge({ status, text }: { status: ReviewStatus | null; text: Text }) {
  const icon = "mr-1 h-3.5 w-3.5";
  if (status === "satisfied")
    return (
      <Badge variant="success">
        <CircleCheck aria-hidden="true" className={icon} />
        {text.satisfied}
      </Badge>
    );
  if (status === "needs_information")
    return (
      <Badge variant="warning">
        <CircleAlert aria-hidden="true" className={icon} />
        {text.needsInformation}
      </Badge>
    );
  return (
    <Badge>
      <Circle aria-hidden="true" className={icon} />
      {text.unwritten}
    </Badge>
  );
}

export function LoadingNotice({ text }: { text: Text }) {
  return <p role="status">{text.loading}</p>;
}

export function QueryError({
  message,
  retryLabel,
  onRetry,
}: {
  message: string;
  retryLabel: string;
  onRetry: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <p>{message}</p>
      <Button variant="outline" className="min-h-11" onClick={onRetry}>
        {retryLabel}
      </Button>
    </div>
  );
}

export function NotFound({ text, onBack }: { text: Text; onBack: () => void }) {
  return (
    <section className="flex flex-col items-start gap-3">
      <h1 className="text-heading-4 font-semibold">{text.notFoundTitle}</h1>
      <p>{text.notFoundBody}</p>
      <Button variant="outline" className="min-h-11" onClick={onBack}>
        {text.back}
      </Button>
    </section>
  );
}
