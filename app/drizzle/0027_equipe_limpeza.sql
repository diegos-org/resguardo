ALTER TYPE "public"."papel" ADD VALUE 'limpeza';--> statement-breakpoint
ALTER TABLE "profissionais_limpeza" ADD COLUMN "usuario_id" uuid;--> statement-breakpoint
ALTER TABLE "profissionais_limpeza" ADD CONSTRAINT "profissionais_limpeza_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profissionais_limpeza_usuario" ON "profissionais_limpeza" USING btree ("usuario_id");