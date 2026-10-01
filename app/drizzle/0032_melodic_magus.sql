CREATE TABLE "beds24_calendario" (
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"data" date NOT NULL,
	"livres" integer,
	"preco" integer,
	"minimo_noites" integer,
	"observado_em" timestamp with time zone NOT NULL,
	CONSTRAINT "beds24_calendario_organizacao_id_imovel_id_data_pk" PRIMARY KEY("organizacao_id","imovel_id","data")
);
--> statement-breakpoint
CREATE TABLE "beds24_execucoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"terminado_em" timestamp with time zone,
	"situacao" text DEFAULT 'executando' NOT NULL,
	"resumo" text DEFAULT '' NOT NULL,
	"divergencias" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "beds24_id" text;--> statement-breakpoint
ALTER TABLE "beds24_calendario" ADD CONSTRAINT "beds24_calendario_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_calendario" ADD CONSTRAINT "beds24_calendario_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_execucoes" ADD CONSTRAINT "beds24_execucoes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beds24_execucoes_org" ON "beds24_execucoes" USING btree ("organizacao_id","iniciado_em");--> statement-breakpoint
CREATE UNIQUE INDEX "reservas_beds24" ON "reservas" USING btree ("organizacao_id","beds24_id");