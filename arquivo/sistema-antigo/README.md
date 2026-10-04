# Sistema antigo (julho de 2026) — inventário de telas e capacidades

Levantamento feito em 4/10/2026 (item M0.6) a partir do "acervo isolado" que Diego mandou:
um arquivo único com as telas do sistema de julho, dados fictícios e integrações desligadas.
Serve para comparar com o plano atual, não para ser copiado: pilha diferente (gerenciador de
canais, banco e pagamento de outros fornecedores), tudo num arquivo só, sem testes visíveis.
**Nada do sistema antigo foi trazido para este repositório** além deste texto. Fotos reais,
credenciais, nomes de projeto e telefones ficaram de fora de propósito. Planejamento vigente:
[ROADMAP.md](../../ROADMAP.md).

Alerta de leitura: boa parte do que está descrito era casca ou intenção. Os próprios textos
das telas dizem "entra no próximo PR", "template não registrado", "automação pendente até
termos API confiável". Pelo acervo dá para saber o que foi **desenhado**, não o que funcionou
em produção.

## 1. O que o sistema tinha (37 telas)

### Painel
- **Financeiro:** receita, despesa e resultado da empresa no mês ou no ano; taxa de ocupação,
  diária média, RevPAR e RevPAN; resumo por apartamento com comissão, repasse e resultado do
  imóvel; filtro gestão × marketplace; gráfico de receita × despesa por mês.
- **Conversas:** caixa de entrada unificada (gerenciador de canais, WhatsApp, e-mail e reserva
  direta), com filtro por apartamento e por fonte.
- **Assistente:** chat interno para perguntar sobre reservas, despesas e limpezas; painel de
  atividade do agente de atendimento ("Leleco", por WhatsApp e voz) com o que precisava de
  decisão humana.
- **Franco (revisão):** um segundo agente que conferia uma vez por dia o trabalho do primeiro,
  respondia sozinho a rotina ("categoria A", só com o auto-envio ligado) e deixava rascunhos
  para Diego decidir ("categoria B"), inclusive por um link de aprovação válido por 48 horas.

### Operação
- **Apartamentos:** resultado por imóvel (receita, despesa, comissão, "a acertar com o dono"),
  lista de reservas e importação do CSV de ganhos do Airbnb.
- **Reservas diretas:** reservas do site, WhatsApp ou contato direto, com situações pendente,
  parcial, pago, cancelado, expirado e **recusado pelo dono**; marcar pago; filtros.
- **Hóspedes (CRM):** hóspedes consolidados a partir das reservas, contatos, estadias e receita.
- **Limpezas:** agenda semanal por apartamento, próximas faxinas, saídas chegando,
  manutenções, "limpezas ⇄ preços"; versão para o celular da equipe (calendário, chat,
  contatos, configurações).
- **Contador:** receita da empresa = só comissões (o repasse do Airbnb é caixa, não receita);
  despesas do centro de custo empresa; resumo e detalhado; exportação em CSV.
- **Despesas:** da empresa × de apartamento, parcelas (excluir uma ou a sequência), importação
  de extrato bancário e de fatura de cartão.
- **Docs de condomínio:** reservas em prédios que exigem cadastro de hóspede, com mensagem
  pronta para o WhatsApp do condomínio e um **formulário público** em que o próprio hóspede
  preenche nome, documento e número de pessoas.

### Crescimento
- **Dynamic pricing (recomendador):** base, piso, teto e janela por apartamento; eventos e
  mínimos (sexta e sábado, feriadão, grande evento); entradas manuais de mercado (ocupação
  estimada do bairro, diária média da concorrência, cortes de ocupação baixa e alta);
  simulador por data com "buraco de uma noite" e faixa útil; modo simulação × ao vivo com
  interruptor mestre; varredura duas vezes por dia; "radar web" previsto para sugerir eventos.
- **Prospecção:** varrer o Airbnb por localidade e número de quartos atrás de anúncios fracos
  (nota baixa, poucos reviews, sem Superhost); captura manual de um anúncio com diagnóstico
  por IA a partir de um print; funil de captação e painel.
- **Marketing:** gerador de rascunhos de posts e anúncios por imóvel, formato, objetivo e
  público, com brief visual e checklist "antes de usar"; nada publicado automaticamente.
- **Campanhas:** conexões com Google e Meta, desempenho, processos e criativos.
- **Cupons** de desconto para reservas diretas.

### Sistema
- **Configurações:** credenciais, anotações, base de conhecimento, dicas locais, páginas,
  taxas, apartamentos, feriados e eventos, e-mails e mensagens, docs de condomínio, cupons,
  integrações; permissões admin / **convidado só leitura** / faxineira; senhas de
  proprietários; aplicar migrações; invalidar todas as sessões.
- **Reconciliação:** CSV do Airbnb (dinheiro real) × sincronização do gerenciador de canais ×
  reservas do site, reserva a reserva: "fantasmas" (sincronizada, check-out passou, CSV nunca
  viu), só no CSV, valor divergente e dupla contagem site ↔ sincronização. Só leitura.
