# Contrato proposto — link de estadia da Lia

Rodada Sage, 20/09/2026, após handoff Lia. Não é contrato comercial nem integração ativa.

## Links públicos existentes

`/consulta?property=102&checkin=2026-10-10&checkout=2026-10-12&guests=2`

`/imoveis/102?checkin=2026-10-10&checkout=2026-10-12&guests=2`

Usar origem SCL aprovada, caminho permitido e query construída com URLSearchParams. Código público de imóvel deve corresponder a registro ativo; datas ISO e ocupação inteira. Nunca incluir nome, e-mail, telefone, documentos, código de porta, token, preço autoritativo ou status de pagamento. Backend revalida parâmetros; total fornecido por cliente não altera valores. O link não reserva inventário.

## Próximo contrato operacional, ainda não implementado

1. Backend emite quoteId opaco vinculado a organização/imóvel/datas/hóspedes, moeda, valores em centavos, linhas de taxas, versão de políticas e expiresAt.
2. Antes de pagar, revalidar quoteId e inventário. Preço alterado requer revisão explícita; indisponível, desconhecido e expirado bloqueiam pagamento. Totais sempre calculados no servidor, nunca por parâmetros da URL.
3. Criar tentativa idempotente e retenção de inventário conforme política. Reenvio não cria nova reserva/cobrança. Tratar conflito, expiração, falha parcial e restituição por estados auditáveis.
4. Confirmar somente após fatos verificados de pagamento e inventário; redirect do navegador não é prova de sucesso. Webhooks assinados e deduplicados. Não prometer atomicidade entre sistemas externos sem estratégia de compensação.
5. E-mail/outbox, código de reserva e portal derivam do estado canônico confirmado. Consulta usa protocolo SCL-Q separado; código/e-mail digitados não autenticam.

## Demonstração local desta rodada

`/demo/checkout?property=102&checkin=2026-10-10&checkout=2026-10-12&guests=2`

Rota isolada, sem link no menu público. Valores inventados: 42000 centavos/noite, limpeza 18000, total de duas noites 102000. Cenário de preço alterado usa 45000/noite e total108000. Cenários: quote, price_changed, unavailable, unknown, expired. Todos mantêm canPay=false. Expiração é cenário simulado, não relógio operacional de cotação. Não chamar essa demonstração de integração Beds24 ou Mercado Pago.

22 testes passaram no conjunto do projeto; três novos verificam totais inteiros, parâmetros manipulados sem autoridade, estados de revalidação e validação de capacidade/datas. Navegador verificou os cinco cenários. Duplicidade está testada na consulta local; reserva/pagamento idempotentes ainda são requisitos, não implementação.

Mercado Pago já escolhido por Diego na conversa de construção; pendente configuração. Bônus/indicação sem regras aprovadas. Não publicar demo como oferta real.
