CREATE TABLE "recebimento_por_canal" (
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"origem" "origem_reserva" NOT NULL,
	"recebimento" "recebimento_reserva" NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recebimento_por_canal_imovel_id_origem_pk" PRIMARY KEY("imovel_id","origem")
);
--> statement-breakpoint
ALTER TABLE "recebimento_por_canal" ADD CONSTRAINT "recebimento_por_canal_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recebimento_por_canal" ADD CONSTRAINT "recebimento_por_canal_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Um proprietário por imóvel (Diego, 24/09). Se algum banco já tiver um imóvel com mais de
-- um vínculo, mantém o vínculo mais antigo (desempate pelo id do proprietário) e remove os
-- outros, para o índice abaixo poder ser criado. (Antes do uso real não há dados assim.)
DELETE FROM "proprietario_imoveis" pi USING "proprietario_imoveis" outro
WHERE pi."imovel_id" = outro."imovel_id"
  AND (pi."criado_em", pi."proprietario_id") > (outro."criado_em", outro."proprietario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proprietario_imoveis_um_dono" ON "proprietario_imoveis" USING btree ("imovel_id");