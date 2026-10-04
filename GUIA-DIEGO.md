# Guia do Diego — tudo sobre o SCL 2.0 num lugar só

> Documento escrito para você, sem precisar ler código. É atualizado a cada PR.
> **Última atualização:** 3/10/2026, backup automático do repositório pronto para você ativar na conta separada (M0.7, seção 6, item 23) e backup do banco no Neon ampliado (7 dias de histórico, snapshots diário e semanal); cotação e "segurar as datas" no site (M8.1), proprietário bloqueia datas de uso próprio pelo portal (M5.5), disponibilidade e valor reais no site (M7.2) e envio de calendário e preços ao Beds24 (M3.7) pronto para o teste no 103. **Nada é enviado** enquanto você não ligar `BEDS24_ESCRITA` na Vercel e marcar o imóvel em Configurações → Calendário e preços. A conferência das reservas é parcial; agosto/setembro podem ter histórico incompleto na origem.

---

## 1. Resumo em 30 segundos

- **O que é:** o novo sistema de gestão da Sua Casa Leblon (painel interno, financeiro,
  portal do proprietário, portal do hóspede, site com reserva direta e integrações com
  Beds24, Mercado Pago e WhatsApp).
- **Onde está:** tudo neste repositório do GitHub, `al-life/scl-reconstrucao`.
- **Quem constrói:** o Claude, por meio de uma rotina automática a cada 3 horas e das
  conversas com você.
- **Quem decide:** você. Por enquanto o Claude faz os merges sozinho (com CI verde e revisão
  automática sem pendências), por sua autorização; você pode revogar quando quiser.
- **Está em uso?** **Não.** Só vai ser usado "para valer" quando tudo estiver pronto
  (marco M11).

---

## 2. Onde estamos

| Etapa | O que entrega | Situação |
|---|---|---|
| M0 Fundação | Base do app, banco de dados, layout, publicação na Vercel, backup | 🟡 Vercel e login funcionando; banco de homologação separado conferido em 3/10; **backup automático do repositório pronto, falta você ativar na conta separada** (M0.7, seção 6, item 23); falta só você dar o M0.5 por fechado e mandar a referência do sistema antigo (M0.6) |
| M1 Acesso | Login (Google/código por e-mail), convites, permissões | ✅ pronto |
| M2 Cadastros | Imóveis, proprietários, contratos e aba Anúncios | ✅ implementado; referências dos canais precisam ser preenchidas/conferidas |
| M3 Reservas | Reservas, calendário central, importação e envio de calendário/preços ao Beds24 | 🟡 importação e envio implementados; o envio começa desligado e espera o seu teste no 103; conferência das reservas parcial |
| M4 Financeiro | Lançamentos, comissões, despesas, dashboard, aba Apartamentos | 🟡 em andamento |
| M5 Portal do proprietário | Relatórios, saldos, PDF, bloqueio de uso próprio | 🟡 relatórios, PDF, e-mail do fechamento e bloqueio de datas prontos |
| M6 Operação | Limpezas, manutenção, agenda diária | 🟡 em andamento |
| M7 Site público | Site novo com disponibilidade e valor reais | 🟡 disponibilidade e valor prontos; fotos reais (M7.3) dependem de você |
| M8 Reserva direta | Cotação, datas seguradas e pagamento pelo Mercado Pago | 🟡 cotação e "segurar as datas" prontos; pagamento (M8.2) espera a decisão do M8.0 e as credenciais de teste |
| M9 Portal do hóspede | Acesso do hóspede e mensagens automáticas | ✅ pronto |
| M10 WhatsApp | Caixa de entrada do WhatsApp no painel | ⚪ aguardando |
| M11 Produção | Dados reais, domínio, entrada em uso | ⚪ aguardando |
| M12 Marketplace | Proprietário que opera o próprio imóvel; SCL cuida do online | 🟡 em andamento |

### Backup do repositório — M0.7

Você pediu em 3/10 um backup automático de tudo, "para caso algum dia algo dê problema". O
que ficou pronto:

- **Um robô de backup** que vai morar numa **segunda conta do GitHub**, só sua, com e-mail e
  senha diferentes. A cada 3 dias ele copia **todo** o repositório (todas as branches, tags e
  o histórico inteiro) para um repositório privado nessa conta e marca a cópia com a data e
  a lista do que existia naquele dia. Nada é apagado, nunca: se alguém apagar ou reescrever
  algo no repositório principal, ou apagar algo no próprio backup, o backup guarda a versão
  anterior e te avisa por e-mail (uma vez por ocorrência). Todas as versões ficam, para sempre.
- **O repositório principal não sabe que o backup existe.** A única ligação é uma "chave só
  de leitura" criada na sua conta principal e guardada dentro do repositório de backup. Se
  invadirem a conta principal, não há nenhum caminho até o backup. Se a chave vazar, ela só
  permite ler o código e você a cancela em um clique.
- **Aqui no repositório fica só o registro** de que o backup existe, como funciona e por quê
  (`requisitos/operations/BACKUP-E-RECUPERACAO.md`, com o passo de recuperação). Nenhum nome
  de usuário, repositório ou e-mail da conta de backup aparece em lugar nenhum — isso fica só
  com você, no gerenciador de senhas. Avaliei e manter esse registro não abre brecha: saber
  que existe um backup em algum lugar não dá acesso a nada.
- **O que falta é só você:** criar a conta, o repositório, a chave e colar dois segredos. O
  passo a passo com os cliques exatos está na seção 6, item 23. Leva uns 15 minutos.

**Atenção, isso protege o código e os documentos, não os dados.** Reservas, proprietários e
financeiro vivem no banco (Neon), e dados reais nunca podem ir para o GitHub. O backup do banco
é do próprio Neon: em 3/10, com o seu "pode fazer", a restauração por ponto no tempo passou de 1
para **7 dias** e entraram snapshots **diário** (guardado 14 dias) e **semanal** (35 dias) do
banco de produção, tudo dentro do Neon (detalhes na seção 6, item 23b). Nada para você fazer aí.

### Site: cotação e "segurar as datas" — M8.1

Depois de ver "Disponível" (ou "a confirmar") com valor, o visitante pode **segurar as datas**:

- **Cotação com código:** o site grava o que mostrou (datas, pessoas, diárias, limpeza, hóspede
  extra e total) e abre uma página própria, com um código tipo COT-XXXXXXXX. Cada vez que a página
  abre, o sistema confere de novo: se o valor ou a disponibilidade mudaram, avisa e manda fazer
  nova consulta em vez de deixar passar.
- **Segurar as datas:** o visitante informa nome, e-mail e WhatsApp e as datas ficam reservadas
  para ele por **30 minutos** (você muda em Configurações → Calendário e preços → Site público).
  Isso cria um **pedido** em Reservas (origem "site", situação "pedido"), que ocupa o calendário
  como qualquer reserva, mas **não entra no financeiro** até ser confirmado. Dois visitantes nas
  mesmas noites ao mesmo tempo: só o primeiro consegue; o segundo vê "acabaram de ficar
  indisponíveis".
- **O que a equipe faz:** o pedido aparece em Reservas com o contato do visitante e o código da
  cotação nas observações. Na ficha, **Confirmar reserva** transforma em reserva confirmada (aí
  entra no financeiro) e **Cancelar** libera as datas. Se ninguém fizer nada até o prazo, o pedido
  **vence sozinho** (uma rotina roda a cada 10 minutos) e as datas voltam à venda.
- **Freios contra abuso:** um pedido em andamento por e-mail e no máximo cinco por imóvel; repetir a
  mesma consulta não cria cotação nova, e cotações que nunca viraram pedido somem depois de 30 dias.
  Pedido do site com o prazo vencido não pode mais ser confirmado: a ficha avisa e as datas voltam à venda.
- **O que ainda não acontece:** nenhum pagamento (M8.2) e nenhuma escrita no Beds24 (M8.3). Até
  lá, o visitante fecha a reserva com a equipe pelo WhatsApp, usando o botão da página da cotação,
  e o Airbnb/Booking só fecham as datas quando a reserva confirmada for enviada (M8.3) — por isso,
  confirme ou cancele os pedidos do site com rapidez.

### Portal do proprietário: bloqueio de uso próprio — M5.5

O proprietário passa a cuidar do próprio calendário no portal, sem precisar pedir à equipe:

- **Bloquear datas:** no portal, na seção "Bloquear datas para uso próprio", ele escolhe o
  imóvel (só os dele), a primeira noite, o dia em que o imóvel volta a ficar livre e um motivo
  (opcional; sem motivo fica "Uso próprio"). As datas saem de venda no sistema na hora e fecham
  no Beds24 e nos canais no próximo envio de calendário (M3.7) — como qualquer bloqueio, só
  quando o envio estiver ligado.
- **Liberar datas:** só o que ele mesmo bloqueou e que ainda não passou, sempre com
  confirmação. Bloqueio feito pela empresa, pelo titular anterior do imóvel ou que veio do
  Beds24 aparece na lista com "quem bloqueou", mas só a empresa libera.
- **Limites:** nunca no passado e nunca por cima de uma reserva — o portal avisa em vez de
  deixar passar.
- **Permissão por contrato:** cada contrato (ficha do imóvel → Contratos) tem a opção
  **"Bloqueio pelo portal"**, que vem como **Sim**. Dá para **ligar ou desligar na própria
  linha do contrato**, a qualquer momento, e vale daí para frente (o que o proprietário já
  bloqueou fica; a equipe remove no Calendário, se for o caso). Com "Não", o proprietário vê o
  calendário mas não bloqueia (o portal explica que precisa falar com a empresa). Sem contrato
  em vigor nas datas, também não dá.
- **No painel:** o bloqueio aparece no Calendário com a origem "Proprietário (portal)" e fica no
  histórico do imóvel, como os da equipe.

### Site: disponibilidade e valor reais — M7.2

Na **Consulta** do site e na página de cada apartamento (quando o link traz as datas), o
visitante passa a ver, antes de mandar a mensagem:

- **Disponível**, **Indisponível nessas datas** ou **Disponibilidade a confirmar**. Uma noite
  só conta como disponível quando não há reserva nem bloqueio no SCL **e** a última leitura do
  Beds24 é recente (padrão: até 36 horas; ajustável em Configurações → Calendário e preços →
  Site público) e informa unidade livre. Sem leitura, ou leitura velha, o site diz "a
  confirmar" — nunca "disponível" por falta de informação.
- O **motivo**, em linguagem simples: datas já reservadas, mínimo de noites para aquela entrada
  (o mesmo mínimo que vai ao Beds24, inclusive em eventos e sobras), máximo, antecedência, dia
  de entrada/saída, pessoas acima da capacidade.
- O **valor por partes** (diárias, limpeza, hóspede extra e total), usando os mesmos preços por
  noite que o SCL envia ao Beds24 (eventos, feriadões e última hora incluídos) e as taxas do
  cadastro do imóvel. Sem preço cadastrado, o valor fica "a confirmar".
- A mensagem do WhatsApp passa a trazer "O site mostrou R$ … para N noites" como referência.

Nada é cobrado pelo site; a cotação guardada e o "segurar as datas" já existem (M8.1, abaixo) e o
pagamento vem no M8.2. A precisão da disponibilidade depende da frequência da importação do Beds24
(hoje, uma vez por dia quando ligada): consultas feitas de tarde já podem estar "a confirmar"
se a importação não rodou. Estadias acima de 90 noites (ajustável) pedem contato com a equipe.

### Calendário e preços no Beds24 — M3.7

O SCL passa a ser a fonte oficial de calendário e preços: o que você cadastra aqui vai ao
Beds24 e dele ao Airbnb/Booking. Tudo está pronto, mas **desligado**: nada sai enquanto a
variável `BEDS24_ESCRITA` não estiver com o valor `ligada` na Vercel e o imóvel não estiver
marcado para envio. Quatro lugares novos:

1. **Configurações → Calendário e preços** (só você): as regras da operação, editáveis:
   - mínimo de noites por dia da semana da entrada (padrão: domingo a quinta 1, sexta e
     sábado 2), máximo de noites (27) e o horizonte do envio (270 noites ≈ 9 meses);
   - **feriados**, um por linha (data e nome). O sistema monta o feriadão sozinho pela regra
     aprovada: feriado na quinta → quarta a domingo; sexta → quinta a domingo; segunda → sexta
     a segunda; terça → sexta a terça; quarta, sábado e domingo não criam feriadão. No
     feriadão: mínimo 3 noites e preço = 2× o preço base (os dois editáveis), só nos imóveis
     que você marcar (Búzios pode ficar de fora). **Os feriados começam vazios**: você
     cadastra as datas de cada ano depois de conferir;
   - **temporadas e eventos** (alta temporada, Réveillon, Carnaval, Rock in Rio): noites,
     multiplicador do preço base (2×, 3×, 4×…), mínimo de noites e imóveis. Dois eventos na
     mesma noite nunca somam: vale o maior. Também começam vazios;
   - **última hora**: duas faixas pela antecedência da noite (padrão: 7 a 3 dias antes 15%,
     2 dias antes até o próprio dia 25%) e quem aplica o desconto. O padrão é **"Beds24
     aplica"**, porque as regras nativas já estão configuradas nos seis imóveis: o SCL envia
     o preço de referência e, quando o desconto do Beds24 deixaria a diária abaixo do piso,
     envia um valor maior para que o resultado fique exatamente no piso. Se um dia você
     desligar as regras nativas, troque para "SCL aplica" e o SCL manda o preço já reduzido;
   - **imóveis com envio ligado** e o **envio automático diário** (7h, depois da importação).
2. **Ficha do imóvel → Preço e taxas:** dois campos novos, os **pisos de última hora** de cada
   faixa (ex.: 350 e 300 nos estúdios; 700 e 650 no 303). Sem piso cadastrado o sistema
   avisa e não reduz por conta própria. O preço base (B) e os períodos especiais continuam
   onde estavam; o preço explícito de um período substitui qualquer regra automática.
