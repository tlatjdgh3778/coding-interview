import { Badge } from "@biyard/components";
import type { DocumentStatus } from "@interview/api-types/DocumentStatus";
import { useI18n } from "../i18n";

export function StatusBadge({ status }: { status: DocumentStatus }) {
  const { t } = useI18n();
  const label = { ready: t.statusReady, processing: t.statusProcessing, failed: t.statusFailed };
  const variant = { ready: "success", processing: "warning", failed: "danger" } as const;
  return <Badge variant={variant[status]}>{label[status]}</Badge>;
}
