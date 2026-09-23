CREATE TYPE "public"."estado_reserva" AS ENUM('pendente', 'confirmada', 'cancelada');--> statement-breakpoint
CREATE TYPE "public"."origem_reserva" AS ENUM('airbnb', 'booking', 'site', 'direta', 'outro');--> statement-breakpoint
CREATE TABLE "bloqueios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"inicio" date NOT NULL,
	"fim" date NOT NULL,
	"motivo" text DEFAULT '' NOT NULL,
	"fonte" text DEFAULT 'manual' NOT NULL,
	"id_fonte" text DEFAULT '' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"origem" "origem_reserva" NOT NULL,
	"estado" "estado_reserva" DEFAULT 'confirmada' NOT NULL,
	"checkin" date NOT NULL,
	"checkout" date NOT NULL,
	"hospedes" integer,
	"hospede_nome" text DEFAULT '' NOT NULL,
	"hospede_email" text DEFAULT '' NOT NULL,
	"hospede_telefone" text DEFAULT '' NOT NULL,
	"hospede_origem" text DEFAULT '' NOT NULL,
	"moeda" text DEFAULT 'BRL' NOT NULL,
	"valor_bruto" integer,
	"taxa_canal" integer,
	"valor_liquido" integer,
	"fonte" text DEFAULT 'manual' NOT NULL,
	"id_fonte" text DEFAULT '' NOT NULL,
	"codigo_canal" text DEFAULT '' NOT NULL,
	"observacoes" text DEFAULT '' NOT NULL,
	"cancelada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservas" ADD CONSTRAINT "reservas_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bloqueios_fonte" ON "bloqueios" USING btree ("organizacao_id","fonte","id_fonte") WHERE "bloqueios"."id_fonte" <> '';--> statement-breakpoint
CREATE INDEX "bloqueios_imovel_periodo" ON "bloqueios" USING btree ("imovel_id","inicio","fim");--> statement-breakpoint
CREATE UNIQUE INDEX "reservas_codigo" ON "reservas" USING btree ("organizacao_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "reservas_fonte" ON "reservas" USING btree ("organizacao_id","fonte","id_fonte") WHERE "reservas"."id_fonte" <> '';--> statement-breakpoint
CREATE INDEX "reservas_imovel_periodo" ON "reservas" USING btree ("imovel_id","checkin","checkout");