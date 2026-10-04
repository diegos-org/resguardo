# Identidade visual do SCL 2.0 — especificação (M7.5)

**Situação:** aprovado por Diego em 4/10/2026: adotar o visual do estudo do "Sage" (site público,
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
| `--scl-dourado` | itálico do logotipo, destaques pequenos | `#c9a96e` | `#c9a96e` | nunca em texto corrido |
| `--scl-tinta` | texto principal | `#252b23` | `#252b23` | |
| `--scl-texto-2` | texto secundário | `#5b604f` | `#5b604f` | contraste ≥ 4,5:1 sobre o papel |
| `--scl-borda` | bordas de cartões e campos | `#cfc1a9` | `#cfc1a9` | |
| `--scl-foco` | contorno de foco do teclado | `#b66630` | `#b66630` | 3px, deslocado 5px |

Contraste: todo texto sobre `--scl-creme`/`--scl-papel` usa `--scl-tinta` ou `--scl-texto-2`;
sobre os verdes, `--scl-creme` ou branco. Conferir com ferramenta de contraste antes de fechar o
PR (mínimo 4,5:1 em texto normal, 3:1 em texto grande e ícones).

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
  Itálico dourado para a palavra de destaque ("Um lugar *seu*", "Sua Casa *Leblon*").
- **Texto:** `Arial, Helvetica, sans-serif`, 13–17px, `line-height 1.7`.
- **Rótulos de campo e "olhos" de seção:** 9–10px, maiúsculas, `letter-spacing 0.06–0.19em`.
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

- **Cabeçalho** verde-floresta com logotipo (ícone + "Sua Casa *Leblon*"), "Nossas casas" e o
  botão contornado "Planeje sua estadia ↗". Faixa fina acima quando for prévia privada.
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
  fundo creme, cartões e tabelas em papel, botões musgo, foco laranja), com **densidade maior**:
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
