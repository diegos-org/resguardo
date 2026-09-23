CREATE TYPE "public"."canal" AS ENUM('beds24', 'airbnb', 'booking');--> statement-breakpoint
CREATE TABLE "ids_externos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"id_externo" text NOT NULL,
	"detalhe" text DEFAULT '' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ids_externos" ADD CONSTRAINT "ids_externos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ids_externos" ADD CONSTRAINT "ids_externos_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ids_externos_unico" ON "ids_externos" USING btree ("organizacao_id","canal","id_externo","detalhe");