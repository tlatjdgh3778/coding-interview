//! 대상 스펙: docs/specs/review-write.md (검토 작성·조회, Review Plugin)
//! 이 파일의 `DoD-N`·`EC-N`은 위 스펙 번호다. 다른 테스트 파일의 번호는 각자의 스펙 기준이다.
//! 모든 case 본문은 구현 단계에서 채웠다(`#[sqlx::test]`). 헬퍼는 `review_common/mod.rs`.
//! 모든 case는 `#[sqlx::test]`의 실제 PostgreSQL에서 `dataroom_api::plugins::dispatch`를 `pluginId: "review"`로 호출한다.
//! EC-13만 임시 DB에 실패를 주입한다(임시 DB의 `review_evidence`에 항상 실패하는 CHECK 제약을 추가하는 확정된 방식). 나머지는 모두 실제 PostgreSQL이고 mock은 없다.

#[allow(dead_code)]
mod common;
mod review_common;

mod 투자자가_검토_기준별로_근거와_함께_검토를_저장하고_다시_읽는다 {
    mod 기준을_조회하는_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        fn assert_criteria_in_order(result: &serde_json::Value) {
            let criteria = result["criteria"].as_array().expect("criteria array");
            let ids: Vec<&str> = criteria
                .iter()
                .map(|c| c["id"].as_str().expect("id"))
                .collect();
            assert_eq!(ids, vec!["business", "team", "revenue"]);
            let titles: Vec<&str> = criteria
                .iter()
                .map(|c| c["title"].as_str().expect("title"))
                .collect();
            assert_eq!(titles, vec!["사업 이해", "팀 구성", "매출 현황"]);
            for criterion in criteria {
                assert!(
                    criterion["reviewQuestion"]
                        .as_str()
                        .is_some_and(|q| !q.is_empty())
                );
            }
        }

        /// @spec DoD-1
        /// @given 투자자가 자신의 workspace를 `workspaceId`로 보낸다
        /// @when `criteria.list`를 호출한다
        /// @then 사업 이해·팀 구성·매출 현황 3건이 `display_order` 순으로 반환된다
        /// @then 각 기준에 id·제목·검토 질문이 담긴다
        #[sqlx::test]
        async fn dod1_criteria_list_returns_three_criteria_in_display_order(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let result = expect_ok(
                review_call(&pool, &investor, WORKSPACE, "criteria.list", json!({})).await,
                "criteria.list",
            );
            assert_criteria_in_order(&result);
        }

        /// @spec DoD-20
        /// @given 기업 담당자가 자신의 workspace를 `workspaceId`로 보낸다
        /// @when `criteria.list`를 호출한다
        /// @then 기준 3건이 `display_order` 순으로 반환된다
        #[sqlx::test]
        async fn dod20_company_criteria_list_returns_three_criteria_in_display_order(pool: PgPool) {
            let company = user(UserRole::Company);
            let result = expect_ok(
                review_call(&pool, &company, WORKSPACE, "criteria.list", json!({})).await,
                "criteria.list",
            );
            assert_criteria_in_order(&result);
        }
    }

    mod 검토를_저장하는_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec DoD-3 DoD-4
        /// @given 투자자가 존재하는 기준 ID, 유효한 상태, 의견, 같은 workspace의 `ready` 자료 ID 2개를 보낸다
        /// @when `reviews.create`를 호출하고 DB 행을 직접 조회한다
        /// @then 검토가 저장되고 응답에 id·기준 ID·상태·의견·근거 자료 ID 목록·작성 시각·수정 시각이 담긴다
        /// @then 근거는 파일명이 아닌 자료 ID로 `review_evidence`에 연결되며 `reviews`와 별도 행으로 저장된다
        /// @then 작성 투자자와 workspace는 세션에서 확인한 값으로 저장된다
        #[sqlx::test]
        async fn dod3_dod4_create_stores_review_and_evidence_rows_separately(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let result = expect_ok(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    json!({
                        "criterionId": "business",
                        "status": "needs_information",
                        "comment": "매출 근거가 더 필요합니다.",
                        "evidenceDocumentIds": ["doc-team", "doc-business"],
                    }),
                )
                .await,
                "create",
            );
            let review = &result["review"];
            let id = review["id"].as_str().expect("id string").to_string();
            assert!(!id.is_empty());
            assert_eq!(review["criterionId"], "business");
            assert_eq!(review["status"], "needs_information");
            assert_eq!(review["comment"], "매출 근거가 더 필요합니다.");
            let mut ids: Vec<String> = review["evidenceDocumentIds"]
                .as_array()
                .expect("evidenceDocumentIds array")
                .iter()
                .map(|v| v.as_str().expect("id string").to_string())
                .collect();
            ids.sort();
            assert_eq!(ids, vec!["doc-business", "doc-team"]);
            assert!(review["createdAt"].as_str().is_some_and(|s| !s.is_empty()));
            assert!(review["updatedAt"].as_str().is_some_and(|s| !s.is_empty()));

            let rows = review_rows(&pool).await;
            assert_eq!(rows.len(), 1, "reviews rows");
            let row = &rows[0];
            assert_eq!(row.0, id);
            assert_eq!(row.1, WORKSPACE, "workspace from session");
            assert_eq!(row.2, "investor-user", "investor from session");
            assert_eq!(row.3, "business");
            assert_eq!(row.4, "needs_information");
            assert_eq!(row.5, "매출 근거가 더 필요합니다.");
            assert_eq!(
                evidence_ids_of(&pool, &id).await,
                vec!["doc-business", "doc-team"],
                "evidence rows keyed by document id"
            );
            assert_eq!(count_evidence(&pool).await, 2, "separate evidence rows");
        }

        /// @spec DoD-18
        /// @given 투자자가 앞뒤에 공백이 있는 `comment`로 저장을 요청한다
        /// @when `reviews.create`와 `reviews.list`를 호출하고 DB 행을 직접 조회한다
        /// @then trim한 값이 DB에 저장된다
        /// @then `reviews.create` 응답과 `reviews.list`가 같은 trim한 값을 반환한다
        #[sqlx::test]
        async fn dod18_comment_is_trimmed_in_db_create_response_and_list(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let params = with_field(
                &valid_params("business", &["doc-business"]),
                "comment",
                json!("  \n 공백 의견 \t "),
            );
            let created = expect_ok(
                review_call(&pool, &investor, WORKSPACE, "reviews.create", params).await,
                "create",
            );
            assert_eq!(created["review"]["comment"], "공백 의견");
            let listed = expect_ok(
                review_call(&pool, &investor, WORKSPACE, "reviews.list", json!({})).await,
                "list",
            );
            assert_eq!(listed["reviews"][0]["comment"], "공백 의견");
            let rows = review_rows(&pool).await;
            assert_eq!(rows.len(), 1);
            assert_eq!(rows[0].5, "공백 의견", "trimmed value stored in DB");
        }

        /// @spec EC-2
        /// @given 투자자가 trim 후 경계 안의 `comment`를 보낸다. 표본: trim 후 1자, trim 후 정확히 2000자, 앞뒤 공백을 더하면 2000자를 넘지만 trim 후 2000자인 값, 여러 바이트 문자로 된 2000자(문자 수 기준). 표본·반복마다 서로 다른 (투자자, 기준) 조합을 쓴다
        /// @when 표본마다 `reviews.create`를 호출한다
        /// @then 모든 표본이 거부되지 않고 저장된다
        #[sqlx::test]
        async fn ec2_comment_within_length_boundary_is_accepted(pool: PgPool) {
            let investors = [
                user(UserRole::Investor),
                user_as("investor-peer", UserRole::Investor),
            ];
            let samples: Vec<(&str, String, String)> = vec![
                ("trim 후 1자", "가".to_string(), "가".to_string()),
                ("정확히 2000자", "a".repeat(2000), "a".repeat(2000)),
                (
                    "공백 포함 시 2000자 초과, trim 후 2000자",
                    format!("  {}  ", "b".repeat(2000)),
                    "b".repeat(2000),
                ),
                (
                    "여러 바이트 문자 2000자",
                    "한".repeat(2000),
                    "한".repeat(2000),
                ),
            ];
            let combos = [(0, "business"), (0, "team"), (1, "business"), (1, "team")];
            for (i, (label, sent, expected)) in samples.iter().enumerate() {
                let (investor_index, criterion) = combos[i];
                let params = with_field(
                    &valid_params(criterion, &["doc-business"]),
                    "comment",
                    json!(sent),
                );
                let result = expect_ok(
                    review_call(
                        &pool,
                        &investors[investor_index],
                        WORKSPACE,
                        "reviews.create",
                        params,
                    )
                    .await,
                    label,
                );
                assert_eq!(result["review"]["comment"], json!(expected), "{label}");
                assert_eq!(count_reviews(&pool).await, (i + 1) as i64, "{label}");
            }
            let stored: Vec<String> = review_rows(&pool).await.into_iter().map(|r| r.5).collect();
            for (_, _, expected) in &samples {
                assert!(
                    stored.contains(expected),
                    "stored comment chars={}",
                    expected.chars().count()
                );
            }
        }

        /// @spec EC-12
        /// @given `investor-user`가 기준에 검토를 저장했다
        /// @when `investor-peer`가 같은 기준에 `reviews.create`를 호출하고 DB 행을 직접 조회한다
        /// @then 두 투자자 모두 저장에 성공하고 각각 별도 행이 생긴다
        #[sqlx::test]
        async fn ec12_different_investors_can_each_save_review_for_same_criterion(pool: PgPool) {
            let first = user(UserRole::Investor);
            let second = user_as("investor-peer", UserRole::Investor);
            let params = valid_params("business", &["doc-business"]);
            expect_ok(
                review_call(&pool, &first, WORKSPACE, "reviews.create", params.clone()).await,
                "investor-user create",
            );
            expect_ok(
                review_call(&pool, &second, WORKSPACE, "reviews.create", params).await,
                "investor-peer create",
            );
            let rows = review_rows(&pool).await;
            assert_eq!(rows.len(), 2, "separate review rows");
            let mut investors: Vec<&str> = rows.iter().map(|r| r.2.as_str()).collect();
            investors.sort();
            assert_eq!(investors, vec!["investor-peer", "investor-user"]);
            assert!(rows.iter().all(|r| r.3 == "business"));
            assert_eq!(count_evidence(&pool).await, 2);
        }
    }

    mod 저장한_검토를_조회하는_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec DoD-5
        /// @given 투자자가 검토를 저장했다
        /// @when `reviews.list`를 호출한다
        /// @then 본인이 저장한 검토가 근거 자료 ID와 함께 반환된다
        #[sqlx::test]
        async fn dod5_list_returns_own_review_with_evidence_ids(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let created = expect_ok(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("team", &["doc-business", "doc-team"]),
                )
                .await,
                "create",
            );
            let listed = expect_ok(
                review_call(&pool, &investor, WORKSPACE, "reviews.list", json!({})).await,
                "list",
            );
            let reviews = listed["reviews"].as_array().expect("reviews array");
            assert_eq!(reviews.len(), 1);
            let review = &reviews[0];
            assert_eq!(review["id"], created["review"]["id"]);
            assert_eq!(review["criterionId"], "team");
            assert_eq!(review["status"], "satisfied");
            assert_eq!(review["comment"], "자료로 확인했습니다.");
            assert_eq!(
                review["evidenceDocumentIds"],
                json!(["doc-business", "doc-team"])
            );
            assert!(review["createdAt"].as_str().is_some_and(|s| !s.is_empty()));
            assert!(review["updatedAt"].as_str().is_some_and(|s| !s.is_empty()));
        }

        /// @spec DoD-19
        /// @given 투자자가 기준 3건을 `display_order`의 역순으로 저장하고 각 검토의 근거를 자료 ID 내림차순으로 요청했다
        /// @when `reviews.list`를 호출한다
        /// @then 검토가 기준의 `display_order` 순으로 반환된다
        /// @then 각 검토의 `evidenceDocumentIds`가 자료 ID 오름차순으로 반환된다
        #[sqlx::test]
        async fn dod19_list_orders_reviews_by_criterion_and_evidence_ids_ascending(pool: PgPool) {
            let investor = user(UserRole::Investor);
            insert_document(&pool, "doc-aaa", WORKSPACE, "ready").await;
            for criterion in ["revenue", "team", "business"] {
                expect_ok(
                    review_call(
                        &pool,
                        &investor,
                        WORKSPACE,
                        "reviews.create",
                        valid_params(criterion, &["doc-team", "doc-business", "doc-aaa"]),
                    )
                    .await,
                    criterion,
                );
            }
            let listed = expect_ok(
                review_call(&pool, &investor, WORKSPACE, "reviews.list", json!({})).await,
                "list",
            );
            let reviews = listed["reviews"].as_array().expect("reviews array");
            let criteria: Vec<&str> = reviews
                .iter()
                .map(|r| r["criterionId"].as_str().expect("criterionId"))
                .collect();
            assert_eq!(criteria, vec!["business", "team", "revenue"]);
            for review in reviews {
                assert_eq!(
                    review["evidenceDocumentIds"],
                    json!(["doc-aaa", "doc-business", "doc-team"])
                );
            }
        }

        /// @spec DoD-6
        /// @given `investor-user`가 검토를 저장했고 `investor-peer`는 저장하지 않았다
        /// @when `investor-peer`가 `reviews.list`를 호출한다
        /// @then `investor-user`의 검토가 반환되지 않는다
        #[sqlx::test]
        async fn dod6_list_does_not_return_other_investors_reviews(pool: PgPool) {
            let owner = user(UserRole::Investor);
            let peer = user_as("investor-peer", UserRole::Investor);
            expect_ok(
                review_call(
                    &pool,
                    &owner,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &["doc-business"]),
                )
                .await,
                "create",
            );
            let listed = expect_ok(
                review_call(&pool, &peer, WORKSPACE, "reviews.list", json!({})).await,
                "peer list",
            );
            assert_eq!(listed["reviews"], json!([]));
        }

        /// @spec DoD-7
        /// @given 투자자가 검토를 저장한 상태에서 기업 담당자가 자신의 workspace로 요청한다
        /// @when 기업 담당자가 `reviews.list`를 호출한다
        /// @then 빈 목록이 반환된다
        #[sqlx::test]
        async fn dod7_company_list_returns_empty_even_when_investor_reviews_exist(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let company = user(UserRole::Company);
            expect_ok(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &["doc-business"]),
                )
                .await,
                "create",
            );
            assert_eq!(count_reviews(&pool).await, 1);
            let listed = expect_ok(
                review_call(&pool, &company, WORKSPACE, "reviews.list", json!({})).await,
                "company list",
            );
            assert_eq!(listed["reviews"], json!([]));
        }
    }

    mod 권한이_없는_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec DoD-8
        /// @given 기업 담당자가 자신의 workspace를 `workspaceId`로 하고 잘못된 입력을 보낸다. 표본: 잘못된 상태·빈 의견·빈 근거·알 수 없는 필드를 함께 담은 요청, 존재하지 않는 `criterionId`와 존재하지 않는 자료 ID를 같은 요청에 함께 담은 요청
        /// @when `reviews.create`를 호출한다
        /// @then 입력 검증보다 먼저 403 `forbidden`이 반환된다
        /// @then DB에 검토·근거 행이 생기지 않는다
        #[sqlx::test]
        async fn dod8_company_create_is_forbidden_before_input_validation(pool: PgPool) {
            let company = user(UserRole::Company);
            let samples = [
                (
                    "잘못된 상태·빈 의견·빈 근거·알 수 없는 필드",
                    json!({
                        "criterionId": "business",
                        "status": "bogus",
                        "comment": "",
                        "evidenceDocumentIds": [],
                        "unknownField": true,
                    }),
                ),
                (
                    "존재하지 않는 기준·존재하지 않는 자료",
                    valid_params("no-such-criterion", &["doc-no-such-document"]),
                ),
            ];
            for (label, params) in samples {
                expect_err(
                    review_call(&pool, &company, WORKSPACE, "reviews.create", params).await,
                    StatusCode::FORBIDDEN,
                    "forbidden",
                    label,
                );
                assert_no_rows(&pool, label).await;
            }
        }

        /// @spec DoD-9
        /// @given 요청 `workspaceId`가 사용자 workspace와 다르다. 표본: `criteria.list`, `reviews.list`, 유효한 입력의 `reviews.create`, 잘못된 입력(예: 빈 의견)을 담은 `reviews.create`를 각각 투자자로 호출
        /// @when 표본마다 method를 호출하고 DB 행을 직접 조회한다
        /// @then 모든 표본에서 403 `forbidden`이 반환된다
        /// @then DB에 검토·근거 행이 생기지 않는다
        #[sqlx::test]
        async fn dod9_workspace_mismatch_is_forbidden_for_every_method(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let other = "other-workspace";
            let samples = [
                ("criteria.list", "criteria.list", json!({})),
                ("reviews.list", "reviews.list", json!({})),
                (
                    "유효한 reviews.create",
                    "reviews.create",
                    valid_params("business", &["doc-business"]),
                ),
                (
                    "잘못된 입력 reviews.create",
                    "reviews.create",
                    with_field(
                        &valid_params("business", &["doc-business"]),
                        "comment",
                        json!(""),
                    ),
                ),
            ];
            for (label, method, params) in samples {
                expect_err(
                    review_call(&pool, &investor, other, method, params).await,
                    StatusCode::FORBIDDEN,
                    "forbidden",
                    label,
                );
                assert_no_rows(&pool, label).await;
            }
        }
    }

    mod 입력_형식이_잘못된_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec EC-1
        /// @given 유효한 입력에서 `status`만 `satisfied`·`needs_information` 이외의 값으로 보낸다. 표본: 빈 문자열, 임의 문자열, 대소문자가 다른 `Satisfied`
        /// @when 표본마다 `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec1_invalid_status_is_rejected_with_invalid_input(pool: PgPool) {
            let investor = user(UserRole::Investor);
            for status in ["", "unknown-status", "Satisfied"] {
                let params = with_field(
                    &valid_params("business", &["doc-business"]),
                    "status",
                    json!(status),
                );
                expect_err(
                    review_call(&pool, &investor, WORKSPACE, "reviews.create", params).await,
                    StatusCode::BAD_REQUEST,
                    "invalid_input",
                    status,
                );
                assert_no_rows(&pool, status).await;
            }
        }

        /// @spec EC-2
        /// @given 유효한 입력에서 `comment`만 잘못 보낸다. 표본: 빈 문자열, 공백뿐인 문자열, trim 후 2001자
        /// @when 표본마다 `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec2_empty_blank_or_too_long_comment_is_rejected(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let samples = [
                ("빈 문자열", String::new()),
                ("공백뿐", "  \t\n  ".to_string()),
                ("trim 후 2001자", format!(" {} ", "가".repeat(2001))),
            ];
            for (label, comment) in samples {
                let params = with_field(
                    &valid_params("business", &["doc-business"]),
                    "comment",
                    json!(comment),
                );
                expect_err(
                    review_call(&pool, &investor, WORKSPACE, "reviews.create", params).await,
                    StatusCode::BAD_REQUEST,
                    "invalid_input",
                    label,
                );
                assert_no_rows(&pool, label).await;
            }
        }

        /// @spec EC-3
        /// @given 유효한 입력에 알 수 없는 필드를 더해 보낸다(예: 작성자 지정 필드)
        /// @when `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec3_unknown_field_is_rejected_with_invalid_input(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let params = with_field(
                &valid_params("business", &["doc-business"]),
                "investorId",
                json!("investor-peer"),
            );
            expect_err(
                review_call(&pool, &investor, WORKSPACE, "reviews.create", params).await,
                StatusCode::BAD_REQUEST,
                "invalid_input",
                "unknown field",
            );
            assert_no_rows(&pool, "unknown field").await;
        }

        /// @spec EC-29
        /// @given 유효한 입력에서 필수 필드 하나를 뺀다. 누락 필드별 표본: `criterionId`, `status`, `comment`, `evidenceDocumentIds`를 하나씩 뺀 요청
        /// @when 표본마다 `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec29_missing_required_field_is_rejected_with_invalid_input(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let base = valid_params("business", &["doc-business"]);
            for field in ["criterionId", "status", "comment", "evidenceDocumentIds"] {
                expect_err(
                    review_call(
                        &pool,
                        &investor,
                        WORKSPACE,
                        "reviews.create",
                        without_field(&base, field),
                    )
                    .await,
                    StatusCode::BAD_REQUEST,
                    "invalid_input",
                    field,
                );
                assert_no_rows(&pool, field).await;
            }
        }
    }

    mod 기준이_존재하지_않는_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec EC-4
        /// @given 유효한 입력이지만 존재하지 않는 `criterionId`를 보낸다
        /// @when `reviews.create`를 호출한다
        /// @then 404 `not_found`가 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec4_unknown_criterion_returns_not_found(pool: PgPool) {
            let investor = user(UserRole::Investor);
            expect_err(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("no-such-criterion", &["doc-business"]),
                )
                .await,
                StatusCode::NOT_FOUND,
                "not_found",
                "unknown criterion",
            );
            assert_no_rows(&pool, "unknown criterion").await;
        }
    }

    mod 근거_자료가_잘못된_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec EC-5
        /// @given `evidenceDocumentIds`가 빈 배열이다
        /// @when `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec5_empty_evidence_is_rejected(pool: PgPool) {
            let investor = user(UserRole::Investor);
            expect_err(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &[]),
                )
                .await,
                StatusCode::BAD_REQUEST,
                "invalid_input",
                "empty evidence",
            );
            assert_no_rows(&pool, "empty evidence").await;
        }

        /// @spec EC-6
        /// @given `evidenceDocumentIds`에 같은 `ready` 자료 ID가 두 번 들어 있다
        /// @when `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec6_duplicate_evidence_ids_are_rejected(pool: PgPool) {
            let investor = user(UserRole::Investor);
            expect_err(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &["doc-business", "doc-business"]),
                )
                .await,
                StatusCode::BAD_REQUEST,
                "invalid_input",
                "duplicate evidence",
            );
            assert_no_rows(&pool, "duplicate evidence").await;
        }

        /// @spec EC-7
        /// @given `evidenceDocumentIds`에 유효한 `ready` 자료 ID와 존재하지 않는 자료 ID가 함께 있다
        /// @when `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 검토·근거 행이 모두 생기지 않는다
        #[sqlx::test]
        async fn ec7_nonexistent_document_id_is_rejected_without_any_rows(pool: PgPool) {
            let investor = user(UserRole::Investor);
            expect_err(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &["doc-business", "doc-no-such-document"]),
                )
                .await,
                StatusCode::BAD_REQUEST,
                "invalid_input",
                "nonexistent document",
            );
            assert_no_rows(&pool, "nonexistent document").await;
        }

        /// @spec EC-8
        /// @given 테스트 안에서 다른 workspace에 `ready` 자료를 만들고 그 ID를 유효한 자료 ID와 함께 보낸다
        /// @when `reviews.create`를 호출한다
        /// @then 존재하지 않는 자료와 같은 400 `invalid_input`이 반환된다
        /// @then 검토·근거 행이 모두 생기지 않는다
        #[sqlx::test]
        async fn ec8_other_workspace_document_is_rejected_like_nonexistent(pool: PgPool) {
            let investor = user(UserRole::Investor);
            insert_workspace(&pool, "other-workspace").await;
            insert_document(&pool, "doc-other", "other-workspace", "ready").await;
            expect_err(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &["doc-business", "doc-other"]),
                )
                .await,
                StatusCode::BAD_REQUEST,
                "invalid_input",
                "other workspace document",
            );
            assert_no_rows(&pool, "other workspace document").await;
        }

        /// @spec EC-9
        /// @given 유효한 `ready` 자료 ID와 함께 `processing` 자료(`doc-pipeline`) 또는 `failed` 자료(`doc-revenue`)의 ID를 보낸다. 표본: 두 자료를 하나씩 반복
        /// @when 표본마다 `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 검토·근거 행이 모두 생기지 않는다
        #[sqlx::test]
        async fn ec9_processing_or_failed_document_is_rejected_without_any_rows(pool: PgPool) {
            let investor = user(UserRole::Investor);
            for document_id in ["doc-pipeline", "doc-revenue"] {
                expect_err(
                    review_call(
                        &pool,
                        &investor,
                        WORKSPACE,
                        "reviews.create",
                        valid_params("business", &["doc-business", document_id]),
                    )
                    .await,
                    StatusCode::BAD_REQUEST,
                    "invalid_input",
                    document_id,
                );
                assert_no_rows(&pool, document_id).await;
            }
        }
    }

    mod 이미_저장한_기준에_다시_저장하는_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec EC-10
        /// @given 같은 투자자가 이미 기준에 검토를 저장했고 다른 상태·의견·근거로 같은 기준에 다시 요청한다. 재요청의 나머지 입력(상태·의견·근거)은 유효하다
        /// @when `reviews.create`를 다시 호출하고 기존 DB 행을 직접 조회한다
        /// @then 409 `conflict`가 반환된다
        /// @then 기존 검토와 근거 행이 바뀌지 않는다
        #[sqlx::test]
        async fn ec10_resave_returns_conflict_and_keeps_existing_rows(pool: PgPool) {
            let investor = user(UserRole::Investor);
            expect_ok(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &["doc-business"]),
                )
                .await,
                "first create",
            );
            let reviews_before = review_rows(&pool).await;
            let evidence_before = evidence_rows(&pool).await;
            assert_eq!(reviews_before.len(), 1);
            assert_eq!(evidence_before.len(), 1);

            let second = json!({
                "criterionId": "business",
                "status": "needs_information",
                "comment": "다른 의견",
                "evidenceDocumentIds": ["doc-team"],
            });
            expect_err(
                review_call(&pool, &investor, WORKSPACE, "reviews.create", second).await,
                StatusCode::CONFLICT,
                "conflict",
                "resave",
            );
            assert_eq!(
                review_rows(&pool).await,
                reviews_before,
                "reviews unchanged"
            );
            assert_eq!(
                evidence_rows(&pool).await,
                evidence_before,
                "evidence unchanged"
            );
        }

        /// @spec EC-11
        /// @given 같은 투자자가 같은 기준에 유효한 `reviews.create` 요청 2개를 동시에 보내며, 경합이 재현되도록 반복한다. 표본·반복마다 서로 다른 (투자자, 기준) 조합을 쓴다
        /// @when 두 요청을 동시에 호출한다
        /// @then 한 요청은 성공하고 다른 요청은 409 `conflict`가 반환된다
        /// @then 검토는 1건만 저장된다
        #[sqlx::test]
        async fn ec11_concurrent_creates_store_exactly_one_review(pool: PgPool) {
            let investors = ["investor-user", "investor-peer"];
            let criteria = ["business", "team", "revenue"];
            let mut iteration: i64 = 0;
            for investor_id in investors {
                for criterion in criteria {
                    let investor = user_as(investor_id, UserRole::Investor);
                    let params = valid_params(criterion, &["doc-business"]);
                    let mut handles = Vec::new();
                    for _ in 0..2 {
                        let pool = pool.clone();
                        let investor = investor.clone();
                        let params = params.clone();
                        handles.push(tokio::spawn(async move {
                            match review_call(&pool, &investor, WORKSPACE, "reviews.create", params)
                                .await
                            {
                                Ok(_) => Ok(()),
                                Err(ApiError(status, kind, _)) => Err((status, kind.to_string())),
                            }
                        }));
                    }
                    let mut outcomes = Vec::new();
                    for handle in handles {
                        outcomes.push(handle.await.expect("task join"));
                    }
                    let successes = outcomes.iter().filter(|o| o.is_ok()).count();
                    assert_eq!(
                        successes, 1,
                        "{investor_id}/{criterion}: exactly one success"
                    );
                    let failures: Vec<_> = outcomes.into_iter().filter_map(|o| o.err()).collect();
                    assert_eq!(failures.len(), 1, "{investor_id}/{criterion}");
                    assert_eq!(
                        failures[0].0,
                        StatusCode::CONFLICT,
                        "{investor_id}/{criterion}"
                    );
                    assert_eq!(failures[0].1, "conflict", "{investor_id}/{criterion}");

                    iteration += 1;
                    let stored: i64 = sqlx::query_scalar(
                        "SELECT COUNT(*) FROM reviews WHERE investor_id = $1 AND criterion_id = $2",
                    )
                    .bind(investor_id)
                    .bind(criterion)
                    .fetch_one(&pool)
                    .await
                    .expect("count combo");
                    assert_eq!(stored, 1, "{investor_id}/{criterion}: one stored review");
                    assert_eq!(count_reviews(&pool).await, iteration);
                    assert_eq!(count_evidence(&pool).await, iteration);
                }
            }
        }
    }

    mod 저장이_실패하는_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec EC-13
        /// @given 유효한 입력을 보내고, 근거 저장 단계에서 DB 오류가 발생한다(검토 행 저장은 성공한 뒤)
        /// @when `reviews.create`를 호출하고 DB 행을 직접 조회한다
        /// @then 500 `storage_error`가 반환된다
        /// @then 검토와 근거가 모두 롤백되어 어느 쪽도 남지 않는다
        /// @then 이후 `reviews.list`가 해당 검토를 반환하지 않는다
        #[sqlx::test]
        async fn ec13_storage_failure_returns_500_and_rolls_back_review_and_evidence(pool: PgPool) {
            let investor = user(UserRole::Investor);
            // 검토 INSERT는 성공하고 근거 INSERT만 항상 실패하게 만든다.
            sqlx::query("ALTER TABLE review_evidence ADD CONSTRAINT always_fail CHECK (false)")
                .execute(&pool)
                .await
                .expect("add failing constraint");
            expect_err(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &["doc-business"]),
                )
                .await,
                StatusCode::INTERNAL_SERVER_ERROR,
                "storage_error",
                "evidence insert failure",
            );
            assert_no_rows(&pool, "rollback").await;
            let listed = expect_ok(
                review_call(&pool, &investor, WORKSPACE, "reviews.list", json!({})).await,
                "list after failure",
            );
            assert_eq!(listed["reviews"], json!([]));
        }
    }

    mod 검증_순서가_겹치는_경우 {
        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec EC-22
        /// @given 입력 형식 오류와 존재하지 않는 `criterionId`를 함께 보낸다. 입력 형식 오류 표본: 잘못된 `status`, 공백뿐인 `comment`, 알 수 없는 필드
        /// @when `reviews.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        #[sqlx::test]
        async fn ec22_format_error_wins_over_unknown_criterion(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let base = valid_params("no-such-criterion", &["doc-business"]);
            let samples = [
                ("잘못된 status", with_field(&base, "status", json!("bogus"))),
                (
                    "공백뿐인 comment",
                    with_field(&base, "comment", json!("   ")),
                ),
                (
                    "알 수 없는 필드",
                    with_field(&base, "investorId", json!("investor-peer")),
                ),
            ];
            for (label, params) in samples {
                expect_err(
                    review_call(&pool, &investor, WORKSPACE, "reviews.create", params).await,
                    StatusCode::BAD_REQUEST,
                    "invalid_input",
                    label,
                );
            }
        }

        /// @spec EC-23
        /// @given 존재하지 않는 `criterionId`와 잘못된 근거를 함께 보낸다. 잘못된 근거 표본: 빈 배열, 중복 ID, 존재하지 않는 자료 ID, `processing` 자료
        /// @when `reviews.create`를 호출한다
        /// @then 404 `not_found`가 반환된다
        #[sqlx::test]
        async fn ec23_unknown_criterion_wins_over_invalid_evidence(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let samples: [(&str, Vec<&str>); 4] = [
                ("빈 배열", vec![]),
                ("중복 ID", vec!["doc-business", "doc-business"]),
                ("존재하지 않는 자료 ID", vec!["doc-no-such-document"]),
                ("processing 자료", vec!["doc-pipeline"]),
            ];
            for (label, evidence) in samples {
                expect_err(
                    review_call(
                        &pool,
                        &investor,
                        WORKSPACE,
                        "reviews.create",
                        valid_params("no-such-criterion", &evidence),
                    )
                    .await,
                    StatusCode::NOT_FOUND,
                    "not_found",
                    label,
                );
            }
        }

        /// @spec EC-24
        /// @given 같은 투자자가 이미 저장한 기준에 잘못된 근거로 다시 요청한다. 잘못된 근거 표본: 존재하지 않는 자료 ID, 빈 배열, 중복 ID, `processing` 자료, 다른 workspace 자료(각각 이미 저장한 기준과 함께 요청)
        /// @when `reviews.create`를 호출하고 기존 DB 행을 직접 조회한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 기존 검토와 근거 행이 바뀌지 않는다
        #[sqlx::test]
        async fn ec24_invalid_evidence_wins_over_conflict_and_keeps_existing_rows(pool: PgPool) {
            let investor = user(UserRole::Investor);
            insert_workspace(&pool, "other-workspace").await;
            insert_document(&pool, "doc-other", "other-workspace", "ready").await;
            expect_ok(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.create",
                    valid_params("business", &["doc-business"]),
                )
                .await,
                "first create",
            );
            let reviews_before = review_rows(&pool).await;
            let evidence_before = evidence_rows(&pool).await;
            assert_eq!(reviews_before.len(), 1);
            assert_eq!(evidence_before.len(), 1);

            let samples: [(&str, Vec<&str>); 5] = [
                ("존재하지 않는 자료 ID", vec!["doc-no-such-document"]),
                ("빈 배열", vec![]),
                ("중복 ID", vec!["doc-team", "doc-team"]),
                ("processing 자료", vec!["doc-pipeline"]),
                ("다른 workspace 자료", vec!["doc-other"]),
            ];
            for (label, evidence) in samples {
                expect_err(
                    review_call(
                        &pool,
                        &investor,
                        WORKSPACE,
                        "reviews.create",
                        valid_params("business", &evidence),
                    )
                    .await,
                    StatusCode::BAD_REQUEST,
                    "invalid_input",
                    label,
                );
                assert_eq!(review_rows(&pool).await, reviews_before, "{label}: reviews");
                assert_eq!(
                    evidence_rows(&pool).await,
                    evidence_before,
                    "{label}: evidence"
                );
            }
        }
    }
}
