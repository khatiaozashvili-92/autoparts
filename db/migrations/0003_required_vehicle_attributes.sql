-- 0003_required_vehicle_attributes
--
-- Constrains categories.required_vehicle_attributes to attributes a vehicle
-- can actually have.
--
-- The seed listed 'axle' as required for brakes and suspension. But an axle
-- describes the *part* — front pads versus rear pads — not the car. No vehicle
-- can ever supply it, so the engine found a required attribute missing on every
-- single vehicle and returned UNCERTAIN for every brake and suspension product.
-- Two whole categories were invisible, and nothing failed loudly: hiding
-- products is what UNCERTAIN is supposed to do.
--
-- The check turns that class of typo into an error at write time instead of an
-- empty category page nobody can explain.

BEGIN;

CREATE OR REPLACE FUNCTION vehicle_attributes_are_known(attrs text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT attrs <@ ARRAY[
    -- Decoded from the VIN
    'make','model','model_year','generation','engine','engine_code',
    'fuel_type','transmission','drive_type','body_type','trim','market',
    'production_date',
    -- Supplied by the owner in answer to a clarifying question
    'brake_config'
  ]::text[]
$$;

-- Fix the two categories the old data got wrong. Front/rear is already carried
-- by the master part (master_parts.axle), so the fitment records themselves
-- discriminate — the vehicle needs to supply nothing extra.
UPDATE categories SET required_vehicle_attributes = '{}'
WHERE slug IN ('brakes', 'suspension');

ALTER TABLE categories
  ADD CONSTRAINT category_required_attributes_known
  CHECK (vehicle_attributes_are_known(required_vehicle_attributes));

COMMIT;
