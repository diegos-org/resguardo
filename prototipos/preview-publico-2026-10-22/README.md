# Prévia pública visual — Sage — 22/10/2026

## Autorização e fronteira da entrega
Diego autorizou nesta conversa, em 22/10/2026, retomar as páginas públicas aprovadas,
preferindo uma prévia separada que possa abrir no celular. Pediu leitura cuidadosa da
evolução recente, preservação de funcionalidades/regras/termos e histórico reversível.
Esta entrega é uma prévia visual independente, não a conclusão de M7.24d nem uma
substituição do aplicativo em `app/`. A ordem normal do roadmap permanece para a
integração definitiva. Não muda a frente de pricing/integrações do Claude.

## Ponto de partida verificável
- Repositório: `al-life/scl-reconstrucao`.
- Main lida: `30f8d6c07f47f0aafc622b9c0969f67808f72973` (PR #165).
- ZIP completo baixado do GitHub; SHA-256:
  `febcd166c0457c05edd799fb8df30e102d8869aaf51ba64227d4581599c2b145`.
- Todos os blobs do ZIP conferidos contra a árvore Git dessa revisão: zero divergências.
- Fonte visual: `prototipos/acervo-visual-2026-10/site-publico/`, preservada integralmente.
- A cópia local antiga foi identificada como desatualizada e não usada como base operacional.

## Conteúdo e mudanças
Oito páginas: início, catálogo, cinco imóveis e consulta ilustrativa; galerias, carrossel
com pausa/redução de movimento e calendário. Mantém fotos dos imóveis do acervo, logo
azul, verde fosco, papel, título à direita e enquadramento do Dois Irmãos.
Aplica creme/papel definidos em DESIGN.md em 4/10 e uma busca translúcida com fallback.
O catálogo é histórico de referência, não é sincronizado com o cadastro atual.
Termos, privacidade e cancelamento apontam às páginas oficiais atuais; não replica
texto jurídico antigo. Nenhum arquivo de `app/`, banco, integração ou domínio é editado.

Formulários apenas navegam localmente. Nenhuma chamada de API, persistência, conta,
e-mail, cobrança, disponibilidade real ou reserva. A consulta filtra apenas capacidade
e imóvel do estudo e avisa que datas/preços não foram verificados. Sem alegar validação
de Lia/Rivers. Fotos dos estabelecimentos em `images/places/`, marcadas no acervo como
direitos pendentes, não fazem parte do pacote publicado; seus espaços são gráficos neutros.

## Verificação
- `python3 verificar.py`: 8 páginas, 163 referências locais válidas, sem POST/fetch/storage.
- `node --check site/app.js` e `node --check site/preview.js`: passaram.
- Navegador: home e imóvel 103 com largura 390px sem transbordamento horizontal;
  troca da foto 8 para a 1; entrada em 25/10 e transição automática para saída;
  marcador da entrada presente; saída em 28/10 fecha o calendário.
- A automação do navegador perdeu resposta ao acionar Consultar; teste ponta a ponta
  desse clique ainda não confirmado nesta revisão. O resultado e o deploy serão
  conferidos separadamente e anotados no registro de publicação.
- Não executados testes do aplicativo operacional: nenhum código operacional foi alterado.
- CSP do pacote bloqueia conexões e frames; noindex e robots desestimulam indexação
  (não são autenticação). Sem segredos ou dados de hóspedes no pacote.

## Reprodução, histórico e reversão
`site/` é o pacote estático pronto, com `manifest.json` contendo SHA-256 de cada arquivo.
`gerar.py` lê a fonte visual versionada citada acima e recria `site/` e `manifest.json`.
Execute `python3 prototipos/preview-publico-2026-10-22/gerar.py`; `verificar.py` valida o pacote.
Publicar somente `site/`, como estático, sem install/build, variáveis ou funções.
O projeto Vercel deve ser separado, sem domínios oficiais e sem ligação automática de Git.
Cada nova revisão terá novo commit e deployment. Guardar URL/ID/hash no registro local
e PR. Para voltar, abrir a URL imutável da versão anterior; se houver alias de preview,
reatribuí-lo apenas à versão verificada. Nunca reescrever histórico, apagar o acervo ou
usar rollback do projeto operacional para desfazer uma prévia visual.

## Próximo passo
Após Diego ver o conjunto, portar apenas os ajustes visuais aprovados para os componentes
atuais de `app/`, mantendo textos/cadastros editáveis, termos, busca real, acessibilidade,
cotação e pagamentos existentes. Exige testes atuais e revisão própria; este PR é draft
de referência e não autoriza merge ou produção.
