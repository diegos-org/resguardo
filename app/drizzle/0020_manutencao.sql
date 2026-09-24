CREATE TABLE "manutencoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"estado" text DEFAULT 'pedida' NOT NULL,
	"fornecedor" text DEFAULT '' NOT NULL,
	"orcamento" integer,
	"responsavel" text,
	"proprietario_id" uuid,
	"aprovada_por" uuid,
	"aprovada_em" timestamp with time zone,
	"data_realizada" date,
	"despesa_id" uuid,
	"observacao" text DEFAULT '' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "manutencoes" ADD CONSTRAINT "manutencoes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manutencoes" ADD CONSTRAINT "manutencoes_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manutencoes" ADD CONSTRAINT "manutencoes_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manutencoes" ADD CONSTRAINT "manutencoes_aprovada_por_usuarios_id_fk" FOREIGN KEY ("aprovada_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manutencoes" ADD CONSTRAINT "manutencoes_despesa_id_lancamentos_id_fk" FOREIGN KEY ("despesa_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manutencoes" ADD CONSTRAINT "manutencoes_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "manutencoes_org_estado" ON "manutencoes" USING btree ("organizacao_id","estado");--> statement-breakpoint
CREATE INDEX "manutencoes_imovel" ON "manutencoes" USING btree ("imovel_id");