-- Seed essential reference data
-- These are required for the application to function

INSERT INTO chains (slug, name, website, logo_url, created_at)
VALUES
  ('konzum', 'Konzum', 'https://www.konzum.hr', NULL, NOW()),
  ('lidl', 'Lidl', 'https://www.lidl.hr', NULL, NOW()),
  ('plodine', 'Plodine', 'https://www.plodine.hr', NULL, NOW()),
  ('interspar', 'Interspar', 'https://www.interspar.hr', NULL, NOW()),
  ('studenac', 'Studenac', 'https://www.studenac.hr', NULL, NOW()),
  ('kaufland', 'Kaufland', 'https://www.kaufland.hr', NULL, NOW()),
  ('eurospin', 'Eurospin', 'https://www.eurospin.hr', NULL, NOW()),
  ('dm', 'dm', 'https://www.dm.hr', NULL, NOW()),
  ('ktc', 'KTC', 'https://www.ktc.hr', NULL, NOW()),
  ('metro', 'Metro', 'https://www.metro.hr', NULL, NOW()),
  ('trgocentar', 'Trgocentar', 'https://www.trgocentar.hr', NULL, NOW())
ON CONFLICT (slug) DO NOTHING;
