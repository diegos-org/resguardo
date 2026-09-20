# Handoff — Sage → Rivers

Data: 20/09/2026. Rodada manual autorizada por Diego após entrega Lia, equivalente à janela Sage15h15 BRT.

## Estado

Código real já existe no Mac desta tarefa: outputs/scl-publico; checkpoint outputs/SCL-2.0-DOCUMENTO-MESTRE.md. Não está neste repositório. O workbench recebeu apenas coordenação. Nenhum merge, deploy ou integração de produção. Conector Sage retornou Unknown tool; leitura e escrita verificadas pelo navegador autenticado.

## Feito e verificado

- Protocolo, CURRENT, SAGE, DIEGO e handoff Lia2026-09-20-1415 lidos; histórico preservado.
- Galeria399 alinhada: principal e última miniatura terminam na mesma borda; são oito fotos totais, sem cópia para fingir nove.
- Demonstração local isolada de checkout, explicitamente fictícia, sem botão de pagamento ativo. Link: http://127.0.0.1:4173/demo/checkout?property=102&checkin=2026-10-10&checkout=2026-10-12&guests=2 . Loopback só funciona no Mac que roda o preview, não é preview remoto compartilhado.
- Total em centavos: duas noites ×42000 +18000 limpeza =102000. Revalidação fictícia muda diária para45000 e total108000, mostra valor anterior e exige revisão. Cenários de indisponibilidade, falha/UNKNOWN e expiração não permitem pagamento. Todos são cenários, não fatos do inventário.
- 22 testes passaram. Navegador verificou os cinco cenários e alinhamento da galeria. Nenhuma reserva ou cobrança criada. Duplicidade foi testada no recebimento de consulta local; prevenção de duplicidade de reserva/pagamento ainda é requisito, não código pronto.

## Contrato proposto do link

Usar somente origem aprovada + /consulta ou /imoveis/:code com property/checkin/checkout/guests. Datas ISO, ocupação inteira, imóvel conhecido. Sem PII, documento, contato, token, código de acesso ou valor autoritativo na URL. Backend valida critérios. Próxima implementação: quoteId opaco com total em centavos, linhas de taxas, política/versionamento e validade; revalidar preço/inventário antes de pagar; alteração exige aceite, desconhecido/indisponível/expirado bloqueiam. Tentativa idempotente, controle de inventário, webhooks assinados e compensação de falhas. Redirect do navegador não confirma pagamento. E-mail/portal nascem de estado confirmado. Contrato completo local em docs/checkout-link-contract.md.

## Decisões de Diego e agenda

Diego confirmou que este agente é Sage. Escolheu Mercado Pago nesta conversa anterior, ainda sem integração; reconciliar com a entrega Lia que o tratava como aberto. Bônus/20% continua ideia sem regras finais.

Automação scl-sage-construtor-rodada-de-engenharia criada e ACTIVE, cadência00/03/06/09/12/15/18/21h15 BRT. Atualizada para SEMPRE avisar Diego nesta conversa ao terminar, inclusive bloqueio, para ele acionar Rivers. Esta rodada manual substitui só a ocorrência equivalente15h15 se continuar redundante; novo handoff/trabalho distinto pode justificar execução. Próximos horários preservados. Agenda de Lia não foi alterada. Notificação no celular depende do app, não há envio WhatsApp automático.

## Sugestões para Rivers

1. Revisar contrato e limites da demonstração, reconciliando o estado real do site já pronto localmente.
2. Decidir próxima fatia pequena: cotação/inventário em homologação e modelo persistente canônico; não recomeçar o site.
3. Planejar entrada da base limpa neste workbench em branch/PR, sem caixa privada, mídia sem direitos revistos ou legado bruto. Sem conector funcional, não fingir que o código já foi compartilhado.

## Não fazer ainda

Sem cobrança, credenciais, produção, merge autônomo, bônus aprovado por inferência ou portal completo. Valores da demonstração não são tarifas. Código/email digitados não autenticam hóspede nem autorizam instruções de acesso.

## Diego

Sage terminou. Você pode chamar Rivers apontando para este handoff. O código e a demonstração são locais; para revisar a documentação compartilhada, este arquivo é suficiente. Não precisa fornecer dados pessoais nem pagar no teste.
