CREATE TABLE "arquivos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"tipo" text NOT NULL,
	"tamanho" integer NOT NULL,
	"conteudo" "bytea" NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repasse_itens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"repasse_id" uuid NOT NULL,
	"lancamento_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"competencia" date NOT NULL,
	"valor" integer NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"liberado_em" timestamp with time zone
);
--> statement-breakpoint
DROP INDEX "repasses_um_por_mes";--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "periodicidade_repasse" text;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "tipo" text DEFAULT 'fechamento' NOT NULL;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "data" date;--> statement-breakpoint
UPDATE "repasses" SET "data" = ("mes" + interval '1 month')::date;--> statement-breakpoint
ALTER TABLE "repasses" ALTER COLUMN "data" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "fora_do_fechamento" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "antecipado" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "comprovante" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "comprovante_arquivo_id" uuid;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "email_situacao" text DEFAULT 'pendente' NOT NULL;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "email_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "email_para" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "pedido_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "arquivos" ADD CONSTRAINT "arquivos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "arquivos" ADD CONSTRAINT "arquivos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasse_itens" ADD CONSTRAINT "repasse_itens_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasse_itens" ADD CONSTRAINT "repasse_itens_repasse_id_repasses_id_fk" FOREIGN KEY ("repasse_id") REFERENCES "public"."repasses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasse_itens" ADD CONSTRAINT "repasse_itens_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasse_itens" ADD CONSTRAINT "repasse_itens_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repasse_itens" ADD CONSTRAINT "repasse_itens_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repasse_itens_lancamento_unico" ON "repasse_itens" USING btree ("lancamento_id") WHERE "repasse_itens"."liberado_em" is null;--> statement-breakpoint
CREATE INDEX "repasse_itens_repasse" ON "repasse_itens" USING btree ("repasse_id");--> statement-breakpoint
CREATE INDEX "repasse_itens_reserva" ON "repasse_itens" USING btree ("reserva_id");--> statement-breakpoint
ALTER TABLE "repasses" ADD CONSTRAINT "repasses_comprovante_arquivo_id_arquivos_id_fk" FOREIGN KEY ("comprovante_arquivo_id") REFERENCES "public"."arquivos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repasses_um_antecipado_por_dia" ON "repasses" USING btree ("proprietario_id","data") WHERE "repasses"."estornado_em" is null and "repasses"."tipo" = 'antecipado';--> statement-breakpoint
CREATE UNIQUE INDEX "repasses_um_por_mes" ON "repasses" USING btree ("proprietario_id","mes") WHERE "repasses"."estornado_em" is null and "repasses"."tipo" = 'fechamento';