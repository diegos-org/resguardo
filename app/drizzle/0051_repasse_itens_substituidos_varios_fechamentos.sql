-- M4.10 (16ª rodada do Codex): fecha a 0049/0050. Quando uma reserva de vários meses foi coberta por fechamentos
-- antigos diferentes e o recálculo criou vários substitutos, a 0050 distribuía por fechamento, cada um partindo do
-- primeiro substituto — o segundo podia ficar sem item e voltar a ser pago. Aqui a distribuição é global por reserva
-- e proprietário: cada original coberto conta uma vez só, no fechamento mais antigo que o alcançou (como na 0045);
-- os fechamentos formam faixas em ordem de mês e os substitutos em vigor (criados depois do primeiro desses
-- fechamentos, sem item) consomem essas faixas em ordem de competência. O substituto fica ligado ao fechamento em
-- que a faixa dele começa, com o valor coberto total que lhe cabe; o que a 0049/0050 já ligou é descontado antes.
-- Substituto além do coberto continua livre. Idempotente; as anteriores não são editadas porque já rodaram.
WITH "originais" AS (
  SELECT DISTINCT ON (o."id") o."id", o."organizacao_id", o."proprietario_id", o."reserva_id", o."valor", r."id" AS "repasse_id", r."mes", r."criado_em" AS "fechado_em"
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
  ORDER BY o."id", r."mes"
),
"cobertos" AS (
  SELECT "repasse_id", "mes", "fechado_em", "organizacao_id", "proprietario_id", "reserva_id", sum("valor")::integer AS "coberto"
  FROM "originais"
  GROUP BY "repasse_id", "mes", "fechado_em", "organizacao_id", "proprietario_id", "reserva_id"
),
"faixas" AS (
  SELECT c.*, coalesce(sum(c."coberto") OVER (PARTITION BY c."reserva_id", c."proprietario_id" ORDER BY c."mes", c."repasse_id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS "inicio"
  FROM "cobertos" c
),
"totais" AS (
  SELECT "organizacao_id", "proprietario_id", "reserva_id", min("fechado_em") AS "primeiro_fechamento", sum("coberto")::integer AS "coberto_total"
  FROM "cobertos"
  GROUP BY "organizacao_id", "proprietario_id", "reserva_id"
),
"alocado" AS (
  SELECT i."reserva_id", l."proprietario_id", sum(i."valor")::integer AS "ja"
  FROM "repasse_itens" i
  JOIN "lancamentos" l ON l."id" = i."lancamento_id"
  JOIN "totais" t ON t."reserva_id" = i."reserva_id" AND t."proprietario_id" = l."proprietario_id"
  WHERE i."liberado_em" IS NULL
    AND l."criado_em" > t."primeiro_fechamento"
  GROUP BY i."reserva_id", l."proprietario_id"
),
"substitutos" AS (
  SELECT l."id", l."organizacao_id", l."proprietario_id", l."reserva_id", l."imovel_id", l."competencia", l."valor", t."coberto_total",
    coalesce(a."ja", 0) + coalesce(sum(l."valor") OVER (PARTITION BY l."reserva_id", l."proprietario_id" ORDER BY l."competencia", l."id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS "inicio"
  FROM "lancamentos" l
  JOIN "totais" t
    ON t."organizacao_id" = l."organizacao_id"
   AND t."proprietario_id" = l."proprietario_id"
   AND t."reserva_id" = l."reserva_id"
   AND l."criado_em" > t."primeiro_fechamento"
  LEFT JOIN "alocado" a ON a."reserva_id" = l."reserva_id" AND a."proprietario_id" = l."proprietario_id"
  WHERE l."tipo" = 'direito_proprietario'
    AND l."estorno_de" IS NULL
    AND l."efeito_saldo" > 0
    AND l."imovel_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "lancamentos" e WHERE e."estorno_de" = l."id")
    AND NOT EXISTS (SELECT 1 FROM "repasse_itens" i WHERE i."lancamento_id" = l."id" AND i."liberado_em" IS NULL)
)
INSERT INTO "repasse_itens" ("organizacao_id", "repasse_id", "lancamento_id", "reserva_id", "imovel_id", "competencia", "valor")
SELECT DISTINCT ON (s."id") s."organizacao_id", f."repasse_id", s."id", s."reserva_id", s."imovel_id", s."competencia", LEAST(s."valor", s."coberto_total" - s."inicio")
FROM "substitutos" s
JOIN "faixas" f
  ON f."reserva_id" = s."reserva_id"
 AND f."proprietario_id" = s."proprietario_id"
 AND f."inicio" <= s."inicio"
 AND s."inicio" < f."inicio" + f."coberto"
WHERE s."coberto_total" - s."inicio" > 0
ORDER BY s."id", f."mes";
