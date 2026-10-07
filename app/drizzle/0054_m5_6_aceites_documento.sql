CREATE TABLE "aceites_documento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"documento" text NOT NULL,
	"versao" integer NOT NULL,
	"proprietario_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"aceito_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aceites_documento" ADD CONSTRAINT "aceites_documento_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aceites_documento" ADD CONSTRAINT "aceites_documento_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aceites_documento" ADD CONSTRAINT "aceites_documento_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aceites_documento_unico" ON "aceites_documento" USING btree ("documento","versao","proprietario_id","usuario_id");--> statement-breakpoint
CREATE INDEX "aceites_documento_proprietario" ON "aceites_documento" USING btree ("organizacao_id","proprietario_id");