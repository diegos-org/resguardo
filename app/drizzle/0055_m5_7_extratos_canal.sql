CREATE TABLE "extratos_canal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"mes" text NOT NULL,
	"canal" text NOT NULL,
	"arquivo_id" uuid NOT NULL,
	"paginas" text DEFAULT '' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "extratos_canal" ADD CONSTRAINT "extratos_canal_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extratos_canal" ADD CONSTRAINT "extratos_canal_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extratos_canal" ADD CONSTRAINT "extratos_canal_arquivo_id_arquivos_id_fk" FOREIGN KEY ("arquivo_id") REFERENCES "public"."arquivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extratos_canal" ADD CONSTRAINT "extratos_canal_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extratos_canal_unico" ON "extratos_canal" USING btree ("organizacao_id","imovel_id","mes","canal");--> statement-breakpoint
CREATE INDEX "extratos_canal_mes" ON "extratos_canal" USING btree ("organizacao_id","mes");