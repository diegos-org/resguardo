-- M8.3c (reserva paga do site no Beds24, escrita real; desenho em requisitos/product/RESERVA-SITE-BEDS24.md, 3.8, 4.5 e 7).
-- Idempotente como a 0067 a 0073: o banco das prévias é compartilhado e as migrações entram por hash, então rodar estas
-- instruções de novo não pode falhar nem mudar nada. Acrescenta às operações a classificação da resposta do Beds24
-- (`resposta`, lista fechada RESPOSTAS_BEDS24; nula antes do POST) e os detalhes seguros de forma fechada (`detalhe`: o id
-- sugerido, as duplicadas, o bloqueio achado, o que o ensaio observou), e cria o estado da rotina por organização
-- (`beds24_reservas_rotina`: os escopos lidos e as marcas de tempo da conferência contínua; não é configuração editável).
-- Nenhuma linha é criada aqui e nada é escrito no Beds24; sem dado pessoal nem valor.
ALTER TABLE "beds24_reservas_operacoes" ADD COLUMN IF NOT EXISTS "resposta" text;
--> statement-breakpoint
ALTER TABLE "beds24_reservas_operacoes" ADD COLUMN IF NOT EXISTS "detalhe" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "beds24_reservas_rotina" (
	"organizacao_id" uuid PRIMARY KEY NOT NULL,
	"escopos" jsonb,
	"escopos_credencial" text DEFAULT '' NOT NULL,
	"escopos_lidos_em" timestamp with time zone,
	"conferencia_em" timestamp with time zone,
	"releitura_em" timestamp with time zone,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_reservas_rotina_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "beds24_reservas_rotina" ADD CONSTRAINT "beds24_reservas_rotina_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beds24_reservas_operacoes_resposta" ON "beds24_reservas_operacoes" USING btree ("organizacao_id","resposta","respondido_em") WHERE "beds24_reservas_operacoes"."resposta" is not null;
