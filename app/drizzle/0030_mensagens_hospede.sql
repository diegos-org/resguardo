CREATE TABLE "mensagens_hospede" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"referencia" text NOT NULL,
	"estado" text NOT NULL,
	"tentativas" integer DEFAULT 1 NOT NULL,
	"para" text NOT NULL,
	"modelo_nome" text NOT NULL,
	"erro" text DEFAULT '' NOT NULL,
	"enviado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "confirmada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "mensagens_hospede" ADD CONSTRAINT "mensagens_hospede_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagens_hospede" ADD CONSTRAINT "mensagens_hospede_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mensagens_hospede_unica" ON "mensagens_hospede" USING btree ("reserva_id","tipo","referencia");--> statement-breakpoint
CREATE INDEX "mensagens_hospede_org" ON "mensagens_hospede" USING btree ("organizacao_id","criado_em");--> statement-breakpoint
-- Reservas já confirmadas: a confirmação conta desde a criação (a mensagem só sai para confirmações depois de ligar o envio).
UPDATE "reservas" SET "confirmada_em" = "criado_em" WHERE "estado" = 'confirmada';