3. **Calendário → Bloquear datas:** bloqueio manual (uso próprio, manutenção) com imóvel,
   primeira noite, dia da liberação e motivo. Vale no SCL na hora e vai ao Beds24 como
   "fechado" no próximo envio; remover (com confirmação) reabre no próximo envio, devolvendo
   a noite ao que ela tinha antes (se o Beds24 já restringia a entrada ou a saída naquela
   data, essa restrição volta). Bloqueios que vieram do Beds24 aparecem, mas mudam lá. O SCL
   **nunca reabre** um bloqueio que ele mesmo não fechou, e só reabre o seu se a leitura
   feita na hora ainda mostrar esse bloqueio lá. Se um dia o quarto Beds24 vinculado a um
   imóvel for trocado, o SCL avisa e não mexe no quarto antigo: o que ele tinha fechado lá
   precisa ser reaberto à mão no Beds24. Se, ao bloquear, remover um bloqueio ou mudar o
   vínculo Beds24 de um imóvel, aparecer "há um envio de calendário em andamento", é só
   esperar um minuto e tentar de novo.
4. **Calendário → Conferir calendário e preços:** a prévia agora mostra, por noite, o preço
   de referência, o preço que seria enviado, o preço final esperado depois da última hora,
   o mínimo pela regra e o mínimo ajustado às **sobras** (se sobram 3 noites até a próxima
   reserva num período de mínimo 5, as entradas ficam com mínimo 3, 2 e 1), o máximo, o
   bloqueio e a última leitura do Beds24 — e a ação (enviar ou já igual). Embaixo, só para
   você: **Simular envio** (não grava nada; diz quantas noites iriam) e **Enviar agora**
   (pede confirmação e cobre todo o horizonte do imóvel). Todo envio (e toda simulação)
   começa lendo o Beds24 na hora: se essa leitura falhar, nada é enviado. Depois de enviar,
   o SCL relê o Beds24 e marca cada noite como confirmada ou divergente; o histórico guarda
   antes/depois, regra usada e resultado, inclusive quando o Beds24 recusou o envio.

Regras de segurança: só vão as noites diferentes do que o Beds24 já tem (repetir o envio
não muda nada nem acumula desconto, porque a referência é sempre recalculada do cadastro);
reservas nunca são criadas, alteradas ou canceladas por aqui; se o Beds24 mudar um valor
depois do envio, a prévia avisa e o SCL reenvia o valor oficial; o que não tem preço
cadastrado não vai; o que o SCL não entende (0 unidades livres sem reserva conhecida,
bloqueio só no Beds24) vira aviso, não ação.

**Como testar no 103 (ordem sugerida):**

1. Em Configurações → Calendário e preços, confira os mínimos e cadastre os feriados do
   restante de 2026 e de 2027 e os eventos (alta temporada 15/12 ao fim de fevereiro 2×;
   Réveillon 25/12 a 1/1 mínimo 5 e 4×; Carnaval mínimo 5 e 4×; Rock in Rio 3×), marcando os
   imóveis do Leblon. Marque o **103** em "imóveis com envio ligado". Deixe o automático
   desligado.
2. Na ficha do 103, confira o preço base (450) e cadastre os pisos (350 e 300).
3. Em Calendário → Conferir, escolha o 103, leia a prévia e clique em **Simular envio**.
   Confira os números e os avisos. Repita com datas de evento e com uma sobra entre reservas.
4. Na Vercel, crie `BEDS24_ESCRITA` = `ligada` (exatamente assim) e confira que o
   `BEDS24_REFRESH_TOKEN` foi gerado com o escopo **inventory** (um token só de leitura
   recebe "sem permissão de escrita"). Faça Redeploy.
5. Volte à prévia e clique em **Enviar agora** (marque a confirmação). Veja o resultado
   (enviadas × confirmadas), abra o Beds24 e o Airbnb e confira algumas noites normais, um
   fim de semana, um evento e a última hora de hoje/amanhã.
6. Teste um bloqueio: bloqueie 2 noites no Calendário, envie, confira no Beds24; remova o
   bloqueio, envie de novo, confira que reabriu.
7. Só então ligue o **envio automático diário** e, se quiser, marque os outros imóveis.

**Limites:** a releitura confirma o que o Beds24 gravou, não a cotação final no Airbnb
(taxas, limpeza, descontos por duração ficam fora). Última hora em grandes eventos,
reprecificação de sobras de Réveillon/Carnaval e as tarifas próprias de Búzios continuam
decisões suas: o sistema aplica as faixas em todas as noites, como as regras nativas fazem
hoje, e não inventa preço para Búzios (cadastre eventos próprios ou deixe fora). Dias de
entrada/saída restritos no cadastro ainda não são enviados.

### Conferir calendário e preços — preparação M3.7a

Em **Painel → Calendário → Conferir calendário e preços com o Beds24**, escolha um imóvel
e a primeira/última noite. O 103 vem selecionado se existir e estiver ativo; na ausência
dele, o 403. É possível consultar qualquer imóvel da empresa, inclusive arquivado, sem reativá-lo.
Administrador e operação podem consultar; proprietário, hóspede e limpeza não acessam a tela.

- Até **92 noites por consulta**, contando a primeira e a última. O resumo diz quantas
  noites têm leitura do Beds24; avance as datas para conferir o restante do horizonte.
- Por noite: preço calculado com o cadastro SCL, preço registrado no Beds24, mínimos,
  reservas/bloqueios locais e horário da leitura externa no fuso do imóvel.
- Valor ausente é mostrado como não informado. Mesmo valor não prova igualdade atual
  no Airbnb/Booking; zero ou ausência de reservas locais não prova disponibilidade.
- O administrador tem atalhos para o cadastro e a importação existente. A prévia lê apenas
  o que já foi importado; não faz uma nova consulta ao Beds24 ao abrir a página.
- **Preços explícitos de períodos especiais são preservados**, inclusive acima do teto
  geral ou abaixo do piso. Os limites se aplicam ao preço base quando habilitados. Isso
  corrige também o simulador; não altera valores de reservas ou tarifas dos canais.

**O que você pode conferir agora:** comece pelo 103, compare algumas noites normais e de
evento com o Beds24 e veja se o cadastro representa o que você pretende usar. A cobertura
depende do intervalo importado; a prévia mostra suas lacunas.

**Atualização M3.7:** as regras operacionais, o envio com conferência e o histórico estão
implementados (seção acima). O teste no imóvel escolhido e a ativação continuam com você.

### Anúncios — atualização M2.9

Em **Painel → Anúncios**, cada imóvel tem um quadro com **Site, Airbnb e Booking.com**.
O filtro de imóveis do painel vale aqui; mês e ano não alteram anúncios. Por padrão aparecem
os ativos; é possível incluir arquivados ou selecioná-los explicitamente.

- **Site:** título, descrição e preço base vêm do cadastro do imóvel. O atalho leva ao mesmo
  cadastro para editar; não há uma segunda cópia. A situação respeita a empresa configurada
  para o site, a marcação público e o imóvel ativo. O preço base é referência interna: a
  cotação pública ainda depende do M7.2. As fotos reais continuam pendentes no M7.3.
- **Airbnb e Booking:** o administrador abre “Editar referência”, informa situação, link,
  título, descrição, preço base em reais e até 30 links de fotos. Pode marcar que conferiu no
  canal agora; a tela guarda a data e mostra no horário de Brasília. Ao editar sem marcar,
  a referência volta a aguardar conferência. A equipe de operação pode consultar, mas não editar.
- **Diferenças:** a tela compara os valores conhecidos de cada par de canais. Ausência não
  vira zero nem prova igualdade. Preços diferentes podem refletir taxas/regras do canal;
  links ou ordem de fotos diferentes pedem conferência visual, não provam imagens diferentes.
- **Limite:** são referências manuais, não uma leitura automática das OTAs. A importação de
  reservas do Beds24 não preenche estas fichas. Os IDs existentes são mostrados sem alterá-los
  e não comprovam publicação. Com vários IDs no mesmo canal, a tela avisa que a ficha é uma
  referência principal e que os demais anúncios precisam ser conferidos no canal.
- **Salvar** altera só a referência interna e registra histórico na ficha do imóvel. Não
  publica anúncios, não troca preços nas OTAs e não copia fotos para o site. Uma ficha que
  mudou em outra aba não é sobrescrita: a tela pede para recarregar e conferir.

**Como conferir:** escolha um imóvel, abra o anúncio no canal, preencha uma referência e
salve com a confirmação manual. Verifique a data, os links e os alertas. Reabra a tela para
confirmar que os dados persistiram. A operação deve conseguir ler, sem botões de edição.

**Próximo teste de envio (M3.7):** usar o 103; o 403 fica como alternativa autorizada por
Diego em 2/10. A implementação e a ativação do envio ainda estão pendentes.

### Conferência das reservas — atualização M3.8

Depois de publicar esta atualização:

1. Em **Configurações → Integrações**, faça **Importar agora** novamente. Não é preciso refazer vínculos: os mesmos registros e códigos SCL são preservados. O SCL continua apenas lendo o Beds24.
2. Em **Reservas**, há atalhos para **reservas mais recentes na origem** e **consultas**. A lista por período começa apenas com imóveis ativos. Use **Todo o histórico importado/cadastrado** para pesquisar sem o recorte de mês/ano da estadia; sem uma seleção de imóveis, inclui também os arquivados. Eles continuam identificados no filtro e podem ser selecionados explicitamente em qualquer escopo.
3. Busque por código SCL, código do canal ou nome; escolha situação, data de entrada ou mais recentes na origem, e opcionalmente últimos 7 ou 30 dias. A lista mostra 25 registros por página, total, primeira/anterior/próxima/última página, mantendo os filtros.
4. **Feita em (origem)** usa a data informada pelo Beds24, exibida no horário de Brasília. É diferente de **Cadastrada no SCL em**, no detalhe. Data não informada fica explícita, no fim da ordenação por mais recentes e fora dos filtros de 7/30 dias. Não usamos a importação como substituta. Na primeira conferência, compare uma data conhecida com o canal original.
5. **Consulta** não é reserva confirmada, não ocupa o calendário, não cria alerta de sobreposição e não gera receita. **Pedido de reserva** ainda não é receita e mantém a restrição de datas anterior até o status mudar na origem. Pendentes antigas só são distinguidas quando o Beds24 devolve o status; não se transforma todo registro pendente em consulta por suposição.
6. O resumo da última importação separa **adicionadas ao SCL**, **alteradas** e **canceladas**, com links para os registros. Cancelada significa que uma reserva existente mudou para esse estado naquela importação. Atualizar dados de uma reserva que já estava cancelada conta como alteração; trazer uma reserva cancelada pela primeira vez conta como adicionada ao SCL. A lista de cada execução começa nesta atualização; importações anteriores não ganham histórico inventado. Os detalhes dos registros mostram o estado atual; o histórico individual registra as alterações.

Não precisa preencher descrições dos apartamentos para importar. A melhoria não ativa a rotina diária, não envia mudanças às OTAs e não altera a configuração dos canais. Para conferir: encontre uma consulta pelo código, confirme seu rótulo após reimportar e confira as mesmas datas no calendário; repita a importação e verifique que não surgiram duplicatas. A primeira releitura pode aparecer como alteração apenas por recuperar a data original/status.

**Itens já prontos (na `main`):**
- M0.1: repositório limpo, plano único (ROADMAP) e regras para o Claude.
- M0.2: esqueleto do aplicativo, com testes automáticos.
- M0.3: conexão com o banco de dados (Neon) e banco de teste automático.
- M0.4: **painel interno com menu e filtro global** (imóveis + mês/ano). Todas as seções
  aparecem no menu, marcadas como "em construção" até ganharem conteúdo. Funciona no
  celular: o menu vira uma faixa que desliza para o lado.
- M1.1: **quem pode ver e fazer o quê.** Existem quatro papéis:
  - **admin** (você): pode tudo;
  - **operação** (equipe): reservas, calendário, limpezas, manutenção e mensagens, mas **não vê o financeiro**;
  - **proprietário**: só **lê** (imóvel, reservas, calendário e financeiro), e **só dos imóveis dele**. Representantes
    autorizados veem o mesmo que o proprietário que representam;
  - **hóspede**: não entra no painel; vê só a própria reserva em "Minha reserva" no site (M9.1).

  O vínculo proprietário ↔ imóvel é sempre cadastrado explicitamente, nunca deduzido por e-mail ou CPF.
  Tudo o que não está permitido é bloqueado.
- M1.2: **login com Google.** O painel só abre para quem entra com uma conta Google
  cadastrada (admin ou operação). Seu e-mail vira administrador automaticamente no
  primeiro login (configurado na Vercel, fora do GitHub). Tem botão "Sair" no topo.
- M1.3: **login por código no e-mail** (para quem não usa Google, como proprietários e
  equipe). A pessoa digita o e-mail, recebe um código de 6 dígitos e entra. Segurança:
  o código vale **10 minutos**, só pode ser usado **uma vez**, **5 erros** bloqueiam o
  código, no máximo **5 pedidos por hora** por e-mail, e pedir um novo cancela o anterior.
  A tela responde sempre igual, exista ou não o e-mail (e mesmo se o serviço de e-mail
  falhar), para ninguém descobrir quem tem acesso. Só recebe código quem está cadastrado e
  ativo; se o envio falhar, o código anterior continua valendo. Para funcionar na internet
  falta um serviço de envio de e-mail (seção 6, item 5).
- M1.4: **convite de proprietário para o portal.** Na ficha do proprietário, seção
  "Acesso ao portal": você digita o e-mail dele e clica em **Gerar convite**. Aparece um
  link para copiar e mandar (por WhatsApp, por exemplo; se o e-mail do sistema estiver
  ligado, ele também recebe por e-mail). O proprietário abre o link, clica em "Aceitar e
  entrar" e entra com **aquele e-mail** (código ou Google) — só assim o convite é aceito.
  O link vale **7 dias**, funciona **uma vez só** e você pode **cancelar** a qualquer
  momento; a ficha mostra a situação (pendente, aceito, cancelado, vencido) e o histórico
  registra quem convidou e quando foi aceito. Quem só tem o link, sem acesso ao e-mail,
  não entra. Depois de entrar, o proprietário vê o **Portal do proprietário** (por
  enquanto só os imóveis dele; relatórios e saldo chegam no M5) e **não** consegue abrir
  o painel interno.
