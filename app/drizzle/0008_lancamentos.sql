CREATE TYPE "public"."estado_lancamento" AS ENUM('previsto', 'realizado', 'conciliado', 'pendente');--> statement-breakpoint
CREATE TYPE "public"."tipo_lancamento" AS ENUM('receita_bruta', 'taxa_canal', 'comissao', 'direito_proprietario', 'recebimento', 'repasse', 'despesa_empresa', 'despesa_proprietario', 'adiantamento', 'reembolso', 'ajuste');--> statement-breakpoint
CREATE TABLE "lancamentos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid,
	"proprietario_id" uuid,
	"reserva_id" uuid,
	"tipo" "tipo_lancamento" NOT NULL,
	"descricao" text NOT NULL,
	"valor" integer NOT NULL,
	"efeito_saldo" integer DEFAULT 0 NOT NULL,
	"competencia" date NOT NULL,
	"data_caixa" date,
	"estado" "estado_lancamento" DEFAULT 'previsto' NOT NULL,
	"origem" text DEFAULT 'manual' NOT NULL,
	"chave_origem" text DEFAULT '' NOT NULL,
	"estorno_de" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lancamentos" ADD CONSTRAINT "lancamentos_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lancamentos_chave_origem" ON "lancamentos" USING btree ("organizacao_id","chave_origem") WHERE "lancamentos"."chave_origem" <> '';--> statement-breakpoint
CREATE UNIQUE INDEX "lancamentos_estorno_unico" ON "lancamentos" USING btree ("estorno_de") WHERE "lancamentos"."estorno_de" is not null;--> statement-breakpoint
CREATE INDEX "lancamentos_competencia" ON "lancamentos" USING btree ("organizacao_id","competencia");--> statement-breakpoint
CREATE INDEX "lancamentos_proprietario" ON "lancamentos" USING btree ("proprietario_id","competencia");--> statement-breakpoint
CREATE INDEX "lancamentos_reserva" ON "lancamentos" USING btree ("reserva_id");