import { fileURLToPath } from "node:url";
import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@prisma/client";

// Resolved relative to this file (not process.cwd()) so it matches the same
// file `prisma db push`/`generate` write to (packages/server/dev.db)
// regardless of what directory the server process is launched from.
const dbPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dev.db");

const adapter = new PrismaBetterSqlite3({ url: dbPath });
export const prisma = new PrismaClient({ adapter });
