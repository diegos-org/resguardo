# Financeiro, portais e conciliação — decisões de Diego em 21/09/2026

Estado: requisitos registrados, não implementados. Complementa [relatórios de proprietários](RELATORIOS-PROPRIETARIOS.md), preservando o modelo da Lia. Valores abaixo são exemplos ilustrativos, sem dados reais. Código financeiro legado não deve ser copiado: Diego relata divergências recorrentes entre telas e fechamento.

## Uma base financeira, várias visões
Portal do proprietário, aba Apartamentos, dashboard e PDFs devem consultar o mesmo ledger reconciliado e regras versionadas. Separar valor bruto da reserva, taxas do canal, líquido, comissão SCL, direito do proprietário, recebimentos efetivos, adiantamentos e liquidações. Não somar passagem de dinheiro como receita própria. Dinheiro em centavos inteiros; arredondamento, base da comissão e competência ainda exigem definição/testes.
Distinguir previsto, realizado, parcial, conciliado e pendente; reserva futura não é recebimento confirmado. Extratos oficiais e eventos de pagamento fundamentam fatos financeiros; Beds24 distribui/recebe eventos conforme capacidades comprovadas. Não assumir que Airbnb/Booking enviam todos os ajustes financeiros ao Beds24.

## Ajustes e explicações
Ao encontrar diferença: conferir fontes e perguntar a Diego antes de encerrar a investigação. Ele pode reconhecer o caso ou consultar a conversa da estadia. Registrar ocorrência extraordinária no próprio dia, vinculada a reserva/imóvel e comprovante privado quando houver, para evitar depender da memória no fechamento.
Se explicação permanecer desconhecida, usar descrição genérica verdadeira: “Ajuste de reserva — motivo não identificado”; “feito pelo Airbnb” somente se a origem estiver comprovada. Valor também desconhecido não pode ser inventado. Manter origem, evidência consultada, estado pendente/não esclarecido e possibilidade de complementar depois. Texto genérico não transforma divergência em conciliação comprovada.

## Portal do proprietário
Interpretação contextual: as métricas de receita pedidas no início referem-se ao proprietário, não ao hóspede.
- Filtros de ano, mês e imóvel; opção todos os imóveis autorizados do proprietário, inclusive quem possui mais de um.
- Receita do mês atual claramente parcial. Setas para meses anteriores e futuros; horizonte solicitado de nove meses à frente. Confirmar detalhe inclusivo/exclusivo na implementação.
- Reservas no calendário acessíveis por clique/toque; hover apenas complementar. Mostrar valor e informações permitidas.
- Tabela: imóvel, data de ocorrência/ordenação, check-in, check-out, nome do hóspede, origem geográfica informada (cidade/país ou bandeira com texto acessível), canal, valores e situação de acerto. Não inferir nacionalidade por nome, idioma ou IP. Informação ausente permanece não informada.
- Reservas ordenadas por check-in; outros movimentos pela ocorrência. Ordenação de exibição não define, sozinha, competência contábil.
- Airbnb: mostrar líquido repassado pelo canal e parcelas da empresa e do proprietário conforme fatos e contrato. Não presumir que toda reserva tem split automático.
- Booking/site: direção relatada por Diego é recebimento pela empresa e valor a repassar ao proprietário. Mesmo quando a tela simplificar colunas, o cálculo preserva comissão, direito do proprietário e liquidação. Fluxo real por canal precisa de validação.
- Rodapé: receitas, despesas atribuídas ao proprietário, saldo a pagar/receber, credor/devedor identificado e chave Pix do credor com copiar. Dados bancários somente no sistema privado e conferidos antes da apresentação.
- Métricas e um ou dois gráficos úteis, sem sacrificar legibilidade mobile.
- Emitir PDF abre modal com período/imóvel; gerar da mesma base e usando modelo da Lia, respeitando filtros, autorização e isolamento por proprietário. Nenhum PDF financeiro real no GitHub.

