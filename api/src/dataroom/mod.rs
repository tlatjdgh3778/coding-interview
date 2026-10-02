pub mod models;
pub mod types;
use crate::{
    auth::AuthenticatedUser,
    error::ApiError,
    types::{DataroomRpcRequest, RpcResponse, UserRole},
};
use rand::RngCore;
use sqlx::PgPool;
use types::{
    CreateDocumentRequest, GetDocumentRequest, GetDocumentResponse, ListDocumentsRequest,
    ListDocumentsResponse,
};

const MAX_QUERY_CHARS: usize = 100;
const MAX_TITLE_CHARS: usize = 100;
const MAX_FILE_NAME_CHARS: usize = 255;
const MAX_CONTENT_BYTES: usize = 200 * 1024;

fn new_document_id() -> String {
    let mut bytes = [0u8; 8];
    rand::rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("doc-{hex}")
}

fn validate_file_name(name: &str) -> Result<(), ApiError> {
    let invalid = || ApiError::invalid("Invalid file name.");
    if name.chars().count() > MAX_FILE_NAME_CHARS
        || name != name.trim()
        || name
            .chars()
            .any(|c| c.is_control() || c == '/' || c == '\\')
    {
        return Err(invalid());
    }
    let lower = name.to_ascii_lowercase();
    let ext_len = if lower.ends_with(".txt") {
        4
    } else if lower.ends_with(".md") {
        3
    } else {
        return Err(invalid());
    };
    if name.len() == ext_len {
        return Err(invalid());
    }
    Ok(())
}

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
        "documents.create" => {
            if !matches!(user.role, UserRole::Company) {
                return Err(ApiError::forbidden());
            }
            let params: CreateDocumentRequest = serde_json::from_value(request.params)
                .map_err(|_| ApiError::invalid("Invalid documents.create params."))?;
            let title = params.title.trim();
            if title.is_empty()
                || title.contains('\u{0}')
                || title.chars().count() > MAX_TITLE_CHARS
            {
                return Err(ApiError::invalid("Invalid title."));
            }
            validate_file_name(&params.file_name)?;
            let content = params
                .content
                .strip_prefix('\u{FEFF}')
                .unwrap_or(&params.content);
            if content.trim().is_empty()
                || content.contains('\u{0}')
                || content.len() > MAX_CONTENT_BYTES
            {
                return Err(ApiError::invalid("Invalid content."));
            }
            let document = models::create_document(
                pool,
                &new_document_id(),
                &user.workspace_id,
                &user.id,
                title,
                &params.file_name,
                content,
            )
            .await?;
            Ok(RpcResponse {
                result: serde_json::to_value(GetDocumentResponse { document })
                    .map_err(ApiError::storage)?,
            })
        }
        _ => Err(ApiError::not_implemented("dataroom::dispatch")),
    }
}
