-- Baseline for databases that already contain tables outside Prisma (e.g. WordPress).
-- Fresh empty DBs: this runs as a no-op before later migrations.
-- Non-empty DB (P3005): run once before first deploy:
--   npx prisma migrate resolve --applied 0_baseline_existing_db
--   npx prisma migrate deploy
SELECT 1;
