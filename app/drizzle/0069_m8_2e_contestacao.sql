-- M8.2e (contestação do pagamento no site: chargeback, MED do Pix e reclamação no Mercado Pago). Idempotente como a
-- 0067 e a 0068: o banco das prévias é compartilhado e as migrações entram por hash, então rodar estas instruções de novo
-- não pode falhar nem mudar nada. Sem tipo novo no enum de lançamentos (a origem `contestacao_pagamento` é texto).
-- Cria a disputa (`contestacoes_pagamento`) e a linha do tempo dela (`eventos_contestacao`, nunca apagada); a busca
-- tardia semanal em `pagamentos.contestacoes_buscadas_em`; a devolução substituída pela disputa em
-- `devolucoes_pagamento.contestacao_id`; e, no fechamento, a parte presa por disputa e o valor segurado que espera junto
-- (`repasses.fora_presa_disputa` e `repasses.fora_segurado_junto`; null nos fechamentos de antes).
CREATE TABLE IF NOT EXISTS "contestacoes_pagamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"pagamento_id" uuid NOT NULL,
	"reserva_id" uuid,
	"imovel_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"origem" text NOT NULL,
	"id_caso" text,
	"id_contestacao" text,
	"id_transacao" text,
	"rodada" integer DEFAULT 1 NOT NULL,
	"duplicata_possivel" boolean DEFAULT false NOT NULL,
	"confirmada_outra_em" timestamp with time zone,
	"confirmada_outra_por" uuid,
	"situacao" text DEFAULT 'aberta' NOT NULL,
	"situacao_pagamento_antes" text NOT NULL,
	"estado_lido" text,
	"codigo" text,
	"cobertura_aplicada" boolean,
	"cobertura_elegivel" boolean,
	"motivo_id" text,
	"motivo_codigo" text,
	"valor" integer,
	"valor_origem" text NOT NULL,
	"valor_em_risco" integer DEFAULT 0 NOT NULL,
	"aberta_em" timestamp with time zone NOT NULL,
	"aberta_no_provedor_em" timestamp with time zone,
	"documentacao" text,
	"documentacao_prazo" timestamp with time zone,
	"documentos_enviados_em" timestamp with time zone,
	"documentos_enviados_por" uuid,
	"tres_ds_status" text,
	"ao_vivo" boolean,
	"consultada_em" timestamp with time zone,
	"lida_em" timestamp with time zone,
	"atualizado_no_provedor_em" timestamp with time zone,
	"proxima_leitura_em" timestamp with time zone,
	"falhas_leitura" integer DEFAULT 0 NOT NULL,
	"avisos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"nota_registro" text DEFAULT '' NOT NULL,
	"causa" text,
	"quem_arca" text,
	"decisao_nota" text DEFAULT '' NOT NULL,
	"decisao_mudanca_nota" text DEFAULT '' NOT NULL,
	"explicacao_proprietario" text DEFAULT '' NOT NULL,
	"decisao_por" uuid,
	"decisao_em" timestamp with time zone,
	"decisao_versao" integer DEFAULT 0 NOT NULL,
	"base_parte_proprietario" integer,
	"base_comissao" integer,
	"exposicao" integer,
	"parte_proprietario" integer,
	"parte_scl" integer,
	"resultado_em" date,
	"resultado_por" uuid,
	"resultado_nota" text DEFAULT '' NOT NULL,
	"valor_perdido" integer,
	"liquido_nao_entrou" integer,
	"debito_em" date,
	"tarifa" integer,
	"definitivo_em" timestamp with time zone,
	"encerrada_nota" text DEFAULT '' NOT NULL,
	"aviso_conferido_em" timestamp with time zone,
	"aviso_conferido_por" uuid,
	"aviso_conferido_nota" text DEFAULT '' NOT NULL,
	"retido_lancamento_id" uuid,
	"retido_confirmado_em" timestamp with time zone,
	"retido_confirmado_por" uuid,
	"debito_nota" text DEFAULT '' NOT NULL,
	"volta_lancamento_id" uuid,
	"caixa_final_lancamento_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "eventos_contestacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contestacao_id" uuid NOT NULL,
	"fonte" text NOT NULL,
	"tipo" text NOT NULL,
	"antes" jsonb,
	"depois" jsonb,
	"usuario_id" uuid,
	"em" timestamp with time zone DEFAULT now() NOT NULL,
	"ordem" integer GENERATED ALWAYS AS IDENTITY (sequence name "eventos_contestacao_ordem_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1)
);
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "contestacao_id" uuid;
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN IF NOT EXISTS "contestacoes_buscadas_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN IF NOT EXISTS "fora_presa_disputa" integer;
--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN IF NOT EXISTS "fora_segurado_junto" integer;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_pagamento_id_pagamentos_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_pagamento_id_pagamentos_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."pagamentos"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_reserva_id_reservas_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_imovel_id_imoveis_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_confirmada_outra_por_usuarios_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_confirmada_outra_por_usuarios_id_fk" FOREIGN KEY ("confirmada_outra_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_documentos_enviados_por_usuarios_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_documentos_enviados_por_usuarios_id_fk" FOREIGN KEY ("documentos_enviados_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_decisao_por_usuarios_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_decisao_por_usuarios_id_fk" FOREIGN KEY ("decisao_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_resultado_por_usuarios_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_resultado_por_usuarios_id_fk" FOREIGN KEY ("resultado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_aviso_conferido_por_usuarios_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_aviso_conferido_por_usuarios_id_fk" FOREIGN KEY ("aviso_conferido_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_retido_lancamento_id_lancamentos_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_retido_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("retido_lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_retido_confirmado_por_usuarios_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_retido_confirmado_por_usuarios_id_fk" FOREIGN KEY ("retido_confirmado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_volta_lancamento_id_lancamentos_id_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_volta_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("volta_lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contestacoes_pagamento_caixa_final_fk') THEN
		ALTER TABLE "contestacoes_pagamento" ADD CONSTRAINT "contestacoes_pagamento_caixa_final_fk" FOREIGN KEY ("caixa_final_lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eventos_contestacao_contestacao_id_contestacoes_pagamento_id_fk') THEN
		ALTER TABLE "eventos_contestacao" ADD CONSTRAINT "eventos_contestacao_contestacao_id_contestacoes_pagamento_id_fk" FOREIGN KEY ("contestacao_id") REFERENCES "public"."contestacoes_pagamento"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'eventos_contestacao_usuario_id_usuarios_id_fk') THEN
		ALTER TABLE "eventos_contestacao" ADD CONSTRAINT "eventos_contestacao_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contestacoes_pagamento_caso" ON "contestacoes_pagamento" USING btree ("pagamento_id","id_caso","rodada") WHERE "contestacoes_pagamento"."id_caso" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contestacoes_pagamento_cbk" ON "contestacoes_pagamento" USING btree ("pagamento_id","id_contestacao","rodada") WHERE "contestacoes_pagamento"."id_contestacao" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contestacoes_pagamento_sem_id" ON "contestacoes_pagamento" USING btree ("pagamento_id") WHERE "contestacoes_pagamento"."id_caso" is null and "contestacoes_pagamento"."id_contestacao" is null and "contestacoes_pagamento"."situacao" in ('aberta', 'a_confirmar');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contestacoes_pagamento_situacao" ON "contestacoes_pagamento" USING btree ("organizacao_id","situacao");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contestacoes_pagamento_leitura" ON "contestacoes_pagamento" USING btree ("proxima_leitura_em") WHERE "contestacoes_pagamento"."situacao" in ('aberta', 'a_confirmar');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contestacoes_pagamento_reserva" ON "contestacoes_pagamento" USING btree ("reserva_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contestacoes_pagamento_pagamento" ON "contestacoes_pagamento" USING btree ("pagamento_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "eventos_contestacao_contestacao" ON "eventos_contestacao" USING btree ("contestacao_id","em");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devolucoes_pagamento_contestacao_id_fk') THEN
		ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_contestacao_id_fk" FOREIGN KEY ("contestacao_id") REFERENCES "public"."contestacoes_pagamento"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devolucoes_pagamento_contestacao" ON "devolucoes_pagamento" USING btree ("contestacao_id") WHERE "devolucoes_pagamento"."contestacao_id" is not null;
