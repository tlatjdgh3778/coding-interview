use super::types::{DocumentDetail, DocumentListItem, DocumentStatus};
use crate::error::ApiError;
use sqlx::PgPool;

#[derive(sqlx::FromRow)]
struct DocumentListRow {
    id: String,
    title: String,
    file_name: String,
    status: String,
    created_at: String,
}

#[derive(sqlx::FromRow)]
struct DocumentDetailRow {
    id: String,
    title: String,
    file_name: String,
    status: String,
    content: String,
    created_at: String,
}

fn parse_status(value: &str) -> Result<DocumentStatus, ApiError> {
    match value {
        "ready" => Ok(DocumentStatus::Ready),
        "processing" => Ok(DocumentStatus::Processing),
        "failed" => Ok(DocumentStatus::Failed),
        other => Err(ApiError::storage(format!(
            "unknown document status: {other}"
        ))),
    }
}

/// LIKE 와일드카드(`\`, `%`, `_`)를 글자 그대로 취급하도록 이스케이프한다.
fn escape_like(term: &str) -> String {
    let mut out = String::with_capacity(term.len());
    for ch in term.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// 사용자 workspace의 자료 목록. `query`는 이미 trim된 값이며 None이면 전체.
pub async fn list_documents(
    pool: &PgPool,
    workspace_id: &str,
    query: Option<&str>,
) -> Result<Vec<DocumentListItem>, ApiError> {
    let pattern = query.map(|q| format!("%{}%", escape_like(q)));
    let rows = sqlx::query_as::<_, DocumentListRow>(
        r#"SELECT id, title, file_name, status,
                  to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
           FROM documents
           WHERE workspace_id = $1
             AND ($2::text IS NULL OR title ILIKE $2 ESCAPE '\')
           ORDER BY created_at DESC, id COLLATE "C" ASC"#,
    )
    .bind(workspace_id)
    .bind(pattern)
    .fetch_all(pool)
    .await
    .map_err(ApiError::storage)?;

    rows.into_iter()
        .map(|row| {
            Ok(DocumentListItem {
                id: row.id,
                title: row.title,
                file_name: row.file_name,
                status: parse_status(&row.status)?,
                created_at: row.created_at,
            })
        })
        .collect()
}

/// 사용자 workspace 안의 자료 한 건. 없거나 다른 workspace면 None.
pub async fn get_document(
    pool: &PgPool,
    workspace_id: &str,
    document_id: &str,
) -> Result<Option<DocumentDetail>, ApiError> {
    let row = sqlx::query_as::<_, DocumentDetailRow>(
        "SELECT id, title, file_name, status, content, \
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at \
         FROM documents WHERE workspace_id = $1 AND id = $2",
    )
    .bind(workspace_id)
    .bind(document_id)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::storage)?;

    row.map(|row| {
        Ok(DocumentDetail {
            id: row.id,
            title: row.title,
            file_name: row.file_name,
            status: parse_status(&row.status)?,
            content: row.content,
            created_at: row.created_at,
        })
    })
    .transpose()
}

/// 자료 한 건 저장. 같은 (workspace, 작성자, 내용) 조합이 이미 있으면 409.
/// `id` 충돌 등 그 밖의 DB 오류는 500(storage_error)이다.
pub async fn create_document(
    pool: &PgPool,
    id: &str,
    workspace_id: &str,
    created_by: &str,
    title: &str,
    file_name: &str,
    content: &str,
) -> Result<DocumentDetail, ApiError> {
    let row = sqlx::query_as::<_, DocumentDetailRow>(
        "INSERT INTO documents (id, workspace_id, created_by, title, file_name, status, content) \
         VALUES ($1, $2, $3, $4, $5, 'ready', $6) \
         ON CONFLICT ON CONSTRAINT documents_workspace_creator_content_key DO NOTHING \
         RETURNING id, title, file_name, status, content, \
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS created_at",
    )
    .bind(id)
    .bind(workspace_id)
    .bind(created_by)
    .bind(title)
    .bind(file_name)
    .bind(content)
    .fetch_optional(pool)
    .await
    .map_err(ApiError::storage)?
    .ok_or_else(ApiError::conflict)?;

    Ok(DocumentDetail {
        id: row.id,
        title: row.title,
        file_name: row.file_name,
        status: parse_status(&row.status)?,
        content: row.content,
        created_at: row.created_at,
    })
}
