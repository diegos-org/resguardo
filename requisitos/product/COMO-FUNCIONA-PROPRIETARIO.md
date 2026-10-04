# "Como funciona" para o proprietário — M5.6 (pedido de Diego em 4/10/2026)

Documento de consulta no portal do proprietário (gestão total e marketplace): o que a SCL faz,
comissão e taxas, quando e como ele recebe, relatórios, cancelamentos e, quando decididas,
contestações. Texto editável no painel, **versão datada** a cada mudança e **aceite registrado**
(quem, quando, qual versão). Código: `app/src/configuracoes/como-funciona.ts` (texto e versões),
`app/src/portal/aceites.ts` (aceites), `app/src/portal/dados-contrato.ts` (quadro "Seus dados"),
tabela `aceites_documento` (migração 0054), telas em Configurações → Como funciona (proprietário),
`/portal/como-funciona`, faixa no `/portal`, página do convite e página do proprietário no painel.

## Regras

- **Seções fixas, texto livre:** o que a empresa faz; marketplace; comissão e taxas; quando e como
  recebe; relatórios e extrato; cancelamentos; contestações; dúvidas. Limite por seção (3.000
  caracteres; dúvidas 1.000); linha em branco separa parágrafos; `{empresa}` vira o nome da empresa.
  Seção vazia não aparece no portal. Pelo menos uma seção escrita para publicar.
- **Nada publicado até a primeira versão:** sem versão, o painel traz um rascunho sugerido (a partir
  das regras do sistema; "contestações" em branco até a decisão de Diego) e o portal não mostra o
  documento nem pede aceite. Avisar em vez de supor: o texto é decisão de Diego, não do sistema.
- **Versões:** publicar com texto diferente da versão atual cria a versão seguinte (número + 1, data de
  hoje, autor); texto igual não cria versão. As versões ficam na configuração `como_funciona`
  (`{ versoes: [...] }`), e cada publicação entra na auditoria com o que mudou por seção.
- **Aceite:** por proprietário, feito por um usuário do portal ligado a ele (um usuário que representa
  dois proprietários aceita pelos dois de uma vez). Fica `aceites_documento` (documento, versão,
  proprietário, usuário, quando), só inclusão; versão nova pede aceite novo e os antigos ficam.
  Deny-by-default: só sessão de proprietário, só os proprietários ligados a ela no servidor, e o
  número da versão aceita tem de ser o da versão publicada agora — se o texto mudou com a página
  aberta, o sistema recusa e pede para ler a nova. Uma vez aceito por qualquer usuário do proprietário,
  vale para o proprietário (a página mostra quem aceitou).
- **Portal:** `/portal/como-funciona` mostra o texto, o quadro "Seus dados" (contrato em vigor por
  imóvel: tipo, comissão, desde quando; periodicidade de repasse escolhida ou padrão) lido do
  cadastro — o texto não repete esses números — e a situação do aceite, com a caixa "li e aceito" e o
  botão quando falta. No início do portal, uma faixa pede a leitura enquanto faltar o aceite da versão
  atual; com tudo aceito, só o link. O portal não é bloqueado.
- **Convite:** com versão publicada, a página do link mostra o documento (sem o quadro "Seus dados",
  que depende do login) e exige "li e aceito" para seguir; a versão marcada vai num cookie curto com o
  token e o aceite é gravado na mesma transação que aceita o convite, no login — só se a versão ainda
  é a publicada; senão o portal pede a nova.
- **Painel:** a aba lista, por proprietário ativo, se tem acesso ao portal e o último aceite (versão,
  quando, e-mail), marcando quem ainda não aceitou a atual; a página do proprietário traz a mesma linha.

## Fora deste item

- Páginas legais do site (termos, privacidade, cancelamento) com aceite no checkout: M7.4.
- Texto das contestações: espera a decisão de Diego (GUIA, seção 7); até lá a seção fica vazia.
- Correção pequena sem novo aceite: não existe — qualquer mudança de texto pede aceite de novo, como
  Diego pediu. Se virar incômodo, a decisão é dele (ex.: marcar uma publicação como "correção").
