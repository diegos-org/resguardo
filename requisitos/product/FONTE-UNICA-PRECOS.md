# Fonte única de preços (M3.11)

**Situação:** desenho do M3.11a escrito em 22/10/2026, na branch `claude/m3-11a-copia-importacao-precos`. O M3.11b ("só
disponibilidade") e o M3.11c ("pronto para ligar") ganham as seções deles quando forem feitos; o M3.11b está em
implementação desde 26/10 na branch `claude/m3-11b-so-disponibilidade`, só local: desenho em
`requisitos/product/SO-DISPONIBILIDADE.md` (commit c0437ee); o código entra em commits na mesma branch conforme a
implementação e a revisão adversarial avançam (a fonte "só disponibilidade" no motor, no envio, no site e no portal; a
reserva direta confirmada no SCL, com a migração 0076 e o aviso na ficha); o PR abre quando as checagens passarem; nada
na `main`. Decisão de Diego e condição dele: `ROADMAP.md`, "Decisões registradas", 22/10. O M3.11a está na `main`
desde 22/10 (PR #164). Leitura de 26/10 e prioridade máxima de Diego: §7.

## 1. Objetivo

O SCL vira o lugar onde se mudam preço, mínimo de noites e regras de venda; o Beds24 só repassa às OTAs. Antes de o
SCL mandar qualquer preço, os preços de hoje entram no SCL **sem mudar nada nas OTAs**. Diego troca aos poucos, criando
eventos, feriadões e períodos, e a simulação mostra o efeito antes de ligar.

## 2. O que existe hoje (produção, 22/10, só contagens)

- Seis imóveis, 270 noites lidas do Beds24 cada (de 7/10/2026 a 3/7/2027). A última leitura é de 7/10; nenhuma
  noite sem preço, nenhum `override`. O preço mais comum cobre só cerca de 30% das noites:
  - junho e julho têm um preço só (a baixa);
  - dezembro a fevereiro, quase fixo (a alta, de 1,6 a 2,3 vezes a baixa, conforme o imóvel);
  - março a maio e outubro a novembro mudam quase toda noite (15 a 22 valores por mês), com sexta e sábado mais caros.
- Mínimos: 1, 2, 3 e 5 noites. Máximo: um valor só por imóvel.
- No SCL, nada configurado: sem `imoveis_detalhes` (sem preço base, pisos ou fonte), sem períodos, sem
  `calendario_regras` (sem eventos, feriados ou lista de envio).
- **Limites do motor (M3.7):**
  - um evento só sobe o preço (multiplicador de 100 a 1000 centésimos) e o arredondamento raramente bate com um preço
    digitado;
  - não há preço por dia da semana;
  - o período fixo vence tudo, inclusive eventos criados depois;
  - o máximo de noites é um só por imóvel.

  Copiar cada trecho como período daria de 110 a 150 períodos por imóvel e travaria as regras futuras.

## 3. Desenho do M3.11a

### 3.1 Cópia datada da leitura

- Tabela nova `beds24_calendario_copias`, só de inclusão (nenhum caminho do código altera ou apaga):
  - colunas: organização, imóvel, quarto, motivo, quem (ou o sistema), quando, a hora da leitura mais nova copiada, o
    número de noites, a assinatura e as noites (JSON: data, preço, mínimo, máximo, unidades livres, bloqueio);
  - motivos: `manual`, `antes_da_leitura`, `antes_da_simulacao`, `antes_do_envio`, `importacao`.
- **A assinatura** é um SHA-256 das noites normalizadas e do quarto. Se for igual à da última cópia do imóvel, nenhuma
  cópia nova é gravada (devolve a última).
- **Quando:**
  - antes de a importação do Beds24 (M3.3) apagar a leitura anterior de cada imóvel;
  - antes de a simulação ou o envio (M3.7) regravarem a leitura (as duas fases do envio);
  - ao aprovar uma importação (§3.5), com a leitura usada;
  - pelo botão "Guardar uma cópia agora".

  Sempre na mesma transação que regrava, com o imóvel sem noites lidas pulando a cópia.
- Dado de preço não é dado pessoal; mesmo assim, nada de hóspede entra na cópia.

### 3.2 Preço importado por noite

- Tabela nova `precos_importados`:
  - colunas: organização, imóvel, data, preço (centavos, maior que zero), mínimo de noites (ou nulo), a cópia de
    origem, quando e quem;
  - chave: organização, imóvel e data.
- **Vale só com a fonte "preços automáticos do SCL"** (M3.9). Com "digitados no cadastro" ou "definidos no Beds24",
  o motor ignora a camada, e a tela avisa.
- **Preço da noite**, nesta ordem:
  1. período com preço;
  2. maior multiplicador de evento ou feriadão × preço base;
  3. **preço importado**;
  4. preço base (com os limites do preço dinâmico).

  Importado não sofre os limites do preço dinâmico, como o período. A última hora e os pisos valem por cima dele,
  como valem por cima do preço base.
- **Mínimo da entrada:**
  - período com mínimo vence;
  - senão, o maior entre o mínimo importado (no lugar da "semana normal"), o mínimo do cadastro e os dos eventos ou
    feriadões;
  - as sobras e a regra de 6/10 continuam iguais.
- **Fonte no plano:** "importado". Motivo: "Preço importado do Beds24 em {data}". No mínimo: "Mínimo importado do
  Beds24".
- **Resultado:** o que Diego criar no SCL passa por cima do preço importado naquelas noites, e o resto fica igual ao
  Beds24.

### 3.3 Proposta (função pura)

- **Entra:**
  - as noites lidas do imóvel, de hoje ao fim da leitura, só do quarto vinculado agora;
  - o cadastro atual;
  - as regras do calendário;
  - hoje.
- **Sai:**
  - **preço base proposto:** o preço que mais aparece entre os 25% de noites mais baratas (empate: o menor). Vale onde
    não houver preço importado, e é a base dos eventos;
  - **estadia máxima proposta:** a que mais aparece, com aviso se houver mais de uma;
  - **as noites a importar:** toda noite com preço, com o preço e o mínimo do Beds24. Noite sem preço não entra e vira
    aviso: "Sem preço no Beds24: o SCL usaria o preço base";
  - **sugestões de temporada, só texto, nada é criado sozinho:**
    - quando: trecho de 14 noites ou mais com o mesmo preço acima da base, em que um multiplicador inteiro de
      centésimos reproduz o preço exato;
    - texto: "De {início} a {fim}, o preço é {m}× a base: dá para criar um evento depois, em Configurações → Calendário
      e preços";
  - **resumo por mês:** noites, menor e maior preço e mínimos;
  - **a assinatura da leitura usada** (a mesma da §3.1).

### 3.4 Tela de revisão

- **Rota:** Configurações → Calendário e preços → "Importar preços do Beds24"
  (`/painel/configuracoes/calendario/importar`). Só com `configuracao:editar`.
- **Lista,** por imóvel:
  - código;
  - fonte de preços;
  - última leitura ("há N horas");
  - o que já foi importado ("N noites, de {d} a {d}, em {d} por {quem}", ou "Nada importado");
  - última cópia;
  - o link "Revisar".
- **Revisão** (`/painel/configuracoes/calendario/importar/[id]`), em textos curtos:
  - **Topo:** fonte, leitura e quarto, mais os avisos de bloqueio:
    - fonte diferente de SCL;
    - sem vínculo;
    - leitura vencida (pela validade de Configurações → Calendário e preços, "site", em horas): "A leitura do Beds24 tem
      mais de {n} horas. Leia de novo em Configurações → Integrações → Importar agora, e volte aqui.";
  - **Proposta:**
    - o preço base (proposto e atual, com a caixa "Usar como preço base", marcada se não houver um);
    - a estadia máxima (a mesma ideia);
    - as noites a importar;
    - as sugestões;
  - **Conferência:**
    - "Depois de aprovar, o SCL calcularia igual ao Beds24 em {x} de {y} noites." É o motor de verdade, com o
      cadastro proposto, a camada nova e as regras, pisos, reservas e bloqueios de hoje, comparado com a leitura;
    - em cada diferença, o motivo do plano (piso de última hora, período ou evento que vale por cima, mínimo de sobra);
  - **Por mês:** num `<details>`, noite a noite: data, preço no Beds24, preço do SCL, mínimo no Beds24, mínimo do SCL
    e diferença;
  - **Ações:**
    - "Aprovar e importar" (`BotaoConfirmar`);
    - "Guardar uma cópia agora";
    - depois de importar: "Desfazer a importação" (`BotaoConfirmar`).
- A tela de configuração do calendário ganha o link. Na ficha do imóvel (Preço e taxas) entra uma linha: "Preços
  importados do Beds24: {n} noites, até {d}. Eventos, feriadões e períodos valem por cima." com o link.
- A prévia do calendário (M3.7a) mostra o motivo novo sem mudança de tela.

### 3.5 Aprovar

Ação no servidor, negada por padrão.

1. **Permissões:** sessão do painel, `configuracao:editar` e `imovel:editar`, o imóvel da organização.
2. **Fonte:** precisa ser `scl`. Recusa: "A importação vale para preços automáticos do SCL. Mude a fonte na ficha do
   imóvel."
3. **Travas:** `esperarEnvioBeds24` (a trava `beds24:<org>`, na ordem única do M8.3), depois o imóvel travado.
4. **Releitura:** relê as noites e a hora da leitura com o imóvel travado.
   - Leitura vencida: recusa.
   - Assinatura diferente da revisada: "A leitura mudou desde que você abriu a revisão. Confira de novo."
5. **Cópia:** motivo `importacao`.
6. **Cadastro:** grava o preço base e a estadia máxima marcados. Cria `imoveis_detalhes` se não houver, pelo caminho
   do cadastro, com a auditoria dele.
7. **Camada:** apaga do imóvel só os importados de hoje em diante e grava as noites novas de hoje em diante. Os de
   antes de hoje ficam: a mudança vale daquela data para frente.
8. **Auditoria:**
   - ação `imovel.precos.importar`;
   - mudanças "preços importados do Beds24" (antes e depois, em número de noites e intervalo) e a cópia;
   - sem dado pessoal.

Repetir a aprovação com a mesma leitura dá o mesmo resultado.

### 3.6 Desfazer

Mesmas permissões e travas. Apaga os importados de hoje em diante, mantém as cópias e audita
`imovel.precos.desfazer_importacao`. O imóvel volta ao preço base e às regras.

### 3.7 Onde o preço importado aparece

O motor tem um caminho só (`planejarImovel`). Por ele, a camada vale para a prévia, a simulação e o envio do M3.7, e
para o site e a cotação (M7.2, M8.1). Nada que o hóspede lê cita o Beds24; o texto de motivo só aparece no painel.

## 4. Registro de desvios em relação ao ROADMAP de 22/10

- **Temporadas e eventos:**
  - **antes:** o M3.11a dizia "preço base, temporadas e eventos tirados dos trechos que fogem do preço base, e período
    fixo onde nada se encaixa";
  - **agora:** a camada "preço importado" e o preço base proposto; temporadas e eventos só como sugestão, nada é
    criado sozinho;
  - **motivo:** os limites do motor (§2). O período vence os eventos futuros, e seriam até 150 por imóvel. Evento não
    desconta e arredonda;
  - **objetivo:** cumprir a condição de Diego, nada mudar nas OTAs ao ligar, e deixar as regras dele valerem por cima,
    aos poucos.

### Ajustes da implementação (22/10), em relação às §3.1 a §3.6

- **Cópia por quarto:** a comparação é com a última cópia do mesmo imóvel e quarto. Imóvel com leitura de dois quartos
  guarda uma cópia de cada.
- **Tabelas:**
  - a coluna `ordem` (sequência) decide qual é a última cópia, mesmo com a mesma hora;
  - o quarto pode ficar vazio;
  - todo preço importado aponta para a cópia de onde veio;
  - o banco recusa cópia sem noites.
- **Leitura vencida:** basta uma noite usada ter sido lida fora da validade, não só a mais nova.
- **Proposta, casos de borda (sempre com aviso):**
  - preço zero não entra;
  - mínimo fora de 1 a 365 entra sem o mínimo, e vale o do SCL;
  - máximo fora de 1 a 365 fica fora da proposta;
  - empate na estadia máxima fica com a menor;
  - máximo proposto menor que o mínimo do cadastro;
  - noite sem preço não traz o mínimo.
- **Conferência:**
  - compara preço, mínimo e máximo, com o motivo da linha do plano;
  - sem conferência quando a fonte não é SCL;
  - as caixas "Usar como…" vêm marcadas quando o cadastro não tem o valor.
- **Entrada da proposta:** o cadastro (o mínimo entra só para o aviso) e, das regras, só a estadia máxima de hoje.
- **Aprovar:**
  - a revisão e a aprovação leem pela mesma função, e a aprovação relê com o imóvel travado;
  - o cadastro é gravado antes da cópia e da camada, na mesma transação: a recusa da validação volta antes de qualquer
    gravação;
  - leitura sem nenhuma noite com preço: recusa ("nada a importar"), em vez de apagar a camada;
  - repetir com a camada igual não regrava nem audita: a data "importado em" fica a da primeira aprovação.
  - leitura parcial (revisão do Codex, 22/10): a importação do M3.3 grava a resposta parcial do Beds24 e só avisa.
    Por isso, a revisão e a aprovação recusam quando falta noite de hoje ao fim da leitura, ou quando a leitura não traz
    noites já importadas. Senão, aprovar apagaria esses preços. Período mais curto de propósito: desfazer antes.
- **Guardar uma cópia agora:** pega a trava da importação sem esperar, como ela; ocupada, recusa e pede para tentar de novo.
- **Telas:**
  - a lista mostra só os imóveis ativos;
  - na ficha, com fonte diferente de SCL, a linha diz que os importados só valem com preços automáticos do SCL;
  - o histórico do imóvel mostra as noites e o intervalo da importação (as outras importações escondem o registro).

## 5. Testes do M3.11a

Com PGlite e a versão falsa do Beds24, sem rede.

1. **Motor:**
   - o período vence o importado;
   - evento e feriadão vencem o importado;
   - o importado vence a base;
   - noite sem importado usa a base;
   - o importado não sofre os limites do preço dinâmico;
   - última hora e pisos por cima do importado (as duas formas, "beds24" e "scl").
2. **Motor, mínimo:**
   - o importado substitui a semana normal;
   - o cadastro e os eventos maiores vencem;
   - o período com mínimo vence;
   - sobras e regra de 6/10 iguais.
3. **Motor, fontes:** com "manual" e "beds24", a camada é ignorada.
4. **`planejarImovel`:**
   - carrega a camada do intervalo;
   - a substituição da revisão não grava nada;
   - o site cota com o importado.
5. **Proposta:**
   - preço base pelo quartil (empate no menor);
   - máximo mais comum, com aviso;
   - noite sem preço;
   - só o quarto vinculado;
   - noites antes de hoje fora;
   - sugestões só quando o multiplicador reproduz exato e o trecho tem 14 noites ou mais;
   - assinatura estável e sensível a cada campo.
6. **Cópias:**
   - deduplicação;
   - a importação do M3.3 guarda a leitura anterior antes de apagar;
   - simulação e envio guardam antes de regravar;
   - nenhuma rota altera ou apaga cópia;
   - imóvel sem noites não gera cópia.
7. **Aprovar:**
   - operação recusada;
   - sem `imovel:editar`, recusada;
   - outra organização recusada;
   - fonte diferente de SCL recusada;
   - leitura vencida recusada;
   - assinatura diferente recusada;
   - grava a cópia, o cadastro marcado, a camada de hoje em diante e a auditoria;
   - os de antes de hoje ficam;
   - repetir dá o mesmo;
   - envio em curso: espera ou recusa como a troca da fonte.
8. **Desfazer:** só de hoje em diante, cópias mantidas, auditado; com outra organização recusado.
9. **Conferência na tela:** igual ao Beds24 depois de aprovar, numa leitura sem pisos; a diferença por piso aparece com
   o motivo.
10. **Telas:**
    - lista e revisão para o admin;
    - operação sem acesso;
    - os avisos de bloqueio;
    - a linha na ficha;
    - a prévia mostra o motivo.
11. **Privacidade:** as tabelas novas na varredura de dados pessoais.

## 6. Limites e o que fica para depois

- **Importar de uma cópia antiga:** fica para depois. A cópia guarda; a importação usa a leitura atual.
- **Fonte "digitados no cadastro":** sem camada. Fica para quando o marketplace pedir.
- **Disponibilidade:** a conferência das noites fechadas é o M3.11c; a reserva direta com o aviso "feche as datas" é o
  M3.11b.
- **Máximo de noites:** continua um só por imóvel.
- **Tamanho das cópias:**
  - a leitura muda todo dia, porque a janela anda;
  - por isso, sai perto de uma cópia por imóvel a cada leitura, simulação ou envio, com uns 25 KB cada;
  - se crescer demais, decidir com Diego quanto tempo guardar.
- **Na produção:** a leitura de 7/10 está vencida. Antes de revisar, Diego toca em "Importar agora" em Integrações, que
  só lê o Beds24.

## 7. Leitura de 26/10/2026 e prioridade

**Prioridade máxima (Diego, 26/10):** "acrescentar como bastante urgente agora então: resolver 100% de vez todo o mapeamento
Castanha-Beds24-demais canais e syncs de preços e calendários; e focar bem forte no motor próprio de preços, pesquisa,
ajustes constantes, pq agora é responsabilidade nossa". Ordem de 26/10, de manhã: (1) mapeamento e sincronização
conferidos (M3.12); (2) motor próprio (M3.11b, M3.11c e M3.13; o M3.14 entrou à tarde); (3) a marca com o domínio (M7.25, M11.2); (4) o
WhatsApp (M10.2, M10.3). **Mudada na noite de 26/10** (Diego aceitou a proposta do Claude; registro em "Decisões
registradas" do `ROADMAP.md`): o PR do plano e o M3.11b (em curso), M3.11c, M10.1b (a chave permanente na Vercel, a
situação do número e a inscrição da conta), M10.2 com o alerta por e-mail a cada mensagem nova, M3.14, M3.12, M3.13,
marca e domínio; o M10.2 puxa também o M10.1b e os passos de Diego nele. Motivo: o número final 0021 saiu do
celular e fica mudo para o hóspede até o M10.2. O M3.11b não espera o M3.12: o modo "só disponibilidade" é parte do
mapeamento da direção do fluxo, e o M3.12 corre em paralelo, dependendo só do M3.11a.

**Contexto:** o Antigravity (ferramenta externa usada por Diego) trabalhou de 23 a 26/10 corrigindo preços e calendários no
Beds24 e nos canais; Diego confirma que terminou; o resumo técnico ainda vai chegar (Diego procura; só o resumo técnico, nunca a conversa inteira, que continha chaves). Durante
esse trabalho o SCL ficou só em leitura nessa área (coordenação de 24/10).

**Conferência de 26/10** (Claude, no Neon de produção, só leitura, só contagens; nenhum dado pessoal):
- Diego tocou em "Importar agora" na noite de 25 para 26/10. O M3.11a guardou a cópia da leitura de 7/10 dos seis imóveis
  antes de reler, como desenhado em §3.1.
- Leitura nova: de 26/10/2026 a 21/07/2027, 269 noites por imóvel, seis imóveis, um quarto cada, todos lidos.
- Comparação com 7/10, nas 251 noites em comum por imóvel:
  - preço: só 13 noites mudaram, todas para cima, de 3% a 5%, quase todas entre 26 e 31/10 ou em maio/2027 (parece ajuste
    de última hora, não correção geral); as médias por mês ficaram iguais;
  - mínimo: 1 noite mudou;
  - máximo: igual (27) em tudo;
  - disponibilidade: 26 noites mudaram (a maioria num só imóvel); movimento normal de reservas.
- Conclusão: pelo calendário do Beds24, nada grande mudou. O que o Antigravity fez deve estar nas regras de preço e na
  ligação dos canais dentro do Beds24, ou direto no Airbnb e no Booking, que o SCL não lê.
- Os seis imóveis não têm nenhum cadastro de preço no SCL (sem `imoveis_detalhes`: sem preço base, mínimo, máximo, pisos
  nem eventos): o motor parte do zero e a importação do M3.11a preenche o grosso.
- A importação sai "parcial" por 100 avisos de reservas sem contrato vigente no SCL ("Sem contrato vigente em {data}",
  do motor financeiro). Conferido em 26/10, só contagens: nenhum dos seis imóveis (102, 103, 303, 399, 403 e bzs) tem
  contrato cadastrado; 97 reservas ficam sem cálculo financeiro, 52 delas futuras; os outros 3 avisos são de reservas
  canceladas ou já iniciadas. Quatro imóveis (102, 303, 399 e bzs) não têm proprietário vinculado (103 e 403 têm):
  o contrato não precisa dele, mas repasses e portal travam depois. É cadastro de contratos, não calendário: decisão de
  Diego na noite de 26/10 (início 01/10/2026 e gestão completa para os seis; % a confirmar), em "Ações de Diego",
  item 21, do `ROADMAP.md`; o Claude cadastra quando a % for confirmada. Tipo, % e início decidem o que é de cada um.

**Itens novos no `ROADMAP.md`:**
- **M3.12, mapeamento e sincronização conferidos:** por imóvel, o quarto do Beds24 (o SCL já sabe) e, registrados à mão por
  Diego no painel, os anúncios do Airbnb e do Booking ligados a ele, com "conferido em (data) por (quem)" e o que conferir
  em cada canal (preço, mínimo, noites fechadas); o SCL mostra o lado do Beds24 pela leitura e avisa o que falta; o lado
  dos canais fica registrado à mão até existir leitura deles. Depende só do M3.11a; o resumo do Antigravity entra como
  registro quando chegar, sem travar o item. Corre em paralelo ao M3.11b.
- **M3.13, pesquisa de mercado e ajuste constante:** sinais dos próprios dados (ocupação, ritmo de vendas, antecedência,
  dia da semana, eventos) e uma referência de mercado; sugestões semanais numa tela que Diego aprova (no começo nada muda
  sozinho), com registro de quem, quando e por quê. Copiar preços de anúncios do Airbnb automaticamente vai contra as
  regras deles: a fonte da referência de mercado é decisão de Diego, com quatro opções: (1) amostragem manual de alguns anúncios
  concorrentes pela equipe; (2) dados pagos de mercado, como AirDNA e similares; (3) a API oficial do Booking, se houver
  acesso; (4) a ferramenta de precificação ligada ao Beds24 só como fonte de dados. "Feito" (26/10): a primeira versão da página de comparação com apartamentos
  semelhantes (cadastro manual de 5 a 10 anúncios comparáveis com os preços que Diego vê; as métricas próprias do M5.8:
  ocupação, diária média, receita por noite disponível; posição relativa) e o registro dos ajustes feitos (quem, quando,
  por quê). A referência automática entra quando Diego decidir a fonte. Depende do M3.11c.
- **M3.14, página do motor de preços e importação de eventos (26/10):** Diego quer o motor "direitinho", com um
  calendário de eventos (hoje só do Rio, feito com o ChatGPT) em que cada evento diz se impacta o preço e com que
  multiplicador. Fato: o calendário de eventos já existe desde o M3.7 (Configurações → Calendário e preços, bloco
  "Temporadas e eventos": nome, início, fim, multiplicador de 1,0× a 10×, em que 1,0 não mexe no preço e só vale a estadia mínima;
  estadia mínima; "mínimo normal com reserva"; todos os imóveis ou só alguns; limite de 100 eventos e 200 feriados (datas; o feriadão é a
  janela em volta de cada um); o motor aplica o maior multiplicador entre evento e feriadão sobre o preço base, sem somar, só na fonte "scl"). O item:
  uma página só que mostra, por imóvel, como cada noite é formada (base, período, evento, feriadão, última hora, pisos,
  preço importado, fonte) e o calendário de eventos com importação por colagem (Diego cola a lista: nome, início, fim,
  multiplicador sugerido, todos os imóveis ou quais; revisa linha a linha antes de gravar), observação e origem por
  evento e o campo "cidade" (Rio hoje; outras depois). Nada escreve no Beds24 fora do envio já existente. Depende do
  M3.11a.
