-- M8.2c (cancelamento de reserva paga pelo site, pela política). Idempotente de propósito, como a 0053: o banco das
-- prévias é compartilhado e as migrações entram por hash, então rodar estas instruções de novo não pode falhar.
-- O valor novo do tipo de lançamento ('devolucao') não é usado nesta migração (cada arquivo roda numa transação).
ALTER TYPE "public"."tipo_lancamento" ADD VALUE IF NOT EXISTS 'devolucao';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cancelamentos_reserva" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"pagamento_id" uuid NOT NULL,
	"situacao" text DEFAULT 'pedido' NOT NULL,
	"pedido_recebido_em" timestamp with time zone NOT NULL,
	"pedido_registrado_original_em" timestamp with time zone,
	"motivo_momento" text DEFAULT '' NOT NULL,
	"canal" text,
	"quem_cancela" text DEFAULT 'hospede' NOT NULL,
	"motivo_empresa" text,
	"motivo_excecao" text,
	"nota" text DEFAULT '' NOT NULL,
	"motivo_decisao" text DEFAULT '' NOT NULL,
	"pedido_por" uuid,
	"politica_versao" integer,
	"dias_reembolso_integral" integer,
	"arrependimento_ate_entrada" boolean,
	"integral_ate" date,
	"arrependimento_ate" date,
	"entrada_em" timestamp with time zone,
	"calculado" text,
	"direito" text,
	"base" text,
	"valor_pago" integer,
	"valor_a_devolver" integer,
	"cancelada_em" timestamp with time zone,
	"cancelada_por" uuid,
	"resultado_lancado_em" timestamp with time zone,
	"espelhado" boolean DEFAULT false NOT NULL,
	"caixa_lancado_em" timestamp with time zone,
	"ota_liberada_em" timestamp with time zone,
	"ota_liberada_por" uuid,
	"hospede_avisado_pedido_em" timestamp with time zone,
	"hospede_avisado_pedido_por" uuid,
	"hospede_avisado_decisao_em" timestamp with time zone,
	"hospede_avisado_decisao_por" uuid,
	"hospede_avisado_devolucao_em" timestamp with time zone,
	"hospede_avisado_devolucao_por" uuid,
	"descartado_em" timestamp with time zone,
	"descartado_por" uuid,
	"descarte_motivo" text DEFAULT '' NOT NULL,
	"desistencia_canal" text,
	"desistencia_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "origem" text DEFAULT 'sem_reserva' NOT NULL;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "cancelamento_id" uuid;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "saida_lancamento_id" uuid;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "confirmada_por" text;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "confirmada_nota" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "valor_confirmado" integer;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "ultimo_codigo" text;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "recusa_no_painel_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "recusa_no_painel_por" uuid;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "recusa_no_painel_nota" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "parada_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "devolucoes_pagamento" ADD COLUMN IF NOT EXISTS "parada_nota" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN IF NOT EXISTS "devolvido_lido" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN IF NOT EXISTS "devolucao_em_andamento_lida" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN IF NOT EXISTS "devolvido_visto_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN IF NOT EXISTS "valor_retido" integer;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_reserva_id_reservas_id_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_pagamento_id_pagamentos_id_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_pagamento_id_pagamentos_id_fk" FOREIGN KEY ("pagamento_id") REFERENCES "public"."pagamentos"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_pedido_por_usuarios_id_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_pedido_por_usuarios_id_fk" FOREIGN KEY ("pedido_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_cancelada_por_usuarios_id_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_cancelada_por_usuarios_id_fk" FOREIGN KEY ("cancelada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_ota_liberada_por_usuarios_id_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_ota_liberada_por_usuarios_id_fk" FOREIGN KEY ("ota_liberada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_hospede_avisado_pedido_por_usuarios_id_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_hospede_avisado_pedido_por_usuarios_id_fk" FOREIGN KEY ("hospede_avisado_pedido_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_descartado_por_usuarios_id_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_descartado_por_usuarios_id_fk" FOREIGN KEY ("descartado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_hospede_avisado_decisao_por_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_hospede_avisado_decisao_por_fk" FOREIGN KEY ("hospede_avisado_decisao_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cancelamentos_reserva_hospede_avisado_devolucao_por_fk') THEN
		ALTER TABLE "cancelamentos_reserva" ADD CONSTRAINT "cancelamentos_reserva_hospede_avisado_devolucao_por_fk" FOREIGN KEY ("hospede_avisado_devolucao_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cancelamentos_reserva_um_ativo" ON "cancelamentos_reserva" USING btree ("reserva_id") WHERE "cancelamentos_reserva"."situacao" in ('pedido', 'cancelada');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancelamentos_reserva_org" ON "cancelamentos_reserva" USING btree ("organizacao_id","situacao");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cancelamentos_reserva_reserva" ON "cancelamentos_reserva" USING btree ("reserva_id");
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devolucoes_pagamento_saida_lancamento_id_lancamentos_id_fk') THEN
		ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_saida_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("saida_lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devolucoes_pagamento_recusa_no_painel_por_usuarios_id_fk') THEN
		ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_recusa_no_painel_por_usuarios_id_fk" FOREIGN KEY ("recusa_no_painel_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'devolucoes_pagamento_cancelamento_id_fk') THEN
		ALTER TABLE "devolucoes_pagamento" ADD CONSTRAINT "devolucoes_pagamento_cancelamento_id_fk" FOREIGN KEY ("cancelamento_id") REFERENCES "public"."cancelamentos_reserva"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
