-- 0004_search_documents
--
-- The search index (PRD §13, §72, docs/02 §5.1).
--
-- Implemented in PostgreSQL rather than OpenSearch. The spec names OpenSearch
-- and the interface still allows it, but the searchable vocabulary here is a
-- few thousand master parts and their synonyms — not millions of documents —
-- and Postgres covers every stated requirement at that size: two languages,
-- synonyms, typo tolerance via pg_trgm, and identifier lookup. Running one
-- datastore instead of two is worth more than headroom nobody is using yet
-- (ADR-010).
--
-- A row per master part per locale. Denormalized on purpose: search must not
-- join six tables on the hot path, and the content changes only when the
-- catalogue does.

BEGIN;

CREATE TABLE search_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_part_id uuid NOT NULL REFERENCES master_parts(id) ON DELETE CASCADE,
  category_id    uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  locale         text NOT NULL,
  -- Shown in results
  part_name      text NOT NULL,
  category_name  text NOT NULL,
  category_slug  text NOT NULL,
  -- Searched over: name + synonyms + category name + category synonyms
  content        text NOT NULL,
  -- 'simple' rather than a language config: there is no Georgian stemmer, and
  -- for part names stemming buys little while risking wrong matches.
  content_tsv    tsvector GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_part_id, locale)
);

CREATE INDEX search_documents_tsv ON search_documents USING gin (content_tsv);
-- Trigram index for typo tolerance: "აკუმლატორი" must still find "აკუმულატორი".
CREATE INDEX search_documents_trgm ON search_documents USING gin (content gin_trgm_ops);
CREATE INDEX search_documents_locale ON search_documents (locale);
CREATE INDEX search_documents_category ON search_documents (category_id);

/**
 * Rebuilds the index from the catalogue.
 *
 * A function rather than triggers: the catalogue changes in bulk (a partner
 * import, an admin edit) and a per-row trigger would rebuild the same document
 * hundreds of times during one import.
 */
CREATE OR REPLACE FUNCTION rebuild_search_documents()
RETURNS integer
LANGUAGE plpgsql
AS $$
DECLARE
  affected integer;
BEGIN
  DELETE FROM search_documents;

  INSERT INTO search_documents
    (master_part_id, category_id, locale, part_name, category_name, category_slug, content)
  SELECT mp.id,
         c.id,
         loc.locale,
         COALESCE(mpt.name, mp.normalized_name),
         COALESCE(ct.name, c.slug),
         c.slug,
         lower(concat_ws(' ',
           COALESCE(mpt.name, mp.normalized_name),
           array_to_string(COALESCE(mpt.synonyms, '{}'), ' '),
           COALESCE(ct.name, c.slug),
           array_to_string(COALESCE(ct.synonyms, '{}'), ' '),
           mp.normalized_name,
           mp.position,
           mp.axle))
  FROM master_parts mp
  JOIN categories c ON c.id = mp.category_id
  CROSS JOIN (VALUES ('ka'), ('en')) AS loc(locale)
  LEFT JOIN master_part_translations mpt
    ON mpt.master_part_id = mp.id AND mpt.locale = loc.locale
  LEFT JOIN category_translations ct
    ON ct.category_id = c.id AND ct.locale = loc.locale
  WHERE c.active;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

SELECT rebuild_search_documents();

COMMIT;
