CREATE TABLE "execucoes_automacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"terminado_em" timestamp with time zone,
	"ok" boolean,
	"resumo" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "execucoes_automacao_nome" ON "execucoes_automacao" USING btree ("nome","iniciado_em");