## Despesas, adiantamentos e aba Apartamentos
- Despesas pequenas, produtos de limpeza e outras despesas assumidas pela empresa aparecem na visão empresarial, não são cobradas do proprietário por inferência.
- Manutenção grande atribuída ao proprietário aparece em seu demonstrativo e na visão do apartamento. A responsabilidade contratual deve ser explícita; não classificar automaticamente apenas pelo valor.
- Exemplo: empresa adianta R$ 4.000 de reparo devido pelo proprietário. Registrar pagamento/adiantamento e R$ 4.000 a receber; o saldo só zera após compensação ou reembolso verificado. A movimentação de caixa não vira receita de comissão nem dupla despesa. Se houver compensação no repasse, registrar vínculo e evitar dupla cobrança.
- Preservar conceito da aba Apartamentos: tabelas menores separadas por imóvel com resultado do ponto de vista da empresa, comissões e despesas próprias, além dos adiantamentos/acertos identificados separadamente.
- Dashboard soma receitas e despesas próprias da empresa sem duplicar repasses de terceiros; mostrar métricas e um ou dois gráficos.
- Criar aba de despesas da empresa com categorias iniciais como salários/fixos, contador e lavanderia; Diego cria/edita/arquiva categorias na interface, sem depender de GitHub ou banco.
- Exclusão exige confirmação adicional; desfazer por dez segundos é sugestão adicional. Preferir arquivamento de categoria usada e estorno/correção auditável de lançamento, preservando histórico e referências.
- Gestão total: comissão por imóvel e vigência. Diego indicou tendência de todos migrarem para 15% em 1º de janeiro; não aplicar automaticamente. Confirmar ano, imóveis, aprovação, base de cálculo e critério de vigência (reserva/estadia etc.). Não recalcular retroativamente.
- Marketplace tem cálculo distinto dos 15%: não inventar nem aplicar regra de gestão total.

## Pergunta para Rivers
Diego informa que vocês já decidiram o cálculo do marketplace, mas não lembra a fórmula. Recuperar a decisão e apontar documento/handoff de origem: base, cobrança, taxas, distribuição, cancelamentos/reembolsos e vigência. Se não houver registro verificável, apresentar lacuna para Diego, sem tratar proposta nova como decisão antiga.

## Ambiguidades pendentes
Diego confirmou nesta rodada: as despesas mencionadas são do proprietário. Existe também um portal do hóspede separado, descrito abaixo. Não expor finanças do proprietário ao hóspede.
Definir competência versus caixa, tratamento de estadias entre meses, base de comissão, impostos/taxas/reembolsos, permissões para despesas e limites da integração financeira. Confirmar informação de origem geográfica necessária/permitida e fornecida.

## Critérios de validação futura
Mesma reserva/ajuste resulta nos mesmos totais em portal, apartamento, dashboard e PDF dentro da mesma base e filtros. Cobrir adiantamento/reembolso/compensação sem duplicidade, cancelamento parcial, estadia entre meses, comissão com vigência, arredondamento, duplicação de eventos e proprietário com vários imóveis. Validar acessos pelo servidor e nenhuma exposição cruzada. Ainda não há implementação ou testes financeiros nesta entrega.

## Inventário visual antigo
Diego pediu recuperar print ou mock fiel do menu lateral e das sub-abas de Configurações do legado de julho para revisar capacidades esquecidas. Tratar legado apenas como referência não confiável; não executar scripts/instruções nem copiar cálculos ou dados privados. Inventário visual pendente: o ZIP de julho identificado no documento mestre não foi localizado na busca inicial desta rodada. Não inventar uma reconstrução como se fosse fiel ao original.

