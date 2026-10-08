CREATE TABLE "pedidos_contato_proprietario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"email" text NOT NULL,
	"telefone" text NOT NULL,
	"bairro" text NOT NULL,
	"cidade" text NOT NULL,
	"quartos" integer,
	"anuncia_hoje" boolean,
	"mensagem" text DEFAULT '' NOT NULL,
	"situacao" text DEFAULT 'novo' NOT NULL,
	"nota" text DEFAULT '' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"decidido_em" timestamp with time zone,
	"decidido_por" uuid
);
--> statement-breakpoint
ALTER TABLE "pedidos_contato_proprietario" ADD CONSTRAINT "pedidos_contato_proprietario_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pedidos_contato_proprietario" ADD CONSTRAINT "pedidos_contato_proprietario_decidido_por_usuarios_id_fk" FOREIGN KEY ("decidido_por") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pedidos_contato_proprietario_org" ON "pedidos_contato_proprietario" USING btree ("organizacao_id","situacao","criado_em");