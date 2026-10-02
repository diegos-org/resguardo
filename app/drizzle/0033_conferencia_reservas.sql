ALTER TYPE "public"."estado_reserva" ADD VALUE 'consulta';--> statement-breakpoint
ALTER TYPE "public"."estado_reserva" ADD VALUE 'pedido';--> statement-breakpoint
CREATE TABLE "beds24_execucao_reservas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"execucao_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"tipo" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reservas" ADD COLUMN "reservada_em" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "beds24_execucao_reservas" ADD CONSTRAINT "beds24_execucao_reservas_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_execucao_reservas" ADD CONSTRAINT "beds24_execucao_reservas_execucao_id_beds24_execucoes_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."beds24_execucoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beds24_execucao_reservas" ADD CONSTRAINT "beds24_execucao_reservas_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "beds24_execucao_reserva_unica" ON "beds24_execucao_reservas" USING btree ("execucao_id","reserva_id");--> statement-breakpoint
CREATE INDEX "beds24_execucao_reservas_org" ON "beds24_execucao_reservas" USING btree ("organizacao_id","execucao_id");