CREATE TABLE "contestacoes_adiantamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"adiantamento_id" uuid NOT NULL,
	"motivo" text NOT NULL,
	"aberta_em" timestamp with time zone DEFAULT now() NOT NULL,
	"resolvida_em" timestamp with time zone,
	"resolucao" text,
	"nota_resolucao" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quitacoes_adiantamento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"adiantamento_id" uuid NOT NULL,
	"forma" text NOT NULL,
	"valor" integer NOT NULL,
	"data" date NOT NULL,
	"lancamento_id" uuid,
	"contestacao_id" uuid,
	"nota" text DEFAULT '' NOT NULL,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"desfeita_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "contestacoes_adiantamento" ADD CONSTRAINT "contestacoes_adiantamento_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contestacoes_adiantamento" ADD CONSTRAINT "contestacoes_adiantamento_adiantamento_id_lancamentos_id_fk" FOREIGN KEY ("adiantamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quitacoes_adiantamento" ADD CONSTRAINT "quitacoes_adiantamento_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quitacoes_adiantamento" ADD CONSTRAINT "quitacoes_adiantamento_adiantamento_id_lancamentos_id_fk" FOREIGN KEY ("adiantamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quitacoes_adiantamento" ADD CONSTRAINT "quitacoes_adiantamento_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quitacoes_adiantamento" ADD CONSTRAINT "quitacoes_adiantamento_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contestacao_aberta_unica" ON "contestacoes_adiantamento" USING btree ("adiantamento_id") WHERE "contestacoes_adiantamento"."resolvida_em" is null;--> statement-breakpoint
CREATE INDEX "quitacoes_adiantamento_adiantamento" ON "quitacoes_adiantamento" USING btree ("adiantamento_id");