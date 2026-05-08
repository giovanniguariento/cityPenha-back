/**
 * Cria a pasta de uma nova migration manual no formato esperado pelo
 * `prisma migrate deploy`: `prisma/migrations/<timestamp>_<nome>/migration.sql`.
 *
 *   npm run db:new -- add_some_table
 *
 * Em seguida, edite o `migration.sql` gerado e rode `npm run db:deploy`.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS_DIR = "prisma/migrations";

const rawName = process.argv.slice(2).join("_").trim();
if (!rawName) {
  console.error("Uso: npm run db:new -- <nome_da_migration>");
  process.exit(1);
}

const slug = rawName
  .toLowerCase()
  .replace(/[^a-z0-9_]+/g, "_")
  .replace(/^_+|_+$/g, "");

if (!slug) {
  console.error("Nome inválido. Use letras, números e underscore.");
  process.exit(1);
}

const now = new Date();
const pad = (n: number, len = 2) => String(n).padStart(len, "0");
const timestamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;

const folder = `${timestamp}_${slug}`;
const path = join(MIGRATIONS_DIR, folder);

if (existsSync(path)) {
  console.error(`Já existe: ${path}`);
  process.exit(1);
}

mkdirSync(path, { recursive: true });
writeFileSync(
  join(path, "migration.sql"),
  `-- ${slug}\n-- Escreva aqui o SQL idempotente quando possível (CREATE TABLE IF NOT EXISTS, etc.).\n`,
);

console.log(`Criada: ${path}/migration.sql`);
console.log("Edite o arquivo e rode `npm run db:deploy` para aplicar.");
