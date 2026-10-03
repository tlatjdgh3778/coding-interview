import type { PluginProps } from "@interview/plugin-sdk/react";
import { NotFound } from "./common";
import { CompanyCriteria } from "./company-criteria";
import { CriteriaList } from "./criteria-list";
import { parseRoute } from "./route";
import { getText } from "./text";

export const App: React.FC<PluginProps> = ({ host, context }) => {
  const text = getText(context);
  // 기업 사용자는 경로와 무관하게 안내와 criteria.list 읽기 전용 목록만 본다(reviews·documents 요청 없음).
  if (context.user.role === "company") {
    return (
      <section className="rounded-lg border border-border bg-card p-6">
        <h1 className="text-heading-4 font-semibold">{text.title}</h1>
        <p role="status">{text.companyUnavailable}</p>
        <div className="mt-4">
          <CompanyCriteria host={host} context={context} />
        </div>
      </section>
    );
  }
  const route = parseRoute(context.location);
  if (route.name === "notFound") {
    return <NotFound text={text} onBack={() => host.navigate("/")} />;
  }
  // 사용자·workspace가 바뀌면 작성 중 입력 상태까지 새로 시작한다.
  const key = `${context.user.id}:${context.workspaceId}`;
  return (
    <CriteriaList
      key={key}
      host={host}
      context={context}
      activeId={route.name === "criterion" ? route.id : null}
    />
  );
};
