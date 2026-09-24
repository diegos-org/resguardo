CREATE TABLE "imoveis_detalhes" (
	"imovel_id" uuid PRIMARY KEY NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"cep" text DEFAULT '' NOT NULL,
	"complemento" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT '' NOT NULL,
	"camas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comodidades" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regras_casa" text DEFAULT '' NOT NULL,
	"aceita_animais" boolean DEFAULT false NOT NULL,
	"permite_fumar" boolean DEFAULT false NOT NULL,
	"permite_festas" boolean DEFAULT false NOT NULL,
	"checkin_a_partir_de" text DEFAULT '15:00' NOT NULL,
	"checkout_ate" text DEFAULT '11:00' NOT NULL,
	"taxa_limpeza" integer,
	"hospede_extra_valor" integer,
	"hospede_extra_a_partir_de" integer,
	"estadia_minima" integer,
	"estadia_maxima" integer,
	"antecedencia_minima" integer,
	"janela_maxima" integer,
	"dias_chegada" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dias_saida" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preco_base" integer,
	"preco_dinamico" boolean DEFAULT false NOT NULL,
	"preco_minimo" integer,
	"preco_maximo" integer,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "imoveis_periodos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"preco_noite" integer,
	"estadia_minima" integer,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imoveis_detalhes" ADD CONSTRAINT "imoveis_detalhes_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imoveis_detalhes" ADD CONSTRAINT "imoveis_detalhes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imoveis_periodos" ADD CONSTRAINT "imoveis_periodos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "imoveis_periodos" ADD CONSTRAINT "imoveis_periodos_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "imoveis_periodos_imovel" ON "imoveis_periodos" USING btree ("imovel_id","inicio");