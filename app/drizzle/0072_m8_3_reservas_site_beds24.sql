-- M8.3a (reserva paga do site no Beds24, base sem escrita; desenho em requisitos/product/RESERVA-SITE-BEDS24.md, 3.2).
-- Idempotente como a 0067 a 0071: o banco das prévias é compartilhado e as migrações entram por hash, então rodar estas
-- instruções de novo não pode falhar nem mudar nada. Cria o acompanhamento de cada reserva do site (`beds24_reservas_site`,
-- uma linha por reserva) e a fila/histórico das operações (`beds24_reservas_operacoes`: chave de idempotência única por
-- organização, no máximo uma operação ativa por reserva). Nenhuma linha é criada aqui e nada é escrito no Beds24; sem dado
-- pessoal nem valor (só códigos, ids do Beds24, quarto, datas, número de pessoas, situação e a impressão da credencial).
CREATE TABLE IF NOT EXISTS "beds24_reservas_operacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"reserva_id" uuid,
	"acompanhamento_id" uuid,
	"tipo" text NOT NULL,
	"chave" text NOT NULL,
	"modo" text NOT NULL,
	"situacao" text DEFAULT 'pendente' NOT NULL,
	"pedido" jsonb,
	"alteracoes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"antes" jsonb,
	"depois" jsonb,
	"beds24_id" text,
	"credencial" text DEFAULT '' NOT NULL,
	"autor_id" uuid,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"enviado_em" timestamp with time zone,
	"respondido_em" timestamp with time zone,
	"terminado_em" timestamp with time zone,
	"erro" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "beds24_reservas_site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"property_id" text,
	"room_id" text,
	"credencial" text DEFAULT '' NOT NULL,
	"referencia" text NOT NULL,
	"situacao" text DEFAULT 'pendente' NOT NULL,
	"motivo" text,
	"versao" integer DEFAULT 0 NOT NULL,
	"esperado" jsonb,
	"assinatura_esperada" text,
	"lido" jsonb,
	"lido_em" timestamp with time zone,
	"conferida_em" timestamp with time zone,
	"ota_fechada_em" timestamp with time zone,
	"ota_fechada_por" uuid,
	"tentativas" integer DEFAULT 0 NOT NULL,
	"proxima_tentativa_em" timestamp with time zone,
	"buscas_sem_conclusao" integer DEFAULT 0 NOT NULL,
	"avisada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_operacoes_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "beds24_reservas_operacoes" ADD CONSTRAINT "beds24_reservas_operacoes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_operacoes_reserva_id_reservas_id_fk') THEN
		ALTER TABLE "beds24_reservas_operacoes" ADD CONSTRAINT "beds24_reservas_operacoes_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_operacoes_autor_id_usuarios_id_fk') THEN
		ALTER TABLE "beds24_reservas_operacoes" ADD CONSTRAINT "beds24_reservas_operacoes_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_operacoes_acompanhamento_fk') THEN
		ALTER TABLE "beds24_reservas_operacoes" ADD CONSTRAINT "beds24_reservas_operacoes_acompanhamento_fk" FOREIGN KEY ("acompanhamento_id") REFERENCES "public"."beds24_reservas_site"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_site_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "beds24_reservas_site" ADD CONSTRAINT "beds24_reservas_site_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_site_reserva_id_reservas_id_fk') THEN
		ALTER TABLE "beds24_reservas_site" ADD CONSTRAINT "beds24_reservas_site_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_site_imovel_id_imoveis_id_fk') THEN
		ALTER TABLE "beds24_reservas_site" ADD CONSTRAINT "beds24_reservas_site_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_site_ota_fechada_por_usuarios_id_fk') THEN
		ALTER TABLE "beds24_reservas_site" ADD CONSTRAINT "beds24_reservas_site_ota_fechada_por_usuarios_id_fk" FOREIGN KEY ("ota_fechada_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "beds24_reservas_operacoes_chave" ON "beds24_reservas_operacoes" USING btree ("organizacao_id","chave");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "beds24_reservas_operacoes_uma_ativa" ON "beds24_reservas_operacoes" USING btree ("reserva_id") WHERE "beds24_reservas_operacoes"."situacao" in ('pendente', 'enviando', 'incerta');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beds24_reservas_operacoes_situacao" ON "beds24_reservas_operacoes" USING btree ("organizacao_id","situacao","iniciado_em");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beds24_reservas_operacoes_beds24" ON "beds24_reservas_operacoes" USING btree ("organizacao_id","beds24_id") WHERE "beds24_reservas_operacoes"."beds24_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "beds24_reservas_site_reserva" ON "beds24_reservas_site" USING btree ("organizacao_id","reserva_id");
