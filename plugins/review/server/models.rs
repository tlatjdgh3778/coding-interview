use super::types::{Criterion, Review, ReviewStatus};
use crate::error::ApiError;
use sqlx::PgPool;

const TS_FORMAT: &str = r#"'YYYY-MM-DD"T"HH24:MI:SS"Z"'"#;

#[derive(sqlx::FromRow)]
struct CriterionRow {
    id: String,
    title: String,
    review_question: String,
}

#[derive(sqlx::FromRow)]
struct ReviewRow {
    id: String,
    criterion_id: String,
    status: String,
    comment: String,
    created_at: String,
    updated_at: String,
}

fn status_str(status: ReviewStatus) -> &'static str {
    match status {
        ReviewStatus::Satisfied => "satisfied",
        ReviewStatus::NeedsInformation => "needs_information",
    }
}

fn parse_status(value: &str) -> Result<ReviewStatus, ApiError> {
    match value {
        "satisfied" => Ok(ReviewStatus::Satisfied),
        "needs_information" => Ok(ReviewStatus::NeedsInformation),
        other => Err(ApiError::storage(format!("unknown review status: {other}"))),
    }
}

fn into_review(row: ReviewRow, evidence_document_ids: Vec<String>) -> Result<Review, ApiError> {
    Ok(Review {
        id: row.id,
        criterion_id: row.criterion_id,
        status: parse_status(&row.status)?,
        comment: row.comment,
        evidence_document_ids,
        created_at: row.created_at,
        updated_at: row.updated_at,
    })
}

/// 검토 기준 전체를 `display_order` 순으로 반환한다.
pub async fn list_criteria(pool: &PgPool) -> Result<Vec<Criterion>, ApiError> {
    let rows = sqlx::query_as::<_, CriterionRow>(
        "SELECT id, title, review_question FROM review_criteria ORDER BY display_order ASC",
    )
    .fetch_all(pool)
    .await
    .map_err(ApiError::storage)?;
    Ok(rows
        .into_iter()
        .map(|row| Criterion {
            id: row.id,
            title: row.title,
            review_question: row.review_question,
        })
        .collect())
}

pub async fn criterion_exists(pool: &PgPool, criterion_id: &str) -> Result<bool, ApiError> {
    let found = sqlx::query_scalar::<_, String>("SELECT id FROM review_criteria WHERE id = $1")
        .bind(criterion_id)
        .fetch_optional(pool)
        .await
        .map_err(ApiError::storage)?;
    Ok(found.is_some())
}

/// 같은 workspace의 `ready` 자료 중 `ids`와 일치하는 개수. `ids`는 중복 없는 값이어야 한다.
pub async fn count_ready_documents(
    pool: &PgPool,
    workspace_id: &str,
    ids: &[String],
) -> Result<i64, ApiError> {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM documents \
         WHERE workspace_id = $1 AND status = 'ready' AND id = ANY($2)",
    )
    .bind(workspace_id)
    .bind(ids)
    .fetch_one(pool)
    .await
    .map_err(ApiError::storage)
}

/// 투자자 본인의 검토 목록. 기준 `display_order` 순, 근거는 자료 ID 오름차순.
pub async fn list_reviews(
    pool: &PgPool,
    workspace_id: &str,
    investor_id: &str,
) -> Result<Vec<Review>, ApiError> {
    let sql = format!(
        "SELECT r.id, r.criterion_id, r.status, r.comment, \
                to_char(r.created_at AT TIME ZONE 'UTC', {TS_FORMAT}) AS created_at, \
                to_char(r.updated_at AT TIME ZONE 'UTC', {TS_FORMAT}) AS updated_at \
         FROM reviews r \
         JOIN review_criteria c ON c.id = r.criterion_id \
         WHERE r.workspace_id = $1 AND r.investor_id = $2 \
         ORDER BY c.display_order ASC"
    );
    let rows = sqlx::query_as::<_, ReviewRow>(&sql)
        .bind(workspace_id)
        .bind(investor_id)
        .fetch_all(pool)
        .await
        .map_err(ApiError::storage)?;

    let evidence = sqlx::query_as::<_, (String, String)>(
        "SELECT e.review_id, e.document_id FROM review_evidence e \
         JOIN reviews r ON r.id = e.review_id \
         WHERE r.workspace_id = $1 AND r.investor_id = $2 \
         ORDER BY e.document_id COLLATE \"C\" ASC",
    )
    .bind(workspace_id)
    .bind(investor_id)
    .fetch_all(pool)
    .await
    .map_err(ApiError::storage)?;

    rows.into_iter()
        .map(|row| {
            let ids = evidence
                .iter()
                .filter(|(review_id, _)| *review_id == row.id)
                .map(|(_, document_id)| document_id.clone())
                .collect();
            into_review(row, ids)
        })
        .collect()
}

/// 검토와 근거를 한 트랜잭션으로 저장한다. 같은 투자자·기준이 이미 있으면 409.
#[allow(clippy::too_many_arguments)]
pub async fn create_review(
    pool: &PgPool,
    id: &str,
    workspace_id: &str,
    investor_id: &str,
    criterion_id: &str,
    status: ReviewStatus,
    comment: &str,
    evidence_document_ids: &[String],
) -> Result<Review, ApiError> {
    let mut tx = pool.begin().await.map_err(ApiError::storage)?;
    let sql = format!(
        "INSERT INTO reviews (id, workspace_id, investor_id, criterion_id, status, comment) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT ON CONSTRAINT reviews_investor_criterion_key DO NOTHING \
         RETURNING id, criterion_id, status, comment, \
                   to_char(created_at AT TIME ZONE 'UTC', {TS_FORMAT}) AS created_at, \
                   to_char(updated_at AT TIME ZONE 'UTC', {TS_FORMAT}) AS updated_at"
    );
    let row = sqlx::query_as::<_, ReviewRow>(&sql)
        .bind(id)
        .bind(workspace_id)
        .bind(investor_id)
        .bind(criterion_id)
        .bind(status_str(status))
        .bind(comment)
        .fetch_optional(&mut *tx)
        .await
        .map_err(ApiError::storage)?
        .ok_or_else(ApiError::conflict)?;

    sqlx::query(
        "INSERT INTO review_evidence (review_id, document_id) \
         SELECT $1, UNNEST($2::text[])",
    )
    .bind(id)
    .bind(evidence_document_ids)
    .execute(&mut *tx)
    .await
    .map_err(ApiError::storage)?;

    tx.commit().await.map_err(ApiError::storage)?;

    let mut ids = evidence_document_ids.to_vec();
    ids.sort();
    into_review(row, ids)
}
