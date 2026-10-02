CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    file_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('ready', 'processing', 'failed')),
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 목록 정렬: created_at 내림차순, 같은 시각이면 id 오름차순
CREATE INDEX documents_workspace_order_idx ON documents (workspace_id, created_at DESC, id ASC);

-- doc-revenue와 doc-pipeline은 같은 created_at(정렬 동률 검증용)
INSERT INTO documents (id, workspace_id, title, file_name, status, content, created_at) VALUES
    ('doc-business', 'lighthouse', '회사 소개', 'company-overview.md', 'ready',
     '제조사 재고 관리 구독형 소프트웨어. 사업장당 월 15만 원, 2026년 8월 유료 고객 40개.',
     '2026-09-03T09:00:00Z'),
    ('doc-team', 'lighthouse', '팀 소개', 'team.md', 'ready',
     '대표 제조업 운영 8년, 개발 책임자 B2B 개발 6년, 디자이너 4년. 전담 영업 담당자는 없음.',
     '2026-09-02T09:00:00Z'),
    ('doc-revenue', 'lighthouse', '매출 자료', 'revenue.txt', 'failed',
     '자료를 읽지 못했습니다.',
     '2026-09-01T09:00:00Z'),
    ('doc-pipeline', 'lighthouse', '고객 인터뷰', 'customer-interviews.md', 'processing',
     '아직 준비되지 않았습니다.',
     '2026-09-01T09:00:00Z');
