CREATE TABLE "fotos_imoveis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"arquivo_id" uuid NOT NULL,
	"miniatura_id" uuid,
	"ordem" integer NOT NULL,
	"legenda" text DEFAULT '' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fotos_imoveis" ADD CONSTRAINT "fotos_imoveis_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fotos_imoveis" ADD CONSTRAINT "fotos_imoveis_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fotos_imoveis" ADD CONSTRAINT "fotos_imoveis_arquivo_id_arquivos_id_fk" FOREIGN KEY ("arquivo_id") REFERENCES "public"."arquivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fotos_imoveis" ADD CONSTRAINT "fotos_imoveis_miniatura_id_arquivos_id_fk" FOREIGN KEY ("miniatura_id") REFERENCES "public"."arquivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fotos_imoveis" ADD CONSTRAINT "fotos_imoveis_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fotos_imoveis_imovel" ON "fotos_imoveis" USING btree ("imovel_id","ordem");--> statement-breakpoint
CREATE UNIQUE INDEX "fotos_imoveis_arquivo" ON "fotos_imoveis" USING btree ("arquivo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fotos_imoveis_miniatura" ON "fotos_imoveis" USING btree ("miniatura_id");