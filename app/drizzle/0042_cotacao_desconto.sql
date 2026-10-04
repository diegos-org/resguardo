ALTER TABLE "cotacoes" ADD COLUMN "valor_cheio" integer;--> statement-breakpoint
UPDATE "cotacoes" SET "valor_cheio" = "total";--> statement-breakpoint
ALTER TABLE "cotacoes" ALTER COLUMN "valor_cheio" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "cotacoes" ADD COLUMN "desconto" integer DEFAULT 0 NOT NULL;
