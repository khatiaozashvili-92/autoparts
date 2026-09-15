-- 0005_search_word_similarity_index
--
-- Supports word_similarity lookups on search_documents.content.
--
-- The gin_trgm_ops index added in 0004 serves `%` (whole-string similarity),
-- which is the wrong comparison here: the indexed content is a full document —
-- part name, every synonym, the category and its synonyms — so a two-word query
-- scores near zero against all of it however good the match. `<%`
-- (word_similarity) scores the query against the best matching run of words
-- inside the document instead, and needs gist_trgm_ops to be indexed.

BEGIN;

CREATE INDEX search_documents_word_trgm
  ON search_documents USING gist (content gist_trgm_ops);

COMMIT;
