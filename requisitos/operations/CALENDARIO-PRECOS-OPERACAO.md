# Calendário, preços e duração — regras operacionais

Consolidação solicitada por Diego em 1/10/2026. Origem: decisões diretas de 15, 18 e 19/9 registradas no protocolo local de calendário, comparadas com ROADMAP, CLAUDE.md, decisões operacionais e código atual da main `73f14d89f7fd616ada889ca175730ab42dba28b0`. Somente regras; reservas, contatos e resultados financeiros individuais ficam fora do Git.

**Atualização de 6/10/2026:** decisões novas de sobras, alta temporada de Búzios e testes de feriados constam nas seções temáticas. Descontos retirados, 35 referências de Búzios e 42 mínimos de sobras foram conferidos; estado e limites estão no [resultado confirmado](#resultado-confirmado-de-610--preços-descontos-mínimos-e-limites). Trechos de 1–4/10 preservam a história e não substituem os resultados posteriores. Detalhe sanitizado do antes/depois no [registro de 6/10](RODADA-2026-10-06.md).

## Fonte e estado de implantação

- Prevalece a direção de 24/9: **SCL como fonte oficial**, enviando calendário/preços ao Beds24 e às OTAs pelo M3.7, após implementação, teste em imóvel escolhido e ativação expressa por Diego. **Atualização de 4/10:** a fonte de **preços** passa a ser escolhida por imóvel (ROADMAP M3.9: automáticos da SCL, definidos no Beds24 pelo proprietário ou pela ferramenta dele, ou digitados no portal); a direção "SCL envia" vale sempre para o calendário e, para os preços, só quando a SCL é a fonte escolhida — em imóvel com preços do Beds24, o M3.7 não escreve preços (até o M3.9 existir, esse imóvel não é marcado para envio). Essa é a direção do sistema; em 1/10 Diego pediu expressamente esta rodada diretamente pelo Beds24 enquanto o painel não efetua escrita.
- Em 1/10, M3.7 ainda consta a fazer. O PR 73/M3.3 é importação somente leitura. Código, credencial ou quarto mapeado não provam envio ativo de tarifas.
- Para a rodada de 1/10, usar o Beds24 já conectado, verificar o que efetivamente envia e conferir resultado no Airbnb. Não editar preços paralelamente no Airbnb nem ativar a integração futura do painel. Evitar dois responsáveis escrevendo no mesmo calendário.
- Comparar sempre registros locais, requisitos vigentes, configurações atuais e últimas decisões de Diego. Preservar decisões novas; não copiar um arquivo antigo por cima de regra melhor. Propostas de agentes não viram aprovação por terem data recente.
- Este documento consolida requisitos operacionais; não afirma que o motor já os implementa nem que a plataforma já os salvou. A fonte futura dos valores configuráveis será o painel, conforme o princípio de uma regra em um lugar.

## Escopo e rotina

Cinco imóveis do Leblon: 102 Inteligente, 103 Boutique, 303 Quadra Praia, 399 Orgânico vigente e 403 Mezanino. Anúncios antigos e Ipanema excluídos. Casa Búzios separada, sem replicar preços dos estúdios ou incluí-la no catálogo público.

Revisão ampla sob pedido de Diego, aproximadamente mensal, cobrindo horizonte móvel de nove meses. Conferir cobertura anterior e novas datas, revalidando também eventos e lacunas já cobertos. Não declarar nove meses conferidos se apenas uma parte foi lida.

Checagem breve, quando atendimento/revisão estiver autorizado: hoje e amanhã, depois próximos sete dias; Búzios próximos 30 dias. Essa definição não cria nem reativa automação.

Preservar reservas e bloqueios intencionais. Uma autorização antiga para liberar bloqueios não se aplica a novos bloqueios. Não inferir disponibilidade da ausência de registros.

## Duração e disponibilidade

- Horizonte móvel: nove meses, conferir anúncio por anúncio.
- Semana normal: domingo–quinta mínimo 1 noite; sexta e sábado mínimo 2 noites.
- Check-in e checkout em qualquer dia da semana.
- Máximo 27 noites; pedidos superiores dependem de avaliação, não aprovação automática.
- Conferir se mínimo na interface é da entrada ou de todas as noites; registrar a semântica antes de traduzir a regra entre sistemas.
- Pedidos para o próprio dia são aceitos para avaliação manual e confirmação da limpeza. Não habilitar reserva instantânea no mesmo dia nem afirmar limpeza pronta por esta regra.

## Feriadões

Feriados nacionais e estaduais do RJ e Corpus Christi continuam no escopo aprovado. Atualização de 6/10: o feriado estadual de **9 de julho/SP** recebe tratamento de teste próprio para Rio e Búzios, descrito abaixo; não é feriado municipal. A antiga exclusão geral de municipais foi substituída apenas pelo teste delimitado de feriados municipais da cidade do Rio com efeito em Búzios. Outros feriados de origem dos hóspedes dependem de conferência e aprovação. Confirmar datas anuais e abrangência em fonte confiável. A tabela de janelas abaixo não define automaticamente a janela dos novos testes de 1,5×.

| Dia do feriado | Janela inclusiva | Mínimo |
|---|---|---:|
| Quinta | Quarta anterior a domingo | 3 |
| Sexta | Quinta anterior a domingo | 3 |
| Segunda | Sexta anterior a segunda | 3 |
| Terça | Sexta anterior a terça | 3 |

Quarta, sábado ou domingo não ativam uma janela extra. Se dois feriados prolongarem o mesmo intervalo (quinta/sexta seguido de segunda/terça), unir as janelas sem interrupção. Preço de teste no Leblon: 2×B.

## Temporada e eventos

- Alta temporada: **15/12 ao último dia de fevereiro**, estendendo até Quarta-feira de Cinzas quando ela cair em março. **2×B no Leblon e em Búzios**, conforme confirmação direta de Diego em 6/10/2026 para a casa. B é a base própria confirmada de cada imóvel, não o piso nem a diária já multiplicada; o piso geral de R$450 de Búzios não define sua base B. Não estender ao fim de semana seguinte por inferência. A adoção da regra não comprova que os preços foram gravados ou relidos.
- Réveillon: 25/12–1/1 inclusivos, mínimo 5 noites, Leblon 4×B. Esclarecimento de 6/10: se já houver reserva no período, aplicar às noites livres restantes o mínimo semanal ordinário, limitado à sobra menor, conforme a regra abaixo; não exige reserva prévia de cinco noites. Manter o preço do evento em todas as noites ainda dentro dessa janela, antes ou depois da reserva. A partir de 2/1, voltar às regras normais da data, incluindo alta temporada quando aplicável.
- Carnaval: segunda-feira da semana anterior à terça-feira de Carnaval até Cinzas, inclusivos; é a segunda três dias antes da quinta que inicia o período principal. Mínimo 5, Leblon 4×B. Confirmar datas anuais. Havendo reserva no período, aplicar a regra de sobras abaixo sem retirar o preço do evento das noites que continuam dentro da janela. Na quinta-feira após Cinzas, retomar as regras normais, incluindo alta temporada quando aplicável; em 2027, esse retorno é em 11/2.
- Rock in Rio: Leblon 3×B; sem novo mínimo de noites. Búzios excluído. Confirmar edição, dias efetivos e noites abrangidas; não importar datas de outro ano.
- Multiplicadores não acumulam: usar o maior aplicável. Carnaval dentro da alta = 4×B, nunca 8×B.
- Nas datas especiais, preço fixo manual substitui o Preço Inteligente naquela noite. Não desligar o recurso global nem elevar seu teto global por consequência.

## Base, preços existentes e pisos

B é a referência geral confirmada do anúncio antes do acréscimo, não a diária já multiplicada. Diego reconfirmou em 1/10/2026 **B=R$450 nos quatro estúdios e B=R$800 no 303** para o cálculo dos multiplicadores. Essa decisão não significa que todas as diárias específicas sejam iguais à base. Conferir intervenções e descontos existentes antes de aplicar, preservando a referência original.

As tarifas manuais de evento podem ultrapassar o teto do Preço Inteligente: essa exceção foi aprovada, preservando o teto geral. Não limitar silenciosamente o preço especial ao teto nem mudar o teto para acomodá-lo.

Os valores são diárias antes de taxas/limpeza/descontos, não receita líquida nem preços validados por pesquisa de mercado. Não aumentar redução manual de Diego sem conhecer a decisão.

## Última hora — teste aprovado

| Antecedência da noite (fuso local) | Redução sobre referência original | Piso estúdios | Piso 303 |
|---|---:|---:|---:|
| D−7 a D−3 | 15% | R$350 | R$700 |
| D−2 a D0 | 25% | R$300 | R$650 |

Preço = maior entre piso aprovado e referência original × (1−percentual). Guardar a referência antes da primeira redução. Ao passar para 25%, recalcular sobre ela; nunca reduzir novamente o preço que já recebeu 15%. Os pisos registrados são limites, não alvos obrigatórios nem valores a recalcular automaticamente se B mudar.

Conferir promoções, descontos por duração, hóspedes com avaliações excelentes e outros descontos antes de aplicar. Não desligar benefícios existentes sem autorização. Se a referência original ou a combinação efetiva for desconhecida, registrar pendência, sem inventar uma base. Eventos grandes não recebem automaticamente o piso de semana normal; essa exceção continua pendente.

## Sobras entre reservas

**Atualização de Diego em 6/10/2026 para feriados/eventos com reserva já existente no período:** em todas as noites livres restantes do período, usar o mínimo ordinário da semana — domingo a quinta **1 noite**, sexta e sábado **2 noites** — limitado ao número de noites consecutivas livres até a próxima reserva/bloqueio válido, para não encalhar uma sobra de uma noite. Vale para todos os seis imóveis, sem alterar reservas ou bloqueios. Esta decisão substitui o escalonamento de três/quatro noites que ainda pudesse resultar do mínimo especial; não manter 3 ou 4 apenas porque essas eram as noites livres restantes.

Se ainda não houver reserva no período de feriado/evento, preservar o mínimo especial aplicável à janela íntegra. A existência de uma reserva no período é a condição para usar o mínimo ordinário nas sobras; consulta ou pedido não confirmado não basta. Conferir a ocupação real antes de mudar.

Fora dessa exceção, permanece a regra geral de sobra: em cada data de entrada, mínimo ajustado = menor entre mínimo aplicável e noites consecutivas livres até a próxima reserva/bloqueio válido. Não liberar todo um período com uma noite indistintamente.

**Preço e mínimo são decisões separadas.** A flexibilização do mínimo não reduz o preço do feriado/evento: manter a tarifa especial em todas as noites ainda dentro da janela, tanto antes quanto depois da reserva. Exemplo de calendário: uma reserva no miolo do Réveillon não retira o preço de evento de 31/12 ou 1/1 livres. Diego também pediu manter, por enquanto, os preços dos grandes eventos nas noites anteriores à reserva que continuem na janela.

Depois da janela, voltar ao preço e ao mínimo normais aplicáveis à data. “Normal” inclui a alta temporada quando documentada: 2/1 e a quinta-feira após Cinzas podem continuar sujeitos à alta temporada, sem prolongar o multiplicador ou mínimo do evento. Búzios agora adota a mesma regra de alta temporada por confirmação expressa de 6/10; os demais multiplicadores não são herdados por inferência.

Esta atualização documenta a decisão; aplicação e releitura dos resultados precisam ser registradas por imóvel/período. Não apresentar a mudança como implementada no motor SCL nem como aplicada na plataforma apenas porque o guia foi alterado. **Situação em 9/10/2026 (M3.10):** a regra está no motor do SCL (envio ao Beds24, prévia e site): só reserva confirmada conta, o mínimo ordinário inclui o mínimo do cadastro do imóvel, período explícito do imóvel continua substituindo, e a regra vem ligada, com opção no painel para desligá-la por evento (temporadas longas, como a alta temporada) e para os feriadões. Aplicação na plataforma só pelo envio ao Beds24, ainda desligado até Diego ligar, e continua exigindo a conferência por imóvel/período.

Sábado livre após checkout com sexta ocupada pode ter mínimo 1, conferindo exceções especiais. Aplicar também a sobras de hoje, mantendo avaliação manual e limpeza. A redução do mínimo não autoriza desconto ou desbloqueio.

## Búzios — regra própria

Histórico: o piloto antigo de 2×/4× sobre 450 não autorizava novas replicações. Em 18/9, Diego orientou preservar os limites gerais então registrados (450/2.500), com revisão própria. Referência relatada de cerca de 3.000/noite para Réveillon anterior e Carnaval desejado não é tarifa aprovada para novas datas. **Nova confirmação de 6/10:** Búzios adota a mesma regra de alta temporada do Leblon (15/12 ao fim de fevereiro, extensão até Cinzas se em março, 2× a base própria confirmada). Isso não aprova automaticamente 4× para Réveillon/Carnaval ou 2× para todos os demais feriadões; os fatores ainda não definidos seguem pendentes de decisão.

Próximos 30 dias: registrar noites reservadas, livres e impedimentos de duração/antecedência. Antes de reduzir, resolver a incidência adicional de 15% para hóspedes com avaliações excelentes observada em setembro. Pisos históricos do teste eram 350/300; aplicar só após conferir as condições específicas e decisões posteriores. A alta temporada passou a ter a fórmula acima por decisão de 6/10; conferir a base própria antes da aplicação. Os demais feriadões/eventos continuam exigindo definição dos fatores/valores que não tenham sido aprovados explicitamente. Não prometer melhora de ranking por reduzir preço.

## Registro e verificação de cada rodada

1. Conferir fonte em vigor, autorização, anúncio atual e reservas/bloqueios.
2. Registrar intervalo, preço e mínimo anteriores, base original e regra usada.
3. Aplicar apenas noites disponíveis e mudanças autorizadas, sem alterar reservas confirmadas.
4. Salvar; reabrir/recarregar e conferir anúncio, datas e valores. Distinguir envio do salvamento e resultado confirmado.
5. Registrar cobertura de preços, mínimos e horizonte separadamente; registrar lacunas e próximo passo.
6. Manter log restrito por data/anúncio para não duplicar reduções, preservando horários, valores antes/depois, motivo, persistência e desfecho. No repositório, somente metodologia, exemplos fictícios ou sínteses sanitizadas autorizadas de preços de calendário/mínimos, sem nomes, identificadores, valores de reservas, repasses ou documentos. Não atribuir resultado de desempenho a uma alteração sem evidência suficiente.

## Compatibilidade com o sistema atual e pendências

O arquivo `app/src/imoveis/regras-venda.ts`, conferido na main citada, aceita períodos explícitos, aplica o primeiro período correspondente e limita o valor ao mínimo/máximo com preço dinâmico ligado. Ainda não é um motor das regras acima: não calcula o maior multiplicador, os descontos de última hora com referência persistida, a semana normal por dia ou as sobras por disponibilidade. Essa diferença precisa ser tratada no desenvolvimento de M3.7 antes de usá-lo como automatismo; esta consolidação **não altera código nem libera escrita**.

Pendentes: tarifas próprias de eventos de Búzios; combinação de descontos adicionais; tratamento de última hora em grandes eventos; validação de mercado e definição de piso líquido. Para sobras de Réveillon/Carnaval, prevalece a decisão de 6/10 acima: mínimo ordinário condicionado à reserva existente e preço de evento mantido dentro da janela; aplicação ainda exige verificação. Nenhuma dessas lacunas deve ser preenchida por palpite.

O documento `requisitos/product/MARKETPLACE-PRECIFICACAO.md` trata de propostas para venda direta e divisão de receita. Foi preservado: não substitui estas regras de diárias e não constitui aprovação de novos percentuais.

## Tradução para a conexão Beds24 vigente

Segundo a documentação oficial consultada em1/10, o modo Limited inclui preços, disponibilidade e mínimos, além de configurações de preços. O nome não significa ausência de envio. Airbnb aplica o mínimo à data de entrada. Preço Inteligente não está disponível para anúncios conectados por API: preservar as regras históricas como origem, mas não presumir esse motor ativo na configuração atual. Conferir tarifas diárias, descontos e base de cada anúncio antes de traduzir regras. Referência: https://wiki.beds24.com/index.php/Airbnb_Mapping.


### Confirmação direta de Diego — 1/10/2026

Diego confirmou: base padrão do303 = R$800 e autorizou corrigir o R$1000 observado noBeds24. Não atribuiu origem ao valor divergente. Preservar tarifas especiais, reservas e intervenções manuais específicas. A gravação e a propagação devem ser verificadas e registradas separadamente.

## Limitação identificada na revisão do PR74

A função `precoDaNoite` atualmente limita também tarifas explícitas de eventos ao teto geral quando o preço dinâmico está ligado. Isso contradiz a exceção aprovada acima e pode reduzir uma cotação do simulador mesmo antes do M3.7. Antes de considerar essa regra implementada, é necessário corrigir a isenção dos preços explícitos de evento e testá-la, mantendo a limitação para as tarifas às quais ela realmente se aplica. Esta rodada documental não altera o motor, não aprova publicação nem comprova cotações corretas.

## Atualização de implementação — M3.7a, 2/10/2026

A prévia em `/painel/calendario/previa` compara o cadastro atual com observações já
importadas, por imóvel e intervalo (até 92 noites inclusivas). Exibe lacunas, horários,
ocupação local e diferenças conhecidas. Não faz consulta remota, não envia valores e não
valida preço final das OTAs. A semântica do mínimo mostrado pelo SCL é a data de entrada;
o mínimo observado do Beds24 ainda requer conferência das regras do canal.

Corrigida a limitação descrita acima: `precoDaNoite` preserva preços explícitos de períodos,
inclusive fora do piso/teto geral; somente o preço base passa pelos limites quando
habilitados. O simulador usa a mesma função. Nenhum preço de reserva ou canal é alterado.
As demais lacunas do motor e a proteção diária de piso/teto continuam pendentes no M3.7.

## Compatibilidade dos PRs73 e74

Conferência em 1/10: PR73 (`codex/m3.3-beds24-sincronizacao`, head `c583e8de7b9255b5e839eaefa02c6185457fbd50`) implementa leitura Beds24 → SCL. PR74 acrescenta esta documentação e uma seção no fim de `GUIA-DIEGO.md`. O único arquivo compartilhado é o guia; os trechos alterados no PR73 e a seção acrescentada no PR74 são distintos. Ambos partiam da mesma main `73f14d89f7fd616ada889ca175730ab42dba28b0` e estavam integráveis na consulta. Não substituir o guia inteiro pela cópia de outra branch. Após o primeiro merge humano, revalidar o diff do segundo contra a nova main; preservar ambos os conjuntos de mudanças. A inspeção documental não constitui revisão ou aprovação integral do código do PR73.

## Atendimento pela conexão — autorização de 1/10/2026

Diego autorizou incluir consultas e pedidos de todos os seis imóveis no Beds24. Configuração `Inquiry and Requests = Import all` salva e relida após recarga em 102, 103, 303, 399 e Búzios; 403 já estava nessa opção e foi reconferido. Foram preservados mapeamentos e modo Limited. Consultas não equivalem a reservas confirmadas e não devem ocupar inventário por inferência. A configuração não comprova que todo histórico antigo foi importado; conferir conversas, anexos e vínculo da reserva antes de responder. Não ativar respondedor automático nem duplicar mensagens programadas.

A caixa de mensagens e um histórico de reserva do Airbnb foram acessados no Beds24. Leitura confirmada; envio pela conexão ainda não testado nesta rodada. Enquanto houver lacunas, consultar o inbox original Airbnb para garantir cobertura. WhatsApp continua no aplicativo/Web vinculado; Diego informou que ainda não cadastrou Meta. Esta mudança não liga o importador Beds24 → SCL do PR73 nem cria rotinas no painel.

O mapeamento do403 foi conferido e as reservas existentes reconciliadas pela função oficial de importação, preservando o cadastro atual. Novas reservas, alterações e cancelamentos são previstos pela conexão; o próximo evento real ainda precisa ser observado para validar o fluxo automático. Não repetir importação manual como agendamento nem atribuir a falha anterior à duplicata sem evidência.


## Decisões e verificação complementares — 1/10/2026

Os pisos de última hora devem valer no valor final da diária após todos os descontos, inclusive semanal: estúdios350/300 e303700/650 nas respectivas faixas. Taxas e limpeza não compensam diária abaixo do piso. Exemplo:393×0,85×0,90=300,645, inferior ao piso350. Não ativar combinação que viole o limite. Antecedência da noite e antecedência do check-in não são automaticamente equivalentes; a tradução nativa precisa preservar essa semântica.

Diego autorizou substituir no399 a promoção19%/14dias pela regra15%/25% e desligar Preços Inteligentes, se ativos. Na interfaceAPI não houve interruptor ativo desligado; origem dos19% não comprovada. Atualização desta mesma rodada: no399, a promoção antiga foi zerada e as faixas nativas15%/25% foram ativadas; ver estado verificado abaixo. Automação com piso final continua pendente, não concluída.

Envio de mensagem porBeds24 foi posteriormente confirmado na conversa originalAirbnb. Isso valida os envios observados, não cobertura integral do histórico nem todos os anexos.

Regras de limpeza, porteiros e chaves, incluindo alternativa comum103/399, estão em [PORTARIA-CHAVES-LIMPEZA.md](PORTARIA-CHAVES-LIMPEZA.md). Contatos reais permanecem fora deste documento; cadastro restrito na nuvem ainda pendente.


## Retirada do desconto semanal e contingência — decisão direta de 1/10/2026

Diego autorizou retirar o desconto automático de 10% para estadias de sete ou mais noites dos anúncios em que estiver configurado. Reservas existentes são preservadas. Desconto mensal e outros benefícios não estão revogados por essa decisão. Aplicação anúncio por anúncio em andamento; não confundir autorização com confirmação de propagação.

Se o Beds24 não conseguir impor sozinho piso/teto depois de todas as combinações, Diego autorizou ativar as regras de desconto mesmo assim e registrar como pendência a implementação de **verificação e correção diária automatizada**. Os limites continuam sendo a regra desejada; podem ocorrer desvios enquanto essa proteção não estiver implementada e testada. Esta decisão supera a orientação anterior de aguardar trava final para ativar, mas não comprova que a automação já foi ligada.

A rotina pendente deve comparar tarifa original, preço enviado, descontos aplicáveis e resultado final; corrigir sem acumular reduções e guardar histórico, fonte e motivo. Teto geral não limita tarifas explícitas de eventos autorizados; não inventar teto novo nem reduzir um evento por engano. Respeitar reservas/bloqueios e o responsável único pela escrita (Beds24 nesta rodada, futuro SCL somente após implementação/ativação). Falta definir e validar execução na nuvem e leitura do resultado nas OTAs; documentação não equivale a rotina funcionando.


## Estado verificado e pendência executável — 1/10/2026

- Desconto semanal10%: removido e relido noBeds24 nos seis imóveis; Update retornouSuccess em todos. Consulta de conteúdo retornado peloAirbnb confirmou ausência de regra7dias em399 eBúzios. A respostaSuccess dos demais não substitui uma conferência independente do conteúdo final.
-399: DailyPrice2 aplica−15% na antecedência3–7 eDailyPrice3 aplica−25% na antecedência0–2, ambas vinculadas diretamente àDailyPrice1 do próprio imóvel. Airbnb habilitado, reservas existentes preservadas. Conteúdo retornado peloAirbnb confirma remoção da promoção antiga19%/14dias e do semanal; mensal15%/28dias mantido.
- PriceData do399 confirma que as faixas alteram as noites correspondentes. Isso confirma o cálculo preparado para exportação, não todas as cotações finais de hóspedes.
- A proteção final de piso/teto **não está implementada nem agendada**. Há desvios observados; ativação permitida pela contingência expressa deDiego. Não apresentar toda a precificação como concluída. Essa limitação permaneceu após a extensão das faixas aos demais imóveis descrita abaixo.

### Rotina diária a implementar

Responsável funcional: motor de preços doSCL, com execução na nuvem quando implementado; até lá, item pendente. Não criar um segundo escritor concorrente com oBeds24.

1. Ler a referência original persistida e as regras vigentes por imóvel/data, tarifa preparada noBeds24, descontos por duração/antecedência ainda vigentes nasOTAs e disponibilidade. Não assumir que salvar noBeds24 prova preço final noAirbnb.
2. Avaliar hoje, amanhã e próximos sete dias, além de alterações de regras que possam afetar o horizonte configurado. Executar no fusoAmerica/Sao_Paulo. Usar somente diárias livres; não alterar valores de reservas existentes nem liberar bloqueios.
3. Recalcular o resultado final após descontos, respeitando os pisos de cada faixa. Detectar referências ausentes, percentuais sobrepostos e regras conflitantes. Não reaplicar25% sobre preço já reduzido15%.
4. Validar teto vigente com fonte identificada; preservar exceções expressas de eventos. Se um limite ou o tratamento do evento estiver indefinido, registrar e avisar em vez de inventar uma correção.
5. Corrigir na fonte autorizada e de forma persistente: uma correção pontual que a regra nativa sobrescreverá de novo não basta. Se a combinação não puder ser representada no provedor, registrar conflito e a alternativa técnica necessária.
6. Reconsultar o destino e guardar antes/depois, regra, horário, tentativa e resultado em registro privado. Repetir uma execução não pode acumular cortes ou produzir mensagens duplicadas. AlertarDiego sobre falha, conflito sem solução ou desvio persistente; não afirmar conformidade quando a leitura falhar.

### Critérios para considerar a rotina pronta

Testar: passagemD−3→D−2; desconto de duração combinado; referência já reduzida; evento acima do teto geral autorizado; arredondamento; reserva/bloqueio; mudança concorrente; falha deAPI e repetição após interrupção. Exigir teste controlado, correção verificada na fonte e no destino, execução diária comprovada e histórico privado. Esta lista é uma pendência de implementação, não prova de testes executados.


## Extensão concluída aos demais imóveis — 1/10/2026

Por pedido direto deDiego, as faixas nativas de15% (D3–7) e25% (D0–2) também foram configuradas no102,103,303,403 eBúzios. O399 já estava configurado e não recebeu duplicatas. Cada par usa aDailyPrice1 do próprio imóvel, preservando as tarifas específicas de origem; não usa a base de outro imóvel nem acumula15% e25%. CanalAirbnb ativo, Direct/Agents desativados nas novas faixas, mínimo1 e máximo27.

Búzios recebeu os mesmos percentuais sobre suas próprias tarifas. A promoção antiga13%/14dias foi zerada, salva, relida e enviada comUpdateSuccess. Isso não transfere bases, multiplicadores de eventos ou limites dos estúdios para a casa.

Listas de regras reabertas confirmaram os dois percentuais e vínculo em cada imóvel. PriceData confirmou cálculo das faixas para envio aoAirbnb. O conteúdo retornado peloAirbnb confirmou ausência das promoções antigas de última hora e do semanal10% nos seis imóveis; mensal15%/28dias preservado. PriceData não equivale a verificação de todas as cotações finais de hóspedes.

A configuração solicitada está aplicada nos seis imóveis, mas **a proteção final e correção diária de piso/teto continuam pendentes**. Foram observadas diárias abaixo dos pisos nos apartamentos doLeblon; não foi feita correção automática nem criada tarefa de execução diária. A contingência autorizada continua explícita. Preservar os resultados e registros privados antes/depois; não declarar revisão ampla de nove meses concluída por ter configurado estas faixas.

Esta atualização está noPR74 e em cópia local conferida; main só receberá após merge humano. PR73 não foi alterado por esta configuração.

## Atualização de implementação — M3.7, 2/10/2026

Implementado no painel (um só lugar por regra; `app/src/calendario/`):

- **Regras operacionais editáveis** em Configurações → Calendário e preços: mínimo por dia da
  semana da entrada (padrão dom–qui 1, sex–sáb 2), máximo (27), horizonte do envio (270
  noites), feriados (lista por data; a janela do feriadão segue a tabela acima, com união de
  janelas vizinhas; mínimo 3 e 2×B por padrão, nos imóveis escolhidos), eventos/temporadas
  com multiplicador e mínimo por imóvel (vale o maior multiplicador, nunca a soma), última
  hora com duas faixas (padrão D−7..D−3 15%, D−2..D0 25%) e modo "Beds24 aplica" (padrão,
  compatível com as DailyPrice2/3 configuradas em 1/10), "SCL aplica" ou desligada.
- **Pisos de última hora por imóvel** (ficha do imóvel). No modo "Beds24 aplica", o SCL envia a
  referência e a eleva só quando o desconto nativo cairia abaixo do piso (ex.: B=393 →
  envia 411,77 para a faixa de 15% resultar em 350,00); no modo "SCL aplica", envia o preço
  final limitado ao piso. Sem piso cadastrado, avisa e não reduz por conta própria. A
  referência é sempre recalculada do cadastro: repetir a execução nunca acumula cortes.
- **Sobras:** mínimo da entrada = menor entre o mínimo aplicável e as noites livres seguidas
  até a próxima reserva ou bloqueio (3, 2, 1). Período explícito do imóvel (preço e/ou
  mínimo) substitui as regras automáticas, inclusive acima do teto.
- **Bloqueios manuais** (Calendário → Bloquear datas) vão como `override: blackout`; o SCL só
  reabre o que ele mesmo fechou, e devolve a noite ao que havia antes: a restrição que já
  existia no Beds24 (`noCheckIn` etc., guardada ao fechar) ou `none`. A reabertura só sai
  quando a leitura atual ainda mostra o blackout do SCL; se o Beds24 mostrar outra coisa, a
  posse acaba sem escrita. A posse é confirmada pelo campo de bloqueio da releitura (ou da
  leitura seguinte), mesmo que preço, mínimo ou máximo tenham sido recusados na mesma noite.
  A posse vale para o quarto Beds24 que recebeu o envio: trocado o
  vínculo do imóvel, o estado do quarto antigo é descartado com aviso (o que o SCL fechou lá é
  reaberto manualmente). As observações do calendário também guardam o quarto lido: leitura
  de outro quarto não descreve o imóvel (plano, prévia e site a tratam como ausente). Bloqueios e 0 unidades que só existem no Beds24 viram aviso.
  Reservas nunca são criadas, alteradas ou canceladas pelo envio.
- **Bloqueio pelo proprietário (M5.5, 3/10):** o portal grava um bloqueio comum com fonte
  "proprietario", que segue ao Beds24 pelo mesmo envio (mesma posse, mesma reabertura). Só com
  um só contrato cobrindo todas as noites pedidas e com a permissão "bloqueio pelo portal" do contrato (ligada por
  padrão; a empresa liga/desliga por contrato no painel, valendo daí para frente); só de hoje em diante (no fuso do imóvel), nunca sobre
  reserva não cancelada; o proprietário só libera o que ele mesmo bloqueou e que ainda não
  passou (o bloqueio guarda o titular que o fez; depois de uma troca de titular, o do anterior
  só a empresa libera). Bloqueio da empresa ou lido do Beds24 aparece a ele, mas não é liberável
  no portal. Reserva do tipo consulta não impede o bloqueio (não ocupa inventário).
- **Envio controlado** (`POST /inventory/rooms/calendar`, price1/minStay/maxStay/override):
  por imóvel, a partir de uma leitura atual do destino feita no início de cada execução
  (sem ela, ou com ela incompleta ou inválida para o imóvel, nada é escrito nem guardado; um registro
  inválido sem quarto identificável invalida a leitura de todos os quartos pedidos), só noites diferentes dessa leitura (ou do último envio
  confirmado), com simulação prévia, intenção gravada antes da escrita externa (se o banco
  falhar depois da escrita, a execução seguinte assume a posse pela leitura), releitura noite
  a noite (confirmada/divergente), histórico
  antes/depois com a regra usada, trava contra execução simultânea (a mesma da importação, dos
  bloqueios manuais e do vínculo Beds24: nada disso muda junto com um envio; e antes de
  escrever o envio confere de novo o vínculo exato e os bloqueios locais) e rotina diária opt-in
  (7h, após a importação). Só funciona com `BEDS24_ESCRITA=ligada` e imóvel marcado; o
  refresh token precisa do escopo `inventory`.

Continuam pendentes (decisão de Diego, não automatizadas): tarifas próprias de Búzios,
tratamento de última hora em grandes eventos (hoje as faixas valem em todas as noites, como
as regras nativas), reprecificação de sobras de Réveillon/Carnaval, validação de mercado e
piso líquido. A releitura comprova o que o Beds24 gravou, não a cotação final nas OTAs. Dias
de entrada/saída restritos no cadastro ainda não são enviados. O teste no 103 e a ativação
(variável na Vercel) não foram feitos nesta implementação.

## Fonte de preços por imóvel — M3.9, 4/10/2026

- Implementado: a ficha de cada imóvel tem o campo **Fonte de preços** (`scl` automáticos,
  `beds24` o SCL só lê, `manual` cadastro sem ajustes). Com `beds24`, o motor não calcula preço
  (sem eventos, feriadões e última hora), o envio ao Beds24 nunca escreve preço (só mínimos,
  máximos e bloqueios), e o site usa o preço da leitura atual do Beds24; noite sem preço lido ou
  com leitura vencida fica a confirmar, sem valor. Com `manual`, vale o preço base e os períodos
  do cadastro, sem multiplicadores, última hora nem os limites mínimo/máximo do preço dinâmico
  (também um ajuste automático), enviados ao Beds24. Entre o plano e a escrita, o envio confere
  de novo a fonte do imóvel: se mudou, nada é escrito para ele nessa execução. O calendário (mínimos,
  máximos, bloqueios, sobras) é sempre do SCL, em qualquer fonte.
- A direção global do M3.7 ("SCL envia") continua valendo para o calendário; para preços, manda a
  fonte do imóvel. A regra "até o M3.9 existir, esse imóvel não é marcado para envio" deixou de
  ser necessária.
- **Desconto do site acumula com a última hora — decisão de Diego em 4/10/2026.** A regra
  "multiplicadores não acumulam" continua valendo entre eventos e feriadões. O desconto do site
  (M12.1) é aplicado por cima do valor cheio de qualquer fonte, e por isso o site fica sempre o
  mesmo percentual abaixo do que está nas OTAs, inclusive em noite de última hora.
- A prévia de calendário mostra a fonte do imóvel e a coluna "Site (≈)" (preço da noite com o
  desconto do site, aproximado) para a conferência periódica contra o Airbnb e o Booking.


## Pisos de Búzios — decisão e aplicação de 6/10/2026

Diego definiu **R$450 de piso geral** e **R$350 de piso de última hora D0–D7**, somente no inventário livre, no horizonte de nove meses de **6/10/2026 a 6/7/2027**, inclusive. São limites mínimos, não diárias uniformes, preços-alvo nem definição da base B. Não copiar a direção para os apartamentos do Leblon ou reduzir valores já acima do piso.

Na execução, 35 referências livres de R$350 foram elevadas para R$450 e relidas; os valores de D0–D7 já respeitavam R$350 e não precisaram alteração. Descontos mensal e de hóspedes bem avaliados foram retirados conforme autorização específica, com resultado por anúncio. Detalhes e limites estão no resultado confirmado abaixo.

A correção da grade não cria proteção permanente: faixas nativas 15%/25% continuam, e referência de R$450 produzirá R$337,50 ao entrar em D0–D2 com −25%. Nessa faixa, é necessária referência de pelo menos R$466,67 para gerar R$350,00. A rotina deve conferir novas datas, preservando referência original, tarifas especiais, reservas/bloqueios e composição efetiva; não presumir que a futura cotação final já esteja protegida.

## Revisão semanal da base — próxima revisão

Na próxima revisão semanal, Diego pediu conferir se a base de preços faz sentido, além de checar piso e teto. Observar, a partir da experiência das rodadas e dos valores efetivamente encontrados, onde ficam as tarifas usuais dentro do intervalo: próximas do mínimo, do máximo ou distribuídas de forma coerente. Identificar tarifas anômalas e sua origem antes de corrigir.

Depois da análise, rever e ajustar a base dentro do escopo autorizado, documentando o motivo e o antes/depois. Distinguir a base de um preço pontual, desconto, piso, teto ou tarifa de evento; preservar reservas, bloqueios e intervenções manuais específicas. Não elevar ou baixar toda a grade apenas porque uma noite encostou num limite. Conferir a persistência da alteração e os descontos que afetam o preço final. Este item entra na próxima revisão semanal já configurada, sem declarar análise concluída nem criar outra rotina paralela.

## Descontos e Preço Inteligente — autorização de 6/10

Diego autorizou retirar o desconto mensal de 15% e o benefício de 15% para hóspedes bem avaliados dos anúncios ativos em escopo, quando configurados, e verificar que o Preço Inteligente esteja desligado em todos. A retirada dos benefícios foi confirmada; o estado explícito OFF do Preço Inteligente ainda não foi comprovado. Guardar resultado por anúncio, distinguir configuração já ausente/desligada de alteração efetuada e registrar opção inacessível ou sem confirmação.

A autorização não inclui desconectar o software para expor opções na plataforma. Resultado de inspeção somente leitura ou ausência de chave não confirma desligamento. Preservar tarifas, taxas, reservas e disponibilidade fora do escopo autorizado.

### Alta temporada e sobras — confirmação documental em 6/10

A alta temporada já estava documentada de 15/12 ao último dia de fevereiro, estendendo até Cinzas quando cair em março, com 2×B no Leblon. Na conferência inicial de 6/10, Búzios ainda não tinha fórmula quantificada aprovada no guia. Depois dessa conferência, Diego confirmou adotar para Búzios o mesmo período e 2×B, usando a base própria confirmada. Em 2027, 2/1 e 11/2 ficam dentro dessa alta temporada: encerrar a janela do Réveillon/Carnaval não significa desligar a alta temporada. Confirmação documental e autorização de adoção não comprovam configuração ou preço final salvo.

## Testes de feriados de origem — decisão de 6/10/2026

- **Municipal do próprio destino:** não tratar como evento de aumento pela hipótese de viagem dos próprios moradores. Feriado municipal de Búzios não gera efeito automático no Rio; eventos realizados em Búzios são avaliados caso a caso.
- **Municipal da cidade do Rio → Búzios:** teste de **1,5× a base própria de Búzios** somente quando o feriado cair em **segunda, terça, quinta ou sexta**. Quarta-feira, sábado e domingo ficam fora do teste. Não aplicar esse teste à própria cidade do Rio nem transformar qualquer evento carioca em demanda de Búzios.
- **9 de julho/SP → Rio e Búzios:** é feriado **estadual**, com teste de **1,5× a base própria de cada imóvel** quando cair em segunda, terça, quinta ou sexta. Não classificar como municipal nem aplicar em quarta/sábado/domingo. 9/7/2027 cai em sexta-feira. Diego adiou a implementação para a revisão semanal de **9/10/2026**, autorizando ampliar o horizonte em três dias, até **9/7/2027**; a rodada já executada terminou em 6/7/2027. Não declarar a data nova aplicada.
- **25 de janeiro/SP → Rio e Búzios:** feriado **municipal da cidade de São Paulo**, com teste de **1,5× a base própria de cada imóvel**, somente segunda, terça, quinta ou sexta. 25/1/2027 cai em segunda-feira. Diego adiou a implementação para a passada de **7/10/2026**; ainda não aplicada nesta rodada. Outros municipais de São Paulo não são incluídos por inferência.
- **Corpus Christi e 20 de novembro:** permanecem no tratamento geral já aprovado; não reclassificar automaticamente como um dos novos testes de 1,5×.
- **Rock in Rio:** permanece sem impacto automático em Búzios; o fator 3× documentado é do Leblon.

**Sobreposição confirmada por Diego:** usar o **maior multiplicador aplicável**, sem acumular. Alta temporada de 2× e teste de 1,5× resultam em 2×, nunca 3×.

**Limite ainda pendente:** definir os dias concretos de início/fim da janela de cada teste antes de escrever. O critério de dia da semana do feriado não determina sozinho os dias adjacentes. A extensão autorizada até 9/7/2027 não permite presumir uma janela até 11/7. Registrar a decisão da janela e a execução separadamente; o adiamento para a próxima rotina não comprova aplicação.

**Comparação ainda aberta para Búzios:** no Leblon, o guia traz 4×B para Réveillon/Carnaval e 2×B para os feriadões gerais; a confirmação de alta temporada de Búzios não aprova esses fatores para a casa. Levantar as diferenças e consultar Diego antes de replicar.

## Resultado confirmado de 6/10 — preços, descontos, mínimos e limites

- **Benefícios Airbnb:** mensal de 15% para 28 ou mais noites passou a 0% nos seis anúncios. Benefício de 15% para hóspedes bem avaliados foi removido de 102, 103, 303, 403 e Búzios; no 399 já estava desligado. Foram 11 alterações com retorno e releitura dos painéis. Semanais já estavam em 0%. Nenhuma tarifa-base, taxa, reserva ou disponibilidade foi alterada diretamente no Airbnb.
- **Piso geral de Búzios:** 35 noites livres passaram de R$350 para R$450 na referência, em oito intervalos entre maio e julho de 2027. Releitura cobriu 274 noites de 6/10/2026 a 6/7/2027: 35 alterações, 44 indisponíveis preservadas e 195 livres já no piso ou acima preservadas. Mínimos, máximos, inventário, multiplicadores e overrides ficaram idênticos nessa operação. Faixas vinculadas acompanharam as referências, sem mudança dos percentuais. Intervalos e limite futuro D0–D2 no [registro](RODADA-2026-10-06.md#búzios--piso-geral-nove-meses).
- **Sobras de feriados:** 42/42 mínimos reduzidos foram conferidos em 16 operações e nova leitura global dos seis calendários, entre o snapshot anterior de 14h16 e o posterior de 14h39 BRT. Em 1.098 noites comparadas houve zero divergências, 1.056 noites fora do plano intactas, nenhum preço/inventário/outro campo alterado. Trinta e cinco mínimos 1 aparecem vazios na interface por herdar o mínimo nativo 1; sete mínimos 2 continuam explícitos, com normalização conferida. Propagação nas OTAs não foi verificada. [Antes/depois sanitizado](RODADA-2026-10-06.md#antesdepois-sanitizado-dos-mínimos).
- **Fronteiras de eventos:** nas noites livres consultadas, os preços após Réveillon e Carnaval já eram normais de alta temporada: R$900 nos studios/Búzios e R$1.600 no 303, conforme imóvel/data examinados. Não houve restauração desnecessária; não estender a amostra a todos os imóveis e datas.
- **Alta temporada de Búzios:** snapshot de 76 noites em 15/12/2026–28/2/2027, com 52 livres e 24 indisponíveis, confirmou referências de R$900 fora das janelas de evento e R$1.800 em 25/12–1/1 e 1–10/2, sem exceções ao padrão observado. Os preços já estavam assim; nenhum novo multiplicador foi aplicado. Esse estado observado não define a base B por inferência a partir do piso R$450 nem comprova cotações finais das OTAs.
- **Preço Inteligente:** OFF explícito continua indeterminado nos seis anúncios conectados ao software. Interface inspecionada somente leitura, sem chave exposta; nenhuma conexão desfeita.
- **Limites restantes:** proteção permanente do piso D0–D2, cotação final das OTAs, definição das janelas concretas dos testes 1,5× e execução nas próximas rotinas autorizadas e fatores de eventos de Búzios ainda não aprovados. Resultados de ações específicas não comprovam implantação dessas proteções no motor SCL.
