import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { scopedKey, type PluginContext, type PluginHost } from "@interview/plugin-sdk";
import type { CreateReviewRequest } from "@interview/api-types/CreateReviewRequest";
import type { CreateReviewResponse } from "@interview/api-types/CreateReviewResponse";
import type { GetDocumentResponse } from "@interview/api-types/GetDocumentResponse";
import type { ListCriteriaResponse } from "@interview/api-types/ListCriteriaResponse";
import type { ListDocumentsResponse } from "@interview/api-types/ListDocumentsResponse";
import type { ListReviewsResponse } from "@interview/api-types/ListReviewsResponse";

interface Deps {
  host: PluginHost;
  context: PluginContext;
}

export function useCriteria({ host, context }: Deps) {
  return useQuery({
    queryKey: scopedKey(context, "review", "criteria"),
    queryFn: ({ signal }) =>
      host.call<ListCriteriaResponse>("criteria.list", undefined, { signal }),
  });
}

export function useReviews({ host, context }: Deps) {
  return useQuery({
    queryKey: scopedKey(context, "review", "reviews"),
    queryFn: ({ signal }) => host.call<ListReviewsResponse>("reviews.list", undefined, { signal }),
  });
}

export function useDocuments({ host, context }: Deps) {
  return useQuery({
    queryKey: scopedKey(context, "review", "documents", "list"),
    queryFn: ({ signal }) =>
      host.call<ListDocumentsResponse>("documents.list", {}, { target: "dataroom", signal }),
  });
}

export function useDocument({ host, context }: Deps, documentId: string) {
  return useQuery({
    queryKey: scopedKey(context, "review", "documents", "detail", documentId),
    queryFn: ({ signal }) =>
      host.call<GetDocumentResponse>(
        "documents.get",
        { documentId },
        { target: "dataroom", signal },
      ),
  });
}

export function useCreateReview({ host, context }: Deps) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateReviewRequest) =>
      host.call<CreateReviewResponse>("reviews.create", request),
    // 갱신이 끝날 때까지 pending을 유지해 입력이 다시 열리지 않게 한다.
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: scopedKey(context, "review", "reviews") }),
  });
}
