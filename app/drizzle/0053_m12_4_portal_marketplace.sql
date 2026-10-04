-- M12.4 (regerada sobre a 0052 da main depois do merge do M4.10). Idempotente de propósito: o banco de preview
-- deste PR já recebeu estas mesmas mudanças pelas migrações antigas do branch (0044–0049), substituídas por esta.
CREATE TABLE IF NOT EXISTS "beds24_envio_imoveis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"envio_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"property_id" text DEFAULT '' NOT NULL,
	"room_id" text DEFAULT '' NOT NULL,
	"falha" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beds24_envios" ADD COLUMN IF NOT EXISTS "credencial" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "limpezas" ADD COLUMN IF NOT EXISTS "sem_custo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "manutencoes" ADD COLUMN IF NOT EXISTS "sem_custo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_envio_imoveis_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "beds24_envio_imoveis" ADD CONSTRAINT "beds24_envio_imoveis_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_envio_imoveis_envio_id_beds24_envios_id_fk') THEN
		ALTER TABLE "beds24_envio_imoveis" ADD CONSTRAINT "beds24_envio_imoveis_envio_id_beds24_envios_id_fk" FOREIGN KEY ("envio_id") REFERENCES "public"."beds24_envios"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_envio_imoveis_imovel_id_imoveis_id_fk') THEN
		ALTER TABLE "beds24_envio_imoveis" ADD CONSTRAINT "beds24_envio_imoveis_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beds24_envio_imoveis_imovel" ON "beds24_envio_imoveis" USING btree ("organizacao_id","imovel_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beds24_envio_imoveis_envio" ON "beds24_envio_imoveis" USING btree ("envio_id");