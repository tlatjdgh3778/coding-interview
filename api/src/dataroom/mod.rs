pub mod models;
pub mod types;
use crate::{
    auth::AuthenticatedUser,
    error::ApiError,
    types::{DataroomRpcRequest, RpcResponse},
};
use sqlx::PgPool;
use types::{GetDocumentRequest, GetDocumentResponse, ListDocumentsRequest, ListDocumentsResponse};

const MAX_QUERY_CHARS: usize = 100;

pub async fn dispatch(
    pool: &PgPool,
    user: &AuthenticatedUser,
    request: DataroomRpcRequest,
) -> Result<RpcResponse, ApiError> {
    if request.workspace_id != user.workspace_id {
        return Err(ApiError::forbidden());
    }
    match request.method.as_str() {
        "documents.list" => {
            let params: ListDocumentsRequest = if request.params.is_null() {
                ListDocumentsRequest::default()
            } else {
                serde_json::from_value(request.params)
                    .map_err(|_| ApiError::invalid("Invalid documents.list params."))?
            };
            let query = params.query.as_deref().map(str::trim).unwrap_or("");
            if query.chars().count() > MAX_QUERY_CHARS {
                return Err(ApiError::invalid("Search query is too long."));
            }
            let query = (!query.is_empty()).then_some(query);
            let documents = models::list_documents(pool, &user.workspace_id, query).await?;
            Ok(RpcResponse {
                result: serde_json::to_value(ListDocumentsResponse { documents })
                    .map_err(ApiError::storage)?,
            })
        }
        "documents.get" => {
            let params: GetDocumentRequest = serde_json::from_value(request.params)
                .map_err(|_| ApiError::invalid("Invalid documents.get params."))?;
            let document = models::get_document(pool, &user.workspace_id, &params.document_id)
                .await?
                .ok_or_else(ApiError::not_found)?;
            Ok(RpcResponse {
                result: serde_json::to_value(GetDocumentResponse { document })
                    .map_err(ApiError::storage)?,
            })
        }
        _ => Err(ApiError::not_implemented("dataroom::dispatch")),
    }
}
