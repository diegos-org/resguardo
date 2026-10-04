-- M4.10 (15ª rodada do Codex): generaliza a 0049, que exigia a mesma competência entre o original coberto por um
-- fechamento antigo e o substituto criado pelo recálculo. Quando a correção da reserva muda o mês das noites, o
-- substituto nasce em outra competência e ficava solto — disponível de novo depois do recebimento, embora o
-- fechamento já tivesse pago aquele direito. Aqui o valor coberto pelo fechamento (originais em vigor quando ele
-- foi calculado, estornados depois dele) é distribuído, por reserva e proprietário, entre os substitutos em vigor
-- criados depois do fechamento, em ordem de competência, até esgotar; o que a 0049 (ou uma rodada anterior desta)
-- já ligou é descontado. Substituto que não recebe nada continua livre. Idempotente; a 0049 não é editada
-- porque já rodou.
WITH "cobertos" AS (
  SELECT r."id" AS "repasse_id", r."mes", r."criado_em" AS "fechado_em", o."organizacao_id", o."proprietario_id", o."reserva_id", sum(o."valor")::integer AS "coberto"
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
  GROUP BY r."id", r."mes", r."criado_em", o."organizacao_id", o."proprietario_id", o."reserva_id"
),
"alocado" AS (
  SELECT i."repasse_id", i."reserva_id", sum(i."valor")::integer AS "ja"
  FROM "repasse_itens" i
  JOIN "lancamentos" l ON l."id" = i."lancamento_id"
  JOIN "repasses" r ON r."id" = i."repasse_id"
  WHERE i."liberado_em" IS NULL
    AND l."criado_em" > r."criado_em"
  GROUP BY i."repasse_id", i."reserva_id"
),
"substitutos" AS (
  SELECT l."id", l."organizacao_id", l."reserva_id", l."imovel_id", l."competencia", l."valor", c."repasse_id", c."mes",
    c."coberto" - coalesce(a."ja", 0) AS "restante",
    coalesce(sum(l."valor") OVER (PARTITION BY c."repasse_id", l."reserva_id" ORDER BY l."competencia", l."id" ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS "antes"
  FROM "lancamentos" l
  JOIN "cobertos" c
    ON c."organizacao_id" = l."organizacao_id"
   AND c."proprietario_id" = l."proprietario_id"
   AND c."reserva_id" = l."reserva_id"
   AND l."criado_em" > c."fechado_em"
  LEFT JOIN "alocado" a ON a."repasse_id" = c."repasse_id" AND a."reserva_id" = c."reserva_id"
  WHERE l."tipo" = 'direito_proprietario'
    AND l."estorno_de" IS NULL
    AND l."efeito_saldo" > 0
    AND l."imovel_id" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "lancamentos" e WHERE e."estorno_de" = l."id")
    AND NOT EXISTS (SELECT 1 FROM "repasse_itens" i WHERE i."lancamento_id" = l."id" AND i."liberado_em" IS NULL)
)
INSERT INTO "repasse_itens" ("organizacao_id", "repasse_id", "lancamento_id", "reserva_id", "imovel_id", "competencia", "valor")
SELECT DISTINCT ON (s."id") s."organizacao_id", s."repasse_id", s."id", s."reserva_id", s."imovel_id", s."competencia", LEAST(s."valor", s."restante" - s."antes")
FROM "substitutos" s
WHERE s."restante" - s."antes" > 0
ORDER BY s."id", s."mes";