- M1.6: **página "Sistema"** (menu **Sistema**, só para você). Três partes:
  - **Serviços:** banco, login com Google, e-mail, Beds24, WhatsApp e pagamentos — cada um
    com "Funcionando" (testado na hora, como o banco), "Configurado" (chave existe), "Falta configurar", "Com problema" ou "Ainda não construído", e o que
    falta. Nenhuma chave ou senha aparece. Mostra também se o envio para o Beds24 está
    ligado ou desligado.
  - **Automações:** o que roda sozinho, quando roda, a última vez que rodou e o resultado
    (as que ainda vão existir aparecem com o item do plano em que chegam).
  - **Regras em vigor:** as regras gerais e, para cada imóvel, o proprietário, o contrato de
    hoje (e o próximo, se já estiver cadastrado) e quem recebe em cada canal, com o botão
    **Editar**. O que estiver faltando (imóvel sem contrato, sem proprietário) aparece em
    vermelho.
- M1.7: **Configurações** (menu **Configurações**, só para você), com abas:
  - **Empresa:** nome, razão social, CNPJ, e-mail, telefone/WhatsApp, endereço e site. O
    nome aparece no painel, no portal do proprietário e nos e-mails de convite e de código.
  - **Usuários e permissões:** adicionar alguém da equipe (nome, e-mail e papel:
    Administrador ou Operação), trocar o papel, renomear, desativar (pede confirmação e
    corta o acesso na hora) e reativar. Você não consegue se desativar nem tirar o seu
    próprio papel, e o sistema nunca deixa a empresa sem nenhum administrador. Embaixo, uma
    tabela mostra o que cada papel pode fazer. Proprietários continuam entrando por convite.
  - **Regras financeiras:** sobre qual valor a comissão é calculada e **quem recebe em cada
    canal** (canal paga o proprietário direto, empresa recebe e repassa no mês, ou "a
    confirmar"). É o padrão da empresa; cada imóvel e cada reserva ainda podem ter a sua
    escolha. Ao salvar, pede confirmação e recalcula só as reservas com entrada **de hoje em
    diante**, e mostra quantas foram recalculadas. O sistema guarda cada versão da regra com
    a data em que passou a valer: uma reserva antiga continua com a regra da época, mesmo que
    o Beds24 a mande de novo.
  - **Integrações:** a situação de cada serviço e o nome exato da variável que vai na
    Vercel. Chaves e senhas nunca ficam no painel.
  - **Categorias de despesa:** as mesmas da tela de Despesas, também editáveis aqui.
  - **Modelos de mensagem:** quatro modelos prontos (confirmação, instruções de check-in,
    lembrete de check-out e agradecimento) que você edita, arquiva ou exclui, e pode criar
    outros. Use variáveis como `{hospede}` e `{checkin}`; a tela mostra uma prévia com dados
    de exemplo e recusa variável escrita errada (ex.: `{hopede}`). O envio automático chega
    no M9.2 e no WhatsApp (M10).
  - **Textos do site:** título, subtítulo, "sobre", "como reservar", contato e rodapé. O site
    novo (M7.1) vai ler daqui.
  Toda mudança fica no histórico com quem fez e quando.
- M2.1: **cadastro de imóveis** em Painel → Imóveis: código (102, 403, buzios…), nome
  comercial, bairro, endereço, capacidade, quartos, banheiros, descrição, se **aparece no site**
  e se está **em operação**. O filtro global do painel passa a usar essa lista. Búzios deve ser
  cadastrado com "Aparece no site" desmarcado. Só o admin cadastra/edita; a equipe só consulta.
- M1.5: **histórico de alterações.** Toda mudança fica registrada com quem fez, quando e o
  que mudou (ex.: "Diego alterou · Nome: Studio A → Studio B"). Aparece embaixo da ficha de
  cada imóvel e vai valer para todos os módulos (reservas, financeiro…). O histórico não pode
  ser apagado pelo sistema.
- M2.6: **cadastro completo do imóvel**, na página de cada imóvel (Painel → Imóveis → abrir):
  - **Endereço:** CEP, complemento e estado, além do que já existia.
  - **Camas e comodidades:** quantas camas de cada tipo (casal, queen, king, solteiro,
    sofá-cama, beliche, colchão extra) e a lista de comodidades para marcar, com espaço para
    outras.
  - **Regras da casa e horários:** animais, fumar, festas, texto de regras para o hóspede,
    horário de entrada e de saída.
  - **Preço e taxas:** preço base da noite, taxa de limpeza, hóspede extra (valor por noite e
    a partir de qual hóspede) e **preço dinâmico** (liga/desliga, com preço mínimo e máximo —
    o valor nunca sai dessa faixa; o cálculo dinâmico automático chega com o M3.7).
  - **Regras de venda:** estadia mínima e máxima, antecedência mínima, até quantos dias à
    frente aceita reserva, e em quais dias da semana pode entrar e sair.
  - **Períodos especiais:** Réveillon, Carnaval etc., com preço da noite e/ou estadia mínima
    próprios. Dois períodos não podem se cruzar; excluir pede confirmação.
  - **Simular uma estadia:** escolha datas e hóspedes e veja se pode ser vendida (e por quê
    não, se for o caso) e quanto dá: diárias, limpeza, hóspede extra e total. Se faltar preço
    em alguma noite, o total fica "pendente" com aviso — o sistema não inventa valor.
  Campo em branco significa "ainda não cadastrado". Tudo vai para o histórico do imóvel. O
  site, o Beds24 (M3.7) e as cotações vão usar estas mesmas regras.
- M2.2: **cadastro de proprietários** em Painel → Proprietários: nome/razão social, pessoa
  física ou jurídica, CPF/CNPJ (conferido automaticamente), e-mail, telefone, endereço,
  **chave Pix**, observações e **quais imóveis são dele**. Cada proprietário pode ter
  **representantes autorizados** (cônjuge, financeiro, procurador), com opção "recebe cópia dos
  relatórios". Essa área é **só do admin** (tem dados pessoais); na lista o CPF aparece
  mascarado (•••.•••.247-25) e o histórico nunca grava CPF nem Pix por extenso.
- M2.3: **contratos de gestão com data de início e fim**, na ficha de cada imóvel: gestão
  completa (sugestão 15%), gestão online (10%) ou marketplace (fórmula ainda a definir).
  Mudou o percentual? Encerra-se o contrato atual e cria-se um novo a partir da data nova —
  assim reservas antigas continuam com a regra da época (ex.: 102, 303 e 399 voltando a
  15/85 em 01/01/2027 = novo contrato começando nessa data). O sistema não deixa dois
  contratos valerem no mesmo dia. Só o admin mexe em contratos.
- M2.4: **canais de cada imóvel** — na ficha do imóvel, os números dele no Beds24, Airbnb e
  Booking. É por aí que, quando ligarmos o Beds24, o sistema vai saber a qual imóvel cada
  reserva pertence. Um mesmo número não pode ficar ligado a dois imóveis.
- M3.1: **base das reservas e bloqueios** (ainda sem tela — a lista e o calendário vêm nos
  próximos itens). Cada reserva tem código SCL próprio (ex.: SCL-7K2QXM), origem (Airbnb,
  Booking, site, direta), entrada/saída, hóspedes, valores (bruto, taxa do canal, líquido — o
  líquido pode ficar "desconhecido" em vez de inventado) e situação. Quando o Beds24 for
  ligado, rodar a sincronização duas vezes não duplica nada, e toda mudança vinda de lá fica
  no histórico. O sistema também já sabe detectar **overbooking** (duas reservas no mesmo
  imóvel no mesmo dia).
- M3.5: **tela de Reservas** no painel: lista filtrada pelo filtro do topo (imóveis + mês/ano),
  com código, imóvel, origem, entrada, saída, noites, hóspede, valor e situação; aviso em
  vermelho se houver overbooking; opção de mostrar canceladas; **"Nova reserva"** para lançar
  à mão (reservas diretas/WhatsApp); ficha de cada reserva com botão de cancelar e histórico.
  A equipe de operação vê as reservas, mas **não vê valores**.
- M3.4: **Calendário central** — todos os imóveis numa grade do mês, uma linha por imóvel,
  reservas coloridas por canal (Airbnb, Booking, site/direta), bloqueios listrados e
  **overbooking com borda vermelha**. Clique/toque numa reserva abre a ficha. Setas para mês
  anterior/seguinte; no celular a grade desliza para o lado com a coluna dos imóveis fixa.
- M2.5: **dados de demonstração** — um comando carrega 6 imóveis, 3 proprietários, contratos e
  ~37 reservas **fictícias** para testar/mostrar o sistema (nunca roda por cima de dados reais).

- M3.2: **leitura do Beds24 (só leitura).** O sistema já sabe ler do Beds24 as reservas,
  os bloqueios, o calendário (unidades livres, preço e estadia mínima) e a lista de
  quartos. **Por enquanto não escreve nada lá** (a escrita de calendário e preços vem no
  M3.7, ligada só quando você mandar). Cada reserva do Beds24 é ligada ao imóvel certo pelos
  "canais de cada imóvel" (na ficha do imóvel: canal Beds24, número do imóvel no Beds24 e,
  como detalhe, o número do quarto). Qualquer informação estranha vira uma
  **divergência** para conferir — nunca uma reserva inventada. O refresh token cadastrado
  na Vercel agora gera e renova automaticamente o token de acesso. Em **Configurações →
  Integrações → Testar conexão com Beds24**, o administrador confere a leitura dos imóveis.
  Esse teste não importa reservas; a importação é feita na seção abaixo, entregue no M3.3.
- M3.3: **trazer os dados do Beds24 para o SCL.** Em **Configurações → Integrações**,
  busque os quartos e escolha o imóvel SCL correspondente a cada um. O vínculo precisa
  dos números do imóvel e do quarto Beds24; a tela preenche esses números pela sua escolha.
  Salve a data inicial das reservas e quantos dias de calendário quer consultar (até 365).
  Depois, confira os vínculos, marque a confirmação e clique em **Importar agora**.
  - A mesma reserva não é criada de novo a cada execução. Se já veio por planilha, é
    reconhecida pelo canal Airbnb/Booking e pelo código da reserva, preservando o código
    SCL e o histórico. Sem código comum não há como reconhecer automaticamente; confira
    possíveis duplicidades antes do primeiro teste. Depois de vinculada ao Beds24, a
    planilha não substitui seus dados.
  - Cancelamentos precisam vir explicitamente do Beds24. Reserva ou bloqueio que não
    aparece na consulta fica como estava e gera aviso. Quartos sem vínculo não são
    importados. Moeda diferente de real, ou não informada, impede a importação financeira.
  - Valores realizados/conciliados não são reescritos. Alterações em reservas já iniciadas
    também preservam o financeiro anterior; divergências pedem conferência e ajuste manual.
    Contato corrigido no painel e anotações são preservados. A importação não dispara uma
    confirmação atrasada de reserva; as demais regras de mensagens continuam valendo.
  - Preço, estadia mínima e unidades livres ficam guardados como **observações** do calendário
    do Beds24. Dia não retornado é desconhecido. Isso ainda não liga cotações ou vendas no site.
  - O histórico mostra as últimas dez execuções e até cem avisos por execução. Uma falha
    técnica durante o processamento desfaz a transação; registros inválidos são separados
    para conferência, sem inventar dados.
  - A rotina automática começa **desligada**. Depois da conferência manual, pode ser ligada
    no mesmo painel. Roda uma vez por dia, entre **6h15 e 7h15**, horário de Brasília,
    com o agendamento configurado na Vercel. Pode importar manualmente entre as execuções.
    Essa frequência inicial não garante disponibilidade atualizada para vendas; uma rotina
    mais frequente precisa ser definida antes de usar a disponibilidade real do M7.2.
  - Nenhuma mudança é enviada ao Beds24 ou ao Airbnb nesta etapa. O envio é o M3.7.
- M2.7: **quem recebe o pagamento, por imóvel e por canal.** Na ficha de cada imóvel, seção
  "Quem recebe o pagamento": para Airbnb, Booking, site, direta (WhatsApp, indicação) e
  outros, você escolhe "canal paga o proprietário direto" ou "empresa recebe e repassa" (ou
  deixa o padrão: Airbnb direto ao proprietário, os demais pela empresa). Ao salvar, o
  financeiro das reservas daquele imóvel é recalculado. Uma reserva específica ainda pode ter
  sua própria escolha. **Um proprietário por imóvel** (pessoa ou empresa): o sistema não
  deixa ligar um imóvel que já tem dono a outro proprietário — primeiro tira de um, depois
  põe no outro.
- M3.6: **importar reservas de uma planilha** (Painel → Reservas → **Importar planilha**),
  enquanto o Beds24 não está ligado. Baixe o modelo, preencha (ou exporte de outro lugar) e
  salve do Excel como "CSV separado por ponto e vírgula". Colunas obrigatórias: imóvel
  (código, ex.: 403), origem (airbnb, booking, site, direta ou outro), código da reserva no
  canal, entrada e saída (DD/MM/AAAA). Opcionais: situação, hóspedes, nome, e-mail,
  telefone, cidade, valor bruto, taxa do canal, valor líquido, observações.
  - Primeiro o sistema **confere** (não grava nada) e mostra linha a linha: nova, a atualizar,
    já importada e igual, ou com erro (e qual o erro). Também avisa se a reserva cruza com
    outra no mesmo imóvel.
  - Depois você clica em **Importar**: só as linhas sem erro entram, e o financeiro de cada
    reserva é calculado na hora. Se faltar algo para o cálculo (valor bruto, contrato do
    imóvel), a reserva entra e a tela avisa a linha. Se uma reserva que já teve dinheiro movimentado mudar na
    planilha, o sistema atualiza a reserva, deixa o financeiro como está e avisa a linha,
    para você fazer o ajuste manual.
  - Até 500 reservas por arquivo (arquivos maiores: divida em partes). O histórico de cada
    reserva mostra quem importou.
  - Importar o mesmo arquivo de novo **não duplica**: a reserva é reconhecida pela origem +
    código do canal, e o que mudou é atualizado.
  - Acentos funcionam tanto em arquivo do Excel brasileiro quanto em UTF-8. Arquivo com
    aspas abertas sem fechar é recusado (evita sumir com linhas). Só o
    administrador importa (a planilha traz valores).
- M4.4: **adiantamentos** (Painel → Despesas → **Adiantamentos**). Quando a empresa paga uma
  despesa que é do proprietário (ex.: reparo de R$ 4.000), nasce um adiantamento: o valor que
  ele deve. A tela mostra, por proprietário, quanto há a cobrar e o que está contestado, e a
  lista de adiantamentos com a situação (a cobrar, parcialmente quitado, quitado, contestado).
  Em cada um você pode:
  - **registrar reembolso** (total ou parcial) quando o proprietário devolver o dinheiro;
  - **registrar contestação** — enquanto estiver contestado, ele não é cobrado nem descontado;
    depois você resolve: **manter a cobrança** ou **a empresa assume** o valor (vira custo da
    empresa e a dívida some);
  - **desfazer** uma quitação lançada errado (com motivo; o histórico fica).
  O que não for reembolsado é **descontado no repasse mensal** (M4.9) quando você fecha o
  mês, se o proprietário tiver o que receber. **Sem dupla
  cobrança:** nunca se quita mais do que o valor, duas pessoas quitando ao mesmo tempo não
  passam do total, e uma despesa cujo adiantamento já teve reembolso não pode ser estornada
  (desfaça a quitação antes).
- M6.1: **limpezas** (Painel → **Limpezas**). Toda reserva confirmada gera a limpeza **no dia
  da saída**, mesmo sem nova entrada e em fim de semana. Cada limpeza passa por estados
  separados, porque pedir não comprova que aconteceu:
  - **Pedida** → **Confirmada** (com a profissional escolhida) → **Realizada** (quem fez e,
    se quiser, o **custo**; o custo pode ficar para depois e aparece como pendente);
  - se a reserva muda de data ou de imóvel, a limpeza acompanha e volta a "pedida" (precisa
    confirmar de novo); se a reserva é cancelada, a limpeza é cancelada;
  - depois de realizada, nada muda sozinho: se a reserva mudar ou for cancelada, aparece um
    **aviso** para conferir;
  - limpeza cuja data passou sem registro aparece com aviso — o sistema **não** marca como
    feita por conta própria;
  - dá para criar **limpeza avulsa** (ex.: antes do uso do proprietário), **cancelar** (com
    motivo e confirmação) e **desfazer** um "feita" marcado por engano.
  - nos imóveis de **gestão completa**, o **custo** informado vira uma **despesa da empresa**
    (na categoria escolhida no fim da tela de Limpezas — começa em "Limpeza e lavanderia" e
    pode ser renomeada à vontade em Despesas —, a pagar), no imóvel e no dia da limpeza, e entra no
    resultado do Início e da aba Apartamentos. Em contrato online ou sem contrato, o sistema
    não supõe quem paga: avisa para lançar em Despesas. Mudar o custo ou desfazer o "feita" corrige a despesa sozinho; se a despesa
    já foi paga, o sistema não mexe e pede para corrigir em Despesas.
  As **profissionais** são cadastradas na própria tela (nome, telefone, observações) e
  arquivadas quando saem. A equipe de operação vê e registra as limpezas, sem ver custos.
- M6.6: **profissionais de limpeza pelo celular**. Em Limpezas → **Profissionais**, você põe o
  e-mail da profissional e aperta **"Liberar acesso"** (pede confirmação):
  - ela entra no sistema com o e-mail dela (recebe um código por e-mail) e cai direto na tela
    **"Minhas limpezas"**: só as limpezas confirmadas com ela, de alguns dias atrás até as próximas
    duas semanas, com o imóvel, o endereço, o horário de saída e, quando alguém entra no mesmo dia,
    o horário-limite para deixar pronto;
  - ela aperta **"Marcar como feita"** (pede confirmação) a partir do dia da limpeza. O custo
    continua sendo informado por você no painel: ela **não vê custo**, proprietário nem financeiro;
  - quando você confirma uma limpeza com ela, ela recebe um **e-mail** avisando (o WhatsApp entra
    quando o M10 estiver ligado);
  - **"Tirar acesso"** (ou arquivar a profissional) corta a entrada na hora.
- M6.3 e M6.7: **agenda diária da equipe** (Painel → **Agenda**). Todo dia às **20h** quem você
  escolher recebe por e-mail a agenda, com **Rio e Búzios separados** (cada seção é a cidade do
  cadastro do imóvel; nada é somado). O texto segue o **modelo que você definiu em 23/09** e o
  **pedido de 2/10** (Rio 5 dias, Búzios 30 dias):
  - **Rio (vários apartamentos), 5 dias:** um dia por linha, **só com as limpezas** (limpeza =
    dia de checkout). Nos dias vazios aparece "nenhuma limpeza". Limpeza já marcada como
    realizada, sem uso do imóvel depois, não volta para a lista. Quando alguém entra no mesmo
    dia, sai o horário-limite ("pronto até 15h, entra Ana, 2 hóspedes"). As **entradas, saídas e
    chaves** vão num bloco separado, com primeiro nome, nº de hóspedes, horários e telefone
    operacional do hóspede (só quando está no cadastro da reserva; nunca tirado da conversa);
  - **Búzios (casa única), 30 dias:** todas as reservas do período, uma por linha, com entrada,
    saída, horários, nº de hóspedes e telefone, e "troca no mesmo dia: conferir limpeza" quando
    uma sai e outra entra no mesmo dia;
  - **horários combinados com o hóspede (M6.7):** na ficha da reserva, a equipe registra um
    **pedido** de horário de entrada ou saída (canal e referência da conversa) e, depois do
    aceite do hóspede, o **acordo confirmado**. A agenda mostra "13:30 (confirmado com
    hóspede)" em vez do padrão; sem acordo, vale o horário do cadastro do imóvel ou o padrão da
    agenda. Mudou data ou imóvel, o acordo precisa ser refeito. Nada é lido das conversas
    automaticamente nem enviado ao hóspede;
  - **Rio e Búzios têm formato fixo** pela sua decisão de 2/10 (a tela mostra os dois travados);
    outra cidade que venha a existir pode ter o formato escolhido na tela (sem escolha, casa
    única vai por reserva e vários apartamentos por limpezas). Os horários padrão de entrada e
    saída (15h e 11h) continuam editáveis e valem só quando o imóvel não tem horário no
    cadastro. A tela mostra **o mesmo texto que a equipe vai receber**;
  - vêm também as **reservas novas desde a última agenda**, mesmo as de datas mais distantes;
  - termina com a frase padrão "Essa é a agenda atual e ainda pode mudar…". A agenda **só
    informa**: não confirma limpeza nem preparação;
  - do hóspede vai só o **primeiro nome** e o número de pessoas, **sem código de reserva**.
    Quando o número de pessoas não está na reserva, a agenda avisa em vez de adivinhar;
  - na mesma tela você cadastra **quem recebe** e, para cada pessoa, as cidades que ela
    recebe (sem cidade marcada = todas). Também liga ou desliga o envio das 20h e tem o botão
    **"Enviar agora"** (pede confirmação).
  - Cada pessoa recebe **uma vez por dia**. O envio das 20h aparece em **Sistema →
    Automações**, com "falhou" quando não deu certo; o "Enviar agora" fica no histórico de
    alterações e mostra na tela quantos saíram e quantos falharam.
