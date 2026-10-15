# Identidade visual do SCL 2.0 — especificação (M7.5)

**Situação:** implementado em `app/` em 4/10/2026 (M7.5): tokens em `app/src/app/globals.css`
(`--scl-*`, com a textura de papel e as cores semânticas), site público em
`app/src/components/site/site.module.css`, portais em `app/src/components/portal/portal.module.css`
(moldura `MolduraPortal`), painel em `app/src/components/painel/painel.module.css` e
`app/src/components/formularios.module.css`; calendário e anúncios pelos mesmos tokens. Desvios
registrados ao implementar: (1) no painel os campos continuam com caixa (borda fina), não só
linha inferior — formulários densos ficam mais legíveis assim; (2) o olho dos cartões sálvia e o
"Conheça a casa" usam branco em vez de `--scl-dourado-claro` (4,3:1 sobre sálvia, abaixo do
mínimo em texto pequeno); (3) `--scl-aviso` ficou `#7d6118` (o `#8a6d1c` dava 4,46:1 sobre o
papel); (4) a foto da capa e as fotos dos imóveis esperam o M7.3: a capa é um gradiente sobre
`--scl-profundo` e os cartões mostram um quadro "foto em breve"; (5) o PDF do relatório mantém
a paleta anterior; (6) **14/10/2026 (M7.11), contorno do foco sobre os verdes** — antes: o mesmo
`--scl-foco` laranja (`#b66630`) em toda parte, deslocado 3px; agora: deslocado 5px, como esta
especificação pede, e creme (`--scl-foco-sobre-verde`) dentro das áreas verdes (cabeçalho, capa, faixa
das casas, fechamento e rodapé do site, dia escolhido do calendário de datas, menu do painel, topo e
rodapé dos portais), que trocam a variável `--scl-foco-cor` no mesmo seletor do fundo; motivo: o
laranja dava 1,69:1 sobre floresta, 2,29:1 sobre profundo, 1,27:1 sobre sálvia e 1,41:1 sobre musgo,
abaixo dos 3:1 dos indicadores, e o creme dá 6,2 / 8,43 / 4,68 / 5,18:1 (o `--scl-dourado-claro`, a
outra opção, dava 3,87:1 na sálvia); o laranja continua nos fundos claros (3,68:1 no creme, 3,88:1 no
papel, 3,13:1 na areia), inclusive numa área clara dentro de uma verde (o cartão papel de "nenhuma casa
publicada", na faixa das casas), que devolve `--scl-foco-cor` ao laranja no próprio seletor (o creme
herdado daria 1,05:1 no papel); no dia do calendário de datas, o contorno de 2px fica inteiro por dentro
(deslocado -2px) e com a opacidade cheia, sobre o fundo do próprio dia (no dia escolhido, creme sobre o
musgo, 5,18:1), porque os dias ficam colados e, meio por fora, ele caía sobre o vizinho ou o papel; nas
rolagens com coisa focável (carrossel das casas, miniaturas da galeria, menu do painel no celular), folga
de 8px e `scroll-padding` para o contorno não ser cortado; o que flutua sobre fundos claros e verdes (botão do WhatsApp, "Pular para o
conteúdo") ganha um halo creme (`--scl-foco-halo`) sob o contorno laranja; objetivo: o foco do teclado
visível em qualquer fundo do site, dos portais e do painel; (7) **14/10/2026 (M7.11), miniatura
escolhida da galeria** — antes: contorno de 2px em `--scl-dourado` (1,93:1 sobre o creme, 2,04:1 sobre o
papel); agora: anel de 3px em `--scl-dourado-escuro` por dentro da borda (5,64:1 / 5,94:1), com o
contorno do foco por fora, a 5px, sem os dois se sobreporem; motivo e objetivo: a foto escolhida
reconhecível sem depender da cor fraca, e o foco distinto da escolha; (8) **14/10/2026 (M7.12), faixa da
prévia** — antes (estudo, `.preview`): "Prévia privada · Reservas e pagamentos ainda não estão habilitados", fundo `#e3d9c3`
e texto `#404537`, fora dos tokens; agora: `.scl-previa` em `globals.css`, `--scl-areia` com texto `--scl-tinta`
(10,66:1), 11px (10px até 600px), 8px × 16px, centralizada, no topo de toda página (layout raiz: site, páginas do
hóspede, portais, painel e telas de erro), só fora do deploy de produção (`app/src/sistema/ambiente.ts`), com o texto
"Prévia de teste · não é o site de verdade · nenhuma cobrança real"; motivo: o texto do estudo deixou de ser verdade (o
pagamento de teste está ligado nas prévias) e as cores dele não eram tokens; objetivo: quem testa não confundir a prévia
com o site de verdade, dizendo só o que o código garante.
Aprovado por Diego em 4/10/2026: adotar o visual do estudo do "Sage" (site público,
`prototipos/acervo-visual-2026-10` e `prototipos/scl-publico`) como design geral do projeto —
site, portal do hóspede, portal do proprietário e painel —, com os ajustes abaixo. O painel usa a
mesma paleta e os mesmos padrões, só mais denso. Este documento é a fonte dos tokens; o código
lê daqui (uma regra, um lugar): os tokens viram variáveis CSS num único arquivo em `app/` e o
resto usa as variáveis, nunca cores soltas.

## Tokens de cor

Extraídos do `styles.css` do estudo (versão "v0.6: matte sage, warm paper") e ajustados pelas
decisões de 4/10.

| Token | Uso | Valor do estudo | Valor adotado | Observação |
|---|---|---|---|---|
| `--scl-floresta` | cabeçalho, seções escuras, botões primários do site | `#505b46` | `#505b46` | "os verdes estão perfeitos" |
| `--scl-profundo` | rodapé, capa (fundo da foto) | `#3d4736` | `#3d4736` | |
| `--scl-musgo` | botões, fechamento, acentos | `#58684d` | `#58684d` | hover `#35432f` |
| `--scl-salvia` | cartões sobre fundo escuro | `#626e55` | `#626e55` | |
| `--scl-creme` | fundo geral das páginas | `#e8ddc9` | **`#f3eee3`** | "bege um pouco mais branco": off-white de papel |
| `--scl-papel` | cartões, formulários, blocos de texto | `#f0e7d7` | **`#f8f4ea`** | sobe junto com o creme, mantendo contraste |
| `--scl-areia` | seção "por que reservar direto" e faixas de apoio | `#e1d3bb` | `#e6dcc8` | um tom abaixo do creme novo |
| `--scl-dourado` | só decoração: itálico do logotipo (≥ 24px, sobre floresta/profundo), filetes, ícones sem significado | `#c9a96e` | `#c9a96e` | contraste 3,2:1 sobre floresta e 2,0:1 sobre papel: **nunca em texto pequeno, nunca em texto sobre fundos claros** |
| `--scl-dourado-claro` | texto dourado pequeno sobre os verdes ("olhos", rótulos, destaques) | `#ecd8b0` (itálico da capa) | `#ecd8b0` | 5,1:1 sobre floresta, 7,0:1 sobre profundo; sobre musgo (4,3:1) só em texto grande |
| `--scl-dourado-escuro` | texto dourado pequeno sobre creme, papel e areia | — | **`#75592a`** | 5,9:1 sobre papel, 5,6:1 sobre creme, 4,8:1 sobre areia |
| `--scl-tinta` | texto principal | `#252b23` | `#252b23` | |
| `--scl-texto-2` | texto secundário | `#5b604f` | `#5b604f` | contraste ≥ 4,5:1 sobre o papel |
| `--scl-borda` | bordas de cartões e campos | `#cfc1a9` | `#cfc1a9` | |
| `--scl-foco` | contorno de foco do teclado | `#b66630` | `#b66630` | 3px, deslocado 5px; sobre os fundos claros (nos verdes, o token abaixo: desvio 6, 14/10) |
| `--scl-foco-sobre-verde` | contorno de foco dentro das áreas verdes | — | **`--scl-creme`** | 6,2:1 floresta, 8,43:1 profundo, 4,68:1 sálvia, 5,18:1 musgo (M7.11) |

Contraste: todo texto sobre `--scl-creme`/`--scl-papel` usa `--scl-tinta` ou `--scl-texto-2`;
sobre os verdes, `--scl-creme` ou branco. O dourado do estudo (`#c9a96e`) não alcança 4,5:1 em
fundo nenhum da paleta, por isso fica restrito à decoração e ao logotipo grande: texto dourado
pequeno usa `--scl-dourado-claro` sobre os verdes e `--scl-dourado-escuro` sobre os fundos
claros (os "olhos" dourados da seção de casas do estudo, a 10px sobre floresta, passam para
`--scl-dourado-claro`). Conferir com ferramenta de contraste antes de fechar o PR (mínimo 4,5:1
em texto normal, 3:1 em texto grande — a partir de 24px, ou 18,7px em negrito — e ícones).

## Textura de papel (decisão de 4/10)

Diego pediu "marcas de papel amassado para dar charme"; combinado: **grão sutil, nunca atrás de
texto corrido**.

- Aplicar só nos fundos de página e de seção (`--scl-creme`, `--scl-areia`, capa), como camada
  de ruído com opacidade entre 2% e 4% (filtro SVG `feTurbulence` em `data:` URI ou um PNG
  minúsculo repetido; nada externo).
- Cartões, formulários, tabelas e qualquer bloco com texto ficam em `--scl-papel` **liso**.
- Testar no celular e em tela de baixa densidade: se o grão virar "sujeira", reduzir a opacidade.
- O estudo já tem um hachurado leve no `body` (listras diagonais a ~2%); a textura nova substitui
  esse hachurado, não soma.

## Tipografia

- **Títulos (h1, h2, logotipo):** serifa `Georgia, "Times New Roman", serif`, peso 400,
  `letter-spacing: -0.04em`; h1 `clamp(2.6rem, 5.7vw, 5.5rem)`, h2 `clamp(2rem, 3.8vw, 3.5rem)`.
  Itálico para a palavra de destaque ("Um lugar *seu*", "Sua Casa *Leblon*"): `--scl-dourado-claro`
  na capa e `--scl-dourado` no logotipo (24px ou mais, sobre floresta/profundo); em título sobre
  fundo claro, `--scl-dourado-escuro`.
- **Texto:** `Arial, Helvetica, sans-serif`, 13–17px, `line-height 1.7`.
- **Rótulos de campo e "olhos" de seção:** 9–10px, maiúsculas, `letter-spacing 0.06–0.19em`, em
  `--scl-tinta`/`--scl-texto-2` sobre fundos claros e `--scl-creme`/`--scl-dourado-claro` sobre os
  verdes; nunca `--scl-dourado` nesse tamanho.
- Sem fontes externas (privacidade e velocidade): as famílias do sistema bastam. Se um dia Diego
  quiser uma serifa própria, ela entra por arquivo local, não por CDN.

## Formas e espaçamento

- Raios: 4px em botões e campos, 5–7px em cartões e formulários, 12px no diálogo do calendário,
  círculo nos botões de navegação do carrossel.
- Campos: sem caixa, só linha inferior (`1px solid #babaa9`), altura mínima 44px (toque).
- Botão primário: `--scl-musgo`, texto branco, 48px de altura, seta "↗" ao lado do rótulo.
- Seções: 80px de respiro vertical no site (42px na versão compacta do estudo), 5vw lateral,
  conteúdo até 1240px.
- Sombra única: `0 12px 32px rgba(26,29,25,.04)` em cartões flutuantes (busca).

## Componentes do site (referência: `prototipos/acervo-visual-2026-10/site-publico`)

- **Cabeçalho** verde-floresta com logotipo (ícone + "Sua Casa *Leblon*", itálico em `--scl-dourado` a 24px), "Nossas casas" e o
  botão contornado "Planeje sua estadia ↗". Faixa fina acima quando for prévia privada (implementada em 14/10/2026, M7.12,
  só fora do deploy de produção e em todas as páginas, não só no site: desvio 8).
- **Capa** com foto do Leblon, gradiente escuro à direita, "olho" pequeno em maiúsculas, título em
  duas linhas e frase curta.
- **Busca** sobreposta à base da capa (decisão de 4/10: **translúcida**): fundo
  `rgba(248,244,234,.82)` com `backdrop-filter: blur(10px)` e fallback opaco em `--scl-papel`
  quando o navegador não suportar; campos "Seu lugar", "Entrada", "Saída", "Hóspedes" e o botão
  "Consultar ↗"; frase de apoio embaixo ("Escolha suas datas. A disponibilidade será
  confirmada antes de reservar.").
- **Carrossel de casas** sobre fundo floresta: cartões sálvia com foto (proporção ~1,85),
  "olho" com o código, título em serifa, uma frase, ícones de comodidades com dica ao passar o
  mouse, rodapé com capacidade e "Conheça a casa →"; setas redondas; botão "Pausar movimento".
- **Por que reservar direto** (fundo areia): três colunas com numeração em serifa itálica.
- **Fechamento** (fundo musgo): título grande e botão claro.
- **Rodapé** profundo: logotipo, frase, bairro, privacidade, © com o ano.
- **Página do imóvel:** "← Todas as casas", olho "LEBLON · RIO DE JANEIRO · 103", título em
  serifa, "Studio · Até 2 hóspedes", botão "Planejar estadia ↗"; **galeria** com foto principal
  (3:2, contador "8 / 9") e grade de miniaturas à direita; abaixo, duas colunas: texto editorial
  ("Dias leves entre a praia e os restaurantes.") com "O que você encontra" em duas colunas, e o
  cartão **"Planeje sua estadia"** com a busca já preenchida com o imóvel; **"O bairro à sua
  porta"** com quatro lugares (foto, nome com ↗, frase, endereço); nota "Fotos e características
  em revisão para publicação" enquanto o M7.3 não liberar.
- **Consulta** e **checkout**: duas colunas, resumo em cartão papel com linhas `dl` (diárias,
  limpeza, hóspede extra, valor cheio, desconto do site, total), rádio de forma de pagamento,
  botão largo; cenários de demonstração como botões pequenos.
- **Botão flutuante do WhatsApp** redondo, musgo, canto inferior direito (no celular, fixo ao fim
  da página em vez de flutuar).
- **Celular:** carrossel com um cartão por vez, galeria em bloco com miniaturas roláveis, busca em
  uma coluna, títulos entre 1,8rem e 2,65rem.

## Portais e painel

- **Portal do hóspede e portal do proprietário:** mesma linguagem do site (cabeçalho floresta,
  fundo creme, cartões papel, serifa nos títulos), com a densidade do site.
- **Painel interno:** mesma paleta e mesmos padrões (cabeçalho e menu lateral em floresta/profundo,
  fundo creme, cartões e tabelas em papel, botões musgo, foco laranja — creme no menu verde, desvio 6), com **densidade maior**:
  grade de 4/8px, tabelas compactas (linhas de 36–40px), formulários em colunas, títulos menores
  (h1 1,5rem, h2 1,125rem), sem capa nem seções de respiro. É lugar de trabalho: mais informação
  por tela, sem perder a identidade.
- As variáveis existentes do painel (`--scl-areia`, `--scl-texto-2` etc.) são mapeadas para os
  tokens acima num único lugar; nenhuma tela recebe cor fixa.

## Ordem sugerida de implementação (M7.5)

1. Arquivo único de tokens em `app/` e mapeamento das variáveis atuais (sem mudar telas).
2. Site público: início, catálogo, página do imóvel, consulta e cotação (componentes já existem;
   muda o visual, não a regra).
3. Portal do hóspede e portal do proprietário.
4. Painel: cabeçalho, menu, cartões, tabelas e formulários pelos tokens, densidade mantida.
5. Conferência de contraste e de celular em cada etapa; capturas antes/depois no PR.

## Referências

- `prototipos/acervo-visual-2026-10/` — páginas renderizadas com fotos (o que Diego aprovou).
- `prototipos/scl-publico/` — código do estudo (`public/styles.css`, `src/views.mjs`).
- Capturas de julho (`arquivo/sistema-antigo/README.md`) só como comparação histórica.
