CREATE TABLE "beds24_calendario_enviado" (
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"data" date NOT NULL,
	"preco" integer,
	"minimo" integer,
	"maximo" integer,
	"bloqueio" text,
	"enviado_em" timestamp with time zone NOT NULL,
	"confirmado" boolean DEFAULT false NOT NULL,
	"envio_id" uuid,
	CONSTRAINT "beds24_calendario_enviado_organizacao_id_imovel_id_data_pk" PRIMARY KEY("organizacao_id","imovel_id","data")
);
--> statement-breakpoint
CREATE TABLE "beds24_envio_noites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"envio_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"data" date NOT NULL,
	"preco_antes" integer,
	"preco_enviado" integer,
	"minimo_antes" integer,
	"minimo_enviado" integer,
	"maximo_enviado" integer,
	"bloqueio_antes" text,
	"bloqueio_enviado" text,
	"regra" text DEFAULT '' NOT NULL,
	"resultado" text NOT NULL,
	"detalhe" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "beds24_envios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"terminado_em" timestamp with time zone,
	"modo" text NOT NULL,
	"automatica" boolean DEFAULT false NOT NULL,
	"situacao" text DEFAULT 'executando' NOT NULL,
	"resumo" text DEFAULT '' NOT NULL,
	"avisos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"noites_enviadas" integer DEFAULT 0 NOT NULL,
	"noites_confirmadas" integer DEFAULT 0 NOT NULL,
	"noites_divergentes" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beds24_calendario" ADD COLUMN "maximo_noites" integer;--> statement-breakpoint
ALTER TABLE "beds24_calendario" ADD COLUMN "bloqueio" text;--> statement-breakpoint
ALTER TABLE "imoveis_detalhes" ADD COLUMN "piso_ultima_hora_1" integer;--> statement-breakpoint
ALTER TABLE "imoveis_detalhes" ADD COLUMN "piso_ultima_hora_2" integer;--> statement-breakpoint
ALTER TABLE "beds24_calendario_enviado" ADD CONSTRAINT "beds24_calendario_enviado_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_calendario_enviado" ADD CONSTRAINT "beds24_calendario_enviado_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_calendario_enviado" ADD CONSTRAINT "beds24_calendario_enviado_envio_id_beds24_envios_id_fk" FOREIGN KEY ("envio_id") REFERENCES "public"."beds24_envios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_envio_noites" ADD CONSTRAINT "beds24_envio_noites_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_envio_noites" ADD CONSTRAINT "beds24_envio_noites_envio_id_beds24_envios_id_fk" FOREIGN KEY ("envio_id") REFERENCES "public"."beds24_envios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_envio_noites" ADD CONSTRAINT "beds24_envio_noites_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_envios" ADD CONSTRAINT "beds24_envios_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beds24_envio_noites_envio" ON "beds24_envio_noites" USING btree ("envio_id");--> statement-breakpoint
CREATE INDEX "beds24_envio_noites_imovel" ON "beds24_envio_noites" USING btree ("organizacao_id","imovel_id","data");--> statement-breakpoint
CREATE INDEX "beds24_envios_org" ON "beds24_envios" USING btree ("organizacao_id","iniciado_em");