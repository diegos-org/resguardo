# Calendário, preços e duração — regras operacionais

Consolidação solicitada por Diego em 1/10/2026. Origem: decisões diretas de 15, 18 e 19/9 registradas no protocolo local de calendário, comparadas com ROADMAP, CLAUDE.md, decisões operacionais e código atual da main `73f14d89f7fd616ada889ca175730ab42dba28b0`. Somente regras; reservas, contatos e resultados financeiros individuais ficam fora do Git.

## Fonte e estado de implantação

- Prevalece a direção de 24/9: **SCL como fonte oficial**, enviando calendário/preços ao Beds24 e às OTAs pelo M3.7, após implementação, teste em imóvel escolhido e ativação expressa por Diego. Essa é a direção do sistema; em 1/10 Diego pediu expressamente esta rodada diretamente pelo Beds24 enquanto o painel não efetua escrita.
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

Feriados nacionais e estaduais do RJ, Corpus Christi e a exceção expressa de 9 de julho/SP para ambos os destinos. Excluir feriados municipais. Outros feriados de origem dos hóspedes dependem de aprovação. Confirmar datas anuais e abrangência em fonte confiável.

| Dia do feriado | Janela inclusiva | Mínimo |
|---|---|---:|
| Quinta | Quarta anterior a domingo | 3 |
| Sexta | Quinta anterior a domingo | 3 |
| Segunda | Sexta anterior a segunda | 3 |
| Terça | Sexta anterior a terça | 3 |

Quarta, sábado ou domingo não ativam uma janela extra. Se dois feriados prolongarem o mesmo intervalo (quinta/sexta seguido de segunda/terça), unir as janelas sem interrupção. Preço de teste no Leblon: 2×B.

## Temporada e eventos

- Alta temporada: 15/12 ao último dia de fevereiro, estendendo até Quarta-feira de Cinzas quando ela cair em março. Preço Leblon 2×B. Não estender ao fim de semana seguinte por inferência.
- Réveillon: 25/12–1/1 inclusivos, mínimo 5 noites, Leblon 4×B. Depois de reserva de cinco noites que ocupe o período principal, rever sobras; datas livres de 25–27/12 voltam ao mínimo semanal. Reprecificação dessas sobras não foi definida: não baixar preço automaticamente.
- Carnaval: segunda-feira da semana anterior à terça-feira de Carnaval até Cinzas, inclusivos; é a segunda três dias antes da quinta que inicia o período principal. Mínimo 5, Leblon 4×B. Confirmar datas anuais. Rever sobras após reserva.
- Rock in Rio: Leblon 3×B; sem novo mínimo de noites. Búzios excluído. Confirmar edição, dias efetivos e noites abrangidas; não importar datas de outro ano.
- Multiplicadores não acumulam: usar o maior aplicável. Carnaval dentro da alta = 4×B, nunca 8×B.
- Nas datas especiais, preço fixo manual substitui o Preço Inteligente naquela noite. Não desligar o recurso global nem elevar seu teto global por consequência.

## Base, preços existentes e pisos

B é a referência geral confirmada do anúncio antes do acréscimo, não a diária já multiplicada. Em 15/9 havia B=450 nos quatro estúdios e B=800 no 303, mas **isso é referência histórica, não confirmação da configuração atual**. Conferir base e intervenções posteriores antes de aplicar.

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

Regra aprovada para todos os seis imóveis e para eventos: em cada data de entrada, mínimo ajustado = menor entre mínimo aplicável e noites consecutivas livres até a próxima reserva/bloqueio válido. Exemplo: sobram três noites num período com mínimo cinco → mínimos 3, 2, 1 nas respectivas entradas. Não liberar todo o período com uma noite indistintamente.

Sábado livre após checkout com sexta ocupada pode ter mínimo 1, conferindo exceções especiais. Aplicar também a sobras de hoje, mantendo avaliação manual e limpeza. A redução do mínimo não autoriza desconto ou desbloqueio.

## Búzios — regra própria

Piloto antigo de 2×/4× sobre 450 não autoriza novas replicações. Em 18/9, Diego orientou preservar os limites gerais então registrados (450/2.500), com revisão própria. Referência relatada de cerca de 3.000/noite para Réveillon anterior e Carnaval desejado não é tarifa aprovada para novas datas.

Próximos 30 dias: registrar noites reservadas, livres e impedimentos de duração/antecedência. Antes de reduzir, resolver a incidência adicional de 15% para hóspedes com avaliações excelentes observada em setembro. Pisos históricos do teste eram 350/300; aplicar só após conferir as condições específicas e decisões posteriores. Alta temporada/feriadões continuam exigindo definição própria dos valores. Não prometer melhora de ranking por reduzir preço.

## Registro e verificação de cada rodada

1. Conferir fonte em vigor, autorização, anúncio atual e reservas/bloqueios.
2. Registrar intervalo, preço e mínimo anteriores, base original e regra usada.
3. Aplicar apenas noites disponíveis e mudanças autorizadas, sem alterar reservas confirmadas.
4. Salvar; reabrir/recarregar e conferir anúncio, datas e valores. Distinguir envio do salvamento e resultado confirmado.
5. Registrar cobertura de preços, mínimos e horizonte separadamente; registrar lacunas e próximo passo.
6. Manter log privado por data/anúncio para não duplicar reduções. No repositório somente metodologia e exemplos fictícios.

## Compatibilidade com o sistema atual e pendências

O arquivo `app/src/imoveis/regras-venda.ts`, conferido na main citada, aceita períodos explícitos, aplica o primeiro período correspondente e limita o valor ao mínimo/máximo com preço dinâmico ligado. Ainda não é um motor das regras acima: não calcula o maior multiplicador, os descontos de última hora com referência persistida, a semana normal por dia ou as sobras por disponibilidade. Essa diferença precisa ser tratada no desenvolvimento de M3.7 antes de usá-lo como automatismo; esta consolidação **não altera código nem libera escrita**.

Pendentes: tarifas próprias de eventos de Búzios; combinação de descontos adicionais; tratamento de última hora em grandes eventos; reprecificação de sobras de Réveillon/Carnaval; validação de mercado e definição de piso líquido. Nenhuma dessas lacunas deve ser preenchida por palpite.

O documento `requisitos/product/MARKETPLACE-PRECIFICACAO.md` trata de propostas para venda direta e divisão de receita. Foi preservado: não substitui estas regras de diárias e não constitui aprovação de novos percentuais.

## Tradução para a conexão Beds24 vigente

Segundo a documentação oficial consultada em1/10, o modo Limited inclui preços, disponibilidade e mínimos, além de configurações de preços. O nome não significa ausência de envio. Airbnb aplica o mínimo à data de entrada. Preço Inteligente não está disponível para anúncios conectados por API: preservar as regras históricas como origem, mas não presumir esse motor ativo na configuração atual. Conferir tarifas diárias, descontos e base de cada anúncio antes de traduzir regras. Referência: https://wiki.beds24.com/index.php/Airbnb_Mapping.
