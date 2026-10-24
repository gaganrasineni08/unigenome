// Database access. Uses PostgreSQL when DATABASE_URL is set, otherwise an embedded Postgres (PGlite) in ./data.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface Db {
  query<T = any>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (q: Db["query"]) => Promise<T>): Promise<T>;
}

const here = dirname(fileURLToPath(import.meta.url));
let dbPromise: Promise<Db> | null = null;

async function open(): Promise<Db> {
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  if (process.env.DATABASE_URL) {
    const { default: pg } = await import("pg");
    // BIGINT columns hold millisecond timestamps, which fit safely in a JS number.
    pg.types.setTypeParser(20, (v: string) => Number(v));
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 3,
    });
    await pool.query(schema);
    return {
      query: async (sql, params = []) => (await pool.query(sql, params as any[])).rows,
      tx: async (fn) => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const out = await fn(async (sql, params = []) => (await client.query(sql, params as any[])).rows);
          await client.query("COMMIT");
          return out;
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        } finally {
          client.release();
        }
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? join(here, "..", "data");
  const pgl = new PGlite(dir === "memory" ? undefined : dir, {
    parsers: { 20: (v: string) => Number(v) },
  });
  await pgl.exec(schema);
  let chain: Promise<unknown> = Promise.resolve();
  // PGlite is single-connection: run transactions one after another.
  const query: Db["query"] = async (sql, params = []) => (await pgl.query(sql, params as any[])).rows as any[];
  return {
    query,
    tx: (fn) => {
      const run = chain.then(() => pgl.transaction(async (t) => fn(async (sql, params = []) => (await t.query(sql, params as any[])).rows as any[])));
      chain = run.catch(() => undefined);
      return run;
    },
  };
}

export const db = (): Promise<Db> => (dbPromise ??= open());
