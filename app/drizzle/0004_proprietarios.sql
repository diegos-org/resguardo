CREATE TYPE "public"."tipo_pessoa" AS ENUM('fisica', 'juridica');--> statement-breakpoint
CREATE TABLE "representantes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proprietario_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"relacao" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"telefone" text DEFAULT '' NOT NULL,
	"recebe_relatorios" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "tipo" "tipo_pessoa" DEFAULT 'fisica' NOT NULL;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "documento" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "email" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "telefone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "endereco" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "chave_pix" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "observacoes" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "ativo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD COLUMN "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "representantes" ADD CONSTRAINT "representantes_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE cascade ON UPDATE no action;