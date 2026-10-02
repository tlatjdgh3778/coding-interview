// 자료 등록 통합 테스트용 헬퍼. 실제 PostgreSQL(`#[sqlx::test]`)과 `dataroom::dispatch` 직접 호출을 쓴다.

use axum::http::StatusCode;
use dataroom_api::{
    auth::AuthenticatedUser,
    dataroom::dispatch,
    error::ApiError,
    types::{DataroomRpcRequest, RpcResponse, UserRole},
};
use serde_json::{Value, json};
use sqlx::PgPool;

pub const WORKSPACE: &str = "lighthouse";

pub fn user(role: UserRole) -> AuthenticatedUser {
    let id = match role {
        UserRole::Company => "company-user",
        UserRole::Investor => "investor-user",
    };
    user_as(id, role)
}

pub fn user_as(id: &str, role: UserRole) -> AuthenticatedUser {
    AuthenticatedUser {
        id: id.to_string(),
        name: "테스트 사용자".to_string(),
        role,
        workspace_id: WORKSPACE.to_string(),
        workspace_name: "라이트하우스".to_string(),
    }
}

pub async fn call(
    pool: &PgPool,
    user: &AuthenticatedUser,
    workspace_id: &str,
    method: &str,
    params: Value,
) -> Result<RpcResponse, ApiError> {
    dispatch(
        pool,
        user,
        DataroomRpcRequest {
            workspace_id: workspace_id.to_string(),
            method: method.to_string(),
            params,
        },
    )
    .await
}

/// 자기 workspace로 `documents.create`를 호출한다.
pub async fn create(
    pool: &PgPool,
    user: &AuthenticatedUser,
    title: &str,
    file_name: &str,
    content: &str,
) -> Result<RpcResponse, ApiError> {
    create_with_params(
        pool,
        user,
        json!({ "title": title, "fileName": file_name, "content": content }),
    )
    .await
}

pub async fn create_with_params(
    pool: &PgPool,
    user: &AuthenticatedUser,
    params: Value,
) -> Result<RpcResponse, ApiError> {
    call(pool, user, WORKSPACE, "documents.create", params).await
}

pub fn expect_ok(result: Result<RpcResponse, ApiError>, context: &str) -> Value {
    match result {
        Ok(response) => response.result,
        Err(ApiError(status, kind, message)) => {
            panic!("[{context}] expected success but got {status} {kind}: {message}")
        }
    }
}

/// 상태 코드와 kind를 모두 확인한다.
pub fn expect_err(
    result: Result<RpcResponse, ApiError>,
    status: StatusCode,
    kind: &str,
    context: &str,
) {
    match result {
        Ok(response) => panic!(
            "[{context}] expected {status} {kind} but got success: {}",
            response.result
        ),
        Err(ApiError(actual_status, actual_kind, message)) => {
            assert_eq!(actual_status, status, "[{context}] status ({message})");
            assert_eq!(actual_kind, kind, "[{context}] kind");
        }
    }
}

pub async fn count_documents(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM documents")
        .fetch_one(pool)
        .await
        .expect("count documents")
}
