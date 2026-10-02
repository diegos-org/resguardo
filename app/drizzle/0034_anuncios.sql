CREATE TABLE "anuncios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"canal" text NOT NULL,
	"situacao" text DEFAULT 'nao_conferido' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"titulo" text DEFAULT '' NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"fotos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preco_base" integer,
	"conferido_em" timestamp with time zone,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"versao" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anuncios" ADD CONSTRAINT "anuncios_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "anuncios" ADD CONSTRAINT "anuncios_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "anuncios_imovel_canal" ON "anuncios" USING btree ("imovel_id","canal");