- M5.4: **e-mail do fechamento aos proprietários** (Painel → Financeiro → **Repasses**, no
  quadro "E-mail do fechamento"):
  - a partir do **dia 1º**, todo dia às **9h**, cada proprietário recebe **uma vez** o
    relatório do mês anterior em **PDF** (o mesmo do portal), com o valor do repasse no texto.
    Os **representantes** marcados para receber relatórios vão em cópia. Quem tem imóvel mas
    ficou com saldo zero no mês também recebe;
  - mês fechado **com atraso** também sai (o envio olha os meses desde que foi ligado, até 12
    para trás). Se o provedor não confirmar um envio por mais de um dia, o sistema **não repete
    sozinho** (poderia chegar duas vezes): a tela mostra "sem confirmação" e você decide se envia de novo;
  - só sai **depois que o mês dele está fechado**: repasse gerado, ou nada a repassar e sem
    pendência. Quem ainda tem pendência (acerto a conferir, ajuste a esclarecer) espera, e a
    tela mostra quem ficou; quem está **sem e-mail** no cadastro também aparece;
  - o **assunto** e o **texto** são editáveis na tela (use {nome} e {mes}). Começa
    **desligado**: você liga quando quiser;
  - em cada proprietário há o botão **"Enviar e-mail do fechamento"** e, depois de enviado,
    **"Enviar e-mail de novo"** (os dois pedem confirmação). Há também "Enviar agora para os
    prontos";
  - o envio das 9h aparece em **Sistema → Automações**; cada e-mail enviado fica no histórico
    do proprietário;
  - o PDF automático vai **sem o extrato do canal e sem a foto** (esses anexos continuam
    manuais, na ficha do proprietário).
- M5.1: **portal do proprietário** (o que o proprietário vê ao entrar com o e-mail dele):
  - escolhe os **imóveis dele** (quem tem mais de um marca quais quer ver), o **mês** ou o
    **ano inteiro**;
  - setas para o mês anterior e o seguinte, **até 9 meses para trás e 9 para a frente**; fora
    disso aparece um aviso e a tela volta ao limite;
  - o **mês atual aparece como "Parcial"** (ainda pode mudar) e os meses futuros como
    **"Previsto"** (só reservas já confirmadas);
  - números do período, **só com o que é dele**: reservas, valor bruto, taxas dos canais,
    comissão da empresa, **sua parte**, despesas atribuídas a ele e o acerto do período (quem
    passou a dever a quem). Se o imóvel trocou de dono, o novo proprietário não vê o histórico
    do anterior.
  O PDF chegou no M5.3 (abaixo).
- M5.3: **relatório do mês em PDF**, no modelo que você aprovou (verde sálvia, areia e
  dourado, títulos com serifa):
  - **primeira página:** nome da empresa e contatos, o mês, o nome comercial do imóvel (sem
    código), o proprietário e o representante que recebe relatórios, o período, e os números
    (os mesmos do portal). O valor em destaque é a **parte do proprietário**, com a base
    escrita embaixo: não é o total do canal nem lucro. Depois vêm a tabela de reservas (do
    hóspede, só o primeiro nome) e o saldo com a empresa. No mês atual, o PDF diz que é
    **parcial**, com a posição do dia, e que já inclui as reservas confirmadas até o fim do mês
    (como no portal);
  - **extrato oficial do canal** nas páginas seguintes, copiado como veio, sem redesenhar. Dá
    para usar só algumas páginas (ex.: "1-2"), e a primeira página avisa quais foram usadas e
    quantas o extrato tem. Sem extrato anexado, avisa "não anexado a esta versão";
  - **no painel:** na ficha do proprietário (mesmo arquivado), o link **Relatório do mês em PDF**. Lá você
    escolhe o mês e os imóveis, e pode anexar a **foto real** do imóvel e o **extrato** (até
    2 MB cada). Os arquivos servem só para montar o PDF: **não ficam guardados** no sistema.
    Cada PDF gerado fica registrado no histórico do proprietário (mês, imóveis e se levou foto
    ou extrato; nunca o conteúdo);
  - **no portal:** o proprietário baixa o PDF do mês que está vendo, só dos imóveis dele. Essa
    versão não tem foto nem extrato.
- M5.2: **reservas, calendário e saldo no portal do proprietário:**
  - **tabela de reservas** do período, com imóvel, entrada, saída, hóspede, valor bruto, a
    parte dele, situação (definido, em conferência ou sem cálculo ainda), canal e a origem que
    o hóspede informou. Origem não informada fica "não informada": o sistema não adivinha;
  - **calendário do mês** com as reservas e os bloqueios dos imóveis dele. Tocar numa reserva
    leva à linha dela na tabela, com os valores;
  - **saldo com a empresa**, somando todos os imóveis dele e já com os repasses. Enquanto o mês
    não terminou ou há algo em conferência, aparece como **parcial**, sem quem paga e sem Pix.
    Com o mês terminado e sem pendências, mostra o **credor**:
    - se a empresa deve, o valor e a chave Pix dele;
    - se ele deve, o valor e a **chave Pix da empresa**, com botões para copiar a chave e o valor.
    Depois do fechamento aparece "mês fechado" ou "pago em dd/mm". Tudo segue a mesma conta da
    tela de Repasses.
- M4.9: **repasse mensal aos proprietários** (Painel → **Financeiro** → Repasses). No dia 1º,
  a tela abre no mês anterior e mostra, para cada proprietário:
  - o **crédito dele até o fim do mês**, os **adiantamentos descontados** e os
    **contestados** (esses ficam de fora do desconto até você resolver);
  - o valor **a transferir**. Se o que ele deve for maior do que tem a receber, a tela diz
    quanto ele deve e nada é transferido (registre o reembolso ou fica para o próximo mês);
  - **avisos antes de fechar:** mês que ainda não terminou, acerto pendente (sem
    proprietário, "quem recebe" a confirmar, ajuste a esclarecer) — esses **impedem** o
    fechamento; lançamentos ainda previstos (dinheiro que pode não ter entrado) e falta de
    chave Pix aparecem como aviso.
  **Fechar mês e gerar repasse** (com confirmação) grava o repasse no livro e marca os
  adiantamentos descontados. Depois: **Copiar Pix**, **Copiar valor**, faça o Pix no banco e
  **Marcar como pago** com a data. Errou? **Estornar este repasse** (com motivo e
  confirmação) desfaz tudo: os adiantamentos voltam a ficar em aberto e o mês pode ser
  fechado de novo. Algo que entrar no mês depois do fechamento aparece como aviso e vai
  sozinho para o repasse do mês seguinte. Proprietário com mais de um imóvel recebe um
  repasse só; se um imóvel dele deu prejuízo, é compensado com o outro.
- M4.5: **ajustes e divergências** (Painel → **Financeiro** → Ajustes). Achou uma diferença
  (ex.: o Airbnb pagou R$ 150 a menos)? Registre no mesmo dia: data, reserva (código) ou
  imóvel, o efeito (entrou/saiu dinheiro da empresa, ou a empresa deve/o proprietário deve),
  o valor e **o que foi consultado** (obrigatório). Regras, como você pediu:
  - sem motivo conhecido, a descrição fica "Ajuste de reserva — motivo não identificado";
  - "feito pelo Airbnb" (ou outro) só aparece se você marcar **origem comprovada**;
  - valor desconhecido não é inventado: fica em branco e nada entra no financeiro até você
    completar;
  - o ajuste fica **pendente** até ser esclarecido, e só pode ser esclarecido com motivo e
    valor conhecidos. Depois de esclarecido, não muda mais (se precisar, registre outro).
  Dá para completar depois (motivo, origem, valor, comprovante); o financeiro é corrigido
  sozinho e o histórico guarda cada mudança. A página Financeiro mostra quantos ajustes
  estão pendentes (o painel com os números do mês chega no M4.6).
