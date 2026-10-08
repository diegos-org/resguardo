CREATE TABLE "tentativas_login" (
	"chave" text PRIMARY KEY NOT NULL,
	"erros" integer DEFAULT 0 NOT NULL,
	"bloqueado_ate" timestamp with time zone,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "usuarios_email_unico";--> statement-breakpoint
ALTER TABLE "profissionais_limpeza" ADD COLUMN "cidades" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "login" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "senha_hash" text;--> statement-breakpoint
ALTER TABLE "usuarios" ADD COLUMN "senha_provisoria" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_login_unico" ON "usuarios" USING btree ("login");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_unico" ON "usuarios" USING btree (lower("email")) WHERE "usuarios"."email" <> '';