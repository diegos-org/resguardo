-- M7.14 (registro da autorização dos proprietários nos formulários de "Anuncie seu imóvel"). Idempotente como a 0067 a
-- 0069: o banco das prévias é compartilhado e as migrações entram por hash, então rodar estas instruções de novo não pode
-- falhar nem mudar nada. No pedido de contato e no cadastro do marketplace: quando o envio com a caixa marcada chegou ao
-- servidor, a versão e o texto exato dela (os três juntos ou nenhum). Os envios de antes ficam sem nenhum dos três: nada é
-- preenchido com palpite.
ALTER TABLE "cadastros_marketplace" ADD COLUMN IF NOT EXISTS "autorizado_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "cadastros_marketplace" ADD COLUMN IF NOT EXISTS "autorizacao_versao" integer;
--> statement-breakpoint
ALTER TABLE "cadastros_marketplace" ADD COLUMN IF NOT EXISTS "autorizacao_texto" text;
--> statement-breakpoint
ALTER TABLE "pedidos_contato_proprietario" ADD COLUMN IF NOT EXISTS "autorizado_em" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "pedidos_contato_proprietario" ADD COLUMN IF NOT EXISTS "autorizacao_versao" integer;
--> statement-breakpoint
ALTER TABLE "pedidos_contato_proprietario" ADD COLUMN IF NOT EXISTS "autorizacao_texto" text;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cadastros_marketplace_autorizacao') THEN
		ALTER TABLE "cadastros_marketplace" ADD CONSTRAINT "cadastros_marketplace_autorizacao" CHECK (("cadastros_marketplace"."autorizado_em" is null and "cadastros_marketplace"."autorizacao_versao" is null and "cadastros_marketplace"."autorizacao_texto" is null) or ("cadastros_marketplace"."autorizado_em" is not null and "cadastros_marketplace"."autorizacao_versao" is not null and "cadastros_marketplace"."autorizacao_texto" is not null and "cadastros_marketplace"."autorizacao_versao" > 0 and "cadastros_marketplace"."autorizacao_texto" <> ''));
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pedidos_contato_proprietario_autorizacao') THEN
		ALTER TABLE "pedidos_contato_proprietario" ADD CONSTRAINT "pedidos_contato_proprietario_autorizacao" CHECK (("pedidos_contato_proprietario"."autorizado_em" is null and "pedidos_contato_proprietario"."autorizacao_versao" is null and "pedidos_contato_proprietario"."autorizacao_texto" is null) or ("pedidos_contato_proprietario"."autorizado_em" is not null and "pedidos_contato_proprietario"."autorizacao_versao" is not null and "pedidos_contato_proprietario"."autorizacao_texto" is not null and "pedidos_contato_proprietario"."autorizacao_versao" > 0 and "pedidos_contato_proprietario"."autorizacao_texto" <> ''));
	END IF;
END $$;
