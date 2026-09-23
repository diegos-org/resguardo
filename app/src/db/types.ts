import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/** Tipo comum às conexões de produção (Neon) e de teste (PGlite). */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
