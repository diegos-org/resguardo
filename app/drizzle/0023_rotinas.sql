CREATE TABLE "rotina_execucoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"rotina_id" uuid NOT NULL,
	"prevista" date NOT NULL,
	"feita_em" date NOT NULL,
	"pulada" boolean DEFAULT false NOT NULL,
	"observacao" text DEFAULT '' NOT NULL,
	"usuario_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rotinas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"titulo" text NOT NULL,
	"descricao" text DEFAULT '' NOT NULL,
	"frequencia" text NOT NULL,
	"proxima_data" date NOT NULL,
	"ativa" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rotina_execucoes" ADD CONSTRAINT "rotina_execucoes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotina_execucoes" ADD CONSTRAINT "rotina_execucoes_rotina_id_rotinas_id_fk" FOREIGN KEY ("rotina_id") REFERENCES "public"."rotinas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotina_execucoes" ADD CONSTRAINT "rotina_execucoes_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rotinas" ADD CONSTRAINT "rotinas_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rotina_execucoes_prevista" ON "rotina_execucoes" USING btree ("rotina_id","prevista");--> statement-breakpoint
CREATE INDEX "rotinas_org_ativa" ON "rotinas" USING btree ("organizacao_id","ativa");