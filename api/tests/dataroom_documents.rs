// 자료 조회 — 같은 데이터룸의 자료를 목록, 제목 검색, 상세로 조회한다.
// 실제 PostgreSQL(`#[sqlx::test]`)로 `dataroom::dispatch`를 직접 호출해 검증한다.

use axum::http::StatusCode;
use dataroom_api::{
    auth::AuthenticatedUser,
    dataroom::dispatch,
    error::ApiError,
    types::{DataroomRpcRequest, RpcResponse, UserRole},
};
use serde_json::{Value, json};
use sqlx::PgPool;

const WORKSPACE: &str = "lighthouse";

fn user(role: UserRole) -> AuthenticatedUser {
    AuthenticatedUser {
        id: "test-user".to_string(),
        name: "테스트 사용자".to_string(),
        role,
        workspace_id: WORKSPACE.to_string(),
        workspace_name: "라이트하우스".to_string(),
    }
}

async fn call(
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

fn expect_ok(result: Result<RpcResponse, ApiError>) -> Value {
    match result {
        Ok(response) => response.result,
        Err(ApiError(status, kind, message)) => {
            panic!("expected success but got {status} {kind}: {message}")
        }
    }
}

fn expect_err(result: Result<RpcResponse, ApiError>, status: StatusCode) -> &'static str {
    match result {
        Ok(response) => panic!("expected {status} but got success: {}", response.result),
        Err(ApiError(actual, kind, _)) => {
            assert_eq!(actual, status);
            kind
        }
    }
}

async fn list_ids_for(pool: &PgPool, user: &AuthenticatedUser, params: Value) -> Vec<String> {
    let result = expect_ok(call(pool, user, WORKSPACE, "documents.list", params).await);
    result["documents"]
        .as_array()
        .expect("documents must be an array")
        .iter()
        .map(|d| d["id"].as_str().expect("id must be a string").to_string())
        .collect()
}

async fn list_ids(pool: &PgPool, params: Value) -> Vec<String> {
    list_ids_for(pool, &user(UserRole::Investor), params).await
}

async fn get_document(pool: &PgPool, document_id: &str) -> Result<RpcResponse, ApiError> {
    call(
        pool,
        &user(UserRole::Investor),
        WORKSPACE,
        "documents.get",
        json!({ "documentId": document_id }),
    )
    .await
}

async fn insert_document(
    pool: &PgPool,
    id: &str,
    workspace_id: &str,
    title: &str,
    file_name: &str,
    content: &str,
) {
    sqlx::query(
        "INSERT INTO documents (id, workspace_id, title, file_name, status, content) \
         VALUES ($1, $2, $3, $4, 'ready', $5)",
    )
    .bind(id)
    .bind(workspace_id)
    .bind(title)
    .bind(file_name)
    .bind(content)
    .execute(pool)
    .await
    .expect("insert document");
}

fn sorted(mut ids: Vec<String>) -> Vec<String> {
    ids.sort();
    ids
}

fn strs(ids: &[&str]) -> Vec<String> {
    ids.iter().map(|s| s.to_string()).collect()
}

