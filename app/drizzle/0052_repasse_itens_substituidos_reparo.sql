-- M4.10 (17ª rodada do Codex): fecha a série 0049–0051 recalculando, para TODO substituto (parte em vigor criada depois
-- do primeiro fechamento antigo que cobriu um original da reserva), a ligação ideal — e consertando a existente:
-- 1) Substituto criado entre dois fechamentos antigos: a 0045 o ligou ao fechamento posterior (ele já existia quando
--    esse foi calculado), mas quem pagou aquele direito foi o anterior; se o posterior for estornado, o item solta e a
--    parte voltaria a ser paga. Aqui o item passa para o fechamento cuja faixa de cobertura alcança o substituto.
-- 2) Recálculo para menos em outro mês: a 0050 gravou no item o valor menor (LEAST), e a diferença sumia. Aqui o item
--    carrega o valor coberto: o último substituto da reserva absorve o excedente, para a soma dos itens ser o coberto.
-- Faixas por fechamento (cada original conta uma vez, no fechamento mais antigo que o alcançou) consumidas em ordem de
-- competência por todos os substitutos, com ou sem item. Item de fechamento diferente do ideal é atualizado; item de
-- antecipado nunca é tocado; substituto além do coberto fica como está. Idempotente; anteriores não editadas.
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
"substitutos" AS (
  SELECT l."id", l."organizacao_id", l."proprietario_id", l."reserva_id", l."imovel_id", l."competencia", l."valor", t."coberto_total",
    coalesce(sum(l."valor") OVER (PARTITION BY l."reserva_id", l."proprietario_id" ORDER BY l."competencia", l."id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS "inicio",
    row_number() OVER (PARTITION BY l."reserva_id", l."proprietario_id" ORDER BY l."competencia" DESC, l."id" DESC) AS "do_fim",
    i."id" AS "item_id", ri."tipo" AS "item_tipo"
  FROM "lancamentos" l
  JOIN "totais" t
    ON t."organizacao_id" = l."organizacao_id"
   AND t."proprietario_id" = l."proprietario_id"
   AND t."reserva_id" = l."reserva_id"
   AND l."criado_em" > t."primeiro_fechamento"
  LEFT JOIN "repasse_itens" i ON i."lancamento_id" = l."id" AND i."liberado_em" IS NULL
  LEFT JOIN "repasses" ri ON ri."id" = i."repasse_id"
  WHERE l."tipo" = 'direito_proprietario'
    AND l."estorno_de" IS NULL
    AND l."efeito_saldo" > 0
    AND l."imovel_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "lancamentos" e WHERE e."estorno_de" = l."id")
),
"ideal" AS (
  SELECT s.*, f."repasse_id" AS "repasse_ideal",
    CASE WHEN s."do_fim" = 1 THEN s."coberto_total" - s."inicio" ELSE LEAST(s."valor", s."coberto_total" - s."inicio") END AS "valor_ideal"
  FROM "substitutos" s
  JOIN "faixas" f
    ON f."reserva_id" = s."reserva_id"
   AND f."proprietario_id" = s."proprietario_id"
   AND f."inicio" <= s."inicio"
   AND s."inicio" < f."inicio" + f."coberto"
  WHERE s."coberto_total" - s."inicio" > 0
),
"corrigidos" AS (
  UPDATE "repasse_itens" i
  SET "repasse_id" = d."repasse_ideal", "valor" = d."valor_ideal"
  FROM "ideal" d
  WHERE i."id" = d."item_id"
    AND d."item_tipo" = 'fechamento'
    AND (i."repasse_id" <> d."repasse_ideal" OR i."valor" <> d."valor_ideal")
  RETURNING i."id"
)
INSERT INTO "repasse_itens" ("organizacao_id", "repasse_id", "lancamento_id", "reserva_id", "imovel_id", "competencia", "valor")
SELECT d."organizacao_id", d."repasse_ideal", d."id", d."reserva_id", d."imovel_id", d."competencia", d."valor_ideal"
FROM "ideal" d
WHERE d."item_id" IS NULL;
