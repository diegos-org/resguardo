-- M4.10 (13ª rodada do Codex): complemento da 0045. Parte que estava em vigor quando um fechamento antigo (sem
-- itens) foi calculado — e portanto entrou no valor dele — mas que o motor recalculou depois: o lançamento
-- original foi estornado e um substituto (mesma reserva, proprietário e competência) nasceu depois do
-- fechamento. A 0045 não dá item a nenhum dos dois (o original está estornado; o substituto é posterior ao
-- fechamento), e o substituto voltaria a contar como "disponível" assim que o recebimento fosse registrado:
-- pago de novo. Aqui o substituto em vigor ganha o item do fechamento mais antigo que cobriu o original, com
-- o valor que aquele fechamento incluiu (o do original). A diferença de valor entre os dois já aparece no
-- acerto do mês ("o acerto até este mês mudou em…"), entra no próximo fechamento mensal e aparece no extrato do
-- proprietário ("Recalculada depois: … a mais entram no próximo fechamento mensal"). Lançamento criado depois do
-- fechamento sem original coberto continua livre (entrada atrasada, como na 0045). Idempotente.
WITH "cobertos" AS (
  SELECT r."id" AS "repasse_id", r."mes", r."criado_em" AS "fechado_em", o."organizacao_id", o."proprietario_id", o."reserva_id", o."competencia", o."valor"
  FROM "lancamentos" o
  JOIN "lancamentos" e ON e."estorno_de" = o."id"
  JOIN "repasses" r
    ON r."organizacao_id" = o."organizacao_id"
   AND r."proprietario_id" = o."proprietario_id"
   AND r."estornado_em" IS NULL
   AND r."tipo" = 'fechamento'
   AND o."competencia" < (r."mes" + interval '1 month')::date
   AND o."criado_em" <= r."criado_em"
   AND e."criado_em" > r."criado_em"
  WHERE o."tipo" = 'direito_proprietario'
    AND o."estorno_de" IS NULL
    AND o."efeito_saldo" > 0
    AND o."reserva_id" IS NOT NULL
)
INSERT INTO "repasse_itens" ("organizacao_id", "repasse_id", "lancamento_id", "reserva_id", "imovel_id", "competencia", "valor")
SELECT DISTINCT ON (l."id") l."organizacao_id", c."repasse_id", l."id", l."reserva_id", l."imovel_id", l."competencia", c."valor"
FROM "lancamentos" l
JOIN (
  SELECT "repasse_id", "mes", "fechado_em", "organizacao_id", "proprietario_id", "reserva_id", "competencia", sum("valor")::integer AS "valor"
  FROM "cobertos"
  GROUP BY "repasse_id", "mes", "fechado_em", "organizacao_id", "proprietario_id", "reserva_id", "competencia"
) c
  ON c."organizacao_id" = l."organizacao_id"
 AND c."proprietario_id" = l."proprietario_id"
 AND c."reserva_id" = l."reserva_id"
 AND c."competencia" = l."competencia"
 AND l."criado_em" > c."fechado_em"
WHERE l."tipo" = 'direito_proprietario'
  AND l."estorno_de" IS NULL
  AND l."efeito_saldo" > 0
  AND l."imovel_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "lancamentos" e WHERE e."estorno_de" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "repasse_itens" i WHERE i."lancamento_id" = l."id" AND i."liberado_em" IS NULL)
ORDER BY l."id", c."mes";
