## Estado vigente — Rivers, 20/09/2026, rodada antecipada após Sage

Rivers revisou o handoff de Sage e consolidou o próximo corte. A demonstração local do checkout foi validada por Sage com 22 testes e cenários fictícios de revalidação, indisponibilidade, falha e expiração; nenhum pagamento/reserva real existe. O ponto limitante agora é simples: o código útil ainda está apenas no ambiente local de Sage e não está compartilhado neste workbench.

### Próximo agente: **Sage**
Missão pequena e objetiva: trazer para este repositório **somente a base limpa e compartilhável** do trabalho local necessário para o SCL 2.0, em branch/PR de construção, incluindo o contrato de checkout relevante. Não trazer segredos, dados privados, legado bruto, mídia sem direito claro nem produção. Não integrar Mercado Pago ainda.

Depois que o código estiver remoto e revisável, **Lia** será a próxima para validar o fluxo pelo navegador e registrar problemas reais de uso. Não faz sentido chamar Lia antes disso.

### Decisões consolidadas
- Não recomeçar o site.
- Mercado Pago é a escolha de Diego, mas integração fica para uma fatia posterior.
- Antes de pagamento real: cotação/inventário, revalidação, idempotência e estado persistente precisam existir.
- Bônus continua sem política aprovada.
- Produção permanece intocada.

### Rodadas
Esta rodada de Rivers foi antecipada manualmente. Apenas a próxima ocorrência equivalente de Rivers deve ser tratada como redundante; a cadência posterior permanece.

---

## Estado vigente — Sage, 20/09/2026, rodada antecipada equivalente às 15h15 BRT

Diego confirmou o nome Sage e autorizou começar após o handoff Lia. Rodada técnica concluída: código local existente preservado, galeria 399 alinhada e demonstração isolada de checkout preenchido, total e revalidação fictícios. 22 testes locais passaram; navegador conferiu alteração de preço, indisponibilidade, falha e expiração sem cobrança. Nenhuma reserva ou pagamento real. Código ainda local, não commitado neste repo.

Próximo agente: **Rivers**. Revisar o [handoff Sage](handoffs/2026-09-20-sage-para-rivers.md), reconciliar decisões e definir a próxima fatia. Mercado Pago foi escolhido por Diego nesta conversa, mas não integrado; bônus segue sem política aprovada.

Rotina Sage criada e ACTIVE: a cada 3h em 00/03/06/09/12/15/18/21h15 BRT. Diego pediu aviso nesta conversa ao término de **toda** rodada para acionar Rivers. A rodada manual atual substitui somente a ocorrência equivalente das 15h15 se continuar redundante; novo handoff ou escopo distinto permite execução. Próximos horários não mudam. Lia mantém sua própria agenda já resolvida; não alterada por Sage.

Conector Sage também retornou Unknown tool; documentação salva pelo navegador autenticado. Produção intocada, área interna fechada, código relevante remoto futuro por branch/PR sem merge autônomo. Registros abaixo são histórico preservado.

---

## Decisão final de agendamento — 20/9
Coordenação Lia integrada e ACTIVE na automação horária, ao final das02/05/08/11/14/17/20/23h BRT. Primeira rodada14h concluída manualmente; próxima17h. Diego pode antecipar rodadas sequenciais, substituindo só ocorrência equivalente. Avisar conclusão no aplicativo após salvar handoff. Sem decisão pendente de formato. Detalhes e próximo passoSage: [handoff Lia](handoffs/2026-09-20-1415-lia-para-sage.md). Esta decisão supera o bloqueio histórico abaixo.

## Atualização vigente — Lia, 20/9/2026, rodada 14h15 BRT


Lia iniciou a rodada manual autorizada, leu o protocolo e validou leitura/escrita documental pelo navegador. Repositório PRIVATE conferido na página inicial. Conector Lia falhou (Unknown tool); não presumir que o acesso de Rivers seja o mesmo. Produção intocada.


Próximo agente: Sage. Propor/testar checkout preenchido com dados fictícios conforme orientação de Diego registrada em LIA.md. Fornecedor, bônus e publicação não decididos.


Bloqueio de agendamento: aplicativo permite só um heartbeat nesta conversa, já usado pelo atendimento. Nova rotina3h não criada; Diego está escolhendo integração à atual ou conversa separada. Não alterar agenda de outros agentes. Proteções de branch ainda não verificadas; nenhum repositório excluído.


O estado abaixo preserva o registro inicial de Rivers; o próximo agente Lia e visibilidade pendente ali foram superados por esta atualização.


---


# CURRENT — SCL 2.0 Workbench


## Estado atual


- Este repositório é o workbench temporário e não canônico do SCL 2.0.
- Produção permanece separada e intocada.
- O protocolo mestre está em `/00-PROTOCOLO.md`.
- Rivers, Lia e Sage devem usar este repositório como memória compartilhada de coordenação.
- O histórico material deve ser preservado em `coordination/handoffs/`.


## Objetivo imediato


Fazer a primeira rodada coordenada com Rivers → Lia → Sage, cada um lendo o protocolo, atualizando seu próprio arquivo e deixando um handoff claro.


## Regras operacionais ativas


- Ler protocolo + CURRENT + arquivo próprio + DIEGO antes de agir.
- Atualizar DIEGO ao final de toda rodada.
- Não tocar produção.
- Não armazenar segredos ou PII desnecessária.
- Mudança relevante de aplicação: preferir branch + PR.
- Coordenação: pode ser atualizada direto para evitar burocracia.


## Pendente administrativo no GitHub


O conector atual permite editar conteúdo, mas não expõe todas as configurações administrativas.
Ainda precisa ser conferido manualmente:
- visibilidade do repo;
- branch protection / regra de merge;
- remoção do repo pessoal de teste, se Diego ainda quiser apagá-lo.


## Próximo agente


Lia, depois que Diego der o start manual no chat dela.
