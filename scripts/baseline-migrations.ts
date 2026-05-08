/**
 * Marca cada pasta em `prisma/migrations/` como já aplicada no banco corrente
 * (`prisma migrate resolve --applied <nome>`). Use APENAS quando o banco já
 * contém o estado pós-migration — ex.: ambiente que rodava as migrations
 * manualmente antes de adotarmos o `prisma migrate deploy`.
 *
 * Execuções repetidas são seguras: chamadas para migrations já marcadas como
 * aplicadas são ignoradas. Para baselinar apenas algumas, passe os nomes
 * desejados como argumentos:
 *
 *   npm run db:baseline -- 20260122163513_init_users_favorites 20260205134723_add_gamification
 */

import { execSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "prisma/migrations";

const explicit = process.argv.slice(2);
const all = readdirSync(MIGRATIONS_DIR)
  .filter((entry) => statSync(join(MIGRATIONS_DIR, entry)).isDirectory())
  .sort();
const targets = explicit.length > 0 ? explicit : all;

if (targets.length === 0) {
  console.log("Nenhuma migration encontrada em prisma/migrations/.");
  process.exit(0);
}

console.log(
  `Marcando ${targets.length} migration(s) como aplicada(s) no banco apontado por DATABASE_URL...`,
);

let baselined = 0;
let skipped = 0;
const failures: { name: string; error: string }[] = [];

for (const name of targets) {
  process.stdout.write(`  -> ${name} ... `);
  try {
    execSync(`npx prisma migrate resolve --applied ${name}`, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    console.log("ok");
    baselined++;
  } catch (err) {
    const stderr = err instanceof Error && "stderr" in err ? String((err as { stderr: unknown }).stderr ?? "") : "";
    if (stderr.includes("is already recorded as applied")) {
      console.log("já aplicada (skip)");
      skipped++;
    } else {
      console.log("falhou");
      failures.push({ name, error: stderr || (err instanceof Error ? err.message : String(err)) });
    }
  }
}

console.log("");
console.log(`Concluído: ${baselined} marcada(s), ${skipped} já existente(s).`);

if (failures.length > 0) {
  console.error(`\n${failures.length} falha(s):`);
  for (const { name, error } of failures) {
    console.error(`- ${name}: ${error.trim().split("\n")[0]}`);
  }
  process.exit(1);
}
