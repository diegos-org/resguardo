CREATE TABLE "beds24_envio_imoveis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"envio_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "beds24_envio_imoveis" ADD CONSTRAINT "beds24_envio_imoveis_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_envio_imoveis" ADD CONSTRAINT "beds24_envio_imoveis_envio_id_beds24_envios_id_fk" FOREIGN KEY ("envio_id") REFERENCES "public"."beds24_envios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_envio_imoveis" ADD CONSTRAINT "beds24_envio_imoveis_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "beds24_envio_imoveis_imovel" ON "beds24_envio_imoveis" USING btree ("organizacao_id","imovel_id");--> statement-breakpoint
CREATE INDEX "beds24_envio_imoveis_envio" ON "beds24_envio_imoveis" USING btree ("envio_id");