mod 자료_목록을_조회한다 {
    mod 역할과_무관하게_같은_목록을_본다 {
        use crate::*;

        /// @spec DoD-1
        /// @given 투자자 사용자와 시드 자료 4건이 있는 자기 workspace가 있다
        /// @when `documents.list`를 호출한다
        /// @then 시드 4건(doc-business, doc-team, doc-revenue, doc-pipeline)이 반환된다
        #[sqlx::test]
        async fn dod1_investor_gets_four_seed_documents(pool: PgPool) {
            let ids = list_ids_for(&pool, &user(UserRole::Investor), json!({})).await;
            assert_eq!(
                sorted(ids),
                sorted(strs(&[
                    "doc-business",
                    "doc-team",
                    "doc-revenue",
                    "doc-pipeline"
                ]))
            );
        }

        /// @spec DoD-2
        /// @given 기업 담당자 사용자와 시드 자료 4건이 있는 자기 workspace가 있다
        /// @when `documents.list`를 호출한다
        /// @then 시드 4건(doc-business, doc-team, doc-revenue, doc-pipeline)이 반환된다
        #[sqlx::test]
        async fn dod2_company_user_gets_four_seed_documents(pool: PgPool) {
            let ids = list_ids_for(&pool, &user(UserRole::Company), json!({})).await;
            assert_eq!(
                sorted(ids),
                sorted(strs(&[
                    "doc-business",
                    "doc-team",
                    "doc-revenue",
                    "doc-pipeline"
                ]))
            );
        }
    }

    mod 정렬 {
        use crate::*;

        /// @spec DoD-3
        /// @given 같은 `created_at`을 가진 자료를 포함해 여러 자료가 있다
        /// @when `documents.list`를 호출한다
        /// @then `created_at` 내림차순으로 정렬되고, 같은 시각이면 ID 오름차순으로 정렬된다
        #[sqlx::test]
        async fn dod3_ordered_by_created_at_desc_then_id_asc(pool: PgPool) {
            let ids = list_ids(&pool, json!({})).await;
            // doc-revenue와 doc-pipeline은 같은 created_at이므로 ID 오름차순(doc-pipeline 먼저)
            assert_eq!(
                ids,
                strs(&["doc-business", "doc-team", "doc-pipeline", "doc-revenue"])
            );
        }
    }

    mod 제목_검색 {
        use crate::*;

        /// @spec DoD-4
        /// @given 제목 앞부분이 아닌 중간에 검색어가 있는 자료와, 제목에는 검색어가 없고 파일명 또는 본문에만 검색어가 있는 자료가 있다
        /// @when 대소문자가 다른 검색어로 `documents.list`를 호출한다
        /// @then 제목에 검색어가 대소문자 무시 부분 일치하는 자료만 반환되고, 제목에 없고 파일명·본문에만 있는 자료는 제외된다
        #[sqlx::test]
        async fn dod4_returns_only_titles_matching_query_case_insensitive_substring(pool: PgPool) {
            insert_document(
                &pool,
                "doc-t-mid",
                WORKSPACE,
                "Q3 Revenue Forecast",
                "plan.md",
                "본문",
            )
            .await;
            insert_document(
                &pool,
                "doc-t-other",
                WORKSPACE,
                "기타 자료",
                "revenue-forecast.csv",
                "revenue forecast 본문",
            )
            .await;
            let ids = list_ids(&pool, json!({ "query": "rEvEnUe fore" })).await;
            assert_eq!(ids, strs(&["doc-t-mid"]));
        }

        /// @spec EC-1
        /// @given 자료가 있다
        /// @when 공백뿐인 검색어로 `documents.list`를 호출한다
        /// @then 전체 목록을 반환한다
        #[sqlx::test]
        async fn ec1_whitespace_only_query_returns_full_list(pool: PgPool) {
            let full = list_ids(&pool, json!({})).await;
            let ids = list_ids(&pool, json!({ "query": "   \t " })).await;
            assert_eq!(ids.len(), 4);
            assert_eq!(ids, full);
        }

        /// @spec EC-2
        /// @given 제목에 `%`, `_`, `\` 글자를 각각 포함한 자료들과 이 글자를 포함하지 않은 자료가 있다
        /// @when `%`, `_`, `\` 각각을 검색어로 하여 `documents.list`를 호출한다
        /// @then 세 글자 각각이 와일드카드가 아닌 글자로 검색되어, 해당 글자를 제목에 포함한 자료만 반환된다
        #[sqlx::test]
        async fn ec2_like_special_characters_are_matched_literally(pool: PgPool) {
            insert_document(
                &pool,
                "doc-p-percent",
                WORKSPACE,
                "성장률 100% 달성",
                "a.md",
                "x",
            )
            .await;
            insert_document(
                &pool,
                "doc-p-underscore",
                WORKSPACE,
                "q3_report",
                "b.md",
                "x",
            )
            .await;
            insert_document(
                &pool,
                "doc-p-backslash",
                WORKSPACE,
                "경로 C:\\data",
                "c.md",
                "x",
            )
            .await;
            insert_document(
                &pool,
                "doc-p-plain",
                WORKSPACE,
                "특수문자 없음 qxr",
                "d.md",
                "x",
            )
            .await;
            let percent = list_ids(&pool, json!({ "query": "%" })).await;
            assert_eq!(percent, strs(&["doc-p-percent"]));
            let underscore = list_ids(&pool, json!({ "query": "_" })).await;
            assert_eq!(underscore, strs(&["doc-p-underscore"]));
            let backslash = list_ids(&pool, json!({ "query": "\\" })).await;
            assert_eq!(backslash, strs(&["doc-p-backslash"]));
        }

        /// @spec EC-3
        /// @given 사용자가 자기 workspace에 요청한다
        /// @when trim 후 문자 수가 101인 검색어(멀티바이트 문자로 구성되고 바이트 수는 문자 수보다 크다)로 `documents.list`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        #[sqlx::test]
        async fn ec3_query_over_100_chars_after_trim_is_invalid_input(pool: PgPool) {
            let query = format!("  {}  ", "가".repeat(101));
            assert!(query.trim().len() > 101);
            let result = call(
                &pool,
                &user(UserRole::Investor),
                WORKSPACE,
                "documents.list",
                json!({ "query": query }),
            )
            .await;
            assert_eq!(expect_err(result, StatusCode::BAD_REQUEST), "invalid_input");
        }

        /// @spec EC-3
        /// @given 사용자가 자기 workspace에 요청한다
        /// @when 바이트 수는 100을 넘지만 문자 수는 정확히 100인(멀티바이트) 검색어이고 앞뒤 공백을 포함한 원문은 100자를 넘는 검색어로 `documents.list`를 호출한다
        /// @then 400 `invalid_input`이 반환되지 않고 목록 요청이 성공한다
        #[sqlx::test]
        async fn ec3_query_of_exactly_100_chars_after_trim_is_accepted(pool: PgPool) {
            let query = format!("  {}  ", "가".repeat(100));
            assert!(query.trim().len() > 100);
            assert!(query.chars().count() > 100);
            let ids = list_ids(&pool, json!({ "query": query })).await;
            assert!(ids.is_empty());
        }
    }

    mod 다른_workspace_요청 {
        use crate::*;

        /// @spec EC-4
        /// @given 요청 `workspaceId`가 사용자 workspace와 다르다
        /// @when `documents.list`를 호출한다
        /// @then 403이 반환된다
        #[sqlx::test]
        async fn ec4_mismatched_workspace_id_is_forbidden(pool: PgPool) {
            let result = call(
                &pool,
                &user(UserRole::Investor),
                "other-workspace",
                "documents.list",
                json!({}),
            )
            .await;
            expect_err(result, StatusCode::FORBIDDEN);
        }
    }
}

