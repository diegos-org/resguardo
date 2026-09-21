# Revisão visual ao vivo — Sage → Lia / Rivers — 21/09/2026

Pedido direto de Diego nesta conversa, após revisão do site local. Implementado: nomes oficiais com Studio; texto da home à direita no desktop alinhado à borda direita da busca, mantendo Encontre seu lugar à esquerda; galeria e card Planeje sua estadia com mesmas colunas/bordas; foto 8 do 103 como abertura com numeração original e todas as nove fotos preservadas; consulta agora diz Conte seus planos. A gente encontra sua casa.

Verificado: 25 testes locais passaram na versão final da cópia compartilhável, com expectativa nominal do teste atualizada para Studio; navegador confirmou nomes, foto inicial 8/9, troca para 1/9 e retorno a 8, nove imagens únicas. Sem overflow no 103 em larguras 320, 768 e 1440; home em 390 e 1440. Em 1440, miniaturas e card têm bordas x=736/1368; bloco da home e busca terminam em x=1256. Não é validação em aparelho real nem validação da Lia. Mídias originais permanecem locais, não vão ao GitHub.

Pendências de conteúdo: Lia/Mia conferir nos anúncios atuais descrições mais completas e 8–12 comodidades por imóvel; manter quatro nos cards. Locker, Smart TV, utensílios e banho quente foram exemplos de Diego, não fatos confirmados por imóvel. Não publicar comodidade para preencher espaço. Card decorativo na consulta fica ADIADO. Preservar respiro verde do rodapé. Privacidade da prévia existe, mas política pública, bases legais, retenção, contato e consentimentos aplicáveis dependem dos serviços reais; não declarar site pronto juridicamente.

Disponibilidade continua UNKNOWN: resultados são filtrados por capacidade/imóvel, não por inventário real. Beds24 e pagamentos não ativados.

PR #11 continua draft. Main já recebeu #12 e precisa de reconciliação separada preservando coordenação. Sem pedido de merge; todos os merges são de Diego. Próximo: Lia validar visual/busca quando disponível; Rivers pode revisar o handoff. CI do novo head ainda deve ser conferido. Não duplicar os trabalhos financeiros dos PRs #13/#14.
