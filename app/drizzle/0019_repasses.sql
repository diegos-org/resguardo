CREATE TABLE "repasses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"proprietario_id" uuid NOT NULL,
	"mes" date NOT NULL,
	"saldo" integer NOT NULL,
	"descontado" integer NOT NULL,
	"contestado" integer NOT NULL,
	"valor" integer NOT NULL,
	"situacao" text DEFAULT 'a_pagar' NOT NULL,
	"data_pagamento" date,
	"motivo_estorno" text DEFAULT '' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"estornado_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "quitacoes_adiantamento" ADD COLUMN "repasse_id" uuid;--> statement-breakpoint
ALTER TABLE "repasses" ADD CONSTRAINT "repasses_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasses" ADD CONSTRAINT "repasses_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasses" ADD CONSTRAINT "repasses_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repasses_um_por_mes" ON "repasses" USING btree ("proprietario_id","mes") WHERE "repasses"."estornado_em" is null;--> statement-breakpoint
CREATE INDEX "repasses_org_mes" ON "repasses" USING btree ("organizacao_id","mes");