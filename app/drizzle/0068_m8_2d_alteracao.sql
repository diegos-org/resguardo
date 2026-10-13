-- M8.2d (alteração de reserva paga e devolução de parte do valor). Idempotente como a 0053/0067: o banco das prévias é
-- compartilhado e as migrações entram por hash, então rodar estas instruções de novo não pode falhar nem mudar nada.
-- Troca o índice "uma devolução por pagamento" por índices parciais (várias devoluções por pagamento, uma pedida por
-- vez) e copia para cada devolução o que até aqui morava no pagamento ou no cancelamento (uma devolução por pagamento).
CREATE TABLE IF NOT EXISTS "alteracoes_reserva" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"cotacao_id" uuid NOT NULL,
	"pagamento_id" uuid NOT NULL,
	"situacao" text DEFAULT 'segurada' NOT NULL,
	"quem_pede" text DEFAULT 'hospede' NOT NULL,
	"motivo_empresa" text,
	"pedido_recebido_em" timestamp with time zone NOT NULL,
	"canal" text,
	"nota" text DEFAULT '' NOT NULL,
	"checkin_antes" date NOT NULL,
	"checkout_antes" date NOT NULL,
	"hospedes_antes" integer,
	"valor_antes" integer NOT NULL,
	"checkin_depois" date NOT NULL,
	"checkout_depois" date NOT NULL,
	"hospedes_depois" integer NOT NULL,
	"valor_depois" integer NOT NULL,
	"origem_valor" text NOT NULL,
	"motivo_valor" text,
	"motivo_valor_nota" text DEFAULT '' NOT NULL,
	"cotacao" jsonb NOT NULL,
	"diferenca" integer NOT NULL,
	"entrada_da_politica" date NOT NULL,
	"noites_novas_inicio" date,
	"noites_novas_fim" date,
	"hold_ate" timestamp with time zone,
	"hold_reserva_id" uuid,
	"politica_versao" integer,
	"dias_reembolso_integral" integer,
	"arrependimento_ate_entrada" boolean,
	"integral_ate" date,
	"arrependimento_ate" date,
	"calculado" text,
	"direito" text,
	"base" text,
	"motivo_excecao" text,
	"motivo_decisao" text DEFAULT '' NOT NULL,
	"valor_a_devolver" integer,
	"assinatura" text NOT NULL,
	"taxa_depois" integer,
	"resultado" jsonb,
	"aplicada_em" timestamp with time zone,
	"aplicada_por" uuid,
	"aplicada_tardia" boolean DEFAULT false NOT NULL,
	"expirada_em" timestamp with time zone,
	"desistida_em" timestamp with time zone,
	"desistida_por" uuid,
	"desistencia_motivo" text DEFAULT '' NOT NULL,
	"ota_atualizada_em" timestamp with time zone,
	"ota_atualizada_por" uuid,
	"hospede_avisado_proposta_em" timestamp with time zone,
	"hospede_avisado_proposta_por" uuid,
	"hospede_avisado_confirmacao_em" timestamp with time zone,
	"hospede_avisado_confirmacao_por" uuid,
	"hospede_avisado_devolucao_em" timestamp with time zone,
	"hospede_avisado_devolucao_por" uuid,
	"criada_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS "devolucoes_pagamento_um_por_pagamento";
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "alteracao_id" uuid;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "origem_devolucao_id" uuid;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "avisos" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "caixa_lancado_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "taxa_atribuida" integer;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "corpo_integral" boolean;
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN IF NOT EXISTS "alteracao_id" uuid;
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN IF NOT EXISTS "devolvido_fora_reconhecido" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_reserva_id_reservas_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_cotacao_id_cotacoes_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_cotacao_id_cotacoes_id_fk" FOREIGN KEY ("cotacao_id") REFERENCES "public"."cotacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_pagamento_id_pagamentos_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_pagamento_id_pagamentos_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."pagamentos"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_hold_reserva_id_reservas_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_hold_reserva_id_reservas_id_fk" FOREIGN KEY ("hold_reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_aplicada_por_usuarios_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_aplicada_por_usuarios_id_fk" FOREIGN KEY ("aplicada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_desistida_por_usuarios_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_desistida_por_usuarios_id_fk" FOREIGN KEY ("desistida_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_ota_atualizada_por_usuarios_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_ota_atualizada_por_usuarios_id_fk" FOREIGN KEY ("ota_atualizada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_criada_por_usuarios_id_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_criada_por_usuarios_id_fk" FOREIGN KEY ("criada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_avisado_prop_por_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_avisado_prop_por_fk" FOREIGN KEY ("hospede_avisado_proposta_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_avisado_conf_por_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_avisado_conf_por_fk" FOREIGN KEY ("hospede_avisado_confirmacao_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alteracoes_reserva_avisado_dev_por_fk') THEN
		ALTER TABLE "alteracoes_reserva" ADD CONSTRAINT "alteracoes_reserva_avisado_dev_por_fk" FOREIGN KEY ("hospede_avisado_devolucao_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alteracoes_reserva_uma_segurada" ON "alteracoes_reserva" USING btree ("reserva_id") WHERE "alteracoes_reserva"."situacao" = 'segurada';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "alteracoes_reserva_hold" ON "alteracoes_reserva" USING btree ("hold_reserva_id") WHERE "alteracoes_reserva"."hold_reserva_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alteracoes_reserva_org" ON "alteracoes_reserva" USING btree ("organizacao_id","situacao");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "alteracoes_reserva_reserva" ON "alteracoes_reserva" USING btree ("reserva_id");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devolucoes_pagamento_alteracao_id_alteracoes_reserva_id_fk') THEN
		ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_alteracao_id_alteracoes_reserva_id_fk" FOREIGN KEY ("alteracao_id") REFERENCES "public"."alteracoes_reserva"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devolucoes_pagamento_origem_devolucao_fk') THEN
		ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_origem_devolucao_fk" FOREIGN KEY ("origem_devolucao_id") REFERENCES "public"."devolucoes_pagamento"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pagamentos_alteracao_id_alteracoes_reserva_id_fk') THEN
		ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_alteracao_id_alteracoes_reserva_id_fk" FOREIGN KEY ("alteracao_id") REFERENCES "public"."alteracoes_reserva"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devolucoes_pagamento_sem_reserva" ON "devolucoes_pagamento" USING btree ("pagamento_id") WHERE "devolucoes_pagamento"."origem" = 'sem_reserva' and "devolucoes_pagamento"."origem_devolucao_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devolucoes_pagamento_do_cancelamento" ON "devolucoes_pagamento" USING btree ("cancelamento_id","pagamento_id") WHERE "devolucoes_pagamento"."cancelamento_id" is not null and "devolucoes_pagamento"."origem_devolucao_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devolucoes_pagamento_da_alteracao" ON "devolucoes_pagamento" USING btree ("alteracao_id","pagamento_id") WHERE "devolucoes_pagamento"."alteracao_id" is not null and "devolucoes_pagamento"."origem_devolucao_id" is null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devolucoes_pagamento_restante" ON "devolucoes_pagamento" USING btree ("origem_devolucao_id") WHERE "devolucoes_pagamento"."origem_devolucao_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "devolucoes_pagamento_uma_pedida" ON "devolucoes_pagamento" USING btree ("pagamento_id") WHERE "devolucoes_pagamento"."situacao" = 'pedida';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "devolucoes_pagamento_pagamento" ON "devolucoes_pagamento" USING btree ("pagamento_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "pagamentos_um_desfecho_alteracao" ON "pagamentos" USING btree ("alteracao_id") WHERE "pagamentos"."desfecho" = 'alteracao';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pagamentos_alteracao" ON "pagamentos" USING btree ("alteracao_id") WHERE "pagamentos"."alteracao_id" is not null;
--> statement-breakpoint
-- Os avisos de devolução do pagamento passam para a devolução (até aqui, uma por pagamento). Só a devolução ainda sem
-- avisos e única no pagamento: rodar de novo não copia os avisos de uma devolução para outra.
UPDATE "devolucoes_pagamento" d SET "avisos" = coalesce((SELECT jsonb_agg(a) FROM jsonb_array_elements_text(p."avisos") a
	WHERE a IN ('devolucao_falhou', 'devolucao_parada', 'devolucao_sem_confirmacao', 'devolucao_fora_do_prazo', 'devolucao_a_menor', 'taxa_perdida_desconhecida', 'devolucao_data_a_conferir')), '[]'::jsonb)
	FROM "pagamentos" p
	WHERE p."id" = d."pagamento_id" AND d."avisos" = '[]'::jsonb
		AND (SELECT count(*) FROM "devolucoes_pagamento" x WHERE x."pagamento_id" = d."pagamento_id") = 1;
--> statement-breakpoint
-- O caixa já acertado das devoluções de cancelamento (M8.2c) fica marcado na própria devolução.
UPDATE "devolucoes_pagamento" d SET "caixa_lancado_em" = c."caixa_lancado_em" FROM "cancelamentos_reserva" c
	WHERE c."id" = d."cancelamento_id" AND d."caixa_lancado_em" IS NULL AND c."caixa_lancado_em" IS NOT NULL;
