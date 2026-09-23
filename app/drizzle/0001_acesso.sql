CREATE TYPE "public"."papel" AS ENUM('admin', 'operacao', 'proprietario', 'hospede');--> statement-breakpoint
CREATE TABLE "imoveis" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"codigo" text NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizacoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proprietario_imoveis" (
	"proprietario_id" uuid NOT NULL,
	"imovel_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proprietario_imoveis_proprietario_id_imovel_id_pk" PRIMARY KEY("proprietario_id","imovel_id")
);
--> statement-breakpoint
CREATE TABLE "proprietario_usuarios" (
	"proprietario_id" uuid NOT NULL,
	"usuario_id" uuid NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "proprietario_usuarios_proprietario_id_usuario_id_pk" PRIMARY KEY("proprietario_id","usuario_id")
);
--> statement-breakpoint
CREATE TABLE "proprietarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organizacao_id" uuid NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"papel" "papel" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "imoveis" ADD CONSTRAINT "imoveis_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proprietario_imoveis" ADD CONSTRAINT "proprietario_imoveis_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proprietario_imoveis" ADD CONSTRAINT "proprietario_imoveis_imovel_id_imoveis_id_fk" FOREIGN KEY ("imovel_id") REFERENCES "public"."imoveis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proprietario_usuarios" ADD CONSTRAINT "proprietario_usuarios_proprietario_id_proprietarios_id_fk" FOREIGN KEY ("proprietario_id") REFERENCES "public"."proprietarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proprietario_usuarios" ADD CONSTRAINT "proprietario_usuarios_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proprietarios" ADD CONSTRAINT "proprietarios_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_organizacao_id_organizacoes_id_fk" FOREIGN KEY ("organizacao_id") REFERENCES "public"."organizacoes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "imoveis_codigo_por_org" ON "imoveis" USING btree ("organizacao_id","codigo");--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_unico" ON "usuarios" USING btree (lower("email"));