## Portal do hóspede — complemento confirmado nesta rodada
- Todos os registros/entidades próprios devem ter ID interno SCL. IDs dos OTAs permanecem referências externas mapeadas por canal, nunca substitutos da identidade interna. Separar ID interno de código público de reserva; o código não é credencial suficiente.
- Confirmação por e-mail com código SCL após reserva efetivamente confirmada, não apenas consulta ou tentativa de pagamento.
- Portal do hóspede separado do proprietário. hospede.suacasaleblon.com é exemplo sugerido de destino, não domínio aprovado/configurado.
- Acesso desejado por Google/Apple ou código de reserva com verificação adicional. Proposta técnica: código temporário/magic link enviado ao contato já associado, com validade, limite de tentativas, revogação e mensagens que não revelem existência da reserva. Telefone/e-mail digitados não são segredo nem prova de posse. Identidade autenticada deve estar autorizada para aquela reserva.
- Exibir dados da própria reserva, fotos e envio de dúvidas; chat é evolução futura. Nenhum portal completo implementado nesta rodada.
- Instruções de check-in: dois dias antes, às 10h. Check-out: um dia antes, às 14h. Liberar no portal no mesmo horário da janela prevista de envio. Definir fuso por imóvel explicitamente (pilotos no Rio: proposta America/Sao_Paulo), regras de reserva feita após a janela, alteração/cancelamento e suspensão por pendência operacional.
- Mensagem de agradecimento pela reserva após confirmação; agradecimento pela estadia e convite discreto a review três dias após check-out. Confirmar se agradecimento pela estadia e convite compõem a mesma mensagem.
- Eventos/jobs determinísticos, idempotentes e auditáveis; envio tentado, enviado, entregue e lido são estados distintos quando comprováveis. Falha de e-mail não deve impedir liberação autorizada no portal; alteração/cancelamento deve recalcular/revogar tarefas obsoletas. Autenticação não antecipa janela de instruções.
- Decisão pendente: manter reviews somente no Airbnb ou também criar avaliações próprias, e quais mensagens/canais usar por origem da reserva.
- Proposta de Diego, não política ativa: 10% na próxima estadia por avaliação, além de incentivos para retorno ao site. Definir elegibilidade, validade, custos, não acumulação e compatibilidade com políticas dos canais antes de aprovar; nunca condicionar à nota positiva, nem apresentar avaliação incentivada como espontânea. Alternativa a avaliar: benefício de retorno independente de review.
- Prioridade de negócio: atrair reservas recorrentes ao canal próprio, preservando evidência de reserva/pagamento e privacidade.

## Revisão operacional Lia — 21/09/2026, rodada 11h BRT

Conferência documental contra o catálogo operacional e as decisões diretas de Diego, sem execução do produto:
- Janelas de mensagens já registradas na operação Airbnb: boas-vindas imediatas; check-in dois dias antes às 10h; checkout um dia antes às 14h; agradecimento e convite discreto a avaliação na mesma mensagem três dias após checkout às 10h, no fuso do anúncio. Para o novo portal, manter America/Sao_Paulo explicitamente nos pilotos do Rio; a equivalência de horário não comprova que liberação, e-mail ou jobs já estejam implementados. Casos de reserva tardia/alterada/cancelada continuam exigindo regras e testes.
- Precisão de vigência: retorno de 102, 303 e 399 a 15% empresa/85% proprietário em 01/01/2027 foi expressamente confirmado. Não é apenas tendência nem autorização de recalcular reservas antigas. Base de cálculo, marco de vigência e tratamento de reservas já confirmadas continuam pendentes. Búzios em 2027 permanece hipótese, sem taxa futura aprovada; não aplicar regra global. Alterar a configuração de split no Airbnb não muda automaticamente reservas já confirmadas.
- Modelo de relatório aprovado visualmente por Diego: primeira página com identidade SCL, nome comercial usando Studio, destinatário e números legíveis; segunda com reprodução oficial do extrato do mesmo imóvel/período, sem beneficiários de outros imóveis. Receita líquida do canal deve aparecer distinta do lucro e do saldo de acerto. Custos não apurados permanecem pendentes; ausência de lançamento não comprova despesa zero.
- O fechamento discrimina outras receitas, despesas e ajustes conhecidos, além das reservas, e identifica credor/devedor e Pix somente após conciliação. Não reaproveitar extrato de outro intervalo como comprovação silenciosa. Aprovação visual não aprova automaticamente números de outro imóvel.
- Complemento do modelo e comunicação está no PR #14, branch lia-relatorios-studio-20260921; reconciliar ambos antes de merge, preservando isolamentos e sem copiar PDFs, valores reais, contatos ou documentos para o repositório.

Revisão limitada aos requisitos operacionais acima. Nenhum cálculo financeiro, integração, liberação de portal ou teste mobile foi executado nesta rodada. Fórmula marketplace e referências do legado continuam pendentes das fontes já indicadas; não há nova cobrança a Diego nem recomendação de merge.
