# SCL · demonstração de gestão

Fatia independente autorizada por Diego em 21/09/2026. Não é painel autenticado nem aplicação operacional. Não depende do PR11 e não modifica scl-publico.

## Executar
Node22 ou superior, sem dependências: `node server.mjs`. Abre http://127.0.0.1:4177. Testes: `node --test test/*.test.mjs`.

## Implementado
- Visão geral com contagem derivada dos mesmos cadastros da lista.
- Três imóveis inteiramente fictícios, identificados DEMO, sem mapeamento para imóveis reais.
- Filtro por completude, editor modal e pendências de descrição, capacidade, bairro, título, imagem demonstrativa e comodidades.
- Alteração somente em memória do navegador; recarregar descarta tudo. Histórico visual temporário, não auditoria persistente.
- Estado das capacidades desta demo explicitamente separado do estado de contas externas.
- Layout responsivo, navegação por teclado, foco após edição, modal nativo e anúncio de resultado.

## Limites intencionais
Nenhuma publicação, banco, autenticação, autorização por papel, API de escrita, upload ou integração. Servidor só entrega quatro assets conhecidos, só GET/HEAD, vinculado a127.0.0.1. /painel, /admin e demais rotas não listadas retornam404 inclusive com cookies falsos. CSP bloqueia conexões e formulários externos. Isso isola a demo; não substitui autenticação do futuro produto.

Não inserir informações reais/sensíveis. Não há salvamento, backup ou proteção por usuário. Validação do navegador demonstra UX apenas: a versão real exigirá validação independente no servidor, permissão por organização e papel, versionamento, auditoria e concorrência. Critérios de completude são mínimos de demonstração, não regra final para publicar um imóvel real.

## Verificação desta entrega
3 testes automatizados: pendências/imutabilidade, preservação de identidade/modalidade, allowlist HTTP e negação de escrita/rotas operacionais. Navegador: editar DEMO-02, completar pendências, retornar à lista; recarregar restaura fixture; filtro Com pendências mostra só DEMO-02. Lista sem overflow em320/390/768/1440px. Não é teste em aparelhos físicos.

## Próxima fatia sugerida
Revisar fluxo com Diego/Lia/Rivers, definir identidade e sessões revogáveis antes de receber dados reais, depois cadastro persistente com autorização no backend. Referências de julho ainda não auditadas nesta entrega; não declarar paridade ou reutilização de código legado.
