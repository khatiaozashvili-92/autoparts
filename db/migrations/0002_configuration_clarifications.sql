-- 0002_configuration_clarifications
--
-- Stores the clarifying questions a provider raised for a configuration
-- (PRD §10, docs/05 §7).
--
-- Without this they existed only in the provider's live response, so the
-- second person to add the same VIN — or the same person after a cache hit —
-- was never asked. Silently skipping the question does not make the answer
-- known: it leaves the vehicle under-specified, and the fitment engine then
-- returns UNCERTAIN for every part that depends on the missing attribute.
-- The question has to survive the cache for the cache to be safe.

BEGIN;

ALTER TABLE vehicle_configurations
  ADD COLUMN clarifications jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN vehicle_configurations.clarifications IS
  'Questions the provider could not answer; replayed on every decode of this VIN.';

COMMIT;
