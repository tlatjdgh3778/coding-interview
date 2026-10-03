CREATE TABLE reviews (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    investor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    criterion_id TEXT NOT NULL REFERENCES review_criteria(id),
    status TEXT NOT NULL CHECK (status IN ('satisfied', 'needs_information')),
    comment TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- 투자자·기준당 검토 1건. 재저장 판정은 ON CONFLICT ON CONSTRAINT reviews_investor_criterion_key
    CONSTRAINT reviews_investor_criterion_key UNIQUE (investor_id, criterion_id)
);

CREATE TABLE review_evidence (
    review_id TEXT NOT NULL REFERENCES reviews(id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES documents(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (review_id, document_id)
);
