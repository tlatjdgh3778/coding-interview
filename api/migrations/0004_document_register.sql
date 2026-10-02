-- 작성자: 시드·기존 자료는 NULL (NULL은 UNIQUE에서 서로 다른 값으로 취급된다)
ALTER TABLE documents ADD COLUMN created_by TEXT;

-- 중복 판정용 해시: 제목·파일명·본문을 각각 문자 수 접두와 함께 이어 붙여 필드 경계를 모호하지 않게 한다
ALTER TABLE documents ADD COLUMN content_hash TEXT GENERATED ALWAYS AS (
    md5(
        length(title)::text || ':' || title || '|' ||
        length(file_name)::text || ':' || file_name || '|' ||
        length(content)::text || ':' || content
    )
) STORED;

ALTER TABLE documents
    ADD CONSTRAINT documents_workspace_creator_content_key
    UNIQUE (workspace_id, created_by, content_hash);
