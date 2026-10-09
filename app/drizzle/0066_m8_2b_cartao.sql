CREATE TABLE "disjuntores_cartao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"aberto_em" timestamp with time zone NOT NULL,
	"ate" timestamp with time zone,
	"recusas" integer NOT NULL,
	"janela" text NOT NULL,
	"reincidente" boolean DEFAULT false NOT NULL,
	"religado_em" timestamp with time zone,
	"religado_por" uuid
);
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "parcelas" integer;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "bandeira" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "tres_ds" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "tres_ds_status" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "etapa_cartao" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "desafio_url" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "prazo_analise_ate" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "com_dispositivo" boolean;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "encerrado_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "cancelamento_por" text;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "conta_no_disjuntor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "id_pagamento_provedor" text;--> statement-breakpoint
ALTER TABLE "disjuntores_cartao" ADD CONSTRAINT "disjuntores_cartao_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disjuntores_cartao" ADD CONSTRAINT "disjuntores_cartao_religado_por_usuarios_id_fk" FOREIGN KEY ("religado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "disjuntores_cartao_org" ON "disjuntores_cartao" USING btree ("organizacao_id","aberto_em");--> statement-breakpoint
CREATE INDEX "pagamentos_cartao_org_criado" ON "pagamentos" USING btree ("organizacao_id","criado_em") WHERE "pagamentos"."forma" = 'cartao';