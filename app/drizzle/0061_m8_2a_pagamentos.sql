CREATE TABLE "devolucoes_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"pagamento_id" uuid NOT NULL,
	"motivo" text NOT NULL,
	"valor" integer NOT NULL,
	"situacao" text DEFAULT 'pedida' NOT NULL,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"falhas" integer DEFAULT 0 NOT NULL,
	"chave_atual" text,
	"proxima_tentativa_em" timestamp with time zone,
	"id_provedor" text,
	"confirmada_em" timestamp with time zone,
	"por_fora_data" date,
	"por_fora_valor" integer,
	"por_fora_nota" text DEFAULT '' NOT NULL,
	"taxa_perdida" integer,
	"despesa_lancamento_id" uuid,
	"autor_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eventos_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid,
	"tipo" text DEFAULT '' NOT NULL,
	"acao" text DEFAULT '' NOT NULL,
	"data_id" text NOT NULL,
	"request_id" text DEFAULT '' NOT NULL,
	"ts" text DEFAULT '' NOT NULL,
	"ao_vivo" boolean,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resultado" text DEFAULT 'pendente' NOT NULL,
	"processado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "pagamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"cotacao_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"ambiente" text NOT NULL,
	"forma" text NOT NULL,
	"referencia" text NOT NULL,
	"chave_idempotencia" text NOT NULL,
	"situacao" text DEFAULT 'criando' NOT NULL,
	"id_provedor" text,
	"ao_vivo" boolean,
	"detalhe_provedor" text DEFAULT '' NOT NULL,
	"valor" integer NOT NULL,
	"valor_pago" integer,
	"taxa" integer,
	"liquido" integer,
	"liberacao_prevista_em" timestamp with time zone,
	"liberacao_confirmada_em" timestamp with time zone,
	"liberacao_origem" text,
	"pix_copia_e_cola" text,
	"pix_imagem" text,
	"pix_link" text,
	"pix_expira_em" timestamp with time zone,
	"aprovado_em" timestamp with time zone,
	"consultado_em" timestamp with time zone,
	"financeiro_consultado_em" timestamp with time zone,
	"desfecho" text,
	"desfecho_motivo" text,
	"desfecho_por" uuid,
	"desfecho_em" timestamp with time zone,
	"motivo_sem_reserva" text,
	"avisos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pagamentos_avisos_dia" (
	"dia" date PRIMARY KEY NOT NULL,
	"assinaturas_recusadas" integer DEFAULT 0 NOT NULL,
	"ultimo_valido_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_pagamento_id_pagamentos_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."pagamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_despesa_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("despesa_lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eventos_pagamento" ADD CONSTRAINT "eventos_pagamento_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_cotacao_id_cotacoes_id_fk" FOREIGN KEY ("cotacao_id") REFERENCES "public"."cotacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_desfecho_por_usuarios_id_fk" FOREIGN KEY ("desfecho_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "devolucoes_pagamento_um_por_pagamento" ON "devolucoes_pagamento" USING btree ("pagamento_id");--> statement-breakpoint
CREATE INDEX "devolucoes_pagamento_situacao" ON "devolucoes_pagamento" USING btree ("organizacao_id","situacao");--> statement-breakpoint
CREATE UNIQUE INDEX "eventos_pagamento_unico" ON "eventos_pagamento" USING btree ("request_id","ts","data_id");--> statement-breakpoint
CREATE INDEX "eventos_pagamento_recebido" ON "eventos_pagamento" USING btree ("recebido_em");--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_referencia" ON "pagamentos" USING btree ("organizacao_id","referencia");--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_id_provedor" ON "pagamentos" USING btree ("organizacao_id","id_provedor") WHERE "pagamentos"."id_provedor" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "pagamentos_um_desfecho_reserva" ON "pagamentos" USING btree ("reserva_id") WHERE "pagamentos"."desfecho" = 'reserva';--> statement-breakpoint
CREATE INDEX "pagamentos_busca_id_provedor" ON "pagamentos" USING btree ("id_provedor");--> statement-breakpoint
CREATE INDEX "pagamentos_cotacao" ON "pagamentos" USING btree ("cotacao_id","criado_em");--> statement-breakpoint
CREATE INDEX "pagamentos_reserva" ON "pagamentos" USING btree ("reserva_id");--> statement-breakpoint
CREATE INDEX "pagamentos_situacao" ON "pagamentos" USING btree ("organizacao_id","situacao");--> statement-breakpoint
CREATE INDEX "pagamentos_criado" ON "pagamentos" USING btree ("organizacao_id","criado_em");