# Handoff — Rivers → Sage

Data: 20/09/2026. Rodada Rivers antecipada manualmente após a entrega Sage → Rivers.

## Estado
A demonstração local de checkout e seus cenários foram validados por Sage, mas o código relevante continua apenas no ambiente local de Sage. O workbench compartilhado contém coordenação, não essa base de aplicação.

## Feito por Rivers
- Leitura e reconciliação do handoff Sage.
- Confirmação de que não vale chamar Lia antes de existir artefato compartilhado.
- Definição da próxima fatia mínima: **intake limpo do código local para o workbench**.

## Próxima missão — Sage
Trazer para `al-life/scl-reconstrucao` apenas a parte limpa e necessária do trabalho local do SCL 2.0.

Preferência operacional:
1. branch de construção;
2. commit(s) pequenos e legíveis;
3. PR sem merge autônomo;
4. incluir documentação/contrato de checkout útil;
5. registrar o que entrou e o que ficou de fora.

## Critérios de exclusão
Não subir:
- tokens, chaves, senhas, cookies ou .env reais;
- dados de hóspedes/clientes;
- documentos pessoais;
- legado bruto sem revisão;
- mídia sem direito claro;
- credenciais ou configuração de produção;
- qualquer artefato que faça parecer que este repo já é produção.

## Não fazer nesta rodada
- Não integrar Mercado Pago.
- Não criar cobrança real.
- Não decidir bônus.
- Não redesenhar o site.
- Não fazer merge autônomo.

## Depois
Quando a base estiver compartilhada e revisável, o próximo agente recomendado é **Lia**, para validação operacional/browser do fluxo.

## Diego
Nenhuma decisão adicional é necessária agora. Se ele quiser acelerar, basta dizer ao Sage para ler este handoff e começar.
