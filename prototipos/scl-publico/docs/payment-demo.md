# Sage — pagamento fictício e armazenamento privado — 21/09/2026

Rodada por pedido direto de Diego após a correção de autorização do PR #15, encerrada às 18h38 BRT. Trabalho paralelo autorizado ao tour da equipe; não presume revisão de Lia/Rivers. O início foi por solicitação na conversa, sem registro de horário preciso.

## Implementado
PR #11 (draft): /demo/checkout leva a /demo/pagamento, com estados fictícios de pendência, aprovação, recusa, expiração, cancelamento e conferência manual. Só cotação fictícia válida expõe o simulador. Retorno do navegador nunca confirma; evento duplicado é ignorado dentro da sessão; divergências de valor/moeda/referência ou inventário não verificado exigem conferência. Aprovação tardia após expiração/cancelamento/recusa também. Todos os estados mantêm canPay=false.
Nenhuma chamada ao Mercado Pago/Beds24, cobrança, reserva, e-mail, upload ou coleta de PII. Estado apenas na memória do navegador. Isto não implementa idempotência persistente, autenticação de webhook, bloqueio concorrente de inventário ou integração de pagamento.

## Verificado
30/30 testes locais Node 24 na versão original e na cópia compartilhável sem mídia privada. Cinco testes novos cobrem os limites acima. Navegador confirmou navegação revisão→pagamento→aprovação fictícia. Em largura 320, documento e viewport mediram 320px sem transbordamento horizontal; não é teste em aparelho real. CI remoto do novo commit ainda precisa ser consultado após push.

## Proposta de armazenamento (não provisionada)
Dados estruturados no Neon Postgres; documentos em object storage privado, com referência no banco. Consulta de metadados confirmou projetos SCL na região São Paulo; não houve auditoria de permissões nem acesso a dados de hóspedes. A documentação atual de Neon Object Storage lista Ohio, Virgínia, Frankfurt e Singapura, sem São Paulo (mais atual que o resumo da skill). Recomendação para manter arquivos em São Paulo: AWS S3 privado sa-east-1. Nenhuma conta ou recurso criado; escolha ainda depende de Diego. Conector Neon callable nesta sessão; nenhum conector AWS/S3 exposto.
Exigir autorização no backend em cada acesso, bloqueio público, criptografia, URLs temporárias, limite/validação/quarentena de uploads, auditoria sem conteúdo sensível, retenção e restauração testada. Dados reais e documentos nunca em branches de preview, GitHub ou chats. Cartões permanecem no provedor de pagamentos.

## Próximo
Rivers pode revisar fluxo e proposta; Lia validar UX quando disponível. PR #15 permanece trilha separada (gestão/autorização e revisão Lia/Mia); nenhuma alteração nele. PR #11 continua draft e com conflito contra main observado antes desta publicação: não pedir merge. Reconciliação e revisão do head final ainda necessárias. Todos os merges exclusivamente Diego.

Fontes: https://neon.com/docs/storage/overview ; https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html ; https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html
