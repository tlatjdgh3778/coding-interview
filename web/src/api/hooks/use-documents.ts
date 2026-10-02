import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { dataroomRpcHandler } from "@interview/api-client/handlers/dataroomRpcHandler";
import type { CreateDocumentRequest } from "@interview/api-types/CreateDocumentRequest";
import type { GetDocumentResponse } from "@interview/api-types/GetDocumentResponse";
import type { ListDocumentsResponse } from "@interview/api-types/ListDocumentsResponse";

export function useDocuments(userId: string, workspaceId: string, query: string) {
  return useQuery({
    queryKey: [userId, workspaceId, "documents", "list", query],
    queryFn: async () => {
      const response = await dataroomRpcHandler({
        workspaceId,
        method: "documents.list",
        params: { query },
      });
      return (response.result as ListDocumentsResponse).documents;
    },
  });
}

export function useDocument(userId: string, workspaceId: string, documentId: string) {
  return useQuery({
    queryKey: [userId, workspaceId, "documents", "detail", documentId],
    queryFn: async () => {
      const response = await dataroomRpcHandler({
        workspaceId,
        method: "documents.get",
        params: { documentId },
      });
      return (response.result as GetDocumentResponse).document;
    },
    retry: (count, error) => !(error as { status?: number }).status && count < 2,
  });
}

export function useCreateDocument(userId: string, workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: CreateDocumentRequest) => {
      const response = await dataroomRpcHandler({
        workspaceId,
        method: "documents.create",
        params,
      });
      return (response.result as GetDocumentResponse).document;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [userId, workspaceId, "documents"] }),
  });
}
