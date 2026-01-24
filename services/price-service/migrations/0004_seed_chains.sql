-- Seed valid retail chains
-- This migration populates the chains table with valid chain slugs
-- used by the ingestion pipeline

INSERT INTO chains (slug, name, website, logo_url) VALUES
  ('konzum', 'Konzum', 'https://www.konzum.hr', NULL),
  ('lidl', 'Lidl', 'https://www.lidl.hr', NULL),
  ('plodine', 'Plodine', 'https://www.plodine.hr', NULL),
  ('interspar', 'Interspar', 'https://www.interspar.hr', NULL),
  ('studenac', 'Studenac', 'https://www.studenac.hr', NULL),
  ('kaufland', 'Kaufland', 'https://www.kaufland.hr', NULL),
  ('eurospin', 'Eurospin', 'https://www.eurospin.hr', NULL),
  ('dm', 'DM', 'https://www.dm.hr', NULL),
  ('ktc', 'KTC', 'https://www.ktc.hr', NULL),
  ('metro', 'Metro', 'https://www.metro.hr', NULL),
  ('trgocentar', 'Trgocentar', 'https://www.trgocentar.hr', NULL)
ON CONFLICT (slug) DO NOTHING;
