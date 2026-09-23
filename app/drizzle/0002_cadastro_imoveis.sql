ALTER TABLE "imoveis" ADD COLUMN "publico" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "ativo" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "bairro" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "cidade" text DEFAULT 'Rio de Janeiro' NOT NULL;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "endereco" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "fuso" text DEFAULT 'America/Sao_Paulo' NOT NULL;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "capacidade" integer;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "quartos" integer;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "banheiros" integer;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "descricao" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "imoveis" ADD COLUMN "atualizado_em" timestamp with time zone DEFAULT now() NOT NULL;