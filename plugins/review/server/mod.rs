pub mod models;
pub mod types;
use crate::{
    auth::AuthenticatedUser,
    error::ApiError,
    types::{PluginRpcRequest, RpcResponse, UserRole},
};
use rand::RngCore;
use serde::Deserialize;
use sqlx::PgPool;
use std::collections::HashSet;
use types::{
    CreateReviewRequest, CreateReviewResponse, ListCriteriaResponse, ListReviewsResponse,
    ReviewHealthResponse, UpdateReviewRequest, UpdateReviewResponse,
};

pub const ID: &str = "review";

const MAX_COMMENT_CHARS: usize = 2000;

/// `criteria.list`·`reviews.list`의 params. null 또는 `{}`만 허용한다.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EmptyParams {}

fn new_review_id() -> String {
    let mut bytes = [0u8; 8];
    rand::rng().fill_bytes(&mut bytes);
    let hex: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    format!("rev-{hex}")
}

fn check_empty_params(params: serde_json::Value, message: &'static str) -> Result<(), ApiError> {
    if params.is_null() {
        return Ok(());
    }
    serde_json::from_value::<EmptyParams>(params)
        .map(|_| ())
        .map_err(|_| ApiError::invalid(message))
}

pub async fn dispatch(
    pool: &PgPool,
    user: &AuthenticatedUser,
    request: PluginRpcRequest,
) -> Result<RpcResponse, ApiError> {
    if request.workspace_id != user.workspace_id {
        return Err(ApiError::forbidden());
    }
    match request.method.as_str() {
        "health" => Ok(RpcResponse {
            result: serde_json::to_value(ReviewHealthResponse {
                status: "ok".into(),
                plugin_id: ID.into(),
            })
            .map_err(ApiError::storage)?,
        }),
        "criteria.list" => {
            check_empty_params(request.params, "Invalid criteria.list params.")?;
            let criteria = models::list_criteria(pool).await?;
            Ok(RpcResponse {
                result: serde_json::to_value(ListCriteriaResponse { criteria })
                    .map_err(ApiError::storage)?,
            })
        }
        "reviews.list" => {
            check_empty_params(request.params, "Invalid reviews.list params.")?;
            let reviews = if matches!(user.role, UserRole::Company) {
                Vec::new()
            } else {
                models::list_reviews(pool, &user.workspace_id, &user.id).await?
            };
            Ok(RpcResponse {
                result: serde_json::to_value(ListReviewsResponse { reviews })
                    .map_err(ApiError::storage)?,
            })
        }
        "reviews.create" => {
            if matches!(user.role, UserRole::Company) {
                return Err(ApiError::forbidden());
            }
            let params: CreateReviewRequest = serde_json::from_value(request.params)
                .map_err(|_| ApiError::invalid("Invalid reviews.create params."))?;
            let comment = params.comment.trim();
            if comment.is_empty() || comment.chars().count() > MAX_COMMENT_CHARS {
                return Err(ApiError::invalid("Invalid comment."));
            }
            if !models::criterion_exists(pool, &params.criterion_id).await? {
                return Err(ApiError::not_found());
            }
            let ids = &params.evidence_document_ids;
            let unique: HashSet<&String> = ids.iter().collect();
            if ids.is_empty() || unique.len() != ids.len() {
                return Err(ApiError::invalid("Invalid evidence documents."));
            }
            let ready = models::count_ready_documents(pool, &user.workspace_id, ids).await?;
            if usize::try_from(ready).ok() != Some(ids.len()) {
                return Err(ApiError::invalid("Invalid evidence documents."));
            }
            let review = models::create_review(
                pool,
                &new_review_id(),
                &user.workspace_id,
                &user.id,
                &params.criterion_id,
                params.status,
                comment,
                ids,
            )
            .await?;
            Ok(RpcResponse {
                result: serde_json::to_value(CreateReviewResponse { review })
                    .map_err(ApiError::storage)?,
            })
        }
        "reviews.update" => {
            if matches!(user.role, UserRole::Company) {
                return Err(ApiError::forbidden());
            }
            let params: UpdateReviewRequest = serde_json::from_value(request.params)
                .map_err(|_| ApiError::invalid("Invalid reviews.update params."))?;
            let comment = params.comment.trim();
            if comment.is_empty() || comment.chars().count() > MAX_COMMENT_CHARS {
                return Err(ApiError::invalid("Invalid comment."));
            }
            if !models::criterion_exists(pool, &params.criterion_id).await? {
                return Err(ApiError::not_found());
            }
            let ids = &params.evidence_document_ids;
            let unique: HashSet<&String> = ids.iter().collect();
            if ids.is_empty() || unique.len() != ids.len() {
                return Err(ApiError::invalid("Invalid evidence documents."));
            }
            let ready = models::count_ready_documents(pool, &user.workspace_id, ids).await?;
            if usize::try_from(ready).ok() != Some(ids.len()) {
                return Err(ApiError::invalid("Invalid evidence documents."));
            }
            let review = models::update_review(
                pool,
                &user.workspace_id,
                &user.id,
                &params.criterion_id,
                params.status,
                comment,
                ids,
            )
            .await?;
            Ok(RpcResponse {
                result: serde_json::to_value(UpdateReviewResponse { review })
                    .map_err(ApiError::storage)?,
            })
        }
        _ => Err(ApiError::not_implemented("review::dispatch")),
    }
}
