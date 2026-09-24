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
CREATE UNIQUE INDEX "proprietario_imoveis_um_dono" ON "proprietario_imoveis" USING btree ("imovel_id");