CREATE TABLE "ajustes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"data" date NOT NULL,
	"imovel_id" uuid,
	"reserva_id" uuid,
	"proprietario_id" uuid,
	"motivo" text DEFAULT '' NOT NULL,
	"origem" text DEFAULT 'desconhecida' NOT NULL,
	"origem_comprovada" boolean DEFAULT false NOT NULL,
	"evidencia" text DEFAULT '' NOT NULL,
	"comprovante" text DEFAULT '' NOT NULL,
	"valor" integer,
	"afeta" text DEFAULT 'empresa' NOT NULL,
	"direcao" text DEFAULT 'empresa_saida' NOT NULL,
	"esclarecido_em" timestamp with time zone,
	"lancamento_id" uuid,
	"criado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ajustes" ADD CONSTRAINT "ajustes_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes" ADD CONSTRAINT "ajustes_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes" ADD CONSTRAINT "ajustes_reserva_id_reservas_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reservas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes" ADD CONSTRAINT "ajustes_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes" ADD CONSTRAINT "ajustes_lancamento_id_lancamentos_id_fk" FOREIGN KEY ("lancamento_id") REFERENCES "public"."lancamentos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ajustes" ADD CONSTRAINT "ajustes_criado_por_usuarios_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ajustes_org_data" ON "ajustes" USING btree ("organizacao_id","data");