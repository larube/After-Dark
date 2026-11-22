import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@libsql/client/sqlite3";
import { drizzle } from "drizzle-orm/libsql/sqlite3";
import { migrate } from "drizzle-orm/libsql/migrator";
import * as schema from "./schema";

export async function openDatabase(filename: string, migrationsFolder: string) {
  mkdirSync(dirname(filename), { recursive: true });
  const client = createClient({ url: pathToFileURL(filename).href, timeout: 5000 });
  try {
    await client.execute("PRAGMA foreign_keys = ON");
    await client.execute("PRAGMA journal_mode = WAL");
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder });
    return { db, close: () => client.close() };
  } catch (error) {
    client.close();
    throw error;
  }
}

export type CinemaDatabase = Awaited<ReturnType<typeof openDatabase>>["db"];
export type CinemaTransaction = Parameters<Parameters<CinemaDatabase["transaction"]>[0]>[0];
