# Acervo visual — site e painel desenhados pelo "Sage" (4/10/2026)

Material de **referência** para o item M7.5 (identidade visual). Não é o produto e não é
publicado: o site real está em `app/` e lê o banco. Guardado a pedido de Diego em 4/10/2026,
que aprovou adotar este visual no site, nos portais e no painel.

## O que é

- `site-publico/` — a versão navegável do site público desenhada pelo "Sage" (codinome de um
  agente do ChatGPT) entre 20/09 e 4/10/2026: início, catálogo, cinco imóveis (102, 103, 303,
  399, 403), consulta, checkout demonstrativo, demonstração de pagamento e privacidade, com as
  fotos. É a **mesma base** de `prototipos/scl-publico` (o código que gera essas páginas está lá,
  em `src/views.mjs` e `public/styles.css`); aqui fica a cópia renderizada, com imagens, do jeito
  que Diego viu e aprovou. Abra `site-publico/index.html` no navegador (os links entre as páginas
  são locais).
- `gestao-demo/` — demonstração interna do painel ("Ateliê de gestão"), com dados fictícios e
  edição em memória. Precisa de um servidor HTTP simples por causa dos módulos JavaScript.
- `comparacao-home.html`, `scl-desktop.png`, `scl-mobile.png` — registros históricos da página
  inicial (comparação entre versões), não capturas novas.
- `LEIA-ME-original.txt` — a nota que veio junto com o arquivo.

Ajustes feitos ao arquivar, só para o acervo abrir inteiro em qualquer máquina: os links entre as
páginas e para as fotos são relativos (em `comparacao-home.html`, os caminhos que apontavam para
o computador de origem passaram a apontar para `site-publico/images/`), e o seletor "Seu lugar"
da página de cada imóvel abre a página local do imóvel escolhido (`imovel-<código>.html`) em vez
do endereço do site de produção. Nada do visual mudou.

## O que **não** é

- Não há disponibilidade, cotação, reserva nem pagamento reais: formulários não enviam nada.
- As fotos dos imóveis são as do anúncio; **os direitos de algumas fotos de lugares do bairro
  (seção "O bairro à sua porta") seguem pendentes para publicação** — valem só como referência de
  layout. A publicação de fotos reais no site é o item M7.3, depois de Diego liberar os direitos.
- Nenhum dado privado de consultas ou hóspedes está incluído. O único contato é o WhatsApp
  comercial público da empresa.

## Como vai ser usado

A especificação de design com os tokens (cores, fontes, espaçamentos) e os ajustes que Diego
decidiu em 4/10 está em `requisitos/product/DESIGN.md`. O M7.5 implementa isso em `app/`
(site, portal do hóspede, portal do proprietário e painel), lendo daqui e de
`prototipos/scl-publico` como referência, sem copiar código.
