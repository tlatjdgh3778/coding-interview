//! 대상 스펙: docs/specs/review-update.md (검토 수정, Review Plugin)
//! 이 파일의 `DoD-N`·`EC-N`은 위 스펙 번호다. 다른 테스트 파일의 번호는 각자의 스펙 기준이다(기존 review_write.rs는 review-write.md 기준).
//! 담당 범위: DoD-1~DoD-9, EC-1~EC-5, EC-7, EC-8. EC-6(미인증 401)은 `plugins::dispatch` 직접 호출 층에서 볼 수 없어 이 파일에서 제외하며 E2E(tests/review-write.update.spec.ts)가 맡는다.
//! 모든 case는 `#[sqlx::test]`의 실제 PostgreSQL에서 `pluginId: "review"`의 `reviews.update`를 호출한다. mock은 없다.
//! 데이터 격리: `#[sqlx::test]`가 테스트마다 임시 DB를 만들고 시드 포함 마이그레이션을 적용한다. 기존 검토는 각 테스트가 `reviews.create`로 만들고 다른 투자자는 시드 `investor-peer`를 쓴다.
//! EC-7 실패 주입 방식(사용자 확정): 기존 검토를 만든 뒤 임시 DB의 `review_evidence`에 항상 실패하는 CHECK 제약을 추가해 근거 INSERT만 실패시킨다.
//! 모든 case 본문은 구현 단계에서 채웠다. 헬퍼는 `review_common/mod.rs`.

#[allow(dead_code)]
mod common;
mod review_common;

