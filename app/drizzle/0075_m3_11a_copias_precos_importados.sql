-- M3.11a (cópia datada da leitura do Beds24 e preço importado por noite; desenho em requisitos/product/FONTE-UNICA-PRECOS.md,
-- 3.1 e 3.2). Idempotente como a 0067 a 0074: o banco das prévias é compartilhado e as migrações entram por hash, então rodar
-- estas instruções de novo não pode falhar nem mudar nada. Cria as cópias da leitura (`beds24_calendario_copias`, só inclusão:
-- a ordem de gravação, quarto, motivo, quem, quando, a hora da leitura, o número de noites, a assinatura e as noites em JSON)
-- e a camada do preço importado (`precos_importados`: uma noite por imóvel, preço maior que zero, mínimo de 1 a 365 ou nulo,
-- a cópia de origem).
-- Nenhuma linha é criada aqui e nada é escrito no Beds24; só preço, mínimo, máximo, unidades e bloqueio, sem dado pessoal.
-- Mudar este arquivo depois do primeiro push com prévia: só acrescentando `ADD COLUMN IF NOT EXISTS` (o
-- `CREATE TABLE IF NOT EXISTS` não acrescenta coluna a uma tabela que já existe).
CREATE TABLE IF NOT EXISTS "beds24_calendario_copias" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ordem" integer GENERATED ALWAYS AS IDENTITY (sequence name "beds24_calendario_copias_ordem_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"room_id" text,
	"motivo" text NOT NULL,
	"autor_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"lido_em" timestamp with time zone NOT NULL,
	"noites" integer NOT NULL,
	"assinatura" text NOT NULL,
	"dados" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "precos_importados" (
	"organizacao_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"data" date NOT NULL,
	"preco" integer NOT NULL,
	"minimo_noites" integer,
	"copia_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"autor_id" uuid,
	CONSTRAINT "precos_importados_organizacao_id_imovel_id_data_pk" PRIMARY KEY("organizacao_id","imovel_id","data")
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_calendario_copias_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "beds24_calendario_copias" ADD CONSTRAINT "beds24_calendario_copias_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_calendario_copias_imovel_id_imoveis_id_fk') THEN
		ALTER TABLE "beds24_calendario_copias" ADD CONSTRAINT "beds24_calendario_copias_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_calendario_copias_autor_id_usuarios_id_fk') THEN
		ALTER TABLE "beds24_calendario_copias" ADD CONSTRAINT "beds24_calendario_copias_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precos_importados_organizacao_id_organizacoes_id_fk') THEN
		ALTER TABLE "precos_importados" ADD CONSTRAINT "precos_importados_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precos_importados_imovel_id_imoveis_id_fk') THEN
		ALTER TABLE "precos_importados" ADD CONSTRAINT "precos_importados_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precos_importados_copia_id_beds24_calendario_copias_id_fk') THEN
		ALTER TABLE "precos_importados" ADD CONSTRAINT "precos_importados_copia_id_beds24_calendario_copias_id_fk" FOREIGN KEY ("copia_id") REFERENCES "public"."beds24_calendario_copias"("id") ON DELETE no action ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precos_importados_autor_id_usuarios_id_fk') THEN
		ALTER TABLE "precos_importados" ADD CONSTRAINT "precos_importados_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'beds24_calendario_copias_noites') THEN
		ALTER TABLE "beds24_calendario_copias" ADD CONSTRAINT "beds24_calendario_copias_noites" CHECK ("beds24_calendario_copias"."noites" > 0);
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precos_importados_preco') THEN
		ALTER TABLE "precos_importados" ADD CONSTRAINT "precos_importados_preco" CHECK ("precos_importados"."preco" > 0);
	END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precos_importados_minimo') THEN
		ALTER TABLE "precos_importados" ADD CONSTRAINT "precos_importados_minimo" CHECK ("precos_importados"."minimo_noites" is null or ("precos_importados"."minimo_noites" between 1 and 365));
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "beds24_calendario_copias_imovel" ON "beds24_calendario_copias" USING btree ("organizacao_id","imovel_id","ordem");
