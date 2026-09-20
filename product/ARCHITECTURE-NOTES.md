# SCL 2.0 — Arquitetura de Produto / Mapa de Superfícies

Este arquivo guarda decisões e perguntas de arquitetura de produto que precisam orientar as próximas telas, mesmo quando a implementação começa menor.

## Princípio: começar pequeno sem perder o mapa inteiro

Antes de aprofundar as primeiras páginas, manter uma visão de quais superfícies existirão depois. Isso reduz retrabalho, duplicação de função e páginas que nascem sobrepostas.

Não significa construir tudo agora. Significa saber onde cada função provavelmente mora antes de cristalizar a arquitetura.

---

## Filtros — padrão transversal obrigatório

Filtros devem ser tratados como componente estrutural do produto, não como detalhe de cada tela.

### Onde considerar filtros
- dashboard financeiro;
- portal do proprietário;
- área de cada apartamento;
- listagens e tabelas operacionais;
- calendários;
- reservas;
- limpezas;
- relatórios;
- qualquer superfície em que faça sentido comparar/perfilar unidades ou períodos.

### Padrão desejado
Quando uma página contém múltiplos apartamentos/unidades:
- **filtro geral no topo** para aplicar seleção em bulk;
- **filtros locais por apartamento/bloco/tabela** quando necessário;
- filtros devem seguir lógica e linguagem consistentes entre páginas.

Evitar cada módulo inventar seu próprio sistema de seleção.

---

## Página / superfície "Apartamentos"

### Histórico útil
Versão antiga tinha:
- vários apartamentos na mesma página;
- tabela/bloco por apartamento;
- filtro próprio em cada bloco;
- filtro geral acima para aplicar seleção em massa.

Isso funcionava bem como padrão operacional.

### Pergunta em aberto
A página "Apartamentos" deve continuar existindo como superfície própria ou suas funções devem ser incorporadas em outra área?

Antes de decidir:
- listar tudo o que essa página fazia;
- identificar o que é realmente entidade "apartamento";
- separar o que pertence a financeiro, calendário, operação, proprietário ou configuração;
- evitar duplicar funções em páginas diferentes sem necessidade.

---

## Calendário dos apartamentos

### Problema antigo
O calendário ficava escondido dentro da área de limpezas/faxineiras. Essa hierarquia é ruim: calendário de ocupação/unidades é uma função central e não deve depender mentalmente da operação de limpeza.

### Direção
Redesenhar o calendário como superfície de primeira classe.

Perguntas para definir:
- calendário global com todas as unidades?
- calendário por apartamento?
- visão por operação (reserva, limpeza, bloqueio, manutenção)?
- filtros globais + locais?
- como calendário conversa com reservas e limpezas sem virar página duplicada?

A resposta deve partir do mapa completo de páginas, não da estrutura antiga.

---

## Próxima tarefa de arquitetura

Antes de aprofundar demais as primeiras telas, montar um **mapa completo provisório de páginas/superfícies do SCL 2.0**:
- o que existe;
- o que provavelmente existirá;
- função primária de cada página;
- quais dados/ações pertencem a cada uma;
- onde filtros globais e locais entram;
- quais áreas se relacionam para evitar sobreposição.

Esse mapa pode mudar. O objetivo é reduzir retrabalho, não congelar o produto.

---

## Material histórico a revisar

Quando o ZIP antigo de julho estiver disponível para análise:
- revisar a área de apartamentos;
- revisar o calendário;
- comparar fluxos antigos com a arquitetura atual;
- resgatar padrões que funcionavam melhor sem restaurar cegamente a UI antiga.
