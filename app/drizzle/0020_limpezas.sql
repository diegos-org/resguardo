CREATE TABLE "limpezas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"reserva_id" uuid,
	"data" date NOT NULL,
	"estado" text DEFAULT 'pedida' NOT NULL,
	"profissional_id" uuid,
	"custo" integer,
	"observacao" text DEFAULT '' NOT NULL,
	"cancelada_manual" boolean DEFAULT false NOT NULL,
	"confirmada_em" timestamp with time zone,
	"realizada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profissionais_limpeza" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"telefone" text DEFAULT '' NOT NULL,
	"observacoes" text DEFAULT '' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "limpezas" ADD CONSTRAINT "limpezas_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limpezas" ADD CONSTRAINT "limpezas_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limpezas" ADD CONSTRAINT "limpezas_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "limpezas" ADD CONSTRAINT "limpezas_profissional_id_profissionais_limpeza_id_fk" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissionais_limpeza"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profissionais_limpeza" ADD CONSTRAINT "profissionais_limpeza_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "limpezas_uma_por_reserva" ON "limpezas" USING btree ("reserva_id") WHERE "limpezas"."reserva_id" is not null;--> statement-breakpoint
CREATE INDEX "limpezas_org_data" ON "limpezas" USING btree ("organizacao_id","data");--> statement-breakpoint
CREATE UNIQUE INDEX "profissionais_limpeza_nome" ON "profissionais_limpeza" USING btree ("organizacao_id",lower("nome"));