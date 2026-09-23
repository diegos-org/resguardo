import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Esquema do banco (Drizzle). Novas tabelas entram aqui e geram migração com
 * `npm run db:generate`. Nunca editar migração já mergeada.
 */

/** Configurações gerais do sistema (chave → valor JSON). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
