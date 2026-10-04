ALTER TABLE "repasses" ADD COLUMN "email_chave" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "repasses" ADD COLUMN "chave_pix_paga" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Correção da 0045 onde ela já rodou: um item ligado a um lançamento criado depois do fechamento não pode
-- existir (o valor do fechamento não o incluiu); a 0045 corrigida já não os cria. Só itens em vigor de fechamento.
DELETE FROM "repasse_itens"
WHERE "id" IN (
  SELECT i."id"
  FROM "repasse_itens" i
  JOIN "lancamentos" l ON l."id" = i."lancamento_id"
  JOIN "repasses" r ON r."id" = i."repasse_id"
  WHERE i."liberado_em" IS NULL AND r."tipo" = 'fechamento' AND l."criado_em" > r."criado_em"
);
