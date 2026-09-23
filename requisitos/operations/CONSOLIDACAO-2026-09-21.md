# Operação e integrações — consolidação de 21/9/2026

Fonte: decisões diretas de Diego na conversa Lia em21/9 e registros locais de implantação19–21/9. Esta é a primeira consolidação revisável; não representa migração integral dos arquivos locais nem ativação técnica.

## Escopo aprovado
Diego cuida de seis imóveis. O catálogo público Sua Casa Leblon contém somente os cinco do Rio:102,103,303,399,403. Búzios não aparece em páginas públicas, busca, disponibilidade pública ou resultados da empresa/site. Sua inclusão no sistema interno ainda será decidida; alternativa é operar somente no Airbnb. Importação histórica em Beds24 não decide exposição pública ou inclusão no produto.
Qualquer relatório interno abrangendo seis, solicitado por Diego, deve mostrar Búzios separado, sem somar silenciosamente aos resultados SCL.

## Fonte canônica e transição
Diego definiu GitHub como destino canônico das regras e decisões compartilhadas. Após revisão/merge, este documento governa estes temas; arquivos locais preservam evidência histórica e dados restritos. O código continua workbench, sem produção ou publicação automática.
Não transportar documentos, códigos de entrada, senhas, contatos privados, reservas nominais ou registros financeiros individuais para este repositório. Migrar regras sanitizadas por tema, com origem e estado, antes de apontar o mestre local ao sucessor. Não alegar que tudo já foi transferido.

## Estado das integrações
- Beds24: registro19/9 confirma seis imóveis importados e Channelsync autorizado; sincronização/mapeamento não ativados naquele registro. Login atual21/9 requerido; revalidar antes de qualquer escrita. Preços importados aprovados como base, Búzios separado. Reservas e bloqueios não podem ser deduzidos de inventário vazio ou1.
- Booking: conta de parceiro ainda exige autenticação nesta sessão. Conferir anúncios existentes e empresa antes de cadastrar. Preparação de conteúdo tem lacunas de contatos/faturamento, política de cancelamento, banheiros, camas/tipo da casa e defaults de frente para praia/animais. Nada publicado por esta consolidação.
- Mercado Pago: painel exige login; conta recebedora/aplicações ainda não conferidas. Prioridade para homologação do checkout; split automático continua LAB. Não configurar webhook sem destino backend validado nem usar redirecionamento do navegador como prova de pagamento.
- Site: contrato Beds24 implementa interface fechada UNKNOWN/canBook:false, sem consulta remota. Reserva real, banco, pagamento e webhooks ainda não implementados nessa entrega.

## Trabalho prioritário autorizado em21/9
1. Lia: reconciliar Beds24 versus fonte real — reservas, bloqueios, preços, mínimos, moeda, horizonte e mensagens; apresentar divergências e prévia do envio. Começar validação profunda103/403. A existência de seis importados não autoriza incluir Búzios no público.
2. Lia: Booking após login, verificar cadastro existente e preparar um imóvel próprio; conteúdo, calendário e mapeamento conferidos antes de ativação.
3. Preparar Mercado Pago em homologação, com identidade recebedora confirmada, configuração de servidor e tratamento de notificações/repetições/reconciliação. Produção, novos acessos e pagamentos reais requerem escopo próprio.
4. Próximas etapas propostas: adaptador de leitura, disponibilidade/cotação verificadas, concorrência/reserva/pagamento, eventos recuperáveis, atendimento integrado, relatórios e portal com acesso por proprietário.

## Regras operacionais trazidas do plano local
- Atendimento tem prioridade sobre construção. Lia se identifica; informações gerais confirmadas podem ser dadas em consultas; dados sensíveis exigem vínculo com reserva.
- Cruzar histórico entre canais e decisão mais recente antes de responder. Não repetir perguntas ou reabrir assunto resolvido; canal indisponível é limitação, não ausência de mensagem.
- Passadas horárias, fechamento privado por WhatsApp substitui e-mail rotineiro. Primeiro destacar ação de Diego, depois cobertura e limitações reais. Coordenação GitHub fica no painel/handoffs, salvo decisão/aviso solicitado.
- Agenda diária20h, próximos cinco dias, Rio e Búzios separados. Na casa, avisar cada nova reserva com entrada/saída mesmo além da janela; equipes verificadas podem pedir horizonte maior, sempre provisório. Agenda não confirma limpeza.
- Documentos de portaria somente403: validar reserva e anexos, conferir histórico, enviar apenas ao destinatário autorizado mantido em referência restrita; entrega não significa aprovação.
- Preços/calendários: não acumular descontos ou multiplicadores; salvar e reabrir para verificar. Não extrapolar regras Rio para Búzios.
- Venda direta deve concluir no site com preço/disponibilidade revalidados; sem improvisar cobrança no WhatsApp ou prometer bônus sem regra.
- Manutenção: receber orçamento não autoriza contratação/execução. Faxinas planejadas, executadas e custos confirmados são estados distintos.
- Relatórios: fontes verdadeiras, realizado/contratado/projeção separados; não publicar números não conferidos, não compartilhar dados entre proprietários.
- Rotinas existentes: consulta quinzenal de manutenção/mídia, conferência semanal de faxinas, lembrete mensal administrativo e anual de caixinhas. Agenda detalhada e índices de envio permanecem locais até migração específica verificada.

## Lacunas de migração
Ainda precisam de consolidação por tema: fichas e regras comerciais completas, catálogo de mensagens, métricas/repasses, cadastro de manutenção, critérios de preços/eventos e índices das rotinas. Histórico de hóspedes, contatos e documentos exige armazenamento restrito próprio, não cópia integral para GitHub.
Referências de origem locais: COMECE-POR-AQUI.md; outputs/guia-respostas-airbnb.md; outputs/plano-de-melhorias-airbnb.md; outputs/implantacao-beds24.md; outputs/plano-execucao-integracoes-2026-09-21.md. Caminhos são proveniência, não arquivos já presentes neste repo.

## Ritmo proposto
Entregas maiores com implementação e verificação quando liberadas, sem preencher meia hora artificialmente. Revisão conforme risco/dependência, não três repasses obrigatórios por ajuste. Nenhuma automação de outro agente foi alterada. A decisão administrativa de gateCI não impede preparar trabalho independente, nem está autorizada por merge documental.
