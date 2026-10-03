// 검토 통합 테스트용 헬퍼. 실제 PostgreSQL(`#[sqlx::test]`)과 `plugins::dispatch` 호출을 쓴다.
#![allow(dead_code)]

use dataroom_api::{
    auth::AuthenticatedUser,
    error::ApiError,
    plugins::dispatch,
    types::{PluginRpcRequest, RpcResponse},
};
use serde_json::{Map, Value, json};
use sqlx::PgPool;

/// `pluginId: "review"`로 라우팅까지 통과시켜 호출한다.
pub async fn review_call(
    pool: &PgPool,
    user: &AuthenticatedUser,
    workspace_id: &str,
    method: &str,
    params: Value,
) -> Result<RpcResponse, ApiError> {
    dispatch(
        pool,
        user,
        PluginRpcRequest {
            plugin_id: "review".to_string(),
            workspace_id: workspace_id.to_string(),
            method: method.to_string(),
            params,
        },
    )
    .await
}

/// 유효한 `reviews.create` params. 상태는 `satisfied`, 의견은 고정 문자열이다.
pub fn valid_params(criterion_id: &str, evidence: &[&str]) -> Value {
    json!({
        "criterionId": criterion_id,
        "status": "satisfied",
        "comment": "자료로 확인했습니다.",
        "evidenceDocumentIds": evidence,
    })
}

/// 객체 params에서 필드 하나를 바꾼 복사본을 만든다.
pub fn with_field(params: &Value, key: &str, value: Value) -> Value {
    let mut map: Map<String, Value> = params.as_object().expect("object params").clone();
    map.insert(key.to_string(), value);
    Value::Object(map)
}

/// 객체 params에서 필드 하나를 뺀 복사본을 만든다.
pub fn without_field(params: &Value, key: &str) -> Value {
    let mut map: Map<String, Value> = params.as_object().expect("object params").clone();
    map.remove(key);
    Value::Object(map)
}

pub async fn count_reviews(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM reviews")
        .fetch_one(pool)
        .await
        .expect("count reviews")
}

pub async fn count_evidence(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM review_evidence")
        .fetch_one(pool)
        .await
        .expect("count review_evidence")
}

/// `reviews`와 `review_evidence`가 모두 비어 있는지 확인한다.
pub async fn assert_no_rows(pool: &PgPool, context: &str) {
    assert_eq!(count_reviews(pool).await, 0, "[{context}] reviews rows");
    assert_eq!(
        count_evidence(pool).await,
        0,
        "[{context}] review_evidence rows"
    );
}

/// (id, workspace_id, investor_id, criterion_id, status, comment, created_at, updated_at)
pub type ReviewRow = (
    String,
    String,
    String,
    String,
    String,
    String,
    String,
    String,
);

pub async fn review_rows(pool: &PgPool) -> Vec<ReviewRow> {
    sqlx::query_as(
        "SELECT id, workspace_id, investor_id, criterion_id, status, comment, \
         created_at::text, updated_at::text FROM reviews ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .expect("select reviews")
}

/// (review_id, document_id, created_at)
pub async fn evidence_rows(pool: &PgPool) -> Vec<(String, String, String)> {
    sqlx::query_as(
        "SELECT review_id, document_id, created_at::text FROM review_evidence \
         ORDER BY review_id, document_id",
    )
    .fetch_all(pool)
    .await
    .expect("select review_evidence")
}

/// 한 검토의 근거 자료 ID(오름차순)를 DB에서 직접 읽는다.
pub async fn evidence_ids_of(pool: &PgPool, review_id: &str) -> Vec<String> {
    sqlx::query_scalar(
        "SELECT document_id FROM review_evidence WHERE review_id = $1 ORDER BY document_id",
    )
    .bind(review_id)
    .fetch_all(pool)
    .await
    .expect("select evidence of review")
}

pub async fn insert_workspace(pool: &PgPool, id: &str) {
    sqlx::query("INSERT INTO workspaces (id, name) VALUES ($1, $2)")
        .bind(id)
        .bind(id)
        .execute(pool)
        .await
        .expect("insert workspace");
}

pub async fn insert_document(pool: &PgPool, id: &str, workspace_id: &str, status: &str) {
    sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, file_name, status, content) \
         VALUES ($1, $2, $3, $4, $5, $6)",
    )
    .bind(id)
    .bind(workspace_id)
    .bind(format!("제목 {id}"))
    .bind(format!("{id}.md"))
    .bind(status)
    .bind(format!("본문 {id}"))
    .execute(pool)
    .await
    .expect("insert document");
}

/// `reviews.update` params. 네 필드를 모두 채운다.
pub fn update_params(criterion_id: &str, status: &str, comment: &str, evidence: &[&str]) -> Value {
    json!({
        "criterionId": criterion_id,
        "status": status,
        "comment": comment,
        "evidenceDocumentIds": evidence,
    })
}

/// `reviews`와 `review_evidence` 전체 행 스냅샷(불변 확인용).
pub async fn snapshot(pool: &PgPool) -> (Vec<ReviewRow>, Vec<(String, String, String)>) {
    (review_rows(pool).await, evidence_rows(pool).await)
}

/// DB `updated_at`을 마이크로초 에포크로 읽는다(시각 비교용).
pub async fn updated_at_micros(pool: &PgPool, review_id: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT (EXTRACT(EPOCH FROM updated_at) * 1000000)::bigint FROM reviews WHERE id = $1",
    )
    .bind(review_id)
    .fetch_one(pool)
    .await
    .expect("select updated_at micros")
}

/// DB `updated_at`을 응답 표기(초 단위 ISO, UTC)로 바꾼 문자열.
pub async fn updated_at_iso(pool: &PgPool, review_id: &str) -> String {
    sqlx::query_scalar(
        "SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') \
         FROM reviews WHERE id = $1",
    )
    .bind(review_id)
    .fetch_one(pool)
    .await
    .expect("select updated_at iso")
}
