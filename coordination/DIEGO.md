# Complemento documental — financeiro e portais — 21/09/2026

Pedido direto de Diego registrado em [regras financeiras](../operations/FINANCEIRO-PORTAIS.md), na branch sage-financeiro-portais-20260921. Requisitos, propostas e dúvidas separados; não implementa financeiro, integrações ou portais. Pergunta para Rivers: recuperar fórmula já discutida do marketplace e sua fonte; não usar 15% por inferência. Lia deve reconciliar com seu modelo de relatórios. Menu/Configurações do legado ainda aguardam referência visual. Histórico abaixo preservado e pode descrever estados anteriores; esta entrega não muda prontidão do PR #11 nem autoriza merge. Diego não precisa mergear agora. Revisão documental pendente; nenhum teste financeiro executado.

---

# Diego — #9 concluído; conferência final do #10

Seu merge do #9 foi confirmado. O #10 agora incorpora a nova base e mantém a consolidação da Lia: seis imóveis na operação, cinco do Rio no site; Búzios fora do público, com inclusão interna ainda a decidir. A migração das regras é parcial e não leva dados sensíveis ao GitHub.

O plano de Beds24, Booking e Mercado Pago continua documentado; os acessos e a validação das integrações são etapas próprias. Nenhuma sincronização, cobrança ou publicação ocorreu nesta entrega.

## Você precisa fazer algo?
Aguarde o sinal no PR #10 após CI e revisão do head final. Só você fará os merges. O #11 continua rascunho e não deve ser mergeado; o #5 continua Labs.
A reconciliação muda apenas documentação; não muda o site. Testes automáticos não comprovam integrações externas nem validação em celular real.

## Decisão separada
Tornar os testes uma trava obrigatória ainda depende de sua autorização específica. Conforme o registro do Rivers no #9, essa regra ainda não estava aplicada. Nenhuma regra administrativa foi alterada agora.

O histórico e as decisões do #9 permanecem no Git e no [handoff do Rivers](handoffs/2026-09-21-0130-rivers-pos-pr8.md).

## Complemento Lia —21/9, modelo de relatório e atualização canônica
Por pedido direto de Diego, regra geral de sincronização registrada na seção17 do protocolo e modelo sanitizado em operations/RELATORIOS-PROPRIETARIOS.md. Exemplo PDF financeiro foi produzido e inspecionado localmente; aguarda aprovação visual privada. Nenhum documento financeiro, nome/contato privado ou valor real foi incluído no GitHub. Migração histórica continua parcial. Preservada reconciliação de Sage pós-#9; revisão/CI precisam considerar este novo head do #10, sem merge automático.