- M4.6: **tela inicial do painel** (Início) com os números do período escolhido no filtro
  (imóveis + mês ou ano):
  - **ocupação** (noites vendidas ÷ noites disponíveis; dias bloqueados não contam), total e
    por imóvel, com barras;
  - **receita bruta** das reservas, **taxas dos canais**, **comissões SCL**, **despesas da
    empresa** e **resultado da empresa** (comissões − despesas, mais os ajustes que afetam a
    empresa). O que é do proprietário e as taxas passam pela conta, mas não entram no resultado;
  - **gráfico** de receita e comissões mês a mês no ano, com o mês escolhido em destaque;
  - **entradas e saídas dos próximos 7 dias**, com link para a reserva;
  - **pendências e alertas**: reservas sobrepostas, imóvel sem contrato ou sem proprietário,
    reserva sem valor, acertos pendentes, ajustes a esclarecer, adiantamentos a cobrar ou
    contestados e despesas a pagar — cada um com link.
  A equipe de operação vê ocupação e entradas/saídas, sem valores. Os números vêm das mesmas
  fontes das outras telas, então batem com Reservas, Despesas e Financeiro.
- M4.7: **aba Apartamentos** (menu lateral): uma tabela com uma linha por imóvel e o total no
  fim, para o período do filtro:
  - do lado da **empresa**: reservas, ocupação, receita bruta, taxas, comissões, despesas da
    empresa, ajustes e **resultado da empresa** daquele imóvel;
  - do lado do **proprietário**, separado: despesas dele, o que mudou no acerto no período, o
    **saldo do acerto** acumulado (com "empresa deve" ou "proprietário deve") e os
    **adiantamentos a cobrar** (os contestados aparecem marcados);
  - **você escolhe como ver:** marque as colunas que quer, ou use **De/Até** para um intervalo
    de meses (até 36). Intervalo inválido não é adivinhado: aparece um aviso e vale o filtro;
  - com "todos os imóveis", entra também uma linha **Geral da empresa** (despesas sem imóvel)
    e os imóveis arquivados que tiveram movimento, então o total bate com o Início.
- M4.8: **conferência dos números entre as telas.** Um teste automático monta um mês com os
  casos que costumam dar diferença (estada que passa de um mês para o outro, reserva
  cancelada, reserva pendente, venda direta, despesa do proprietário e imóvel de outro dono) e
  confere que **Início, aba Apartamentos, portal do proprietário e PDF** mostram os mesmos
  valores (bruto, taxas, comissão, parte do proprietário, despesas, acerto e número de
  reservas). Ele achou uma diferença, já corrigida:
  - **reserva pendente** (ainda não confirmada) entrava na receita e no acerto do painel, mas
    não no portal. Agora ela **não entra em nenhum número** até ser confirmada; ao confirmar,
    aparece em todas as telas ao mesmo tempo. Reserva pendente feita no painel tem o botão
    **"Confirmar reserva"** na página dela. Ela continua ocupando o calendário e a agenda
    de limpezas, como antes. Pendentes antigas, calculadas antes desta mudança, são acertadas
    sozinhas na próxima publicação do sistema. Se uma reserva já tinha dinheiro recebido e
    voltou a ficar pendente, os valores continuam (nada que já movimentou dinheiro é mexido
    sozinho), mas ficam **em conferência**: o Início avisa, o portal e o PDF mostram a reserva
    marcada assim, e o fechamento do mês espera até você confirmar a reserva de novo (aí sai da
    conferência sozinha) ou fazer o ajuste manual e apertar **"Dar a conferência por resolvida"**
    na página da reserva (com confirmação; fica no histórico). Vale também para reserva cancelada
    nessa situação, e se a reserva mudar de novo em algo que pesa no dinheiro (situação, valor,
    datas, imóvel), a conferência volta; mudar só o nome ou contato do hóspede não reabre;
  - o contador de reservas do Início e da aba Apartamentos passou a contar **só as
    confirmadas**, igual ao portal e ao relatório.
- M6.5: **rotinas recorrentes** (menu **Rotinas**). Tarefas que se repetem, cada uma com a
  próxima data:
  - já vêm as cinco das regras de atendimento, nas datas combinadas:
    - **conferência das faxinas** toda segunda;
    - **consulta de manutenção**, separada para **Rio** e **Búzios**, de 15 em 15 dias contando
      de 21/09 (a próxima é 06/10);
    - **lembrete do dia 30**: fixos, contador, notas e condomínios. Em fevereiro cai no último
      dia e em março volta ao dia 30;
    - **caixinhas de fim de ano** em 1º de dezembro.
    Dá para mudar tudo na própria tela;
  - você cria, edita (nome, o que fazer, frequência, próxima data) e **arquiva** (com
    confirmação; o histórico fica). Arquivada não volta sozinha;
  - a equipe marca **"feita"** (com a data e uma observação) ou **"pular desta vez"** (motivo
    obrigatório). A próxima data vai para o vencimento seguinte depois do dia informado: quem
    atrasou três semanas não fica devendo três conferências;
  - nada fica "feito" sozinho: vencida e não registrada, a rotina aparece como **atrasada**.
- M6.4: **documentos de portaria** (menu **Portaria**). É só uma lista de controle:
  **nenhum documento, número ou foto é guardado** no sistema.
  - você marca na própria tela quais imóveis exigem documentos (hoje, o 403). Nada fica fixo
    no código;
  - para cada reserva confirmada desses imóveis nos próximos 30 dias, a tela diz o próximo
    passo:
    - **aviso inicial** na reserva;
    - **segundo pedido** entre 5 e 7 dias antes da entrada, se faltar documento;
    - **pedido final** na véspera;
  - reserva de última hora não recebe os três pedidos de uma vez. Depois da entrada, não há
    mais cobrança: fica só o registro do que falta;
  - a equipe registra quantos hóspedes já mandaram documento. Com todos completos, confere o
    destinatário e registra o **encaminhamento**, depois a **entrega confirmada**. Entrega não
    é aprovação da portaria;
  - dá para anotar uma **pendência** concreta (falha de entrega, dúvida). Tudo fica no
    histórico da reserva.
- M6.2: **manutenção** (menu **Manutenção**). Cada serviço segue quatro passos:
  - a equipe registra o **pedido** (imóvel e o que precisa ser feito) e depois o **orçamento**
    (quem vai fazer e o valor);
  - **você aprova** e escolhe **quem paga**: empresa ou proprietário. Nada é decidido pelo valor.
    Enquanto não aprovar, a tela avisa "não execute antes". Se chegar um orçamento novo depois
    da aprovação, ele volta para você aprovar de novo;
  - feito o serviço, a equipe registra a **data**;
  - quem cuida do financeiro **lança o custo final**. Ele vira uma despesa com o imóvel, o
    fornecedor e quem paga já preenchidos. Se o proprietário paga e a empresa adiantou, vira
    adiantamento a cobrar, como nas outras despesas.

  A tela avisa quando o custo passa do orçamento, quando falta lançar o custo e quando a
  despesa foi estornada. Também dá para recusar ou cancelar, sempre com motivo e confirmação.
  A equipe de operação cuida dos pedidos, mas não aprova nem lança custo.
