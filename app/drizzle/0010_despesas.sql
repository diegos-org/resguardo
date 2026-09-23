CREATE TABLE "categorias_despesa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "categoria_id" uuid;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "fornecedor" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "comprovante" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "montante" integer;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD COLUMN "pago_por" text;--> statement-breakpoint
ALTER TABLE "categorias_despesa" ADD CONSTRAINT "categorias_despesa_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categorias_despesa_nome" ON "categorias_despesa" USING btree ("organizacao_id",lower("nome"));--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_categoria_id_categorias_despesa_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias_despesa"("id") ON DELETE no action ON UPDATE no action;