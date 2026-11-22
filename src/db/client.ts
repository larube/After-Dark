import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export function openDatabase(filename: string, migrationsFolder: string) {
  if (filename !== ":memory:") mkdirSync(dirname(filename), { recursive: true });
  const sqlite = new Database(filename);
  try {
    sqlite.pragma("foreign_keys = ON");
    sqlite.pragma("busy_timeout = 5000");
    sqlite.pragma("journal_mode = WAL");
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder });
    return { db, close: () => sqlite.close() };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}

type Connection = ReturnType<typeof openDatabase>["db"];
export type CinemaTransaction = Parameters<Parameters<Connection["transaction"]>[0]>[0];
export type CinemaDatabase = Omit<Connection, "$client">;
