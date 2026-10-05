DROP INDEX "extratos_canal_unico";--> statement-breakpoint
ALTER TABLE "extratos_canal" ADD COLUMN "proprietario_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "extratos_canal" ADD CONSTRAINT "extratos_canal_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extratos_canal_unico" ON "extratos_canal" USING btree ("organizacao_id","imovel_id","proprietario_id","mes","canal");