mod 투자자가_저장한_검토를_같은_검토로_수정한다 {
    mod 수정을_저장하는_경우 {

        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;
        /// @spec DoD-1 DoD-2 DoD-4 DoD-5
        /// @given 투자자가 한 기준에 검토(결과·의견·근거 집합 A)를 저장해 두었고 수정 전 근거 집합 A에는 수정 후 근거 집합 B에 없는 자료가 포함된다. 수정 요청의 `status`는 저장된 `status`와 다른 값이다. 수정 요청의 trim한 `comment`는 저장된 `comment`와 다르다
        /// @when `status`·`comment`(앞뒤 공백 포함)·다른 `ready` 자료 집합 B로 `reviews.update`를 호출한다
        /// @then 응답의 `review`와 DB 행에 요청한 `status`와 trim한 `comment`가 저장된다
        /// @then `id`와 `createdAt`은 수정 전과 같다
        /// @then `review_evidence`를 직접 조회하면 근거는 요청한 자료 ID 집합 B와 정확히 같고 빠진 자료는 남지 않는다
        /// @then 해당 투자자·기준의 `reviews` 행은 1개다
        #[sqlx::test]
        async fn dod1_update_replaces_values_and_evidence_keeping_same_review(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let created = expect_ok(
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
            let before = &created["review"];
            let id = before["id"].as_str().expect("id").to_string();
            let created_at_before: String =
                sqlx::query_scalar("SELECT created_at::text FROM reviews WHERE id = $1")
                    .bind(&id)
                    .fetch_one(&pool)
                    .await
                    .expect("created_at before");
            assert_eq!(before["status"], json!("satisfied"));

            let updated = expect_ok(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.update",
                    update_params(
                        "business",
                        "needs_information",
                        "  수정한 의견  ",
                        &["doc-team"],
                    ),
                )
                .await,
                "update",
            );
            let review = &updated["review"];
            assert_eq!(review["status"], json!("needs_information"));
            assert_eq!(review["comment"], json!("수정한 의견"));
            assert_eq!(review["evidenceDocumentIds"], json!(["doc-team"]));
            assert_eq!(review["id"], json!(id));
            assert_eq!(review["createdAt"], before["createdAt"]);

            let (db_id, status, comment, created_at_after): (String, String, String, String) =
                sqlx::query_as(
                    "SELECT id, status, comment, created_at::text FROM reviews \
                 WHERE investor_id = 'investor-user' AND criterion_id = 'business'",
                )
                .fetch_one(&pool)
                .await
                .expect("select updated row");
            assert_eq!(db_id, id);
            assert_eq!(status, "needs_information");
            assert_eq!(comment, "수정한 의견");
            assert_eq!(created_at_after, created_at_before);
            assert_eq!(
                evidence_ids_of(&pool, &id).await,
                vec!["doc-team".to_string()]
            );
            assert_eq!(count_evidence(&pool).await, 1);
            let rows: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM reviews WHERE investor_id = 'investor-user' AND criterion_id = 'business'",
            )
            .fetch_one(&pool)
            .await
            .expect("count rows");
            assert_eq!(rows, 1);
        }

        /// @spec DoD-3
        /// @given 투자자가 검토를 저장해 두었고 DB의 `updated_at`(timestamptz)을 읽어 두었다. 표본: 값을 바꾼 요청, 저장된 값과 완전히 같은 값으로 재저장하는 요청
        /// @when 표본마다 `reviews.update`를 호출한다
        /// @then 성공한다
        /// @then DB의 `updated_at`이 수정 전 값보다 이후 시각이다(응답 시각 문자열은 초 단위라 같은 초에 동일할 수 있으므로 비교 대상이 아니다)
        /// @then 응답의 `review.updatedAt`은 DB `updated_at`을 응답 표기(초 단위 ISO 문자열)로 바꾼 값과 같다
        #[sqlx::test]
        async fn dod3_update_advances_updated_at_in_db_even_when_values_unchanged(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let created = expect_ok(
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
            let id = created["review"]["id"].as_str().expect("id").to_string();
            let samples = [
                (
                    "값을 바꾼 요청",
                    update_params("business", "needs_information", "바꾼 의견", &["doc-team"]),
                ),
                (
                    "동일 값 재저장",
                    update_params("business", "needs_information", "바꾼 의견", &["doc-team"]),
                ),
            ];
            for (label, params) in samples {
                let before = updated_at_micros(&pool, &id).await;
                let result = expect_ok(
                    review_call(&pool, &investor, WORKSPACE, "reviews.update", params).await,
                    label,
                );
                let after = updated_at_micros(&pool, &id).await;
                assert!(
                    after > before,
                    "[{label}] updated_at must advance: {before} -> {after}"
                );
                assert_eq!(
                    result["review"]["updatedAt"].as_str().expect("updatedAt"),
                    updated_at_iso(&pool, &id).await,
                    "[{label}] response updatedAt matches DB"
                );
            }
        }

        /// @spec DoD-6
        /// @given 투자자가 검토를 저장한 뒤 `reviews.update`로 수정에 성공했다
        /// @when 바로 이어서 `reviews.list`를 호출한다
        /// @then 수정된 결과·의견과 수정된 근거 목록을 반환한다
        #[sqlx::test]
        async fn dod6_list_returns_updated_values_and_evidence_right_after_update(pool: PgPool) {
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
                "create",
            );
            expect_ok(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.update",
                    update_params(
                        "business",
                        "needs_information",
                        "수정한 의견",
                        &["doc-team"],
                    ),
                )
                .await,
                "update",
            );
            let listed = expect_ok(
                review_call(&pool, &investor, WORKSPACE, "reviews.list", json!({})).await,
                "list",
            );
            let reviews = listed["reviews"].as_array().expect("reviews array");
            assert_eq!(reviews.len(), 1);
            assert_eq!(reviews[0]["criterionId"], json!("business"));
            assert_eq!(reviews[0]["status"], json!("needs_information"));
            assert_eq!(reviews[0]["comment"], json!("수정한 의견"));
            assert_eq!(reviews[0]["evidenceDocumentIds"], json!(["doc-team"]));
        }
    }

    mod 다른_투자자의_검토가_있는_경우 {

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
        /// @given 투자자와 다른 투자자(`investor-peer`)가 같은 기준에 검토를 모두 저장했다
        /// @when 투자자가 그 기준에 `reviews.update`를 호출한다
        /// @then 투자자 본인의 검토만 바뀐다
        /// @then `investor-peer`의 같은 기준 검토의 값·근거·`updated_at`은 그대로다
        #[sqlx::test]
        async fn dod8_update_does_not_change_other_investors_review(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let peer = user_as("investor-peer", UserRole::Investor);
            for who in [&investor, &peer] {
                expect_ok(
                    review_call(
                        &pool,
                        who,
                        WORKSPACE,
                        "reviews.create",
                        valid_params("business", &["doc-business"]),
                    )
                    .await,
                    "create",
                );
            }
            let peer_rows_before: Vec<_> = review_rows(&pool)
                .await
                .into_iter()
                .filter(|r| r.2 == "investor-peer")
                .collect();
            let peer_id = peer_rows_before[0].0.clone();
            let peer_evidence_before = evidence_ids_of(&pool, &peer_id).await;
            let own_before: Vec<_> = review_rows(&pool)
                .await
                .into_iter()
                .filter(|r| r.2 == "investor-user")
                .collect();

            expect_ok(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.update",
                    update_params(
                        "business",
                        "needs_information",
                        "내 수정 의견",
                        &["doc-team"],
                    ),
                )
                .await,
                "update",
            );

            let rows_after = review_rows(&pool).await;
            let peer_rows_after: Vec<_> = rows_after
                .iter()
                .filter(|r| r.2 == "investor-peer")
                .cloned()
                .collect();
            assert_eq!(
                peer_rows_after, peer_rows_before,
                "peer review (incl. updated_at) unchanged"
            );
            assert_eq!(evidence_ids_of(&pool, &peer_id).await, peer_evidence_before);
            let own_after: Vec<_> = rows_after
                .iter()
                .filter(|r| r.2 == "investor-user")
                .cloned()
                .collect();
            assert_eq!(own_after.len(), 1);
            assert_ne!(own_after, own_before, "own review changed");
            assert_eq!(own_after[0].4, "needs_information");
            assert_eq!(own_after[0].5, "내 수정 의견");
        }
    }

    mod 의견이_허용_길이_경계에_걸리는_경우 {

        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;
        /// @spec EC-2
        /// @given 투자자가 저장한 검토가 있다. 의견 길이는 바이트가 아니라 문자 수 기준이다. 표본: 한글 2000자, 앞뒤 공백을 포함해 요청하고 trim 후 정확히 2000자인 값
        /// @when 표본마다 `reviews.update`를 호출한다
        /// @then 요청이 거부되지 않고 저장된다
        /// @then 저장되는 `comment`는 trim한 값이다
        #[sqlx::test]
        async fn ec2_comment_of_exactly_2000_chars_is_accepted_and_trimmed(pool: PgPool) {
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
                "create",
            );
            let hangul = "가".repeat(2000);
            let padded = format!("  {}\n ", "a".repeat(2000));
            let samples = [
                ("한글 2000자", hangul.clone(), hangul.clone()),
                ("공백 포함 trim 후 2000자", padded, "a".repeat(2000)),
            ];
            for (label, requested, expected) in samples {
                let result = expect_ok(
                    review_call(
                        &pool,
                        &investor,
                        WORKSPACE,
                        "reviews.update",
                        update_params("business", "satisfied", &requested, &["doc-business"]),
                    )
                    .await,
                    label,
                );
                assert_eq!(
                    result["review"]["comment"],
                    json!(expected),
                    "[{label}] response"
                );
                let stored: String = sqlx::query_scalar(
                    "SELECT comment FROM reviews WHERE criterion_id = 'business'",
                )
                .fetch_one(&pool)
                .await
                .expect("select comment");
                assert_eq!(stored, expected, "[{label}] stored");
            }
        }
    }

    mod 수정_요청이_거부되면_검토가_바뀌거나_생기지_않는다 {
        mod 저장된_검토가_없는_기준을_수정하려는_경우 {

            #[allow(unused_imports)]
            use crate::{common::*, review_common::*};
            #[allow(unused_imports)]
            use axum::http::StatusCode;
            #[allow(unused_imports)]
            use dataroom_api::{error::ApiError, types::UserRole};
            #[allow(unused_imports)]
            use serde_json::json;
            use sqlx::PgPool;
            /// @spec DoD-9
            /// @given 투자자가 저장한 검토가 없는 기준이다. 표본: 아무도 저장하지 않은 기준, 다른 투자자(`investor-peer`)만 저장한 기준
            /// @when 표본마다 투자자가 `reviews.update`를 호출한다
            /// @then 404 `not_found`가 반환된다
            /// @then `reviews`와 `review_evidence`에 행이 생기지 않는다
            #[sqlx::test]
            async fn dod9_update_without_saved_review_returns_404_and_creates_no_row(pool: PgPool) {
                let investor = user(UserRole::Investor);
                let params = update_params("business", "satisfied", "의견", &["doc-business"]);
                expect_err(
                    review_call(
                        &pool,
                        &investor,
                        WORKSPACE,
                        "reviews.update",
                        params.clone(),
                    )
                    .await,
                    StatusCode::NOT_FOUND,
                    "not_found",
                    "아무도 저장하지 않은 기준",
                );
                assert_no_rows(&pool, "아무도 저장하지 않은 기준").await;

                let peer = user_as("investor-peer", UserRole::Investor);
                expect_ok(
                    review_call(
                        &pool,
                        &peer,
                        WORKSPACE,
                        "reviews.create",
                        valid_params("business", &["doc-team"]),
                    )
                    .await,
                    "peer create",
                );
                let before = snapshot(&pool).await;
                expect_err(
                    review_call(&pool, &investor, WORKSPACE, "reviews.update", params).await,
                    StatusCode::NOT_FOUND,
                    "not_found",
                    "다른 투자자만 저장한 기준",
                );
                assert_eq!(snapshot(&pool).await, before, "no row created or changed");
                assert_eq!(count_reviews(&pool).await, 1);
                assert_eq!(count_evidence(&pool).await, 1);
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
            /// @spec DoD-7
            /// @given 투자자가 저장한 검토가 있고 기업 담당자가 잘못된 입력을 보낸다. 표본: 공백뿐인 의견, 빈 근거 배열, 알 수 없는 필드, 허용되지 않은 `status`(하나씩 보내도 모두 입력 검증 이전에 403이어야 한다)
            /// @when 표본마다 기업 담당자가 `reviews.update`를 호출한다
            /// @then 입력 검증보다 먼저 403으로 거부된다
            /// @then 기존 검토와 근거는 바뀌지 않는다
            #[sqlx::test]
            async fn dod7_company_update_is_forbidden_before_input_validation(pool: PgPool) {
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
                let before = snapshot(&pool).await;
                let base = update_params("business", "needs_information", "의견", &["doc-team"]);
                let samples = [
                    ("공백뿐인 의견", with_field(&base, "comment", json!("   "))),
                    (
                        "빈 근거 배열",
                        with_field(&base, "evidenceDocumentIds", json!([])),
                    ),
                    (
                        "알 수 없는 필드",
                        with_field(&base, "investorId", json!("investor-peer")),
                    ),
                    (
                        "허용되지 않은 status",
                        with_field(&base, "status", json!("bogus")),
                    ),
                ];
                for (label, params) in samples {
                    expect_err(
                        review_call(&pool, &company, WORKSPACE, "reviews.update", params).await,
                        StatusCode::FORBIDDEN,
                        "forbidden",
                        label,
                    );
                    assert_eq!(snapshot(&pool).await, before, "[{label}] unchanged");
                }
            }

            /// @spec EC-5
            /// @given 투자자가 저장한 검토가 있고 요청의 `workspaceId`가 사용자 workspace와 다르다
            /// @when 투자자가 `reviews.update`를 호출한다
            /// @then 403이 반환된다
            /// @then 기존 검토는 바뀌지 않는다
            #[sqlx::test]
            async fn ec5_update_with_mismatched_workspace_id_is_forbidden(pool: PgPool) {
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
                    "create",
                );
                let before = snapshot(&pool).await;
                expect_err(
                    review_call(
                        &pool,
                        &investor,
                        "other-workspace",
                        "reviews.update",
                        update_params("business", "needs_information", "의견", &["doc-team"]),
                    )
                    .await,
                    StatusCode::FORBIDDEN,
                    "forbidden",
                    "workspace mismatch",
                );
                assert_eq!(snapshot(&pool).await, before, "unchanged");
            }
        }

        mod 의견이_규칙에_맞지_않는_경우 {

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
            /// @given 투자자가 저장한 검토가 있다. 표본: 빈 `comment`, 공백뿐인 `comment`
            /// @when 표본마다 `reviews.update`를 호출한다
            /// @then 400 `invalid_input`이 반환된다
            /// @then DB의 기존 검토·근거는 바뀌지 않는다
            #[sqlx::test]
            async fn ec1_blank_comment_returns_400_and_keeps_existing_review(pool: PgPool) {
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
                    "create",
                );
                let before = snapshot(&pool).await;
                let base = update_params(
                    "business",
                    "needs_information",
                    "수정한 의견",
                    &["doc-team"],
                );
                let samples = [
                    (
                        "빈 comment".to_string(),
                        with_field(&base, "comment", json!("")),
                    ),
                    (
                        "공백뿐인 comment".to_string(),
                        with_field(&base, "comment", json!(" \t\n ")),
                    ),
                ];
                for (label, params) in samples {
                    expect_err(
                        review_call(&pool, &investor, WORKSPACE, "reviews.update", params).await,
                        StatusCode::BAD_REQUEST,
                        "invalid_input",
                        &label,
                    );
                    assert_eq!(snapshot(&pool).await, before, "[{label}] unchanged");
                }
            }

            /// @spec EC-2
            /// @given 투자자가 저장한 검토가 있다. 표본: trim 후 2001자(ASCII), 한글 2001자
            /// @when 표본마다 `reviews.update`를 호출한다
            /// @then 400 `invalid_input`이 반환된다
            /// @then DB의 기존 검토·근거는 바뀌지 않는다
            #[sqlx::test]
            async fn ec2_comment_over_2000_chars_returns_400_and_keeps_existing_review(
                pool: PgPool,
            ) {
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
                    "create",
                );
                let before = snapshot(&pool).await;
                let base = update_params(
                    "business",
                    "needs_information",
                    "수정한 의견",
                    &["doc-team"],
                );
                let samples = [
                    (
                        "ASCII 2001자".to_string(),
                        with_field(&base, "comment", json!(format!(" {} ", "a".repeat(2001)))),
                    ),
                    (
                        "한글 2001자".to_string(),
                        with_field(&base, "comment", json!("가".repeat(2001))),
                    ),
                ];
                for (label, params) in samples {
                    expect_err(
                        review_call(&pool, &investor, WORKSPACE, "reviews.update", params).await,
                        StatusCode::BAD_REQUEST,
                        "invalid_input",
                        &label,
                    );
                    assert_eq!(snapshot(&pool).await, before, "[{label}] unchanged");
                }
            }
        }

        mod 근거_자료가_규칙에_맞지_않는_경우 {

            #[allow(unused_imports)]
            use crate::{common::*, review_common::*};
            #[allow(unused_imports)]
            use axum::http::StatusCode;
            #[allow(unused_imports)]
            use dataroom_api::{error::ApiError, types::UserRole};
            #[allow(unused_imports)]
            use serde_json::json;
            use sqlx::PgPool;
            /// @spec EC-3
            /// @given 투자자가 저장한 검토가 있다. 표본: 빈 배열, 중복 ID, 존재하지 않는 자료, 다른 workspace의 자료, `processing` 자료(`doc-pipeline`), `failed` 자료(`doc-revenue`)
            /// @when 표본마다 `reviews.update`를 호출한다
            /// @then 400 `invalid_input`이 반환된다
            /// @then DB의 기존 검토·근거는 바뀌지 않는다
            #[sqlx::test]
            async fn ec3_invalid_evidence_returns_400_and_keeps_existing_review(pool: PgPool) {
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
                    "create",
                );
                let before = snapshot(&pool).await;
                let base = update_params(
                    "business",
                    "needs_information",
                    "수정한 의견",
                    &["doc-team"],
                );
                insert_workspace(&pool, "other-workspace").await;
                insert_document(&pool, "doc-other", "other-workspace", "ready").await;
                let samples = [
                    (
                        "빈 배열".to_string(),
                        with_field(&base, "evidenceDocumentIds", json!([])),
                    ),
                    (
                        "중복 ID".to_string(),
                        with_field(
                            &base,
                            "evidenceDocumentIds",
                            json!(["doc-team", "doc-team"]),
                        ),
                    ),
                    (
                        "존재하지 않는 자료".to_string(),
                        with_field(&base, "evidenceDocumentIds", json!(["no-such-doc"])),
                    ),
                    (
                        "다른 workspace 자료".to_string(),
                        with_field(&base, "evidenceDocumentIds", json!(["doc-other"])),
                    ),
                    (
                        "processing 자료".to_string(),
                        with_field(&base, "evidenceDocumentIds", json!(["doc-pipeline"])),
                    ),
                    (
                        "failed 자료".to_string(),
                        with_field(&base, "evidenceDocumentIds", json!(["doc-revenue"])),
                    ),
                    (
                        "유효 자료 + failed 자료".to_string(),
                        with_field(
                            &base,
                            "evidenceDocumentIds",
                            json!(["doc-team", "doc-revenue"]),
                        ),
                    ),
                ];
                for (label, params) in samples {
                    expect_err(
                        review_call(&pool, &investor, WORKSPACE, "reviews.update", params).await,
                        StatusCode::BAD_REQUEST,
                        "invalid_input",
                        &label,
                    );
                    assert_eq!(snapshot(&pool).await, before, "[{label}] unchanged");
                }
            }
        }

        mod 요청_형식이_규칙에_맞지_않는_경우 {

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
            /// @given 투자자가 저장한 검토가 있다. 표본: 알 수 없는 필드가 추가된 `params`, 허용되지 않은 `status` 값
            /// @when 표본마다 `reviews.update`를 호출한다
            /// @then 400 `invalid_input`이 반환된다
            /// @then DB의 기존 검토·근거는 바뀌지 않는다
            #[sqlx::test]
            async fn ec4_unknown_field_or_invalid_status_returns_400_and_keeps_existing_review(
                pool: PgPool,
            ) {
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
                    "create",
                );
                let before = snapshot(&pool).await;
                let base = update_params(
                    "business",
                    "needs_information",
                    "수정한 의견",
                    &["doc-team"],
                );
                let samples = [
                    (
                        "알 수 없는 필드".to_string(),
                        with_field(&base, "investorId", json!("investor-peer")),
                    ),
                    (
                        "허용되지 않은 status".to_string(),
                        with_field(&base, "status", json!("bogus")),
                    ),
                ];
                for (label, params) in samples {
                    expect_err(
                        review_call(&pool, &investor, WORKSPACE, "reviews.update", params).await,
                        StatusCode::BAD_REQUEST,
                        "invalid_input",
                        &label,
                    );
                    assert_eq!(snapshot(&pool).await, before, "[{label}] unchanged");
                }
            }
        }
    }

    mod 근거_교체_중_저장소_오류가_나는_경우 {

        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;
        /// @spec EC-7
        /// @given 투자자가 저장한 검토가 있고 새 근거 목록은 1개 이상이며 근거 교체 중 DB 오류가 난다
        /// @when 투자자가 새 결과·의견·근거로 `reviews.update`를 호출한다
        /// @then 500 `storage_error`가 반환된다
        /// @then 기존 의견·결과·근거와 DB의 `updated_at`이 그대로다(전체 롤백)
        #[sqlx::test]
        async fn ec7_evidence_replace_db_error_rolls_back_everything(pool: PgPool) {
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
                "create",
            );
            let before = snapshot(&pool).await;
            // 기존 행은 허용하고 새 근거 INSERT만 항상 실패하게 만든다.
            sqlx::query(
                "ALTER TABLE review_evidence ADD CONSTRAINT always_fail CHECK (false) NOT VALID",
            )
            .execute(&pool)
            .await
            .expect("add failing constraint");
            expect_err(
                review_call(
                    &pool,
                    &investor,
                    WORKSPACE,
                    "reviews.update",
                    update_params(
                        "business",
                        "needs_information",
                        "수정한 의견",
                        &["doc-team"],
                    ),
                )
                .await,
                StatusCode::INTERNAL_SERVER_ERROR,
                "storage_error",
                "evidence insert failure",
            );
            // review_rows에는 status·comment·updated_at이 포함되고, evidence_rows에는 기존 근거가 포함된다.
            assert_eq!(snapshot(&pool).await, before, "rolled back completely");
        }
    }

    mod 같은_검토를_동시에_수정하는_경우 {

        #[allow(unused_imports)]
        use crate::{common::*, review_common::*};
        #[allow(unused_imports)]
        use axum::http::StatusCode;
        #[allow(unused_imports)]
        use dataroom_api::{error::ApiError, types::UserRole};
        #[allow(unused_imports)]
        use serde_json::json;
        use sqlx::PgPool;
        /// @spec EC-8
        /// @given 투자자가 저장한 검토가 있고 서로 다른 근거 집합 두 개(X, Y)로 동시에 `reviews.update` 요청 두 개를 보낸다. 경합이 재현되도록 반복한다
        /// @when 두 요청을 실제로 동시에 호출한다
        /// @then 검토 행은 1개다
        /// @then 최종 근거 목록은 두 요청 중 하나의 목록(X 또는 Y)과 정확히 같고 섞이지 않는다
        #[sqlx::test]
        async fn ec8_concurrent_updates_leave_one_review_with_one_of_the_evidence_sets(
            pool: PgPool,
        ) {
            let investor = user(UserRole::Investor);
            let created = expect_ok(
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
            let id = created["review"]["id"].as_str().expect("id").to_string();
            let set_x = vec!["doc-business".to_string()];
            let set_y = vec!["doc-team".to_string()];
            for iteration in 0..30 {
                let mut handles = Vec::new();
                for (status, comment, evidence) in [
                    ("satisfied", "의견 X", ["doc-business"]),
                    ("needs_information", "의견 Y", ["doc-team"]),
                ] {
                    let pool = pool.clone();
                    let investor = investor.clone();
                    let params = update_params("business", status, comment, &evidence);
                    handles.push(tokio::spawn(async move {
                        review_call(&pool, &investor, WORKSPACE, "reviews.update", params)
                            .await
                            .map(|_| ())
                            .map_err(|ApiError(status, kind, _)| (status, kind.to_string()))
                    }));
                }
                for handle in handles {
                    // 성공 여부는 스펙에 없으므로 단언하지 않는다.
                    let _ = handle.await.expect("task join");
                }
                assert_eq!(
                    count_reviews(&pool).await,
                    1,
                    "iteration {iteration}: one review row"
                );
                let evidence = evidence_ids_of(&pool, &id).await;
                assert!(
                    evidence == set_x || evidence == set_y,
                    "iteration {iteration}: evidence must be exactly X or Y, got {evidence:?}"
                );
                assert_eq!(
                    count_evidence(&pool).await,
                    1,
                    "iteration {iteration}: no mixed rows"
                );
            }
        }
    }
}
