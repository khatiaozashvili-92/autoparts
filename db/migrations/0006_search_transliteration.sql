-- 0006_search_transliteration
--
-- Makes fuzzy search work for Georgian, on every platform.
--
-- pg_trgm decides what counts as a letter through the database ctype, which on
-- Windows follows the locale's codepage. Under any Latin locale, Georgian
-- characters are not letters, so `show_trgm('რადიატრი')` returns {} — no
-- trigrams, no similarity, no typo tolerance. Nothing errors; Georgian fuzzy
-- search is simply always empty, which is the worst way for a feature to fail.
--
-- Rather than depend on the host's locale behaving, the trigram column holds a
-- transliterated copy. Queries are transliterated the same way, so matching is
-- identical on Windows, Linux and in CI. Collisions (თ and ტ both become "t")
-- are harmless here and mildly helpful: they make the match more forgiving,
-- which is the point of fuzzy search.
--
-- Exact and synonym matching are unaffected — those go through tsvector on the
-- original text.

BEGIN;

CREATE OR REPLACE FUNCTION translit_ka(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  SELECT translate(
    -- Two-letter romanizations first, so they are not broken up by translate().
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(lower(input), 'ჟ', 'zh', 'g'),
              'ღ', 'gh', 'g'),
            'შ', 'sh', 'g'),
          'ჩ', 'ch', 'g'),
        'ც', 'ts', 'g'),
      'ძ', 'dz', 'g'),
    'ჭ', 'ch', 'g'),
    'აბგდევზთიკლმნოპრსტუფქყწხჯჰ',
    'abgdevztiklmnoprstupkqtxjh'
  );
$$;

COMMENT ON FUNCTION translit_ka(text) IS
  'Georgian to Latin for trigram matching. Not for display.';

ALTER TABLE search_documents
  ADD COLUMN content_translit text
  GENERATED ALWAYS AS (translit_ka(content)) STORED;

-- The original-text trigram indexes only ever worked for Latin input; the
-- transliterated column supersedes both.
DROP INDEX IF EXISTS search_documents_trgm;
DROP INDEX IF EXISTS search_documents_word_trgm;

CREATE INDEX search_documents_translit_trgm
  ON search_documents USING gist (content_translit gist_trgm_ops);

COMMIT;
