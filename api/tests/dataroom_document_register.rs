//! 대상 스펙: docs/specs/dataroom-document-register.md (자료 등록)
//! 이 파일의 `DoD-N`·`EC-N`은 위 스펙 번호다. `dataroom_documents.rs`의 번호는 이전 스펙(자료 조회) 기준이다.
//! 본문은 `#[sqlx::test]`로 채웠다. 헬퍼는 `common/mod.rs`에 있다.

mod common;

mod 기업_담당자가_제목과_파일을_자료로_등록한다 {
    mod 등록에_성공하는_경우 {
        use crate::common::*;
        use dataroom_api::types::UserRole;
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec DoD-1 DoD-2 DoD-4 DoD-9
        /// @given 세션 사용자 id와 workspace가 있는 기업 담당자가 유효한 제목·파일명·본문을 가지고 있다
        /// @when `documents.create`를 호출하고, 등록된 id로 `documents.get`과 `documents.list`를 호출하고, DB 행을 직접 조회한다
        /// @then `ready` 상태의 자료가 저장되고 응답에 id·제목·파일명·상태·본문·작성 시각이 담긴다
        /// @then `documents.get` 응답이 등록한 값과 같다
        /// @then `documents.list`에서 작성 시각 내림차순 규칙대로 최상단에 나온다
        /// @then DB 행의 `workspace_id`는 요청자의 workspace이고 다른 workspace에는 해당 자료가 없다
        /// @then DB 행의 작성자(`created_by`)는 세션에서 확인한 사용자 id다
        #[sqlx::test]
        async fn dod1_dod2_dod4_dod9_registered_document_is_stored_readable_and_owned_by_session(
            pool: PgPool,
        ) {
            let company = user(UserRole::Company);
            let before = count_documents(&pool).await;

            let created = expect_ok(
                create(&pool, &company, "분기 보고", "report.md", "# 본문\n내용").await,
                "create",
            );
            let document = &created["document"];
            let id = document["id"]
                .as_str()
                .expect("id must be a string")
                .to_string();
            assert!(id.starts_with("doc-"), "id: {id}");
            assert_eq!(document["title"], "분기 보고");
            assert_eq!(document["fileName"], "report.md");
            assert_eq!(document["status"], "ready");
            assert_eq!(document["content"], "# 본문\n내용");
            assert!(
                document["createdAt"]
                    .as_str()
                    .is_some_and(|v| !v.is_empty()),
                "createdAt must be a non-empty string"
            );

            // DoD-2: get 응답이 등록한 값과 같고, list 최상단에 나온다
            let got = expect_ok(
                call(
                    &pool,
                    &company,
                    WORKSPACE,
                    "documents.get",
                    json!({ "documentId": id }),
                )
                .await,
                "get",
            );
            assert_eq!(&got["document"], document);
            let listed = expect_ok(
                call(&pool, &company, WORKSPACE, "documents.list", json!({})).await,
                "list",
            );
            assert_eq!(listed["documents"][0]["id"], id.as_str());

            // DoD-1·4·9: DB 행으로 상태·workspace·작성자 확인
            assert_eq!(count_documents(&pool).await, before + 1);
            let (status, workspace_id, created_by): (String, String, Option<String>) =
                sqlx::query_as(
                    "SELECT status, workspace_id, created_by FROM documents WHERE id = $1",
                )
                .bind(&id)
                .fetch_one(&pool)
                .await
                .expect("select created row");
            assert_eq!(status, "ready");
            assert_eq!(workspace_id, WORKSPACE);
            assert_eq!(created_by.as_deref(), Some(company.id.as_str()));
            let in_other_workspaces: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM documents WHERE id = $1 AND workspace_id <> $2",
            )
            .bind(&id)
            .bind(WORKSPACE)
            .fetch_one(&pool)
            .await
            .expect("count other workspaces");
            assert_eq!(in_other_workspaces, 0);
        }
    }

    mod 권한이_없는_경우 {
        use crate::common::*;
        use axum::http::StatusCode;
        use dataroom_api::types::UserRole;
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec DoD-3
        /// @given 투자자가 자신의 workspace를 `workspaceId`로 하고, 의미 검증 위반(빈 제목·잘못된 파일명·빈 본문)과 알 수 없는 필드(예: `createdBy`)를 모두 포함해 보낸다
        /// @when `documents.create`를 호출한다
        /// @then 입력 검증(의미 검증·알 수 없는 필드 거부)보다 먼저 403 `forbidden`이 반환된다
        /// @then DB에 행이 생기지 않는다
        #[sqlx::test]
        async fn dod3_investor_create_is_forbidden_before_any_input_validation(pool: PgPool) {
            let investor = user(UserRole::Investor);
            let before = count_documents(&pool).await;
            // 투자자 본인의 workspace, 의미 검증 위반 + 알 수 없는 필드
            let result = create_with_params(
                &pool,
                &investor,
                json!({
                    "title": "",
                    "fileName": "bad.pdf",
                    "content": "",
                    "createdBy": "someone-else"
                }),
            )
            .await;
            expect_err(
                result,
                StatusCode::FORBIDDEN,
                "forbidden",
                "investor create",
            );
            assert_eq!(count_documents(&pool).await, before);
        }

        /// @spec DoD-4
        /// @given 요청 `workspaceId`가 사용자 workspace와 다르다
        /// @when `documents.create`를 호출한다
        /// @then 403 `forbidden`이 반환된다
        /// @then DB에 행이 생기지 않는다
        #[sqlx::test]
        async fn dod4_workspace_mismatch_is_forbidden_and_creates_no_row(pool: PgPool) {
            let company = user(UserRole::Company);
            let before = count_documents(&pool).await;
            let result = call(
                &pool,
                &company,
                "other-workspace",
                "documents.create",
                json!({ "title": "제목", "fileName": "a.md", "content": "본문" }),
            )
            .await;
            expect_err(
                result,
                StatusCode::FORBIDDEN,
                "forbidden",
                "workspace mismatch",
            );
            assert_eq!(count_documents(&pool).await, before);
        }
    }

    mod 입력이_규칙을_어기는_경우 {
        use crate::common::*;
        use axum::http::StatusCode;
        use dataroom_api::types::UserRole;
        use serde_json::json;
        use sqlx::PgPool;

        /// @spec EC-1
        /// @given 제목 표본: 빈 제목, 공백뿐인 제목, NUL(`\u0000`)을 포함한 제목, trim 후 100자(문자 수 기준)를 넘는 제목을 하나씩 사용한다
        /// @when 표본마다 `documents.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec1_invalid_title_is_rejected_with_invalid_input(pool: PgPool) {
            let company = user(UserRole::Company);
            let samples: Vec<(&str, String)> = vec![
                ("빈 제목", String::new()),
                ("공백뿐인 제목", "  \t\n ".to_string()),
                ("NUL 포함 제목", "제목\u{0}끝".to_string()),
                ("trim 후 100자 초과", format!("  {}  ", "가".repeat(101))),
            ];
            for (name, title) in samples {
                let before = count_documents(&pool).await;
                let result = create(&pool, &company, &title, "ok.md", "본문").await;
                expect_err(result, StatusCode::BAD_REQUEST, "invalid_input", name);
                assert_eq!(count_documents(&pool).await, before, "[{name}] row count");
            }
        }

        /// @spec EC-2
        /// @given 파일명 표본: `.txt`/`.md`로 끝나지 않는 이름, 확장자만 있는 이름(`.md`), 공백뿐인 이름, 선행 공백이 있는 이름, 후행 공백이 있는 이름, `/` 포함, `\` 포함, C0 제어문자 포함, DEL 포함, C1 제어문자 포함, 255자 초과를 각각 별도 표본으로 하나씩 사용한다
        /// @when 표본마다 `documents.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec2_invalid_file_name_is_rejected_with_invalid_input(pool: PgPool) {
            let company = user(UserRole::Company);
            let samples: Vec<(&str, String)> = vec![
                ("확장자 불가", "note.pdf".to_string()),
                ("확장자만(.md)", ".md".to_string()),
                ("공백뿐", "   ".to_string()),
                ("선행 공백", " a.md".to_string()),
                ("후행 공백", "a.md ".to_string()),
                ("슬래시 포함", "a/b.md".to_string()),
                ("백슬래시 포함", "a\\b.md".to_string()),
                ("C0 제어문자", "a\u{0001}b.md".to_string()),
                ("DEL", "a\u{007f}b.md".to_string()),
                ("C1 제어문자", "a\u{0085}b.md".to_string()),
                ("255자 초과", format!("{}.md", "a".repeat(253))),
            ];
            for (name, file_name) in samples {
                let before = count_documents(&pool).await;
                let result = create(&pool, &company, "제목", &file_name, "본문").await;
                expect_err(result, StatusCode::BAD_REQUEST, "invalid_input", name);
                assert_eq!(count_documents(&pool).await, before, "[{name}] row count");
            }
        }

        /// @spec EC-3
        /// @given 본문 표본: 빈 본문, 공백뿐인 본문, BOM(U+FEFF)만 있는 본문, NUL(`\u0000`) 포함 본문, 문자 수는 한도 이하이나 UTF-8 바이트가 204,800을 넘는 다바이트 본문을 하나씩 사용한다
        /// @when 표본마다 `documents.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec3_invalid_content_is_rejected_with_invalid_input(pool: PgPool) {
            let company = user(UserRole::Company);
            // "가"는 UTF-8 3바이트: 68,267자 = 204,801바이트(문자 수는 한도 이하, 바이트는 초과)
            let multibyte = "가".repeat(68_267);
            assert_eq!(multibyte.len(), 204_801);
            let samples: Vec<(&str, String)> = vec![
                ("빈 본문", String::new()),
                ("공백뿐인 본문", " \n\t ".to_string()),
                ("BOM만 있는 본문", "\u{feff}".to_string()),
                ("NUL 포함", "a\u{0000}b".to_string()),
                ("UTF-8 바이트 204,800 초과(다바이트)", multibyte),
            ];
            for (name, content) in samples {
                let before = count_documents(&pool).await;
                let result = create(&pool, &company, "제목", "ok.md", &content).await;
                expect_err(result, StatusCode::BAD_REQUEST, "invalid_input", name);
                assert_eq!(count_documents(&pool).await, before, "[{name}] row count");
            }
        }

        /// @spec EC-4 DoD-9
        /// @given 요청 `params`에 알 수 없는 필드(`id`, `status`, `createdAt`, `createdBy`)를 하나씩 추가한다
        /// @when 필드마다 `documents.create`를 호출한다
        /// @then 400 `invalid_input`이 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec4_unknown_fields_are_rejected_with_invalid_input(pool: PgPool) {
            let company = user(UserRole::Company);
            for field in ["id", "status", "createdAt", "createdBy"] {
                let before = count_documents(&pool).await;
                let mut params = json!({ "title": "제목", "fileName": "a.md", "content": "본문" });
                params[field] = json!("injected");
                let result = create_with_params(&pool, &company, params).await;
                expect_err(result, StatusCode::BAD_REQUEST, "invalid_input", field);
                assert_eq!(count_documents(&pool).await, before, "[{field}] row count");
            }
        }
    }

    mod 같은_자료를_다시_등록하는_경우 {
        use crate::common::*;
        use axum::http::StatusCode;
        use dataroom_api::types::UserRole;
        use sqlx::PgPool;

        /// @spec DoD-7 EC-6
        /// @given 같은 사용자가 이미 자료를 등록했다. 재등록 표본: ① 정확히 같은 제목·파일명·본문 ② 제목 앞뒤 공백만 다름 ③ 본문의 선행 BOM 유무만 다름
        /// @when 표본마다 같은 사용자가 `documents.create`를 호출한다
        /// @then 같은 자료로 판정되어 409 `conflict`가 반환된다
        /// @then 새 행이 생기지 않는다
        #[sqlx::test]
        async fn dod7_ec6_same_normalized_content_is_conflict(pool: PgPool) {
            let company = user(UserRole::Company);
            expect_ok(
                create(&pool, &company, "분기 보고", "report.md", "본문").await,
                "first create",
            );
            let before = count_documents(&pool).await;
            let samples: [(&str, &str, &str, &str); 3] = [
                ("정확히 같음", "분기 보고", "report.md", "본문"),
                (
                    "제목 앞뒤 공백만 다름",
                    "  분기 보고\t",
                    "report.md",
                    "본문",
                ),
                (
                    "본문 선행 BOM 유무만 다름",
                    "분기 보고",
                    "report.md",
                    "\u{feff}본문",
                ),
            ];
            for (name, title, file_name, content) in samples {
                let result = create(&pool, &company, title, file_name, content).await;
                expect_err(result, StatusCode::CONFLICT, "conflict", name);
                assert_eq!(count_documents(&pool).await, before, "[{name}] row count");
            }
        }

        /// @spec DoD-8 EC-6
        /// @given 한 사용자가 자료를 등록했다. 등록 표본: ① 같은 workspace의 다른 사용자가 같은 내용을 등록 ② 같은 사용자가 제목만 다름 ③ 파일명만 다름 ④ 본문만 다름 ⑤ 제목과 파일명의 경계만 다르게 이어 붙여지는 조합 ⑥ 파일명과 본문의 경계만 다르게 이어 붙여지는 조합
        /// @when 표본마다 `documents.create`를 호출한다
        /// @then 별개 자료로 저장된다
        #[sqlx::test]
        async fn dod8_ec6_different_user_or_field_or_boundary_is_saved_separately(pool: PgPool) {
            let company = user(UserRole::Company);
            let other = user_as("company-other", UserRole::Company);
            // (표본, 기존 자료, 등록 사용자, 등록 내용) — 기존 자료는 표본마다 서로 다르다
            let samples = [
                (
                    "① 같은 workspace의 다른 사용자가 같은 내용",
                    ("t1", "f1.md", "c1"),
                    &other,
                    ("t1", "f1.md", "c1"),
                ),
                (
                    "② 제목만 다름",
                    ("t2", "f2.md", "c2"),
                    &company,
                    ("t2-b", "f2.md", "c2"),
                ),
                (
                    "③ 파일명만 다름",
                    ("t3", "f3.md", "c3"),
                    &company,
                    ("t3", "f3-b.md", "c3"),
                ),
                (
                    "④ 본문만 다름",
                    ("t4", "f4.md", "c4"),
                    &company,
                    ("t4", "f4.md", "c4-b"),
                ),
                (
                    "⑤ 제목↔파일명 경계만 다름",
                    ("a", "bc.md", "c5"),
                    &company,
                    ("ab", "c.md", "c5"),
                ),
                (
                    "⑥ 파일명↔본문 경계만 다름",
                    ("t6", "a.md", "b.mdc"),
                    &company,
                    ("t6", "a.mdb.md", "c"),
                ),
            ];
            for (name, base, sample_user, sample) in samples {
                let first = expect_ok(create(&pool, &company, base.0, base.1, base.2).await, name);
                let before = count_documents(&pool).await;
                let second = expect_ok(
                    create(&pool, sample_user, sample.0, sample.1, sample.2).await,
                    name,
                );
                assert_ne!(
                    first["document"]["id"], second["document"]["id"],
                    "[{name}] ids must differ"
                );
                assert_eq!(
                    count_documents(&pool).await,
                    before + 1,
                    "[{name}] row count"
                );
            }
        }

        /// @spec EC-7
        /// @given 같은 사용자의 동일 내용 요청 2개가 있다
        /// @when 두 요청을 동시에 `documents.create`로 호출한다
        /// @then 1건만 저장된다
        /// @then 한 요청은 성공한다
        /// @then 다른 요청은 409 `conflict`가 반환된다
        #[sqlx::test]
        async fn ec7_concurrent_identical_requests_store_only_one(pool: PgPool) {
            let company = user(UserRole::Company);
            for round in 0..5 {
                let title = format!("동시 등록 {round}");
                let before = count_documents(&pool).await;
                let (a, b) = tokio::join!(
                    create(&pool, &company, &title, "race.md", "동일 본문"),
                    create(&pool, &company, &title, "race.md", "동일 본문"),
                );
                let (ok, err) = match (a, b) {
                    (Ok(ok), err @ Err(_)) | (err @ Err(_), Ok(ok)) => (ok, err),
                    (Ok(_), Ok(_)) => panic!("[round {round}] both requests succeeded"),
                    (Err(_), Err(_)) => panic!("[round {round}] both requests failed"),
                };
                assert!(ok.result["document"]["id"].is_string(), "[round {round}]");
                expect_err(
                    err,
                    StatusCode::CONFLICT,
                    "conflict",
                    &format!("round {round}"),
                );
                assert_eq!(
                    count_documents(&pool).await,
                    before + 1,
                    "[round {round}] row count"
                );
            }
        }
    }

    mod 저장이_실패하는_경우 {
        use crate::common::*;
        use axum::http::StatusCode;
        use dataroom_api::types::UserRole;
        use sqlx::PgPool;

        /// @spec EC-8
        /// @given 기업 담당자가 유효한 입력으로 등록하는데 저장이 실패하는 상황(임시 DB의 `documents`에 항상 실패하는 제약이 있다)
        /// @when `documents.create`를 호출한다
        /// @then 500 `storage_error`가 반환된다
        /// @then 행이 생기지 않는다
        #[sqlx::test]
        async fn ec8_storage_failure_returns_storage_error_without_row(pool: PgPool) {
            let company = user(UserRole::Company);
            // 이후의 모든 INSERT가 실패한다(NOT VALID라 기존 시드 행은 검사하지 않는다)
            sqlx::query(
                "ALTER TABLE documents ADD CONSTRAINT always_fails CHECK (false) NOT VALID",
            )
            .execute(&pool)
            .await
            .expect("add failing constraint");
            let before = count_documents(&pool).await;
            let result = create(&pool, &company, "제목", "a.md", "본문").await;
            expect_err(
                result,
                StatusCode::INTERNAL_SERVER_ERROR,
                "storage_error",
                "storage failure",
            );
            assert_eq!(count_documents(&pool).await, before);
        }
    }
}

// `id` 충돌은 서버가 id를 만들어 강제할 수 없으므로 미검증이다.
