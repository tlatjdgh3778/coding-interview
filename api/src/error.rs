use axum::{Json, http::StatusCode, response::IntoResponse};
use serde::{Serialize, Serializer};

use crate::types::ApiErrorBody;

#[derive(Debug)]
pub struct ApiError(pub StatusCode, pub &'static str, pub &'static str);

impl ApiError {
    pub fn not_implemented(feature: &'static str) -> Self {
        Self(StatusCode::NOT_IMPLEMENTED, "assignment_pending", feature)
    }

    pub fn invalid(message: &'static str) -> Self {
        Self(StatusCode::BAD_REQUEST, "invalid_input", message)
    }

    pub fn invalid_credentials() -> Self {
        Self(
            StatusCode::UNAUTHORIZED,
            "invalid_credentials",
            "Email or password is incorrect.",
        )
    }

    pub fn unauthorized() -> Self {
        Self(
            StatusCode::UNAUTHORIZED,
            "not_authenticated",
            "Sign in is required.",
        )
    }

    pub fn forbidden() -> Self {
        Self(
            StatusCode::FORBIDDEN,
            "forbidden",
            "You do not have access to this workspace.",
        )
    }

    pub fn not_found() -> Self {
        Self(StatusCode::NOT_FOUND, "not_found", "Resource not found.")
    }

    pub fn conflict() -> Self {
        Self(StatusCode::CONFLICT, "conflict", "Resource already exists.")
    }

    pub fn storage(error: impl std::fmt::Display) -> Self {
        eprintln!("Storage error: {error}");
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            "storage_error",
            "Could not save or load data.",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> axum::response::Response {
        (
            self.0,
            Json(ApiErrorBody {
                kind: self.1.into(),
                message: self.2.into(),
            }),
        )
            .into_response()
    }
}

impl Serialize for ApiError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        ApiErrorBody {
            kind: self.1.into(),
            message: self.2.into(),
        }
        .serialize(serializer)
    }
}

impl ts_server_fn_axum::AsStatusCode for ApiError {
    fn as_status_code(&self) -> StatusCode {
        self.0
    }
}
