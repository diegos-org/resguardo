CREATE TYPE "public"."tipo_contrato" AS ENUM('gestao_completa', 'gestao_online', 'marketplace');--> statement-breakpoint
CREATE TABLE "contratos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"tipo" "tipo_contrato" NOT NULL,
	"comissao_bp" integer,
	"inicio" date NOT NULL,
	"fim" date,
	"observacoes" text DEFAULT '' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contratos" ADD CONSTRAINT "contratos_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contratos_imovel_inicio" ON "contratos" USING btree ("imovel_id","inicio");