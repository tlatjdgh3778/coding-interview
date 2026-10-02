import { useQuery } from "@tanstack/react-query";
import { Route, Routes, useParams } from "react-router-dom";
import type { HostSession } from "../../../shared/platform";
import { useI18n } from "../i18n";
import { DocumentDetail } from "./document-detail";
import { DocumentList } from "./document-list";

export function DataroomApp() {
  const { t } = useI18n();
  const { workspaceId = "" } = useParams();
  // 세션은 SessionGate가 채운 캐시를 읽기만 한다(재요청하지 않는다).
  const session = useQuery<HostSession | null>({
    queryKey: ["session"],
    queryFn: () => null,
    enabled: false,
  });
  const userId = session.data?.user.id;
  if (!userId) return <p role="status">{t.loading}</p>;
  return (
    <Routes>
      <Route index element={<DocumentList userId={userId} workspaceId={workspaceId} />} />
      <Route
        path="documents/:documentId"
        element={<DocumentDetail userId={userId} workspaceId={workspaceId} />}
      />
    </Routes>
  );
}
