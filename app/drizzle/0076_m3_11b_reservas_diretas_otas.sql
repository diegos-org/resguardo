-- M3.11b (reserva direta confirmada no SCL e as OTAs; desenho em requisitos/product/SO-DISPONIBILIDADE.md, 8). Idempotente
-- como a 0067 a 0075: o banco das prévias é compartilhado e as migrações entram por hash, então rodar estas instruções de
-- novo não pode falhar nem mudar nada. Cria as marcas manuais das OTAs da reserva direta (`reservas_diretas_otas`, uma linha
-- por reserva, criada pela primeira marca): "Datas fechadas nas OTAs" (quem e quando) tira o aviso "feche as datas no Beds24
-- como bloqueio"; cancelada depois disso, "Datas reabertas nas OTAs" (quem e quando) tira o "reabra as datas". Não reaproveita
-- `beds24_reservas_site`: o envio do M8.3c lê aquela tabela para decidir o que escrever no Beds24, e a reserva direta nunca
-- pode entrar nessa fila.
-- Nenhuma linha é criada aqui e nada é escrito no Beds24; só ids e horas, sem dado pessoal nem valor.
-- Mudar este arquivo depois do primeiro push com prévia: só acrescentando `ADD COLUMN IF NOT EXISTS` (o
-- `CREATE TABLE IF NOT EXISTS` não acrescenta coluna a uma tabela que já existe).
CREATE TABLE IF NOT EXISTS "reservas_diretas_otas" (
	"reserva_id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"fechadas_em" timestamp with time zone NOT NULL,
	"fechadas_por" uuid,
	"reabertas_em" timestamp with time zone,
	"reabertas_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservas_diretas_otas_reserva_id_reservas_id_fk') THEN
		ALTER TABLE "reservas_diretas_otas" ADD CONSTRAINT "reservas_diretas_otas_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservas_diretas_otas_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "reservas_diretas_otas" ADD CONSTRAINT "reservas_diretas_otas_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservas_diretas_otas_fechadas_por_usuarios_id_fk') THEN
		ALTER TABLE "reservas_diretas_otas" ADD CONSTRAINT "reservas_diretas_otas_fechadas_por_usuarios_id_fk" FOREIGN KEY ("fechadas_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'reservas_diretas_otas_reabertas_por_usuarios_id_fk') THEN
		ALTER TABLE "reservas_diretas_otas" ADD CONSTRAINT "reservas_diretas_otas_reabertas_por_usuarios_id_fk" FOREIGN KEY ("reabertas_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reservas_diretas_otas_organizacao" ON "reservas_diretas_otas" USING btree ("organizacao_id");
