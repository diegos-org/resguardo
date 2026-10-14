# Performance operacional — leitura e comparação

Critérios confirmados na revisão documental de 13/10/2026, comparados com os registros privados de 8–9/10. Este método orienta a análise da operação; não altera cálculos do aplicativo, não publica dados de reservas e não autoriza nova estratégia de preço. Para preços e mínimos vigentes, consultar [Calendário e preços](CALENDARIO-PRECOS-OPERACAO.md); para a rodada, o [roteiro operacional vigente](ORIENTACOES-OPERACIONAIS.md#roteiro-de-consulta-e-fechamento).

## Snapshot privado e comparação possível

Guardar cada leitura datada em registro restrito, sem sobrescrever a anterior. Identificar fonte, hora/fuso da captura, data até a qual a fonte está atualizada, imóvel, canal, filtros, moeda, período, fórmula e limitações. Preservar os valores originais junto dos cálculos derivados e a referência privada que permita conferir a leitura. No GitHub ficam método e exemplos fictícios; dados individuais, recursos, reservas e conversas continuam privados.

Comparar somente métricas com a mesma definição e cobertura. Distinguir janela fixa de noites de uma janela móvel de 30/90 noites: o deslocamento diário tira e acrescenta noites, então a diferença de ocupação entre snapshots não é, sozinha, venda nova ou cancelamento. Se mudarem filtros, estados incluídos, bloqueios ou fonte, explicar a mudança antes de apresentar o delta. Fonte indisponível ou parcial é lacuna, não zero. Saída já encerrada que desaparece de uma lista de futuras não é cancelamento.

Separar **realizado histórico**, **futuro reservado/contratado** e **projeção ou proposta**. Reserva futura não é diária já ocupada, receita realizada ou dinheiro recebido. Não somar passado e futuro num indicador sem declarar os recortes e a base.

## Ocupação com período e denominador explícitos

- Definir o período por noites: entrada inclusiva, checkout exclusivo; contar apenas a interseção de cada estadia com a janela. Para uma unidade, usar a união das noites elegíveis, evitando dupla contagem de sobreposições. No agregado, somar noites-imóvel, sem tirar média simples de percentuais com denominadores diferentes.
- Informar sempre **noites reservadas / noites do denominador**, percentual, datas e estados incluídos. Confirmar o significado dos estados na fonte; consultas, ofertas e propostas não aceitas não viram reservas.
- Identificar **denominador calendário bruto** (todas as noites da janela) ou **denominador disponível para venda** (calendário menos bloqueios identificados, como uso do proprietário ou manutenção). Informar a quantidade e o tratamento dos bloqueios, evitando descontá-los duas vezes. Bloqueios não ocupam o numerador como se fossem hóspedes. Se não houver cobertura suficiente para apurá-los, declarar a limitação; não chamá-la de zero bloqueios.
- Denominador zero produz “não aplicável”, não 0% de ocupação. No histórico parcial, explicitar a data de corte. “Inventário indisponível” pode significar bloqueio ou outra restrição e não prova reserva comercial; “livre” não garante venda para qualquer duração ou grupo.

Exemplo fictício: 12 noites reservadas numa janela de 30 noites = 40% pelo calendário bruto. Com 5 noites bloqueadas fora dessas reservas, são 12/25 = 48% sobre as noites disponíveis para venda. Os dois resultados exigem rótulos diferentes e não são intercambiáveis.

## Propostas, cancelamentos e ritmo de reservas

Oferta ou proposta enviada, inclusive alteração/extensão, permanece separada até aceite e confirmação na fonte. Não acrescentar suas noites ou valor à venda confirmada. Acompanhar com a mensagem cordial prevista no [guia de atendimento](GUIA-LIA-ATENDIMENTO.md#dicas-de-atendimento-e-julgamento), sem afirmar confirmação antecipadamente.

Manter **pending cancellation / cancelamento pendente** separado de cancelamento concluído. Preservar o estado original e explicar seu tratamento no indicador: se a reserva ainda estiver ativa/ocupando noites na fonte, identificar a parcela incluída e o risco pendente; se o estado impedir confirmar a elegibilidade, mostrar a lacuna separadamente. Não liberar datas nem registrar perda definitiva por inferência. Cancelamento fora da janela não reduz a ocupação daquela janela.

Para medir novas contratações, antecedência ou ritmo de vendas, conferir a data original da reserva no canal. Data de importação, conexão ou sincronização não é data de contratação. Se várias reservas aparecem com a mesma data técnica, cruzar a fonte original antes de construir a série; sem ela, informar que o ritmo não foi apurado. “Novo na lista” sozinho não prova venda nova. Taxa de cancelamento exige população, período e critério definidos; uma lista de reservas futuras não equivale ao histórico completo.

## Diária média (ADR) e composição do valor

Toda média traz numerador, denominador, período e regime (realizado ou futuro). Para **ADR de acomodação**, usar a receita de acomodação das noites elegíveis dividida por essas mesmas noites, indicando se a base é bruta ou líquida e como foram tratados descontos, cancelamentos e rateio de estadias que atravessam o período. Declarar o que foi excluído: limpeza, taxas de serviço, impostos e outros componentes não devem entrar ocultamente nessa base.

Se a fonte só fornece um total sem discriminar componentes, não apresentar `total / noites` como ADR de acomodação. Quando útil, rotular como **valor total médio por noite**, listar o que se sabe que está incluído e o que não pôde ser separado. Sem base suficiente, registrar “ADR não calculado”. O [relatório mensal do produto](../product/RELATORIO-MENSAL.md) tem sua própria base documentada; não mudar sua definição por esta revisão nem compará-lo silenciosamente a uma série com composição diferente.

## Da observação à decisão

Separar no registro: **fato observado**, **hipótese a investigar**, **proposta de ação**, **decisão autorizada**, **execução** e **resultado conferido**. Guardar data, fonte e limites da decisão. Aumento de visitas com baixa conversão orienta investigação; não demonstra sozinho preço errado, causa de queda ou efeito de uma mudança recente. Janela que começou antes da mudança não isola seu efeito.

Comparações de preço usam datas, duração, grupo, composição de taxas e condições equivalentes; preço anunciado de concorrente não é preço vendido. Comparadores agregados da plataforma, sem amostra/método conhecidos, não são um conjunto de concorrentes auditado. Nenhuma leitura isolada transforma diagnóstico em estratégia aprovada. Propor mudanças com evidência e aguardar decisão para alterar estratégia; executar apenas o escopo já autorizado, preservando reservas, bloqueios e intervenções específicas.
