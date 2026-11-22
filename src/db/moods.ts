import { eq } from "drizzle-orm";
import { moodSchema } from "../shared/profile";
import type { CinemaDatabase } from "./client";
import { moodSessions } from "./schema";

export function saveMood(db: CinemaDatabase, input: unknown): number {
  const { date, ...criteria } = moodSchema.parse(input);
  return db.insert(moodSessions).values({ date, criteria }).returning({ id: moodSessions.id }).get().id;
}

export function readMood(db: CinemaDatabase, id: number) {
  const row = db.select().from(moodSessions).where(eq(moodSessions.id, id)).get();
  return row && { date: row.date, ...row.criteria };
}
