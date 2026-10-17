-- M10.1a (WhatsApp, recebimento). Idempotente como a 0067 a 0072: pode rodar de novo no banco das prévias.
-- O banco das prévias é compartilhado e as migrações entram por hash, então rodar estas instruções de novo não pode falhar
-- nem mudar nada. Cria a situação da conta (`whatsapp_conta`, uma linha por organização), as conversas (`whatsapp_contatos`:
-- BSUID e wa_id únicos por organização, no máximo um vínculo e só confirmado), as mensagens (`whatsapp_mensagens`: uma por
-- organização e wamid; apagada sem texto), os blocos processados (`whatsapp_eventos`, sem nada do corpo) e os contadores do
-- dia (`whatsapp_avisos_dia`, sem organização). Nenhuma linha é criada aqui e nada é escrito na Meta. Não guarda mídia, url,
-- id de mídia, sha256, nome de arquivo, coordenadas, contato compartilhado nem system.body. Mudar este arquivo depois do
-- primeiro push com prévia: só acrescentando `ADD COLUMN IF NOT EXISTS` (o `CREATE TABLE IF NOT EXISTS` não acrescenta
-- coluna a uma tabela que já existe).
CREATE TABLE IF NOT EXISTS "whatsapp_avisos_dia" (
	"dia" date PRIMARY KEY NOT NULL,
	"assinaturas_recusadas" integer DEFAULT 0 NOT NULL,
	"ilegiveis" integer DEFAULT 0 NOT NULL,
	"outra_conta" integer DEFAULT 0 NOT NULL,
	"desconhecidos" integer DEFAULT 0 NOT NULL,
	"ignorados" integer DEFAULT 0 NOT NULL,
	"ultimo_valido_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_conta" (
	"organizacao_id" uuid PRIMARY KEY NOT NULL,
	"situacao" text DEFAULT 'nao_conectada' NOT NULL,
	"ultimo_evento" text,
	"motivo" text,
	"iniciado_por" text,
	"situacao_em" timestamp with time zone,
	"conectado_em" timestamp with time zone,
	"sincronizacao_contatos" text DEFAULT 'nao_pedida' NOT NULL,
	"contatos_recebidos_em" timestamp with time zone,
	"sincronizacao_historico" text DEFAULT 'nao_pedida' NOT NULL,
	"progresso_historico" integer,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_contatos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"wa_id" text,
	"bsuid" text,
	"nome_perfil" text DEFAULT '' NOT NULL,
	"nome_agenda" text DEFAULT '' NOT NULL,
	"nome_agenda_em" timestamp with time zone,
	"ultima_mensagem_em" timestamp with time zone,
	"ultima_recebida_em" timestamp with time zone,
	"ultima_enviada_em" timestamp with time zone,
	"lida_ate" timestamp with time zone,
	"conflito_identidade" boolean DEFAULT false NOT NULL,
	"reserva_id" uuid,
	"cotacao_id" uuid,
	"pedido_contato_id" uuid,
	"cadastro_marketplace_id" uuid,
	"proprietario_id" uuid,
	"vinculo_confirmado_por" uuid,
	"vinculo_confirmado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_eventos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"campo" text NOT NULL,
	"tipo" text DEFAULT '' NOT NULL,
	"motivo" text,
	"chave" text DEFAULT '' NOT NULL,
	"itens" integer DEFAULT 0 NOT NULL,
	"resultado" text NOT NULL,
	"ocorrido_em" timestamp with time zone,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"avisar_por_email" boolean DEFAULT false NOT NULL,
	"email_aviso_em" timestamp with time zone,
	"email_resultado" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whatsapp_mensagens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"contato_id" uuid NOT NULL,
	"wamid" text NOT NULL,
	"direcao" text NOT NULL,
	"origem" text NOT NULL,
	"tipo" text NOT NULL,
	"texto" text DEFAULT '' NOT NULL,
	"anexo_mime" text,
	"resposta_a" text,
	"enviada_em" timestamp with time zone NOT NULL,
	"recebida_em" timestamp with time zone DEFAULT now() NOT NULL,
	"editada_em" timestamp with time zone,
	"apagada_em" timestamp with time zone,
	"reacao" text,
	"reacao_em" timestamp with time zone,
	"situacao" text
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_conta_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "whatsapp_conta" ADD CONSTRAINT "whatsapp_conta_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_reserva_id_reservas_id_fk') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_cotacao_id_cotacoes_id_fk') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_cotacao_id_cotacoes_id_fk" FOREIGN KEY ("cotacao_id") REFERENCES "public"."cotacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_proprietario_id_proprietarios_id_fk') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_vinculo_confirmado_por_usuarios_id_fk') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_vinculo_confirmado_por_usuarios_id_fk" FOREIGN KEY ("vinculo_confirmado_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_pedido_contato_fk') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_pedido_contato_fk" FOREIGN KEY ("pedido_contato_id") REFERENCES "public"."pedidos_contato_proprietario"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_cadastro_fk') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_cadastro_fk" FOREIGN KEY ("cadastro_marketplace_id") REFERENCES "public"."cadastros_marketplace"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_eventos_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "whatsapp_eventos" ADD CONSTRAINT "whatsapp_eventos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_mensagens_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_mensagens_contato_id_whatsapp_contatos_id_fk') THEN
		ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_contato_id_whatsapp_contatos_id_fk" FOREIGN KEY ("contato_id") REFERENCES "public"."whatsapp_contatos"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_conta_progresso') THEN
		ALTER TABLE "whatsapp_conta" ADD CONSTRAINT "whatsapp_conta_progresso" CHECK ("whatsapp_conta"."progresso_historico" is null or ("whatsapp_conta"."progresso_historico" between 0 and 100));
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_identidade') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_identidade" CHECK ("whatsapp_contatos"."wa_id" is not null or "whatsapp_contatos"."bsuid" is not null);
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_wa_id_digitos') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_wa_id_digitos" CHECK ("whatsapp_contatos"."wa_id" is null or "whatsapp_contatos"."wa_id" ~ '^[0-9]{6,20}$');
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_contatos_um_vinculo') THEN
		ALTER TABLE "whatsapp_contatos" ADD CONSTRAINT "whatsapp_contatos_um_vinculo" CHECK (num_nonnulls("whatsapp_contatos"."reserva_id", "whatsapp_contatos"."cotacao_id", "whatsapp_contatos"."pedido_contato_id", "whatsapp_contatos"."cadastro_marketplace_id", "whatsapp_contatos"."proprietario_id") <= 1 and ((num_nonnulls("whatsapp_contatos"."reserva_id", "whatsapp_contatos"."cotacao_id", "whatsapp_contatos"."pedido_contato_id", "whatsapp_contatos"."cadastro_marketplace_id", "whatsapp_contatos"."proprietario_id") = 1) = ("whatsapp_contatos"."vinculo_confirmado_em" is not null)));
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_mensagens_apagada_sem_texto') THEN
		ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_apagada_sem_texto" CHECK ("whatsapp_mensagens"."apagada_em" is null or "whatsapp_mensagens"."texto" = '');
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_mensagens_wamid_tamanho') THEN
		ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_wamid_tamanho" CHECK (char_length("whatsapp_mensagens"."wamid") between 1 and 256);
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_contatos_wa_id" ON "whatsapp_contatos" USING btree ("organizacao_id","wa_id") WHERE "whatsapp_contatos"."wa_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_contatos_bsuid" ON "whatsapp_contatos" USING btree ("organizacao_id","bsuid") WHERE "whatsapp_contatos"."bsuid" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_contatos_ultima" ON "whatsapp_contatos" USING btree ("organizacao_id","ultima_mensagem_em" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_contatos_reserva" ON "whatsapp_contatos" USING btree ("reserva_id") WHERE "whatsapp_contatos"."reserva_id" is not null;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_contatos_cotacao" ON "whatsapp_contatos" USING btree ("cotacao_id") WHERE "whatsapp_contatos"."cotacao_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_eventos_chave" ON "whatsapp_eventos" USING btree ("organizacao_id","chave") WHERE "whatsapp_eventos"."chave" <> '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_eventos_recebido" ON "whatsapp_eventos" USING btree ("recebido_em");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_mensagens_wamid" ON "whatsapp_mensagens" USING btree ("organizacao_id","wamid");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_mensagens_contato" ON "whatsapp_mensagens" USING btree ("contato_id","enviada_em");
