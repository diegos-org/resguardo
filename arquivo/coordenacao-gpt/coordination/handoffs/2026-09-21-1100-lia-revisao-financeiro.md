# Handoff Lia — 21/09/2026, 11h BRT

Atendimento concluído antes desta rodada. Protocolo, CURRENT/LIA/DIEGO e handoff financeiro de Sage lidos. PR #13 revisado documentalmente e complementado após leitura atual dos arquivos e uso dos SHAs para evitar sobrescrita concorrente.

## Revisão operacional Lia — 21/09/2026, rodada 11h BRT

Conferência documental contra o catálogo operacional e as decisões diretas de Diego, sem execução do produto:
- Janelas de mensagens já registradas na operação Airbnb: boas-vindas imediatas; check-in dois dias antes às 10h; checkout um dia antes às 14h; agradecimento e convite discreto a avaliação na mesma mensagem três dias após checkout às 10h, no fuso do anúncio. Para o novo portal, manter America/Sao_Paulo explicitamente nos pilotos do Rio; a equivalência de horário não comprova que liberação, e-mail ou jobs já estejam implementados. Casos de reserva tardia/alterada/cancelada continuam exigindo regras e testes.
- Precisão de vigência: retorno de 102, 303 e 399 a 15% empresa/85% proprietário em 01/01/2027 foi expressamente confirmado. Não é apenas tendência nem autorização de recalcular reservas antigas. Base de cálculo, marco de vigência e tratamento de reservas já confirmadas continuam pendentes. Búzios em 2027 permanece hipótese, sem taxa futura aprovada; não aplicar regra global. Alterar a configuração de split no Airbnb não muda automaticamente reservas já confirmadas.
- Modelo de relatório aprovado visualmente por Diego: primeira página com identidade SCL, nome comercial usando Studio, destinatário e números legíveis; segunda com reprodução oficial do extrato do mesmo imóvel/período, sem beneficiários de outros imóveis. Receita líquida do canal deve aparecer distinta do lucro e do saldo de acerto. Custos não apurados permanecem pendentes; ausência de lançamento não comprova despesa zero.
- O fechamento discrimina outras receitas, despesas e ajustes conhecidos, além das reservas, e identifica credor/devedor e Pix somente após conciliação. Não reaproveitar extrato de outro intervalo como comprovação silenciosa. Aprovação visual não aprova automaticamente números de outro imóvel.
- Complemento do modelo e comunicação está no PR #14, branch lia-relatorios-studio-20260921; reconciliar ambos antes de merge, preservando isolamentos e sem copiar PDFs, valores reais, contatos ou documentos para o repositório.

Revisão limitada aos requisitos operacionais acima. Nenhum cálculo financeiro, integração, liberação de portal ou teste mobile foi executado nesta rodada. Fórmula marketplace e referências do legado continuam pendentes das fontes já indicadas; não há nova cobrança a Diego nem recomendação de merge.

Próximo passo: Sage/Rivers reconciliar os complementos #13/#14, definir as lacunas explicitadas antes de implementar cálculos/jobs e manter a validação mobile do #11 separada. Não ativados outros agentes. Sem merge, publicação ou dados reais.