- M4.1: **base do financeiro (o "livro" de lançamentos).** Cada fato financeiro vira um
  lançamento: valor bruto da reserva, taxa do canal, comissão SCL, parte do proprietário,
  recebimentos, repasses, despesas da empresa, despesas do proprietário, adiantamentos,
  reembolsos e ajustes. Regras que atendem ao que você pediu:
  - **nada é apagado nem editado** — erro se corrige com **estorno** (um lançamento espelho,
    com motivo), e tudo fica no histórico;
  - cada lançamento tem situação: **previsto, realizado, conciliado ou pendente** (reserva
    futura não é dinheiro recebido);
  - separa o **resultado da empresa** do **acerto com o proprietário** ("quem deve quanto a
    quem"): ex. a empresa adianta R$ 4.000 de reparo → o proprietário fica devendo R$ 4.000; o
    saldo só zera quando houver reembolso/compensação registrado — e isso não vira receita nem
    despesa duplicada da empresa;
  - valores sempre em centavos, sem arredondamento escondido.
- M4.2: **cálculo automático de cada reserva.** Ao lançar, importar, alterar ou cancelar uma
  reserva, o sistema gera (ou corrige com estorno) os lançamentos: valor bruto, taxa do canal,
  **comissão SCL** pelo contrato vigente na data de entrada, e **parte do proprietário**. A
  ficha da reserva mostra esse financeiro (só para o admin). Regras **confirmadas por você em
  24/09**: comissão sobre o valor que o canal repassa (depois da taxa do canal); estadia que
  atravessa o mês é **dividida igualmente por noite** (valor total, com a limpeza); no
  **Airbnb** o proprietário recebe a parte dele direto (split) e isso não entra no acerto; no
  **Booking, site e direta** a empresa recebe tudo e repassa uma vez por mês (para o site, você
  pediu para rever com a opção de split — ver "Como receber as reservas do site"; até lá, vale
  esta). Dá para mudar
  reserva a reserva no campo "Quem recebe do canal". Imóvel com **mais de um proprietário**
  (ainda não há cadastro de cotas) ou sem proprietário fica com o acerto **pendente** — nada
  é atribuído a alguém por chute.
- M4.2c: **mudança vale só daquela data para frente.** Quando você muda uma regra (contrato,
  percentual, quem recebe por canal) ou sai uma versão nova do sistema, o recálculo só
  alcança as reservas com **entrada a partir da data da mudança** (nunca antes de hoje).
  O passado fica exatamente como foi. E qualquer lançamento que **já movimentou dinheiro**
  (pago ou conciliado) nunca é mexido automaticamente: se algo mudar numa reserva assim, o
  sistema avisa e a correção vira um ajuste manual.
- M4.3: **despesas** (menu **Despesas**). Cada despesa tem categoria, valor, data, imóvel
  (opcional para as da empresa), fornecedor, comprovante (por enquanto um link ou referência,
  ex.: link do recibo no Drive — o envio de arquivo vem depois) e situação (a pagar / paga).
  Dois tipos, sem misturar:
  - **da empresa** — custo da SCL (equipe, mercado, pequenos reparos absorvidos): entra no
    resultado da empresa;
  - **do proprietário** — gasto que é dele (ex.: conserto do ar-condicionado). **Não** conta
    como custo da empresa. Quando a empresa **efetivamente paga** (marcar "paga"), o
    proprietário passa a dever esse valor no acerto — conta ainda a pagar não vira dívida;
    se ele mesmo pagou, fica só o registro.
  - Errou? **Estornar** (com motivo) anula sem apagar o histórico.
  - **Categorias** editáveis em Despesas → Categorias: criar, renomear, arquivar (some das
    opções novas, continua nas antigas) e excluir (só se nunca foi usada). Começa com
    Equipe, Limpeza e lavanderia, Manutenção, Mercado e consumo, Contas e Outros (só na
    primeira vez — se você apagar, elas não voltam).
  - Só o admin vê e lança despesas.

### Como está ficando (prints com dados fictícios)

| Calendário | Reservas |
|---|---|
| ![Calendário](docs/telas/calendario.png) | ![Reservas](docs/telas/reservas.png) |

| Calendário no celular | Imóveis |
|---|---|
| ![Calendário no celular](docs/telas/calendario-celular.png) | ![Imóveis](docs/telas/imoveis.png) |

| Ficha da reserva com o financeiro | Despesas |
|---|---|
| ![Reserva com financeiro](docs/telas/reserva-financeiro.png) | ![Despesas](docs/telas/despesas.png) |

| Página Sistema | Configurações · Regras financeiras |
|---|---|
| ![Sistema](docs/telas/sistema.png) | ![Regras financeiras](docs/telas/configuracoes-regras.png) |

| Configurações · Modelos de mensagem | Imóvel · simular estadia |
|---|---|
| ![Modelos de mensagem](docs/telas/configuracoes-mensagens.png) | ![Simulador](docs/telas/imovel-simulador.png) |

| Imóvel · cadastro completo | Adiantamento |
|---|---|
| ![Cadastro completo](docs/telas/imovel-cadastro-completo.png) | ![Adiantamento](docs/telas/adiantamento.png) |

| Ajuste esclarecido | Início no celular |
|---|---|
| ![Ajuste](docs/telas/ajuste.png) | ![Início no celular](docs/telas/inicio-dashboard-celular.png) |

| Início (painel com números e alertas) | Repasses no celular |
|---|---|
| ![Início](docs/telas/inicio-dashboard.png) | ![Repasses no celular](docs/telas/repasses-celular.png) |

| Repasses aos proprietários (fechamento do mês) | Apartamentos no celular |
|---|---|
| ![Repasses](docs/telas/repasses.png) | ![Apartamentos no celular](docs/telas/apartamentos-celular.png) |

| Apartamentos (resultado por imóvel) | Manutenção no celular |
|---|---|
| ![Apartamentos](docs/telas/apartamentos.png) | ![Manutenção no celular](docs/telas/manutencao-celular.png) |

| Manutenção (pedido, orçamento, aprovação e custo) | Portaria no celular |
|---|---|
| ![Manutenção](docs/telas/manutencao.png) | ![Portaria no celular](docs/telas/portaria-celular.png) |

| Portaria (documentos: pedidos, encaminhamento e entrega) |
|---|
| ![Portaria](docs/telas/portaria.png) |

| Apartamentos (resultado por imóvel) | Portal do proprietário no celular |
|---|---|
| ![Apartamentos](docs/telas/apartamentos.png) | ![Portal no celular](docs/telas/portal-celular.png) |

| Rotinas | Rotinas no celular |
|---|---|
| ![Rotinas](docs/telas/rotinas.png) | ![Rotinas no celular](docs/telas/rotinas-celular.png) |

| Portal do proprietário | Portal no celular (reservas e saldo) |
|---|---|
| ![Portal](docs/telas/portal.png) | ![Portal com reservas no celular](docs/telas/portal-reservas-celular.png) |

| Portal do proprietário: calendário, reservas e saldo | Relatório do mês em PDF (primeira página) |
|---|---|
| ![Portal com reservas](docs/telas/portal-reservas.png) | ![Relatório em PDF](docs/telas/relatorio-pdf.png) |

| Limpezas | Limpezas no celular |
|---|---|
| ![Limpezas](docs/telas/limpezas.png) | ![Limpezas no celular](docs/telas/limpezas-celular.png) |

| Agenda da equipe | Agenda no celular |
|---|---|
| ![Agenda](docs/telas/agenda.png) | ![Agenda no celular](docs/telas/agenda-celular.png) |

- M7.1: **site público novo, dentro do sistema** (o endereço principal, sem login). Tem a
  página inicial, a lista de apartamentos, a página de cada apartamento e a **consulta**:
  - aparecem **só os imóveis marcados como "público" e ativos** no cadastro (Búzios fica de
    fora enquanto não for público). Nome, bairro, capacidade, quartos, banheiros, descrição,
    camas, comodidades, horários de entrada e saída, mínimo de noites e regras da casa vêm
    do **cadastro do imóvel** — mudou lá, o site mostra na hora. **Endereço exato,
    proprietário, preços e reservas nunca aparecem**;
  - os textos da página inicial (título, subtítulo, "Sobre", "Como reservar", contato e
    rodapé) ficam em **Configurações → Site**;
  - **consulta:** o visitante escolhe o apartamento, as datas e quantas pessoas; o sistema
    confere (datas no futuro, saída depois da entrada, pessoas dentro da capacidade) e monta
    uma mensagem pronta que ele envia pelo **WhatsApp da empresa** (o telefone em
    Configurações → Empresa; sem telefone, vai por e-mail). **Nada é gravado nem cobrado**:
    disponibilidade e valor são combinados na conversa (a cotação automática é o M7.2);
  - **fotos:** enquanto os direitos de uso não forem liberados (M7.3), aparece um quadro
    com o nome do apartamento no lugar de cada foto;
  - há um link discreto **"Área da equipe"** no rodapé, que leva ao login do painel.
- M9.1: **portal do hóspede — "Minha reserva"** (link no topo do site):
  - o hóspede digita o **e-mail que está na reserva** e recebe um **código de 6 dígitos**
    (vale 10 minutos, uso único, até 5 tentativas e 5 códigos por hora — as mesmas regras
    do login da equipe). O código da reserva sozinho **não** dá acesso;
  - a tela responde sempre igual, tenha ou não reserva com aquele e-mail (ninguém descobre
    quem está hospedado). Só recebe código quem tem reserva **confirmada** que ainda não
    terminou há mais de 30 dias. O código do hóspede não serve para entrar no painel;
  - ele vê **só as próprias reservas**: apartamento, bairro, datas, horários de entrada e
    saída, noites, pessoas e o contato da empresa (WhatsApp/e-mail de Configurações →
    Empresa). **Valores e dados de outras pessoas nunca aparecem**;
  - o **endereço completo** (com complemento) só aparece **2 dias antes da entrada, às 10h**
    (horário de São Paulo), e some no horário de saída do imóvel. Estar logado não antecipa;
  - só contam as reservas da empresa do site (se um dia houver outra empresa no sistema, uma
    não vê as reservas da outra);
  - a permissão é conferida a cada acesso: **trocar o e-mail da reserva ou cancelá-la tira
    o acesso na hora**. O acesso dura até 7 dias no mesmo aparelho, com botão "Sair";
  - no painel, o detalhe da reserva agora tem o campo **"E-mail do hóspede"** para cadastrar
    ou corrigir, e um **aviso** quando a reserva está sem e-mail. O e-mail salvo ali **vale
    sobre o da planilha ou do Beds24** (a próxima importação não desfaz a correção).
- M9.2: **mensagens automáticas ao hóspede, por e-mail** (Configurações → Modelos de mensagem,
  no alto da página):
  - quatro mensagens, cada uma com o **modelo que você escolher** (os modelos continuam
    editáveis ali mesmo): **confirmação** (logo depois de confirmada), **check-in** (2 dias
    antes da entrada, às 10h — o mesmo momento em que o endereço aparece em "Minha reserva"),
    **check-out** (1 dia antes da saída, às 14h) e **agradecimento** (3 dias depois da saída,
    às 10h). Horário de São Paulo; o sistema confere de hora em hora (cada mensagem sai até
    cerca de 1 hora depois do momento previsto);
  - vem **desligado**: você liga com a caixinha "Envio automático ligado". Vale **daquele
    momento em diante** — nada previsto para antes é mandado atrasado;
  - escolha as **origens**: vem marcado só **site e direta** (o Airbnb e o Booking já mandam as
    mensagens deles). Dá para deixar uma mensagem sem modelo ("não enviar");
  - **cada mensagem sai uma vez só**. Reserva cancelada não recebe; se a data mudar, vale a
    nova. Reserva feita em cima da hora recebe a confirmação e o check-in logo, mas nunca
    depois da entrada;
  - **avisar em vez de supor:** se faltar algo que o modelo usa (e-mail, nome do hóspede,
    endereço do imóvel…), ou o modelo tiver sido arquivado, a mensagem **não sai** e o motivo
    aparece na página **Sistema**. A confirmação **não pode usar {endereco}** (o endereço só vai
    2 dias antes da entrada);
  - no fim da seção aparecem as **últimas mensagens** com a situação: enviada, recusada pelo
    provedor (o sistema tenta de novo, até 3 vezes) ou **sem confirmação — confira** (quando
    o provedor não respondeu: não é repetida sozinha, para não mandar duas vezes).
- M12.3: **cadastro de proprietários marketplace pelo site** ("Anuncie seu imóvel", no topo
  do site):
  - a pessoa confirma o **e-mail com um código** (as mesmas regras do login; um abuso aqui não
    atrapalha o login da equipe) e preenche os dados dela (nome, pessoa física ou empresa,
    telefone) e do imóvel (nome, bairro, cidade, endereço, pessoas, quartos, banheiros,
    descrição). Diz se **já anuncia** em outra plataforma (cola até 3 links) ou se quer um
    **anúncio novo**, e autoriza o uso dos dados para a análise;
  - o pedido fica **esperando análise** — nada é criado nem publicado sozinho. Cada e-mail
    pode ter até 3 pedidos em análise, e o site para de aceitar pedidos novos se houver 100
    esperando;
  - em **Proprietários → "Cadastros pelo site"** você vê cada pedido com todos os dados e
    decide: **Aprovar** (você dá o código do imóvel no sistema) cria de uma vez o
    proprietário, o imóvel (**não público** — publicar continua sendo no cadastro do imóvel)
    e manda o **convite do portal** para o e-mail confirmado; **Recusar** pede um motivo, que
    fica registrado. Se algo impedir (código de imóvel repetido, e-mail que já é da equipe),
    nada é criado e a tela avisa;
  - depois de aprovar, complete na ficha do proprietário o **documento, o Pix e o contrato**
    (o contrato marketplace depende do modelo de cobrança, M12.1).

A lista completa e detalhada, item por item, está em [ROADMAP.md](ROADMAP.md).

---

## 3. Como o trabalho acontece

1. A **rotina automática** roda a cada 3 horas nesta conversa do Claude Code. Ela pega o
   próximo item do ROADMAP, programa, testa e abre um **PR** no GitHub.
2. Cada PR tem no título o código do item (ex.: `[M1.2] Login com Google`) e uma
   descrição em português com: *O que muda / Como conferir / Testes / Limites*.
3. Dois robôs conferem cada PR automaticamente:
   - **CI** (GitHub Actions): roda todos os testes. Verde = passou.
   - **Codex**: revisão automática de código. O Claude corrige o que ele apontar.
4. **O Claude faz o merge** (autorizado por você em 23/09, até o sistema estabilizar), mas só
   quando o CI está verde, a revisão do Codex terminou sem pendências e não há conflito.
   Você continua podendo ler cada PR — a descrição explica em português o que mudou — e
   pode pedir para voltar a ser você quem faz o merge a qualquer momento.
5. Pode haver até **3 PRs abertos** ao mesmo tempo esperando seu merge.

**Onde ver o sistema:** assim que a Vercel estiver conectada (seção 6), cada PR ganha um
link de *preview*, e a `main` fica publicada num endereço fixo de homologação. O painel
fica em `/painel`.

**Se quiser acompanhar ou pedir algo:** abra esta conversa no app Claude (área *Code*)
e escreva normalmente.

---

## 4. Onde encontrar cada coisa no GitHub

| Pasta ou arquivo | O que tem | Precisa ler? |
|---|---|---|
| `GUIA-DIEGO.md` | Este guia | ✅ sim |
| `ROADMAP.md` | Plano completo, item por item, com o que falta | Se quiser detalhe |
| `requisitos/` | Suas decisões de negócio, escritas e organizadas por tema | Só para conferir regras |
| `docs/telas/` | Prints das telas (dados fictícios), atualizados a cada entrega visual | Se quiser ver |
| `requisitos/operations/FINANCEIRO-PORTAIS.md` | Regras do financeiro e dos portais | Quando chegarmos no M4/M5 |
| `app/` | **O sistema novo** (código) | ❌ não |
| `app/drizzle/` | Histórico das mudanças no banco de dados | ❌ não |
| `prototipos/` | Protótipos antigos (site e gestão), só como referência | ❌ não |
| `arquivo/` | Papelada dos agentes antigos (Rivers, Lia, Sage...), guardada como histórico | ❌ não |
| `CLAUDE.md` | Regras que o Claude segue ao programar | ❌ não |
| `.github/workflows/` | Configuração dos testes automáticos (CI) | ❌ não |
| `infra/backup/espelho-github.yml` | O robô de backup (o arquivo que você copia para a conta de backup) | Só na hora de ativar (seção 6, item 23) |
| `requisitos/operations/BACKUP-E-RECUPERACAO.md` | Como o backup funciona, por quê, e como recuperar | Se um dia precisar restaurar |

---

## 5. Contas e serviços

| Serviço | Para que serve | Situação | O que falta |
|---|---|---|---|
| **GitHub** (`al-life/scl-reconstrucao`) | Guarda o código e o histórico | ✅ conectado; robô de backup pronto (M0.7) | Ativar o backup na conta separada (seção 6, item 23) |
| **Claude Code** | Programa o sistema; rotina a cada 3h | ✅ ativo | — |
| **Codex** (revisor automático) | Revisa cada PR | ✅ ativo no repositório | — |
| **Neon** | Banco de dados (Postgres) | ✅ projeto `scl-sistema` com duas branches: `main` (produção) e `preview` (versões de teste dos PRs); as 41 migrações até o M5.5 aplicadas nas duas, conferido em 3/10 | **Backup:** desde 3/10, 7 dias de histórico e snapshots diário (14 dias) e semanal (35 dias) da `main`, dentro do Neon (seção 6, item 23b). Cópia fora do Neon e checklist ficam para o M11.3 |
| **Vercel** | Publica o sistema na internet (homologação e depois produção) | ✅ site acessível (27/09); conferido em 3/10 que produção usa a branch `main` do Neon e as previews dos PRs usam a branch `preview` — bancos separados | Variáveis já presentes: banco, login Google, Beds24 (leitura), Resend, agendador. Faltam só as que ligam coisas novas (`BEDS24_ESCRITA`, item 3) |
| **Beds24** | Channel manager (Airbnb/Booking), reservas, calendário e preços | 🟡 importação feita por Diego (1 e 2/10); envio de calendário/preços pronto e **desligado** | Testar o envio no 103 (simular → `BEDS24_ESCRITA=ligada` com refresh token de inventário → enviar → conferir no Beds24/Airbnb) e só então ligar o automático (seção 6, item 3) |
| **Mercado Pago** | Pagamentos da reserva direta | ⚪ não conectado | Credenciais de *teste* do provedor escolhido no M8.0 (Mercado Pago, se for a escolha), mais adiante (M8) |
| **Meta / WhatsApp Business** | Atendimento pelo WhatsApp da empresa | ⚪ não conectado | Verificação da empresa no Meta Business (demora dias) |
| **Google Cloud (login)** | Botão "Entrar com Google" | ✅ login confirmado por Diego em 27/09 | — |
| **Resend** (envio de e-mail) | E-mails do sistema: código de login, convites, agenda da equipe, relatórios, mensagens ao hóspede | 🟡 conta criada (e conector no Claude) | Cadastrar o domínio e pôr a chave na Vercel (seção 6, item 5) |
| **Cloudflare** | Domínio e e-mail | ⚪ não conectado | Só no final (M11) |

**Conector do Claude × chave do sistema:** os "conectores" que você liga no Claude (ex.: o
do Resend) deixam **o Claude** usar aquele serviço nas conversas. O **sistema SCL**, rodando
na Vercel, precisa da **sua própria chave** em *Settings → Environment Variables*. São duas
coisas diferentes — as duas são úteis. Em 27/09, o conector Vercel no ChatGPT encontra a
equipe AL Apps, mas não enxerga seus projetos, mesmo após reconexão. Isso não impede o
site de funcionar nem o teste manual de conexão pelo painel.

**Onde ficam senhas e chaves:** nunca no GitHub e nunca no chat. Elas ficam nas
configurações da Vercel e nas configurações do ambiente do Claude Code (variáveis de
ambiente).

---

## 6. O que você precisa fazer agora

1. **Vercel + Neon:** site já publicado, segundo Diego (27/09). Conferir ainda o banco
   isolado de homologação. Passos abaixo ficam como referência de configuração:
   1. Entre em vercel.com → *Add New… → Project* → escolha `al-life/scl-reconstrucao`.
   2. Em **Root Directory**, escolha `app`. Clique em *Deploy*.
   3. No projeto criado: *Storage* (ou *Integrations*) → **Neon** → conecte sua conta
      Neon. Isso cria a variável `DATABASE_URL` automaticamente.
   4. Me avise aqui na conversa: eu confiro se o site de homologação abriu.
2. **Login com Google:** funcionando, confirmado por Diego (27/09). Referência para reconfigurar:
   1. Em console.cloud.google.com → crie um projeto "SCL" → *APIs e serviços → Tela de
      consentimento OAuth* (tipo "Externo", nome "Sua Casa Leblon").
   2. *Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web*.
      Em "URIs de redirecionamento autorizados" coloque
      `https://scl-reconstrucao.vercel.app/api/auth/callback/google` (o endereço que a Vercel der).
   3. Na Vercel, em *Settings → Environment Variables*, crie:
      `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET` (os dois valores que o Google mostrar),
      `AUTH_SECRET` (qualquer texto longo e aleatório, ex.: gerado em 1password ou similar) e
      `ADMIN_EMAILS` = seu e-mail do Google.
   4. Faça *Redeploy* e entre em `/entrar`. Se travar em algum passo, me chame que eu guio.
3. **Beds24:** o Airbnb já está conectado/mapeado e a leitura dos quartos pelo SCL foi
   confirmada por Diego em 28/09. O 403 duplicado foi removido. Não precisa gerar outra credencial.
   - Use **`BEDS24_REFRESH_TOKEN`** para o refresh token. O sistema o troca por um token de
     acesso e renova quando necessário. Um **invite code** precisa ser trocado primeiro;
     ele não pode ser colocado nessa variável.
   - **`BEDS24_API_KEY`** fica como alternativa para um token de acesso direto. Um *long life
     token* só permite leitura; nunca colocar refresh token nesse campo. Se as duas
     variáveis existirem, o sistema usa `BEDS24_REFRESH_TOKEN`.
   - Após publicar M3.3, abra **Configurações → Integrações → Buscar quartos para vincular**.
     Confira os seis quartos e escolha o imóvel SCL de cada um. Para corrigir um vínculo,
     abra a ficha do imóvel e a seção **Canais e IDs externos**. Não deduza o imóvel pelo
     proprietário ou pelo e-mail do hóspede.
   - Deixe a importação automática desligada, escolha a data inicial e **salve a configuração**.
     Para o primeiro teste, escolha um período que você consiga conferir. Marque a confirmação
     dos vínculos e clique em **Importar agora**. Confira a contagem, os avisos, **Reservas** e
     **Calendário**, comparando com o Beds24. Confira também códigos de reservas que já vieram
     por planilha. Repita a importação: não deve criar cópias.
   - Só depois dessa conferência, ligue a rotina diária se quiser. Ela usa a variável
     **`CRON_SECRET`**, já usada pelas outras rotinas. O botão manual não depende dela.
     Se o banco tiver mais de uma empresa, **`BEDS24_ORGANIZACAO_ID`** precisa apontar a
     empresa atendida pela credencial; o sistema recusa copiar reservas para várias empresas.
   - O teste **Testar conexão com Beds24** continua disponível e apenas lê quartos. Não
     comprova importação de reservas nem execução do agendamento. Os e-mails recebidos do
     Beds24 também não comprovam que as reservas chegaram ao SCL.
   - As variáveis precisam estar no ambiente do deploy que será testado (Production no
     endereço principal; Preview se for testar um PR). Alteração de variável exige novo
     deploy. Chaves nunca vão no chat, Git ou tela do sistema.
   - **Envio de calendário e preços (M3.7):** pronto e desligado. O passo a passo do teste no
     103 está na seção 2 ("Calendário e preços no Beds24"). Resumo: regras e feriados em
     Configurações → Calendário e preços; pisos na ficha do imóvel; simular na prévia; só
     depois criar `BEDS24_ESCRITA` = `ligada` na Vercel (o refresh token precisa do escopo
     **inventory**; um token só de leitura recebe "sem permissão de escrita") e fazer
     Redeploy; enviar; conferir no Beds24 e no Airbnb; por último ligar o automático diário.
     Sem a variável, nenhum caminho do sistema escreve no Beds24.
   - **Histórico do acesso:** o teste de 27/09 falhou; após salvar novamente a variável,
     Diego confirmou a leitura. Isso não comprova qual foi a causa da falha anterior.
     Caso reapareça, informe só a mensagem sanitizada do painel, nunca a chave.
4. **Meta Business:** comece a verificação da empresa, porque ela demora.
5. **E-mail do sistema (Resend)** — sem pressa; enquanto isso, o login com Google funciona:
   1. Crie conta grátis em resend.com e cadastre o domínio de onde os e-mails vão sair
      (ex.: suacasaleblon.com.br). Ele pede para adicionar alguns registros no DNS
      (Cloudflare) — eu te guio nessa hora.
   2. Crie uma *API key* e coloque na Vercel como `RESEND_API_KEY`, e crie
      `EMAIL_REMETENTE` = `Sua Casa Leblon <acesso@seudominio.com.br>`. **Não cole no chat.**
6. **Agenda da equipe (20h):** depois da Vercel e do Resend (itens 1 e 5):
   1. Na Vercel, em *Settings → Environment Variables*, crie `CRON_SECRET` com um texto
      longo e aleatório. É a senha que o agendador da Vercel usa para chamar a agenda; sem
      ela, a chamada é recusada. **Não cole no chat.**
   2. No painel, em **Agenda**, cadastre os e-mails da equipe (marque Rio ou Búzios para cada
      pessoa), marque "Enviar todo dia às 20h" e salve.
   3. Use "Enviar agora" uma vez para conferir como o e-mail chega.
7. **Profissionais de limpeza pelo celular:** depois do Resend (item 5), em Limpezas →
   Profissionais, ponha o e-mail de cada profissional e aperte "Liberar acesso". Ela entra em
   `/entrar` com esse e-mail (código por e-mail).
8. **Chaves Pix:**
   - confira no cadastro de cada proprietário (Painel → Proprietários) se a chave Pix está
     preenchida. A tela de Repasses usa essa chave para o botão "Copiar Pix" e avisa quando
     falta; o portal mostra ao proprietário a chave para onde vai o repasse;
   - cadastre a **chave Pix da empresa** em Painel → Configurações → Empresa. Ela aparece no
     portal para o proprietário que deve à empresa, depois do fechamento do mês. Sem ela, o
     portal pede que ele fale com a empresa.
9. **Booking:** criar os anúncios (ver "Copiar anúncios do Airbnb para o Booking" na seção 7).
10. **Relatórios em PDF:** para o fechamento, gere o PDF na ficha do proprietário, anexando o
   **extrato oficial** do canal e uma **foto real** do imóvel. Antes de mandar, abra o PDF e
   confira se o extrato é só daquele imóvel e daquele mês. O **envio automático por e-mail**
   (M5.4) está pronto em Financeiro → Repasses, mas começa desligado e manda o PDF **sem** o
   extrato e sem a foto. Se quiser o automático, confira o texto, ligue e use "Enviar e-mail do
   fechamento" em um proprietário primeiro. Ele depende do Resend e do `CRON_SECRET` (itens 5
   e 6).
