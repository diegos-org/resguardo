-- M4.10 (3ª rodada do Codex): os fechamentos feitos antes da tabela "repasse_itens" não têm item, e sem item
-- a parte de reserva que eles já pagaram voltaria a contar como "disponível" assim que o recebimento fosse
-- registrado. Cada parte de reserva em vigor (direito do proprietário, efeito no saldo positivo) ganha o item
-- do fechamento mais antigo, não estornado, cujo mês alcança a competência dela. Quem já tem item fica como está.
INSERT INTO "repasse_itens" ("organizacao_id", "repasse_id", "lancamento_id", "reserva_id", "imovel_id", "competencia", "valor")
SELECT DISTINCT ON (l."id") l."organizacao_id", r."id", l."id", l."reserva_id", l."imovel_id", l."competencia", l."valor"
FROM "lancamentos" l
JOIN "repasses" r
  ON r."organizacao_id" = l."organizacao_id"
 AND r."proprietario_id" = l."proprietario_id"
 AND r."estornado_em" IS NULL
 AND r."tipo" = 'fechamento'
 AND l."competencia" < (r."mes" + interval '1 month')::date
WHERE l."tipo" = 'direito_proprietario'
  AND l."estorno_de" IS NULL
  AND l."efeito_saldo" > 0
  AND l."reserva_id" IS NOT NULL
  AND l."imovel_id" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "lancamentos" e WHERE e."estorno_de" = l."id")
  AND NOT EXISTS (SELECT 1 FROM "repasse_itens" i WHERE i."lancamento_id" = l."id" AND i."liberado_em" IS NULL)
ORDER BY l."id", r."mes";
