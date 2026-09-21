# SCL — revisão de produto, 21/09/2026

Pedido direto de Diego autoriza esta fatia de produto, sem alteração do gate de CI, merge ou produção.

## Implementado para revisão
Busca opcional por imóvel; consultar datas apresenta catálogo filtrado por capacidade e imóvel, mantendo datas nos links. Enquanto Beds24 não estiver conectado, todos os resultados indicam disponibilidade não confirmada. Não mostrar ausência de disponibilidade nem simular vagas. Botão “Consultar”; “Planejar estadia”; título “Encontre sua casa no Leblon”. Calendários alinhados à esquerda, título mobile menor em duas linhas, seção clara mais compacta e WhatsApp no rodapé mobile. Texto desktop deslocado sem aumentar a foto. Corrigido espaço no título do passeio.

## Pilotos locais
Mesmo layout e catálogo de referência, marcas Sua Casa Rio e Sua Casa Ipanema; Ipanema usa azul ardósia. As localizações dos imóveis continuam verdadeiras: Leblon. Pilotos não significam lançamento, novo inventário ou decisão de arquitetura. Recomenda-se uma base compartilhada com configuração de marca/bairro em vez de manter cópias divergentes. Sem deploy nem domínio.

## Requisitos aprovados para o painel futuro — não implementados
- Edição e adição de imóveis e indicações próximas por Diego autenticado, com autorização no servidor.
- Modal de cadastro, upload de foto e validação dos campos mínimos antes de publicação.
- Rascunho incompleto pode ser salvo; pendências legíveis e publicação bloqueada enquanto faltarem campos ou foto.
- Imóvel: nome, bairro/localização pública, capacidade, descrição, fotos e comodidades mínimas. Nunca confundir localização pública com instruções privadas de acesso.
- Indicação: nome, descrição, categoria, localização, foto e link quando aplicável. Validar links e arquivos no servidor; exigir direitos de uso de mídia.
- Modelos de operação separados: gestão completa e marketplace; somente gestão completa ativa hoje.
- Avaliações reais por imóvel: selecionar fontes, preservar sentido, verificar uso e minimizar dados pessoais. Nada de depoimentos inventados.
- Espaço vazio junto às comodidades: ideia futura de Diego; manter respiro até existir função útil.
- Fold: adaptar por largura disponível, incluindo tela externa, aberta e multitarefa, sem exigir meia tela. Verificação em aparelho real pendente.

## Limites
Busca real por disponibilidade, preços e reserva depende de integração Beds24 validada. Checkout, pagamento, e-mail e autenticação continuam pendentes. Prévia mobile local é somente de leitura, com formulários de envio desativados; não é emulação completa de aparelho.