mod 자료_상세를_조회한다 {
    mod 상세_내용 {
        use crate::*;

        /// @spec DoD-5
        /// @given 자기 workspace에 자료가 있다
        /// @when 그 자료 ID로 `documents.get`을 호출한다
        /// @then 제목·파일명·상태·본문을 반환한다
        #[sqlx::test]
        async fn dod5_returns_title_file_name_status_and_content(pool: PgPool) {
            let result = expect_ok(get_document(&pool, "doc-business").await);
            let document = &result["document"];
            assert_eq!(document["title"], "회사 소개");
            assert_eq!(document["fileName"], "company-overview.md");
            assert_eq!(document["status"], "ready");
            assert_eq!(
                document["content"],
                "제조사 재고 관리 구독형 소프트웨어. 사업장당 월 15만 원, 2026년 8월 유료 고객 40개."
            );
        }

        /// @spec EC-7
        /// @given 상태가 `processing`인 자료가 있다
        /// @when 그 자료 ID로 `documents.get`을 호출한다
        /// @then 성공 응답이고 해당 자료가 반환되며 `status`가 `processing`이다
        #[sqlx::test]
        async fn ec7_processing_document_is_retrievable(pool: PgPool) {
            let result = expect_ok(get_document(&pool, "doc-pipeline").await);
            assert_eq!(result["document"]["id"], "doc-pipeline");
            assert_eq!(result["document"]["status"], "processing");
        }

        /// @spec EC-7
        /// @given 상태가 `failed`인 자료가 있다
        /// @when 그 자료 ID로 `documents.get`을 호출한다
        /// @then 성공 응답이고 해당 자료가 반환되며 `status`가 `failed`다
        #[sqlx::test]
        async fn ec7_failed_document_is_retrievable(pool: PgPool) {
            let result = expect_ok(get_document(&pool, "doc-revenue").await);
            assert_eq!(result["document"]["id"], "doc-revenue");
            assert_eq!(result["document"]["status"], "failed");
        }
    }

    mod 다른_workspace_요청 {
        use crate::*;

        /// @spec EC-4
        /// @given 요청 `workspaceId`가 사용자 workspace와 다르다
        /// @when `documents.get`을 호출한다
        /// @then 403이 반환된다
        #[sqlx::test]
        async fn ec4_mismatched_workspace_id_is_forbidden_for_get(pool: PgPool) {
            let result = call(
                &pool,
                &user(UserRole::Investor),
                "other-workspace",
                "documents.get",
                json!({ "documentId": "doc-business" }),
            )
            .await;
            expect_err(result, StatusCode::FORBIDDEN);
        }
    }

    mod 찾을_수_없는_자료 {
        use crate::*;

        /// @spec EC-5
        /// @given 존재하지 않는 자료 ID가 있다
        /// @when 그 ID로 `documents.get`을 호출한다
        /// @then 404가 반환된다
        #[sqlx::test]
        async fn ec5_unknown_document_id_is_not_found(pool: PgPool) {
            let result = get_document(&pool, "doc-does-not-exist").await;
            expect_err(result, StatusCode::NOT_FOUND);
        }

        /// @spec EC-6
        /// @given 다른 workspace에 속한 자료가 있다
        /// @when 그 자료 ID로 자기 workspace에서 `documents.get`을 호출한다
        /// @then 404가 반환된다
        #[sqlx::test]
        async fn ec6_document_in_other_workspace_is_not_found(pool: PgPool) {
            sqlx::query(
                "INSERT INTO workspaces (id, name) VALUES ('other-workspace', '다른 회사')",
            )
            .execute(&pool)
            .await
            .expect("insert workspace");
            insert_document(
                &pool,
                "doc-other",
                "other-workspace",
                "타사 자료",
                "other.md",
                "비공개",
            )
            .await;
            let result = get_document(&pool, "doc-other").await;
            expect_err(result, StatusCode::NOT_FOUND);
        }
    }
}
