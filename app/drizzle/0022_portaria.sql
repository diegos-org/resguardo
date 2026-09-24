CREATE TABLE "portaria_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"reserva_id" uuid NOT NULL,
	"aviso_inicial_em" date,
	"segundo_pedido_em" date,
	"pedido_final_em" date,
	"documentos_recebidos" integer DEFAULT 0 NOT NULL,
	"destinatario_conferido" boolean DEFAULT false NOT NULL,
	"encaminhado_em" date,
	"entrega_confirmada_em" date,
	"pendencia" text DEFAULT '' NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "portaria_checklists_reserva_id_unique" UNIQUE("reserva_id")
);
--> statement-breakpoint
ALTER TABLE "portaria_checklists" ADD CONSTRAINT "portaria_checklists_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portaria_checklists" ADD CONSTRAINT "portaria_checklists_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;