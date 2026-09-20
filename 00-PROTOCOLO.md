# SCL 2.0 — PROTOCOLO DE COORDENAÇÃO

> **Status:** workbench temporário e não canônico.
> **Não é produção. Não é documentação final da Sua Casa Leblon.**

Este repositório é o canteiro de construção coordenado de **Rivers, Lia e Sage** para o SCL 2.0.
A futura aplicação de produção deverá viver separada. Nada aqui deve ser tratado como produção por acidente.

## 1. Antes de qualquer turno

Todo agente deve, nesta ordem:

1. Ler este arquivo.
2. Ler `coordination/CURRENT.md`.
3. Ler o próprio arquivo:
   - Rivers → `coordination/RIVERS.md`
   - Lia → `coordination/LIA.md`
   - Sage → `coordination/SAGE.md`
4. Ler `coordination/DIEGO.md` para entender decisões humanas e pendências.
5. Ler o handoff mais recente em `coordination/handoffs/` quando houver.

Só depois começa a trabalhar.

## 2. Regra central

Cada turno deve **reduzir incerteza e avançar o produto**. Não criar sistema por prazer de criar sistema.

Prioridades:
1. Produto funcionando.
2. Clareza de estado.
3. Segurança prática sem travar o trabalho.
4. Histórico preservado.
5. Elegância técnica depois.

## 3. Papéis

### Rivers
Coordenação, arquitetura de trabalho, coerência entre rodadas, decisões de estrutura, revisão de handoffs e tradução para Diego.

### Lia
Execução operacional e navegação/browser quando isso for necessário; validação prática de fluxos reais e tarefas que dependam de interface.

### Sage
Análise técnica, implementação/revisão complementar, contraponto crítico e investigação quando houver mais de uma solução plausível.

Os papéis não são jaulas. Um agente pode sugerir trabalho para outro, mas deve registrar o motivo.

## 4. Ao terminar cada turno

O agente deve obrigatoriamente:

1. Atualizar `coordination/CURRENT.md` com o estado atual, sem transformar o arquivo num diário gigante.
2. Atualizar o próprio arquivo com:
   - o que verificou;
   - o que fez;
   - o que recomenda;
   - o que deliberadamente **não** decidiu;
   - o que o próximo agente precisa saber.
3. Atualizar `coordination/DIEGO.md` em linguagem simples.
4. Criar um handoff datado em `coordination/handoffs/` quando houver mudança material.
5. Preservar histórico anterior. Nunca apagar silenciosamente uma decisão antiga só porque mudou de ideia.

## 5. DIEGO.md é obrigatório

`DIEGO.md` é o painel humano.

Escrever para alguém inteligente que quer entender o sistema, mas **não precisa aprender programação**.
Evitar jargão sem tradução.

Sempre responder, em linguagem comum:
- Onde estamos?
- O que mudou?
- O que funciona?
- O que ainda não funciona?
- Há algum risco ou decisão pendente?
- Diego precisa fazer alguma coisa? Se sim, exatamente o quê?

Se Diego não precisa fazer nada, escrever isso explicitamente.

## 6. Handoff

Um handoff útil contém:
- **De:** agente que terminou.
- **Para:** próximo agente.
- **Estado:** o que é verdade agora.
- **Feito:** mudanças realizadas.
- **Verificado:** fatos efetivamente checados.
- **Sugestões:** próximos movimentos.
- **Não fazer ainda:** decisões adiadas ou caminhos rejeitados.
- **Diego:** qualquer assunto que exija decisão humana.

Sugestões podem ser recusadas. Quem recusar registra o motivo.

## 7. Rodadas e antecipação manual

A cadência normal é definida pelas tarefas agendadas de cada agente.

Diego pode antecipar manualmente uma rodada.
Quando isso acontecer:
- executar a rodada antecipada;
- cancelar/ignorar **somente a ocorrência seguinte equivalente**, se ela se tornar redundante;
- manter as demais ocorrências futuras e a cadência geral.

Não reprogramar toda a operação por causa de uma antecipação pontual.

## 8. Produção

É proibido presumir que este repositório seja produção.

Não:
- publicar como aplicação oficial;
- apontar domínio oficial;
- migrar dados reais de clientes;
- conectar credenciais de produção;
- sobrescrever sistemas existentes da Sua Casa Leblon sem decisão explícita de Diego.

## 9. Segurança prática

Nunca armazenar aqui:
- tokens, API keys, senhas ou cookies;
- documentos pessoais;
- dados bancários;
- credenciais;
- PII desnecessária;
- dumps privados de clientes/hóspedes.

Usar placeholders e nomes genéricos quando necessário.
Segurança deve ser sensata, não paralisante.

## 10. Código e merge

Até que as regras administrativas do GitHub estejam configuradas:
- tratar `main` como protegida por convenção;
- mudanças de código relevantes devem preferir branch + PR;
- nenhum agente deve fazer merge de mudança de aplicação por conta própria sem regra explícita posterior;
- Diego mantém a palavra final humana sobre merge e publicação.

Arquivos de coordenação podem ser atualizados diretamente para não criar burocracia inútil.

## 11. Fonte de verdade

Para o estado operacional deste workbench:
- protocolo → `00-PROTOCOLO.md`
- estado atual → `coordination/CURRENT.md`
- visão humana → `coordination/DIEGO.md`
- memória por agente → arquivos individuais
- histórico → `coordination/handoffs/`

Quando houver conflito, registrar o conflito; não escolher silenciosamente uma versão.

## 12. Regra de saída

Quando SCL 2.0 estiver pronto para virar produto real:
1. revisar o que é canônico;
2. separar documentação final de material de coordenação;
3. criar/migrar para o repositório de produção;
4. arquivar este workbench com o histórico intacto.
