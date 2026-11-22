import { eq } from "drizzle-orm";
import { moodSchema } from "../shared/profile";
import type { CinemaDatabase } from "./client";
import { moodSessions } from "./schema";

export async function saveMood(db: CinemaDatabase, input: unknown): Promise<number> {
  const { date, ...criteria } = moodSchema.parse(input);
  const row = await db.insert(moodSessions).values({ date, criteria }).returning({ id: moodSessions.id }).get();
  return row.id;
}

export async function readMood(db: CinemaDatabase, id: number) {
  const row = await db.select().from(moodSessions).where(eq(moodSessions.id, id)).get();
  return row && { date: row.date, ...row.criteria };
}