11. **Portaria:** em Painel → **Portaria**, marque os imóveis que exigem documentos de
   portaria (hoje, o 403). Sem marcação, a tela só avisa e não lista nada.
12. **Rotinas:** em Painel → **Rotinas**, confira as cinco rotinas que já vêm prontas, com as
   datas das suas regras. Arquive a que não usar.
13. **Manutenção:** quando aparecer "aguardando aprovação" (no menu **Manutenção**), confira o
   orçamento, escolha quem paga (empresa ou proprietário) e aprove, ou recuse com o motivo.
   Só você (administrador) vê esses botões.
14. **Sistema antigo (referência):** mande o arquivo (zip) do sistema antigo — o jeito mais
   fácil é subir no seu **Google Drive** e me dizer o nome do arquivo (o Drive já está
   conectado aqui). Eu só leio para levantar todas as telas e capacidades e comparar com o
   plano; **nada dele vai para o GitHub**, e dados reais de clientes não são copiados.
15. **Site novo:** em **Configurações → Site**, escreva os textos (título, "Sobre", "Como
   reservar", contato, rodapé); em **Configurações → Empresa**, confira o **telefone do
   WhatsApp** da consulta; e, em cada imóvel, marque **público** só nos que devem aparecer e
   confira a descrição, as camas e as comodidades. Para a disponibilidade e o valor reais
   (M7.2) funcionarem: preço base, taxa de limpeza e hóspede extra no cadastro de cada imóvel
   público, e a importação do Beds24 rodando (manual ou diária); confira em Configurações →
   Calendário e preços → Site público a validade da leitura. O site ainda não substitui o
   atual: o domínio só muda na entrada em uso (M11).
16. **Minha reserva (hóspede):** depende do e-mail do sistema (Resend, item 5) — sem ele o
   código não sai. Confira se as reservas têm o **e-mail do hóspede** (o detalhe da reserva
   avisa quando falta) e se o **endereço e o complemento** de cada imóvel estão no cadastro,
   porque é isso que o hóspede vê 2 dias antes da entrada.
17. **Mensagens automáticas ao hóspede:** depois do Resend (item 5), em **Configurações →
   Modelos de mensagem**, confira o texto de cada modelo, escolha as origens (vem site e
   direta) e marque "Envio automático ligado". Até lá, nada é enviado.
18. **Cadastros pelo site (marketplace):** de vez em quando, abra **Proprietários → Cadastros
   pelo site** e aprove ou recuse os pedidos. O código de confirmação depende do Resend
   (item 5). Quem é recusado ainda não recebe e-mail automático — responda você mesmo.
19. **Recebimento do site:** leia a comparação na seção 7 ("Como receber as reservas do
   site"), leve a pergunta ao contador e me diga se mantém "empresa recebe e repassa" ou muda.

20. **Bloqueio pelo portal (M5.5):** confira em cada contrato (ficha do imóvel → Contratos) se
   "Bloqueio pelo portal" deve ficar em Sim (como vem) ou Não — o botão Ligar/Desligar fica na
   própria linha —, e avise os proprietários que já podem bloquear datas de uso próprio pelo
   portal. As datas só fecham nos canais quando o envio
   de calendário ao Beds24 estiver ligado (item 3).
21. **Data de início dos contratos (registrado em 2/10):** nada a fazer agora. Na carga de dados
   reais (M11.1), o início do contrato de cada um dos seis imóveis será a data da primeira
   reserva dele (nunca mudaram de proprietário), e **1/10/2026** fica como o marco oficial de
   preços e reservas pelo Beds24 e pelo sistema. O histórico anterior à conexão do Airbnb ao
   Beds24 não vem pela API do Beds24 — é limitação do canal, não do sistema — e fica fora da
   conferência.

22. **Pedidos do site (M8.1):** quando aparecer em **Reservas** uma linha com origem "site" e
   situação "pedido", é um visitante que segurou datas pela cotação. Fale com ele (contato na
   ficha) e **confirme ou cancele antes do prazo** das observações; se não, o pedido vence sozinho.
   O prazo padrão é de 30 minutos, em Configurações → Calendário e preços → Site público.

23. **Backup do repositório (M0.7) — ativar na conta separada.** Pode fazer pelo celular. Guarde
   cada senha e chave no gerenciador de senhas na hora em que criar; **nada vai para o chat**.
   Nunca me passe o nome da conta nova nem do repositório de backup: não preciso deles e é
   melhor que fiquem só com você.
   1. **Conta nova no GitHub** com outro e-mail seu, senha própria e **2FA** ligado
      (*Settings → Password and authentication → Two-factor authentication*). Salve os
      **códigos de recuperação** no gerenciador de senhas. Não use o nome da empresa na conta.
   2. **Repositório privado** nessa conta: *New repository*, qualquer nome discreto, visibilidade
      **Private**, marque *Add a README file*, *Create repository*.
   3. **Chave só de leitura, na sua conta principal** (a do `al-life`): *Settings → Developer
      settings → Personal access tokens → Fine-grained tokens → Generate new token*.
      - *Token name*: algo como "leitura para espelho"; *Expiration*: o máximo (1 ano);
        anote a data de validade no gerenciador de senhas.
      - *Resource owner*: **al-life** (se não aparecer, em *al-life → Settings → Personal
        access tokens* permita tokens fine-grained e volte aqui).
      - *Repository access*: **Only select repositories** → `scl-reconstrucao`.
      - *Permissions → Repository permissions → Contents*: **Read-only**. Nada mais.
      - *Generate token* e copie a chave (ela aparece uma vez só).
   4. **Dois segredos no repositório de backup** (na conta nova): *Settings → Secrets and
      variables → Actions → New repository secret*:
      - `ORIGEM_REPO` = `al-life/scl-reconstrucao`
      - `ORIGEM_TOKEN` = a chave do passo 3.
   5. **O robô:** no repositório principal, abra `infra/backup/espelho-github.yml`, toque em
      *Raw* (ou no botão de copiar o arquivo) e copie **tudo**. No repositório de backup:
      *Add file → Create new file*, nome do arquivo exatamente
      `.github/workflows/backup.yml`, cole o conteúdo, *Commit changes* (na `main`).
   6. **Proteção extra contra apagar e reescrever** (opcional). **Só existe em repositório
      privado com plano pago do GitHub** (Pro, cerca de US$ 4 por mês, na conta nova). No plano
      Free, **pule este passo**: o robô já nunca apaga nem reescreve e te avisa se o backup
      perder algo; a trava só protege a mais contra um erro manual seu. Se assinar o Pro:
      *Settings → Rules → Rulesets → New ruleset → New branch ruleset*. Nome "nunca apagar";
      *Enforcement status*: **Active**; *Target branches → Add target → Include all branches*;
      em *Rules*, marque **só** *Restrict deletions* e *Block force pushes*; *Create*. Repita
      com *New tag ruleset* → *Include all tags*, as mesmas duas regras.
   7. **Primeira rodada à mão:** aba *Actions* → "Backup do repositório de origem" → *Run
      workflow* → *Run workflow*. Em um ou dois minutos deve ficar verde. Confira em *Code* que
      apareceram as branches `espelho/main` (e as outras) e `backup-marcos`, e, em *Tags*, uma
      `backup/` com a data de hoje. Na branch principal vai aparecer também um commit do robô
      com um arquivo `.backup/iniciado`: é o marcador de que o backup já existe; não apague.
      **Depois dessa primeira rodada verde**, crie uma variável no repositório de backup:
      *Settings → Secrets and variables → Actions → aba Variables → New repository variable*,
      nome `BACKUP_INICIADO`, valor `sim`. É um registro que o robô só lê e nunca cria: se um
      dia alguém apagar tudo (até o marcador), o robô ainda vai saber que o backup já existia e
      avisar, em vez de recomeçar em silêncio. Se ficar vermelho, abra a rodada e me mande **só o texto da mensagem de erro**
      (ela não contém chave).
      - Se o erro falar de permissão para escrever, em *Settings → Actions → General → Workflow
        permissions* escolha *Read and write permissions* e rode de novo.
      - Se o erro falar do marcador `.backup/iniciado`, é a branch principal recusando o commit
        do robô (alguma regra de "só por pull request"): em *Settings → Branches* (ou *Rules*)
        tire essa exigência da branch principal e rode de novo. Até resolver, a rodada fica
        vermelha de propósito.
   8. **Depois:** o robô roda sozinho a cada 3 dias, às 03:17. Uma vez por mês, dê uma olhada
      na aba *Actions* (verde). Rodada vermelha gera e-mail para a conta nova e diz exatamente
      o que sumiu, foi reescrito ou foi alterado, e onde (é aviso, não perda), ou que a chave
      venceu. Se a mensagem falar em algo "alterado" ou "movido" no backup, a correção é
      apagar aquela ref lá; o robô regrava sozinho na rodada seguinte. Antes de a chave
      vencer, gere outra (passo 3) e troque o segredo `ORIGEM_TOKEN` (passo 4). **Confira
      também a data da última rodada:** se o próprio robô for apagado ou desligado, ele não
      roda e, sem rodar, não avisa nada. O passo 9 cobre isso.
   9. **Batimento (opcional, recomendado, grátis, 5 minutos):** um serviço que espera um sinal
      do robô a cada rodada e te manda e-mail se o sinal faltar. Crie uma conta em
      healthchecks.io (ou serviço parecido) com o e-mail da conta nova; *New check*, nome
      "backup", *Period* 3 dias, *Grace* 1 dia; copie a URL de *ping*. No repositório de
      backup, crie o segredo `BATIMENTO_URL` com essa URL (como no passo 4). Pronto: se o
      backup parar por qualquer motivo, você recebe um e-mail em até 4 dias. Rodada vermelha
      por aviso ainda manda o sinal; e-mail do serviço quer dizer que o robô não rodou ou não
      conseguiu gravar. O serviço só recebe o sinal, não tem acesso a nada.

23b. **Backup do banco (Neon) — feito em 3/10, com o seu "pode fazer".** O Neon agora guarda
   **7 dias** de histórico para voltar no tempo (antes era 1 dia) e tira um **snapshot diário**
   do banco de produção às 3h (guardado 14 dias) e um **semanal** (guardado 35 dias). Esses
   backups ficam **dentro do próprio Neon**, na mesma conta e projeto, guardados à parte do banco
   vivo: protegem contra erro nos dados (apagar algo sem querer, migração ruim), não contra
   perder a conta do Neon. A cópia **fora** do Neon (despejo cifrado num lugar privado, nunca no
   GitHub) fica para o M11.3, quando houver volume de dados reais. Nada para você fazer agora;
   custa um pouco de armazenamento a mais (o banco tem poucos megabytes).

---

## 7. Decisões pendentes e respostas às suas perguntas

**Preciso de você (sem pressa):**
- **Como receber as reservas do site (M8.0):** em 24/09 você decidiu que no site a empresa
  recebe e repassa; depois perguntou se dava para fazer como o Airbnb (split). Comparei as
  opções em `requisitos/product/RECEBIMENTO-SITE.md` — até você dizer outra coisa, vale a de
  24/09. Resumo:
  - **empresa recebe e repassa (a de 24/09; minha sugestão é manter):** o hóspede paga à SCL pelo
    Mercado Pago (cartão ~4–5%, Pix ~1%), a SCL repassa ao proprietário no dia 1º, como já
    faz com Booking e diretas. A parte financeira do sistema já está pronta para isso (falta,
    em qualquer opção, ligar o pagamento em si — M8.2) e o proprietário não precisa abrir
    conta nenhuma;
  - **split automático no Mercado Pago (como no Airbnb):** a parte do proprietário cai
    direto na conta dele, mas **cada proprietário precisa de conta no Mercado Pago** ligada
    ao sistema. Faz mais sentido no marketplace (M12);
  - **Stripe:** mais caro no Brasil, Pix só por convite e o dinheiro também passa pela conta
    da SCL antes de ir ao proprietário; não recomendo agora.
  **Antes de decidir, pergunte ao contador:** "a SCL recebendo o valor total da reserva e
  repassando ao proprietário, com contrato de intermediação, paga imposto só sobre a
  comissão?". E diga se a taxa do cartão/Pix segue a regra de hoje (sai antes da divisão,
  cada um na proporção, como a do Airbnb/Booking) ou se muda; quem arca com uma contestação
  de cartão perdida (SCL, proprietário ou os dois na proporção); e a **política de
  cancelamento** das reservas do site (reembolso total, parcial ou nenhum, conforme a
  antecedência); e, no cartão com recebimento em 30 dias, se o repasse espera o Mercado Pago
  liberar o dinheiro, se a SCL adianta, ou se usa o recebimento na hora (taxa maior). Essas
  três últimas só precisam estar decididas antes de o site receber pagamentos de verdade.
- **Modelo do marketplace:** as fórmulas antigas não estão em lugar nenhum, então montei
  uma proposta com as contas feitas: `requisitos/product/MARKETPLACE-PRECIFICACAO.md`.
  Resumo, numa reserva de R$ 1.650 que no Airbnb custaria R$ 1.881 ao hóspede e daria
  R$ 1.600 ao proprietário:
  - **A — taxa de serviço menor (8%):** hóspede paga R$ 1.782, proprietário recebe
    R$ 1.650, SCL fica com ~R$ 52;
  - **B — dividir a economia em três (minha sugestão):** hóspede paga R$ 1.815,
    proprietário recebe R$ 1.667, SCL fica com ~R$ 66;
  - **C — mensalidade fixa + preço limpo:** hóspede paga R$ 1.728, proprietário recebe
    R$ 1.650, SCL vive da mensalidade.
  Os percentuais das OTAs e do pagamento são aproximados e precisam ser conferidos. A ideia
  é ter uma **tela de simulação** com tudo editável para você testar com números reais antes
  de decidir. Me diga qual modelo te agrada mais (ou o que mudar).
- **Búzios:** fica no sistema interno para controle (combinado). No site público, a decidir.
- **Avaliações**: só no Airbnb ou também próprias.

**Respostas:**
- **Telas do sistema antigo:** o **dashboard** inicial com vários indicadores (M4.6) e a aba
  **Apartamentos** com tabela de todos e filtros para escolher como ver (M4.7) já estavam
  no plano — deixei as descrições mais completas. A aba **Anúncios** (M2.9) e as
  **Configurações com sub-abas** (M1.7) entraram agora. Quando você mandar o zip do sistema
  antigo, eu cruzo tudo com o plano (M0.6) e acrescento o que faltar.
- **Avisar em vez de supor:** virou regra do projeto — faltou um dado ou algo não bate, o
  sistema avisa e deixa pendente; nunca preenche com um palpite.
- **Beds24 só leitura?** Não — como o SCL vai ser a fonte oficial de calendário e preços, a
  chave precisa de **leitura e escrita** (seção 6, item 3). Entrou no plano o **M3.7** (SCL
  manda calendário, preços e regras para o Beds24 → OTAs) e o **M5.5** (proprietário mexe
  no calendário do imóvel dele pelo portal; a mudança passa pelo SCL e segue para as OTAs).
  A escrita fica **desligada** até você mandar ligar, depois de testarmos num imóvel.
- **Repasse e relatório mensal:** combinado, **dia 1º do mês seguinte** (no último dia ainda
  pode entrar reserva). Já está no plano (M4.9 e M5.4).
- **E-mail no cadastro de todos:** o e-mail do proprietário passou a ser **obrigatório**
  (convite do portal, relatórios, avisos, às vezes a chave Pix). Hóspedes entram no portal
  pelo e-mail (M9.1). Nas reservas das OTAs o e-mail às vezes vem mascarado pelo canal; o
  sistema guarda o que vier.
- **Tudo editável por você, sem código nem banco:** virou regra do projeto (está no
  `CLAUDE.md`, que toda sessão do Claude segue): cadastros, contratos, taxas, regras de venda,
  textos do site, modelos de mensagem, categorias — tudo com tela de edição. E **uma regra
  fica num lugar só**: quando você muda (um contrato, quem recebe num canal), o sistema
  recalcula o que depende dela na hora; a cada nova versão publicada, recalcula tudo. Não
  ficam duas versões da mesma regra. E a mudança vale **daquela data para frente**: o
  passado e o dinheiro que já movimentou nunca são recalculados. Desde o M1.7, as regras
  gerais, os usuários, os modelos de mensagem e os textos do site estão em **Configurações**.
- **Excluir com confirmação:** todo botão de excluir, remover, cancelar ou estornar agora
  pergunta "tem certeza?" antes. Onde há histórico (financeiro, reservas), o sistema
  prefere arquivar ou estornar em vez de apagar de vez.
- **Área para ver serviços, automações e regras:** entrou no plano como **M1.6** — uma
  página "Sistema" no painel mostrando os serviços ligados (banco, Beds24, e-mail,
  WhatsApp, Mercado Pago) e se estão funcionando, as automações com a última vez que
  rodaram, e as regras em vigor, com atalho para editar.
- **Recebimento do site com divisão automática (como o Airbnb):** existe. O **Mercado Pago**
  tem o modelo "marketplace": cada proprietário liga a conta Mercado Pago dele ao nosso
  sistema, e cada pagamento cai direto na conta dele com a comissão da SCL separada
  automaticamente para a conta da empresa. O **Stripe** faz algo parecido (Stripe Connect), mas o
  pagamento entra primeiro na conta da SCL e depois é transferido ao proprietário.
  Pontos de atenção: cada proprietário precisa ter conta própria e a parte fiscal muda (ele
  recebe direto, como no Airbnb). Quem arca com estorno e contestação de cartão depende do
  provedor — no Stripe o dinheiro sai da conta da SCL; no Mercado Pago ainda é **a conferir**.
  Se a SCL repassa essa perda ao proprietário é decisão sua (pergunta 4 da comparação). A comparação completa (M8.0) está em "Como receber as reservas do
  site", acima, e em `requisitos/product/RECEBIMENTO-SITE.md`.
- **Copiar anúncios do Airbnb para o Booking:** é **semiautomático** pelo Beds24 — ele
  reaproveita os dados e fotos que já importou do Airbnb e cria o anúncio no Booking. Mas
  exige a conta Booking da empresa (com os dados da pessoa jurídica) conectada ao Beds24, e
  depois é preciso conferir fotos, políticas, comodidades, camas e preços, porque o Booking
  valida tudo e às vezes pede complemento na extranet. Minha sugestão: fazer **um apartamento
  do Rio primeiro**, até ficar 100% aberto para reservas, e só depois repetir nos outros. Se
  algum anúncio já existir no Booking, a gente **liga** em vez de criar outro. Quando você for
  fazer, me chame que eu te guio tela a tela.
- **Modelos de cliente:** o sistema já tem os dois tipos de contrato — **gestão completa**
  (os cinco do Rio) e **marketplace** (tipo separado, esperando a fórmula). Agora o marketplace
  ganhou um bloco próprio no plano (**M12**): fórmula, cálculo e repasse, auto-cadastro do
  proprietário e portal dele com calendário e preços.
- **Site público:** é a parte que estava mais adiantada, mas ainda como **protótipo
  separado** (`prototipos/scl-publico`): home, catálogo dos 5 imóveis, página de cada um,
  galeria, calendário, formulário de consulta e uma demonstração de checkout sem cobrança.
  Não está no ar, não usa banco e está sem as fotos (faltava autorização de uso). No plano,
  o **M7.1** traz esse site para dentro do sistema novo lendo os imóveis do banco; o **M7.2**
  liga disponibilidade e preço reais (depois do Beds24); o **M7.3** coloca as fotos quando
  você autorizar.
- **Cadastro de apartamento novo:** hoje o cadastro tem código, nome, bairro, endereço,
  capacidade, quartos, banheiros, descrição, se aparece no site, proprietário(s) com todos os
  dados, contratos e os números nos canais. Criei o **M2.6** para o cadastro **completo**:
  endereço completo, camas e comodidades, regras da casa, horários, taxas (limpeza, hóspede
  extra), estadia mínima/máxima **com exceções por período**, antecedência, dias de
  chegada/saída, preço base e **preço dinâmico liga/desliga** — tudo editável pelo painel,
  como nas OTAs. O portal do proprietário puxa daí.
- **Equipe de limpeza:** já estava a agenda diária para a equipe (M6.3); acrescentei o
  **M6.6** — acesso próprio pelo celular (ver a agenda e marcar faxina feita) **e** aviso por
  WhatsApp quando o WhatsApp estiver ligado (por e-mail enquanto isso). As duas formas
  funcionando, como você sugeriu.

---

## 8. Glossário rápido

- **Repositório:** a "pasta" do projeto no GitHub, com todo o histórico.
- **Branch:** uma cópia paralela onde uma mudança é preparada sem mexer no principal.
- **PR (pull request):** o pedido para juntar uma branch ao principal. É onde você revisa.
- **Merge:** aceitar o PR. A mudança passa a fazer parte da versão principal (`main`).
- **CI:** os testes automáticos que rodam em cada PR. Verde = tudo certo.
- **Deploy / publicar:** colocar o sistema no ar (na Vercel).
- **Homologação:** versão de teste no ar, com dados fictícios, antes da versão real.
- **Migração de banco:** um arquivo que cria ou altera tabelas do banco de dados de
  forma controlada.


## Calendário e preços — referência operacional de 1/10/2026

As regras aprovadas de mínimos, feriadões, temporada, multiplicadores, última hora e sobras estão reunidas em [Calendário, preços e duração](requisitos/operations/CALENDARIO-PRECOS-OPERACAO.md), com as exceções e decisões ainda pendentes. Desde 2/10 (M3.7) elas vivem no painel, em Configurações → Calendário e preços, e o envio ao Beds24 existe, mas só é ativado por você. Enquanto o envio do SCL não estiver ligado, a rodada autorizada em 1/10 continua usando o Beds24 conectado, com conferência no Airbnb — e não deve haver dois responsáveis escrevendo no mesmo calendário: ao ligar o SCL, pare de editar preços à mão no Beds24. Não aplicar descontos repetidos sobre diárias já reduzidas.