- **Relatórios:** PDF mensal por apartamento para o proprietário.
- **E-mails e mensagens automáticas:** modelos, gatilhos por data (uma vez por reserva, em
  horário comercial), variáveis; template do WhatsApp na Meta.
- **Importar:** CSV de ganhos do Airbnb, extrato bancário, fatura de cartão, com filtro
  inteligente de duplicatas.
- **Integrações:** situação de cada conexão (banco, gerenciador de canais, Beds24, pagamento,
  e-mail, WhatsApp, voz, varredura web, IA), avisos de sincronização, resync anual e atalhos
  para os painéis externos.

### Público
- **Site:** "reserve direto, pague menos"; busca por datas e hóspedes; catálogo; página do
  imóvel; depoimentos; chamada para proprietários; "minha reserva" (e-mail + código);
  confirmação de pagamento; política de privacidade (LGPD).
- **Para proprietários:** landing com faixas de mercado por tipo de imóvel (diária, ocupação,
  líquido mensal estimado, com ressalva de "sem garantia"), como a gestão funciona e "análise
  gratuita do seu imóvel".
- **Portal do proprietário:** entrada por senha, por imóvel ou por dono; relatórios.
- **Operador (celular):** conversas por canal e agentes.

## 2. Cruzamento com o plano atual (SCL 2.0)

| Capacidade do sistema antigo | Situação no SCL 2.0 |
|---|---|
| Financeiro, dashboard, resultado por apartamento, repasse | Feito (M4.1, M4.6, M4.7, M4.9); indicadores de ocupação/diária média existem no dashboard |
| Despesas da empresa × do imóvel, categorias | Feito (M4.3) |
| Reservas diretas, cotação e "segurar as datas" | Feito (M8.1); pagamento é o M8.2 |
| Portal do proprietário, relatório PDF, e-mail do fechamento, bloqueio de datas | Feito (M5.1 a M5.5) |
| Limpezas, manutenção, agenda diária, equipe pelo celular, portaria | Feito (M6.1 a M6.6) |
| Site público com disponibilidade e valor reais | Feito (M7.1, M7.2); páginas legais são o M7.4 |
| Portal do hóspede e mensagens automáticas | Feito (M9.1, M9.2) |
| Importação de reservas do Beds24 e conferência | Feito (M3.3, M3.8) |
| Calendário e preços (regras, eventos, última hora, envio ao Beds24) | Feito (M3.7); fonte de preços por imóvel é o M3.9 |
| Cadastro de proprietários marketplace pelo site | Feito (M12.3) |
| Caixa de entrada do WhatsApp e assistente com revisão humana | Planejado (M10.1 a M10.3) |
| Reconciliação CSV do Airbnb × sincronização × site | **Não planejado** (ver ideias) |
| "Recusado pelo dono" em reserva direta | **Não planejado**; faz sentido no marketplace (M12.4) |
| Formulário público de cadastro no condomínio para o hóspede | Parcial: M6.4 tem o checklist; o formulário do hóspede não |
| Visão do contador (só comissões) com exportação | Parcial: M4 tem o ledger; a exportação para o contador não |
| Recomendador de preço com dados de mercado e "buraco de uma noite" | Parcial: M3.7 tem regras; mercado e buraco de uma noite não |
| Cupons de desconto | **Não planejado** |
| Importação de extrato bancário e fatura para despesas | **Não planejado** |
| Papel "convidado só leitura" | **Não planejado** |
| Prospecção, gerador de posts, campanhas | **Não planejado**; ideias de crescimento |
| Agentes Leleco e Franco com auto-envio | Decisão atual: M10.3 mantém revisão humana antes do envio |

## 3. Ideias para Diego decidir (em ordem de valor, na minha leitura)

1. **Reconciliação** do CSV de ganhos do Airbnb com as reservas importadas e as do site
   (fantasmas, só no CSV, valor divergente, dupla contagem). Fecha a pergunta "o dinheiro que
   entrou bate com o que o sistema diz?".
2. **"Recusado pelo dono"** nas reservas do site para imóveis de marketplace (o proprietário
   que opera o imóvel aprova ou recusa um pedido do site dentro do prazo do hold).
3. **Formulário público de cadastro no condomínio** para o hóspede preencher, com aviso pronto
   ao condomínio (complemento do M6.4).
4. **Exportação para o contador** (só comissões como receita, despesas da empresa à parte).
5. **Recomendador de preço com dados de mercado** e preço para buraco de uma noite, depois do
   M3.9 (a fonte de preços por imóvel).
6. **Cupons** de desconto para reservas diretas.
7. **Importação de extrato bancário e fatura de cartão** para lançar despesas.
8. **Papel "convidado só leitura"** para mostrar o painel sem risco.
9. Crescimento (anotado em `requisitos/growth/ROADMAP.md`): prospecção de anúncios fracos,
   gerador de posts e anúncios, campanhas.

Nenhum destes vira item do plano sem decisão de Diego.

## 4. O que não veio no acervo

- Fotos reais dos imóveis e do site (os espaços aparecem como "imagem omitida").
- O código e o histórico do repositório de julho, e os dados de produção.
- O site antigo não está mais no ar: os domínios não respondem (conferido em 4/10).
