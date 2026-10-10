CREATE TABLE "aceites_site" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"cotacao_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"versao_termos" integer NOT NULL,
	"versao_privacidade" integer NOT NULL,
	"versao_cancelamento" integer NOT NULL,
	"origem" text NOT NULL,
	"aceito_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pagamentos" ADD COLUMN "aceite_id" uuid;--> statement-breakpoint
ALTER TABLE "aceites_site" ADD CONSTRAINT "aceites_site_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aceites_site" ADD CONSTRAINT "aceites_site_cotacao_id_cotacoes_id_fk" FOREIGN KEY ("cotacao_id") REFERENCES "public"."cotacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aceites_site" ADD CONSTRAINT "aceites_site_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "aceites_site_unico" ON "aceites_site" USING btree ("cotacao_id","versao_termos","versao_privacidade","versao_cancelamento");--> statement-breakpoint
CREATE INDEX "aceites_site_reserva" ON "aceites_site" USING btree ("reserva_id");--> statement-breakpoint
CREATE INDEX "aceites_site_organizacao" ON "aceites_site" USING btree ("organizacao_id","aceito_em");--> statement-breakpoint
ALTER TABLE "pagamentos" ADD CONSTRAINT "pagamentos_aceite_id_aceites_site_id_fk" FOREIGN KEY ("aceite_id") REFERENCES "public"."aceites_site"("id") ON DELETE no action ON UPDATE no action;