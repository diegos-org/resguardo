CREATE TABLE "cotacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"estado" text DEFAULT 'aberta' NOT NULL,
	"checkin" date NOT NULL,
	"checkout" date NOT NULL,
	"hospedes" integer NOT NULL,
	"noites" integer NOT NULL,
	"situacao" text NOT NULL,
	"diarias" integer NOT NULL,
	"limpeza" integer NOT NULL,
	"hospede_extra" integer NOT NULL,
	"total" integer NOT NULL,
	"leitura_em" timestamp with time zone,
	"reserva_id" uuid,
	"hold_ate" timestamp with time zone,
	"criada_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizada_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cotacoes" ADD CONSTRAINT "cotacoes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotacoes" ADD CONSTRAINT "cotacoes_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cotacoes" ADD CONSTRAINT "cotacoes_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cotacoes_codigo" ON "cotacoes" USING btree ("organizacao_id","codigo");--> statement-breakpoint
CREATE INDEX "cotacoes_imovel_estado" ON "cotacoes" USING btree ("imovel_id","estado");