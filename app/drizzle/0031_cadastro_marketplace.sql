CREATE TABLE "cadastros_marketplace" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"tipo" "tipo_pessoa" DEFAULT 'fisica' NOT NULL,
	"telefone" text NOT NULL,
	"imovel" jsonb NOT NULL,
	"anuncio" text NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"situacao" text DEFAULT 'pendente' NOT NULL,
	"motivo_recusa" text DEFAULT '' NOT NULL,
	"decidido_em" timestamp with time zone,
	"decidido_por" uuid,
	"proprietario_id" uuid,
	"imovel_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cadastros_marketplace" ADD CONSTRAINT "cadastros_marketplace_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadastros_marketplace" ADD CONSTRAINT "cadastros_marketplace_decidido_por_usuarios_id_fk" FOREIGN KEY ("decidido_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadastros_marketplace" ADD CONSTRAINT "cadastros_marketplace_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cadastros_marketplace" ADD CONSTRAINT "cadastros_marketplace_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cadastros_marketplace_org" ON "cadastros_marketplace" USING btree ("organizacao_id","situacao","criado_em");--> statement-breakpoint
CREATE INDEX "cadastros_marketplace_email" ON "cadastros_marketplace" USING btree ("email");