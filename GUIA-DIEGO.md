# Guia do Diego — tudo sobre o SCL 2.0 num lugar só

> Documento escrito para você, sem precisar ler código. É atualizado a cada PR.
> **Regras de preservação (9/10/2026):** Claude e Codex trabalham em cópias e branches novas, preservando originais, acervos e o histórico. Cada PR explica o que mudou, por quê, com qual objetivo e onde retomar. Decisões substituídas continuam registradas; voltar atrás acontece por uma nova mudança, sem apagar o passado. O visual continua tomando o acervo do Sage como referência, depois das entregas funcionais.
> **Conferência da equipe (9/10/2026):** protegido também o caso de um cadastro ligado por engano a uma conta de outro perfil ou outra empresa. O sistema recusa alterar esse acesso, preserva a conta e não usa seu e-mail nos avisos da equipe. Os testes usam dados fictícios; isso não afirma que os cadastros reais foram inspecionados.
> **Última atualização:** 10/10/2026, **alteração de reserva paga pelo site, em teste (M8.2d):** na ficha de uma reserva paga pelo site, quem cuida do financeiro (hoje, só você) muda as datas, o número de pessoas ou o valor **antes da entrada**: o sistema mostra antes o valor novo, a diferença e o que acontece com o dinheiro, e segura as noites novas por um tempo que você escolhe. Se o valor sobe, o hóspede paga a diferença por Pix ou cartão na página da reserva e a alteração vale sozinha; se desce, a diferença segue a Política de cancelamento que ele aceitou, contando da entrada original ou da nova, a que vier primeiro: dentro do prazo, volta; fora, fica e é dividida como uma reserva normal. O financeiro é refeito sozinho, e a devolução de parte do valor só é pedida ao Mercado Pago depois que ele libera o pagamento (no teste, registre a liberação à mão). Também ficou pronto o que faltava das devoluções: mais de uma devolução no mesmo pagamento, o restante de um pagamento já devolvido em parte e a devolução que o Mercado Pago fez a menos. Nada é escrito no Beds24: o Início avisa quando mudar o bloqueio nas OTAs, mesmo com o envio ao Beds24 ligado (o envio manda só os bloqueios do SCL, nunca as datas das reservas; o mesmo vale para os avisos de reserva paga e cancelada). Como o Pix, o cartão e o cancelamento, roda só nas prévias da Vercel e com a conta de teste do Mercado Pago (seção 2; o que fazer nos itens 44 e 45 da seção 6 e as frases novas da política no item 42; decisões novas na seção 7). Antes, também em 10/10, **cancelamento de reserva paga pelo site, em teste (M8.2c):** na ficha de uma reserva paga pelo site, quem cuida do financeiro (hoje, só você) calcula o cancelamento pela Política de cancelamento que o hóspede aceitou, vê o resultado antes (devolução integral ou nada, e por quê) e cancela; o sistema pede a devolução ao Mercado Pago, acompanha até ela sair e acerta o financeiro sozinho: reserva, comissão, parte do proprietário, a taxa que não voltar (despesa da empresa) e, se a parte do proprietário já tinha sido paga, o desconto no próximo repasse dele. Sem devolução, o valor fica e é dividido como uma reserva normal. O hóspede pode pedir o cancelamento em Minha reserva (ele só pede, e a hora fica registrada; quem cancela é a equipe), a página da reserva mostra a situação e há três mensagens novas ao hóspede, prontas para copiar, que saem sozinhas quando você ligar as mensagens. Como o Pix e o cartão, roda só nas prévias da Vercel e com a conta de teste do Mercado Pago (seção 2; o que fazer nos itens 41 a 43 da seção 6; decisões novas na seção 7). Também em 10/10, **conferências com dados fictícios:** equipe (senha provisória, troca da própria senha, cidades e avisos) e cartão (liberação imediata, em 14 e em 30 dias). A previsão não vira dinheiro recebido: precisa da confirmação do provedor, e o proprietário espera também o check-in. Não houve criação de contas reais, envio de avisos reais nem cobrança. **Visual:** componentes atuais renderizados localmente em computador (1512 px) e celular (390 px), comparados com o acervo do Sage; sem estouro horizontal, imagens carregadas e campos de no mínimo 44 px. Essa conferência de aparência não valida navegação, autenticação ou pagamentos no site publicado.
> **Entregas de 9/10/2026:** **pagamento com cartão no site, em teste (M8.2b):** depois de segurar as datas, o hóspede escolhe entre o Pix (recomendado, já marcado) e o cartão de crédito; o formulário do cartão é do Mercado Pago (os dados do cartão nunca passam pelo nosso sistema), aceita só crédito e parcela com os juros pagos pelo hóspede; quando o banco pede, a verificação do banco aparece na própria página. A reserva confirma sozinha quando o cartão é aprovado, e um cartão em análise no Mercado Pago segura as datas por mais um tempo que você escolhe. Contra quem testa cartões roubados, toda recusa mostra a mesma mensagem e, com muitas recusas, o cartão desliga sozinho (o Pix continua). O cartão vem **desligado**: você liga em Configurações → Pagamento no site. Como o Pix, roda só nas prévias da Vercel e com a conta de teste do Mercado Pago: nada é cobrado de verdade (seção 2; o que fazer no item 40 da seção 6; decisões novas na seção 7: verificação do banco, prazo de liberação do cartão, e-mail do formulário e devolução por fora). Também em 9/10, **páginas legais do site prontas (M7.4):** o site ganhou as três páginas que a lei pede para vender pela internet — Termos de uso, Política de privacidade e Política de cancelamento —, com links no rodapé de todas as páginas. Você revisa e publica cada uma em Configurações → Páginas legais do site, com prévia, versão datada e histórico; os dados da empresa entram sozinhos (preencha antes o novo campo "encarregado" em Configurações → Empresa). Antes de gerar o Pix, o hóspede lê o resumo da política de cancelamento, vê até que dia tem o reembolso integral daquela reserva e marca que aceita; na ficha da reserva você vê o que ele aceitou. Os textos são um texto-base que eu escrevi a partir da lei: leve ao contador e, de preferência, a um advogado antes de publicar. **Atenção: enquanto as três não estiverem publicadas, o site não oferece o Pix — nem nas prévias da Vercel**, que usam outro banco e precisam ter as três publicadas lá também para o teste do pagamento continuar (seção 2; o que fazer no item 39 da seção 6). Também em 9/10, **sobras de feriado e evento com reserva (M3.10):** quando um feriadão ou evento já tem uma reserva confirmada, as noites livres dele passam a pedir o mínimo normal da semana (1 noite de domingo a quinta, 2 na sexta e no sábado), sem baixar o preço do evento, como você decidiu em 6/10. A regra vem ligada; desligue, evento por evento, em Configurações → Calendário e preços, nas temporadas longas como a alta temporada (seção 2; o que fazer no item 38 da seção 6). Também em 9/10, **pagamento por Pix no site, em teste (M8.2a):** depois de segurar as datas, a página da cotação mostra o Pix (copia e cola, QR e prazo) e confirma a reserva sozinha quando o pagamento é aprovado; no painel, a ficha da reserva ganha o quadro "Pagamento no site", há a lista em Financeiro → Pagamentos do site e a aba Configurações → Pagamento no site, onde você liga e desliga. Tudo roda só nas prévias da Vercel e só com a conta de teste do Mercado Pago: nada é cobrado de verdade (seção 2; o que fazer no item 37 da seção 6). Em 8/10, **página para proprietários pronta (M7.7):** "Anuncie seu imóvel" no site virou uma página completa, no visual do estudo: as duas formas de trabalhar (gestão completa e marketplace), como gerimos, a vitrine dos imóveis, o "Como funciona" publicado e um pedido de contato para a gestão completa, que chega em Proprietários → Pedidos de contato, com aviso no Início do painel e por e-mail; o cadastro do marketplace continua igual. Os textos começam com um texto-base para você revisar em Configurações → Página para proprietários, e os números de mercado só aparecem quando você digitar dados reais (seção 2; o que fazer no item 36 da seção 6). Em 7/10, **a equipe entra sem e-mail (M6.8):** em Limpezas → Profissionais você cria para cada pessoa um usuário e uma senha provisória (o sistema pode criar a senha), copia a mensagem pronta e manda pelo WhatsApp; ela entra em "Entrar com usuário e senha" e troca a senha no acesso dela. Na mesma tela você escolhe a cidade da agenda de cada uma: quem é de Búzios vê só Búzios, quem é do Rio vê só o Rio (seção 2; o que fazer no item 7 da seção 6). Também em 7/10, **site do hóspede no visual do estudo (M7.6):** a página inicial ganhou a foto de capa que você escolher em Configurações → Site (sem foto, fica o fundo verde), a legenda vertical, a vitrine "Seu endereço no Leblon" em carrossel com setas e botão de pausa, cartões com selo e ícones das comodidades, e "Por que reservar direto" com um texto-base para você revisar; a página do imóvel ganhou "O bairro à sua porta" (lugares que você cadastra no painel, com foto opcional); as datas são escolhidas num calendário próprio, com as noites ocupadas marcadas; a consulta ficou em duas colunas com o "Resumo da viagem"; a marca do logotipo aparece no topo e no rodapé (seção 2; o que fazer no item 35 da seção 6). Também em 7/10, **pesos do marketplace no padrão 6/3/3 (M12.5):** quem nunca salvou a aba Marketplace e desconto do site já usa hóspede 1, proprietário 1 e SCL 2 (desconto do site de cerca de 3%); se o que está salvo é o 1/1/1 antigo, a aba avisa e oferece o botão "Usar o padrão novo" (seção 6, item 24). Também em 7/10, **fotos reais dos imóveis prontas (M7.3):** na ficha de cada imóvel, no painel, há a parte **Fotos**: você sobe várias de uma vez (pode ser a original do celular, o sistema reduz antes de subir), escolhe a capa, muda a ordem e escreve a legenda; o site mostra a capa nos cartões e a galeria na página do imóvel, e a capa do relatório mensal usa a mesma foto (seção 2; o que fazer no item 34 da seção 6). Também em 7/10, **Beds24 fora do que o proprietário e o hóspede leem (M5.9, pronto):** o portal passa a falar de "nosso sistema", "os canais" e "sua ferramenta de preços"; o site, quando o preço de uma data ainda não foi lido, diz só que o preço é confirmado na conversa; o painel continua dizendo Beds24 (seção 2). Também em 7/10, **sua segunda rodada de respostas de 7/10 no plano** (seção 7): a equipe entra de vários jeitos (conta Google, e-mail com senha ou usuário e senha criados por você), sem verificação em duas etapas, e cada pessoa vê só a agenda da cidade dela (M6.8 sai de "bloqueado"); no reembolso integral do site, a taxa que o Mercado Pago não devolver fica com a empresa; a posição sobre o arrependimento de 7 dias eu escrevo e você confere com o contador; dois itens novos para o site: o site do hóspede pronto pelas referências do Sage (M7.6) e a página para proprietários (M7.7). Antes, **suas respostas de 7/10 registradas no plano** (seção 7): no marketplace, relatório e extrato mostram só o que passa pela SCL (as reservas do site e o dinheiro que a empresa receber); o Beds24 fica nos bastidores, sem aparecer para proprietário e hóspede (item novo M5.9); contestação perdida fica com quem deu causa ao motivo, decidido caso a caso; cancelamento do site com a base de 14 dias; pesos 6/3/3 confirmados (item novo M12.5); fotos liberadas (M7.3 sai de "bloqueado"); só o Leblon no site público no começo; e-mail não serve para a equipe (item novo M6.8, espera você decidir como a equipe entra); ideia de serviços à parte com valor mensal fixo (item novo M4.14, espera a sua lista). **O que depende de você agora fica na página "Pendências do Diego"** (https://claude.ai/artifact/PVim3wJVrYgsRVvzabUv6K), onde você marca o que fez e pergunta; esta seção 6 continua como referência completa. Você fez em 7/10: início do sistema e acerto por fora, recebimentos de outubro, chaves Pix, "Como funciona" versão 1 publicada e o remetente do e-mail. Antes, em 5/10: **relatório mensal com os ajustes que você pediu (M5.8):** o quadro diz "noites ocupadas", entraram "receita por noite disponível" (o RevPAN do setor) e "reservas e estadia média", e o segundo gráfico é a ocupação por mês com a diária média sobre cada barra — a opção 1, que você escolheu em 5/10 (seção 2); **dia do fechamento passou para o dia 2 (M4.13, sua decisão de 5/10):** o fechamento mensal, o repasse mensal e o e-mail do relatório saem sozinhos no dia 2 do mês seguinte (o Airbnb só paga no dia 1º a reserva com check-in no último dia do mês); dá para mudar de 1 a 5 em Configurações → Repasses, valendo do fechamento do mês atual em diante; no dia 1º você ainda pode fechar e enviar à mão, e o proprietário baixa o PDF no portal a qualquer hora (seção 2; item 33 da seção 6); **relatório mensal no modelo oficial pronto (M5.7):** o PDF do portal, do painel e do e-mail do fechamento saiu em quatro páginas (capa com o resultado e "como chega até você", números e reservas do mês com o gráfico de 12 meses, conciliação e repasses, extratos dos canais no fim), com os ajustes que você pediu (quadros dois a dois, nada com rolagem lateral no celular); **antes do fechamento de outubro, guarde os extratos dos canais em Financeiro → Repasses → "Extratos dos canais"** para irem no e-mail (item 32 da seção 6); os e-mails do fechamento e do repasse ganharam a versão bonita (HTML) na mesma ordem do texto; **documento "Como funciona" para o proprietário pronto (M5.6):** texto por seção em Configurações → Como funciona (proprietário), versão datada a cada publicação, aceite registrado no convite e no portal (quem, quando, qual versão) — **nada aparece no portal até você revisar o rascunho e publicar a versão 1** (seção 6, item 31); **reserva paga antes do início é acertada inteira por fora (M4.12):** o corte do início do sistema passou a ser pela data em que o canal pagou a reserva, não por noite — a reserva de 29/9 a 2/10 paga em 30/9 é toda de antes, com a noite de outubro; a paga a partir de 1/10 entra inteira; Booking, site e direta que atravessam 30/9→1/10 precisam do recebimento registrado **com a data em que o canal pagou** antes da marcação (item 29 da seção 6); Configurações → Regras financeiras ganhou "em quantos dias depois do check-in o canal paga" (Airbnb: 1) — seção 2; **antes do fechamento de outubro (o primeiro no sistema), faça o item 29 da seção 6: defina o início do sistema (1/10/2026) em Configurações → Repasses e clique em "Marcar como acertado por fora" em Financeiro → Repasses (M4.11) — nada de setembro entra de novo e o fechamento sai sem tratamento à mão;** **modelo oficial do relatório mensal especificado (M5.7, a implementar):** o relatório de setembro que a Lia montou com você virou o padrão, no visual novo, com números do mês e os extratos das OTAs no fim — veja o protótipo com dados fictícios e me diga o que mudar (seção 2 e seção 7); **portal do proprietário marketplace pronto (M12.4):** quem tem contrato marketplace edita no portal os preços e as regras de venda do próprio imóvel (com a conta do site ao vivo), vê se a mudança já foi ao Beds24, marca as limpezas como feitas e registra os consertos por conta própria (seção 2); **atenção ao fechamento de outubro — o primeiro no sistema: checklist no item 29 da seção 6 (setembro já acertado por fora não pode entrar de novo);** **extrato e repasses por periodicidade prontos (M4.10):** o proprietário vê no portal a parte dele em cada reserva (a liberar, disponível, repassada), escolhe como quer receber (mensal, quinzenal, semanal, assim que disponível) e pode pedir um repasse; você registra o recebimento do canal na reserva, marca o repasse pago com o comprovante e o e-mail sai sozinho (seção 2); **identidade visual nova implementada (M7.5):** site, portais e painel estão no visual do estudo que você aprovou (verdes, off-white de papel, grão sutil nos fundos, busca translúcida, serifa nos títulos; painel mais denso), com três textos novos da capa editáveis em Configurações → Site (seção 2); **acervo visual do Sage guardado e especificação de design escrita (M7.5):** o visual que você aprovou está em `prototipos/acervo-visual-2026-10` (e o código dele já estava em `prototipos/scl-publico`); os tokens e os ajustes combinados estão em `requisitos/product/DESIGN.md`; falta só implementar; **fonte de preços por imóvel pronta (M3.9):** cada imóvel escolhe, na ficha, se os preços são automáticos do SCL, definidos no Beds24 (o SCL só lê) ou digitados no cadastro; site, envio ao Beds24, prévia e portal seguem a escolha (seção 2); item novo de **identidade visual** (M7.5, aprovado por você); **referência do sistema antigo cruzada com o plano (M0.6):** o museu que você mandou foi percorrido tela a tela e comparado com o que já existe, com uma lista de ideias para você decidir (seção 2 e `arquivo/sistema-antigo`); **desconto do site e simulação do marketplace prontos (M12.1):** nova aba Configurações → Marketplace e desconto do site, com as taxas de referência e os três pesos editáveis e a simulação Airbnb × Booking × site; o site passa a mostrar valor cheio, desconto e total em toda consulta e cotação (seção 2); recebimento do site decidido (M8.0: empresa recebe e repassa, Mercado Pago; repasse na periodicidade que o proprietário escolher, item novo M4.10), modelo do marketplace decidido (B, partes iguais; M12.1 liberado), marketplace recebendo pela empresa como o site, fonte de preços por imóvel no plano (M3.9), backup do repositório ativado por você (M0.7), publicação de homologação dada por fechada por você (M0.5), pedido do checkout com Pix e cartão registrado (M8.2, com parcelamento pago pelo hóspede) e decisão de não cobrar nada sobre as reservas das OTAs do dono do marketplace; correção do robô de backup depois da sua primeira rodada (ele passa a gravar com uma chave da própria conta de backup e guarda o que vem da origem fora de branches e tags, onde nenhuma automação roda; item 23, passos 4, 5 e 7) e passo a passo mais detalhado (passos 5 e 7); conferência automática de cada PR mais rápida (M0.8); backup automático do repositório ativo na conta separada (M0.7, seção 6, item 23) e backup do banco no Neon ampliado (7 dias de histórico, snapshots diário e semanal); cotação e "segurar as datas" no site (M8.1), proprietário bloqueia datas de uso próprio pelo portal (M5.5), disponibilidade e valor reais no site (M7.2) e envio de calendário e preços ao Beds24 (M3.7) pronto para o teste no 103. **Nada é enviado** enquanto você não ligar `BEDS24_ESCRITA` na Vercel e marcar o imóvel em Configurações → Calendário e preços. A conferência das reservas é parcial; agosto/setembro podem ter histórico incompleto na origem.

---

## 1. Resumo em 30 segundos

- **O que é:** o novo sistema de gestão da Sua Casa Leblon (painel interno, financeiro,
  portal do proprietário, portal do hóspede, site com reserva direta e integrações com
  Beds24, Mercado Pago e WhatsApp).
- **Onde está:** tudo neste repositório do GitHub, `al-life/scl-reconstrucao`.
- **Quem constrói:** o Claude, por meio de uma rotina automática a cada 3 horas e das
  conversas com você.
- **Quem decide:** você. Desde 9/10, Claude e Codex podem fazer o merge do trabalho autorizado
  depois de todas as checagens e da revisão automática do Codex no GitHub concluídas, no
  commit mais recente e sem apontamentos pendentes. Sem limite de rodadas de revisão: os
  agentes corrigem e conferem quantas vezes forem necessárias, e te avisam com um resumo
  curto do que mudou. Você pode revogar essa autorização quando quiser.
- **Está em uso?** **Não.** Só vai ser usado "para valer" quando tudo estiver pronto
  (marco M11).

---

## 2. Onde estamos

| Etapa | O que entrega | Situação |
|---|---|---|
| M0 Fundação | Base do app, banco de dados, layout, publicação na Vercel, backup | 🟡 Vercel e login funcionando; banco de homologação separado conferido em 3/10; backup automático do repositório **ativo desde 4/10** em conta separada (M0.7, seção 6, item 23); conferência automática dos PRs mais rápida (M0.8); M0.5 fechado por você em 4/10; referência do sistema antigo cruzada com o plano em 4/10 (M0.6). **M0 concluído** |
| M1 Acesso | Login (Google/código por e-mail), convites, permissões | ✅ pronto |
| M2 Cadastros | Imóveis, proprietários, contratos e aba Anúncios | ✅ implementado; referências dos canais precisam ser preenchidas/conferidas |
| M3 Reservas | Reservas, calendário central, importação e envio de calendário/preços ao Beds24 | 🟡 importação e envio implementados; o envio começa desligado e espera o seu teste no 103; conferência das reservas parcial; fonte de preços por imóvel escolhida na ficha de cada imóvel (M3.9) pronta; sobras de feriado e evento com reserva usam o mínimo normal da semana (M3.10, 9/10) |
| M4 Financeiro | Lançamentos, comissões, despesas, dashboard, aba Apartamentos | 🟡 em andamento; extrato e repasses por periodicidade prontos (M4.10); início do sistema e acerto por fora do que é de antes (M4.11); conciliação do extrato bancário (M4.4b) e Pix automático dependem do banco/Mercado Pago; reserva paga antes do início acertada inteira por fora, pela data em que o canal pagou (M4.12); dia do fechamento no dia 2, editável de 1 a 5 (M4.13, 5/10) |
| M5 Portal do proprietário | Relatórios, saldos, PDF, bloqueio de uso próprio | 🟡 relatórios, PDF, e-mail do fechamento e bloqueio de datas prontos; documento "como funciona" para o proprietário pronto e com a versão 1 publicada por você em 7/10 (M5.6); relatório mensal no modelo oficial pronto (M5.7), com os extratos dos canais guardados por mês para o e-mail; ajustes de 5/10 no relatório prontos (M5.8: noites ocupadas, receita por noite disponível, estadia média, gráfico de ocupação); Beds24 fora dos textos do portal e do site (M5.9, 7/10) pronto |
| M6 Operação | Limpezas, manutenção, agenda diária | 🟡 em andamento; a equipe entra sem e-mail e vê só a agenda da cidade dela (M6.8, 7/10); aviso pelo WhatsApp depende do M10 |
| M7 Site público | Site novo com disponibilidade e valor reais | 🟡 disponibilidade e valor prontos; visual novo do site, dos portais e do painel pronto (M7.5, 4/10); páginas legais prontas (M7.4, 9/10): você revisa e publica; fotos reais prontas (M7.3, 7/10: você sobe na ficha do imóvel); site do hóspede no visual do estudo pronto (M7.6, 7/10); página para proprietários pronta (M7.7, 8/10) |
| M8 Reserva direta | Cotação, datas seguradas e pagamento pelo Mercado Pago | 🟡 cotação e "segurar as datas" prontos; recebimento decidido em 4/10 (empresa recebe e repassa); pagamento dividido em cinco partes (8/10): **Pix em teste pronto (M8.2a)**, testado nas prévias com as suas chaves de teste; **cartão em teste pronto (M8.2b, 9/10)**, desligado até você ligar; **cancelamento de reserva paga pelo site em teste pronto (M8.2c, 10/10)**, pela política que o hóspede aceitou; **alteração de reserva paga pelo site em teste pronta (M8.2d, 10/10)**, antes da entrada, com a diferença paga pelo site ou devolvida pela política, e a devolução de parte do valor; contestação a seguir |
| M9 Portal do hóspede | Acesso do hóspede e mensagens automáticas | ✅ pronto; desde 10/10, o hóspede pede o cancelamento da reserva paga pelo site em Minha reserva, e há três mensagens novas do cancelamento (M8.2c); também em 10/10, Minha reserva avisa a alteração que espera o hóspede, e há duas mensagens novas da alteração (M8.2d) |
| M10 WhatsApp | Caixa de entrada do WhatsApp no painel | ⚪ aguardando |
| M11 Produção | Dados reais, domínio, entrada em uso | ⚪ aguardando |
| M12 Marketplace | Proprietário que opera o próprio imóvel; SCL cuida do online | 🟡 portal do proprietário marketplace pronto (M12.4, 4/10); cadastro pelo site pronto; modelo de cobrança (B, partes iguais) com pesos editáveis, simulação e desconto único do site prontos (M12.1); cálculo e repasse no financeiro (M12.2) dependem do pagamento (M8.2) e do extrato (M4.10); pesos 6/3/3 no padrão do sistema (M12.5, 7/10) |

### Alteração de reserva paga pelo site, em teste — M8.2d (10/10)

Esta é a quarta das cinco partes do pagamento pelo site: **mudar uma reserva que o hóspede já pagou pelo site** —
as datas, o número de pessoas ou o valor — e cobrar ou devolver a diferença. Junto, ficou pronto o que faltava das
devoluções: **devolver só uma parte do valor**. Como o Pix, o cartão e o cancelamento, está em **modo de teste**: só
nas prévias da Vercel e com a conta de teste do Mercado Pago (item 44 da seção 6).

- **Quem faz:** quem cuida do financeiro (hoje, só você). Na ficha da reserva paga pelo site, dentro do quadro
  "Pagamento no site", fica o bloco **Alteração da reserva**. Quem é da operação vê "a alteração é feita por quem
  cuida do financeiro" e as datas seguradas, sem valores. O hóspede não pede a alteração pelo site: ele pede pelo
  WhatsApp ou pelo e-mail, e a equipe prepara.
- **Só antes da entrada:** a alteração vale até o horário de entrada (a nova entrada pode ser hoje, mas só antes do
  horário de entrada). Depois que a estadia começa, nada muda pelo sistema: mais noites viram uma reserva nova (no
  painel, com o pagamento registrado, ou pelo site); sair antes não tem devolução e a reserva fica como está (as
  noites continuam ocupadas e a limpeza de saída fica na data original). Acrescentar noites antes e depois ao mesmo
  tempo se faz em duas alterações; trocar de apartamento é cancelar e reservar de novo.
- **Em dois passos:** primeiro **"Calcular a alteração"**: as novas datas e o número de pessoas; quem pede ("O
  hóspede pediu" ou "A SCL propõe" — apartamento sem condições, força maior ou outro); o valor ("Pela cotação do site
  (preços de hoje)", "Manter o valor atual" ou "Outro valor", os dois últimos com o motivo e uma nota); e, se o
  hóspede pediu, quando e por onde o pedido chegou. A prévia mostra hoje e depois, a diferença, a política que o
  hóspede aceitou, como a devolução sai, o financeiro antes e depois (valor, taxa, comissão e parte do proprietário,
  mês a mês), as noites novas seguradas e os avisos, com o botão "Copiar a proposta para o hóspede". Depois, o botão
  do caso, sempre com uma pergunta de confirmação que repete tudo:
  - **o valor sobe:** "Segurar as novas datas e liberar o pagamento da diferença". Você manda a proposta ao hóspede;
    ele paga a diferença por Pix ou cartão na página da reserva, e a alteração vale sozinha quando o pagamento é
    aprovado. Até lá, a reserva continua como está;
  - **o valor desce ou fica igual:** "Aplicar a alteração", quando o hóspede já aceitou por escrito (a pergunta
    começa por "Confirme que o hóspede aceitou por escrito"). Se ele ainda vai decidir, use "Só segurar as datas (o
    hóspede ainda decide)" e, quando ele aceitar, "Conferir para aplicar (o hóspede aceitou)" e "Aplicar a
    alteração".

  Se algo mudar entre a prévia e o clique (o pagamento, a leitura do Mercado Pago, a agenda), o sistema pede para
  calcular de novo. Uma alteração aplicada não se desfaz por aqui.
- **As noites novas ficam seguradas** por 60 minutos (você muda em Configurações → Calendário e preços, de 5 minutos a
  48 horas; não muda o tempo do visitante do site). O Pix da diferença estende esse prazo, mas nunca além do horário
  de entrada. Se o prazo passar sem pagamento e sem você aplicar, a alteração deixa de valer e as noites voltam à
  venda. Você também pode **"Desistir da alteração"**, com o motivo; o Pix da diferença ainda não pago é cancelado.
- **O valor novo:** pela cotação, é o preço de hoje da estadia inteira nova, não só das noites a mais. Quando **a SCL
  propõe** a alteração (o apartamento teve um problema, por exemplo), o formulário começa em "Manter o valor atual":
  o hóspede não paga pelo problema da SCL, e cobrar a mais pede que você escolha e confirme. Se a cotação der menos
  noites com valor maior (ou o contrário), a prévia avisa.
- **Quando o valor desce, a diferença segue a Política de cancelamento que o hóspede aceitou**, como se fosse o
  cancelamento daquela parte naquele momento: pedido dentro do prazo do reembolso integral (ou nos 7 dias do
  arrependimento) → a diferença volta; fora do prazo → a diferença fica, o valor da reserva continua o mesmo e é
  dividido como uma reserva normal, e as noites liberadas voltam à venda. Os prazos contam da **entrada original ou
  da nova, a que vier primeiro** (decisão sua, seção 7). Você pode devolver por exceção (com o motivo e uma nota); e,
  quando a SCL propõe, a diferença sempre volta.
- **A ordem é sempre a mesma:** primeiro a alteração vale (as novas datas e o valor novo na reserva), depois a
  devolução é pedida. Nunca há devolução sem alteração.
- **A devolução de parte do valor espera o Mercado Pago liberar o pagamento.** Só depois disso (e com a taxa dele
  conhecida) o sistema pede a devolução. Até lá, a ficha mostra "aguardando a liberação do pagamento (prevista para
  dd/mm)" e o hóspede vê que ela "será pedida quando o Mercado Pago liberar o seu pagamento", nunca "já pedimos". Se a
  liberação atrasar, o Início avisa. **No teste, o Mercado Pago nunca avisa a liberação: registre a liberação à mão no
  quadro do pagamento** para a devolução sair. Uma nova alteração da mesma reserva espera essa devolução sair.
- **O dinheiro, em exemplos** (Pix, com a taxa do Mercado Pago de 0,99% e comissão de 15%, como no exemplo do
  cancelamento):
  - **Uma noite a mais (o valor sobe):** reserva de 10/11 a 14/11 por R$ 1.500. O hóspede pede para sair em 15/11;
    pela cotação de hoje, a estadia nova custa R$ 1.900, então a diferença é de R$ 400. O sistema segura a noite de
    14 para 15/11, e o hóspede paga os R$ 400 por Pix (o Mercado Pago fica com R$ 3,96). Quando o pagamento é
    aprovado, a reserva passa a R$ 1.900: a comissão da SCL sobe R$ 59,41 e a parte do proprietário sobe R$ 336,63.
    A parte do proprietário só fica disponível depois do check-in e da liberação do pagamento da diferença pelo
    Mercado Pago.
  - **Uma noite a menos, no prazo (a diferença volta):** reserva de 28/11 a 03/12 (5 noites) por R$ 1.500. Em 01/11,
    o hóspede pede para ir de 05/12 a 09/12 (4 noites), e a cotação dá R$ 1.200. O prazo do reembolso integral conta
    de 28/11 e vai até 14/11: os R$ 300 da diferença voltam. A parte da taxa do Mercado Pago que corresponde à
    devolução (R$ 2,97) sai da reserva, que fica com taxa de R$ 11,88; a SCL fica com R$ 178,22 de comissão e o
    proprietário com R$ 1.009,90, tudo em dezembro (novembro sai do financeiro). Quando o Mercado Pago confirma a
    devolução, saem do caixa R$ 297,03; se a taxa dessa parte não voltar, você informa os R$ 2,97 em "Registrar taxa
    que não voltou", eles viram despesa da empresa, e a SCL fica no fim com R$ 175,25.
  - **A mesma mudança fora do prazo (a diferença fica):** pedida em 20/11 (depois de 14/11 e passados os 7 dias do
    arrependimento), a diferença não volta: a reserva continua valendo R$ 1.500 nas datas de dezembro, dividida como
    uma reserva normal, e as noites de 28/11 a 03/12 voltam à venda.
  - **Adiantar e depois cancelar:** reserva para 15/01. Em 20/11, o hóspede adianta para 28/11 a 03/12, pelo mesmo
    valor. Em 01/12, já hospedado, pede para cancelar. Como os prazos contam da entrada que vier primeiro (28/11), o
    prazo do integral acabou em 14/11 e a estadia já começou: sem devolução. Se contasse só da entrada original
    (15/01), ele teria devolução integral no meio da estadia; por isso o ajuste.
  - **Redução no cartão e depois cancelamento:** o pagamento no cartão ainda não foi liberado pelo Mercado Pago; uma
    redução de R$ 300 é aplicada e a devolução fica esperando a liberação. Antes disso, o hóspede cancela dentro do
    prazo: a devolução de R$ 300, que nunca chegou ao Mercado Pago, entra no cancelamento ("substituída pela
    devolução do cancelamento"), e o hóspede recebe o valor inteiro de volta de uma vez, na hora, como num
    cancelamento normal.
- **O financeiro é refeito sozinho**, antes da entrada: os lançamentos de antes saem (cada um no próprio mês, com a
  referência da alteração) e os novos entram; a ficha mostra o antes, o depois e a diferença de cada item, mês a mês.
  Como antes da entrada nada foi repassado, nenhum mês fechado muda. O plano falava em lançar só "a diferença" de
  cada item; o resultado é o mesmo, e os lançamentos de diferença separados ficam para uma alteração depois da
  entrada, que ainda não existe (decisão sua, seção 7).
- **Cancelar depois de alterar:** vale a mesma política, contando da mesma entrada; o hóspede recebe de volta o que
  pagou (a reserva e a diferença, uma devolução de cada pagamento), menos o que já voltou numa redução. Se houver uma
  alteração com as datas seguradas, o cancelamento desiste dela (ou pede para esperar, se o pagamento da diferença
  estiver em andamento).
- **Devolver só uma parte do valor (o que faltava desde o Pix e o cancelamento):**
  - um pagamento pode ter **mais de uma devolução**, uma de cada vez; o quadro do pagamento mostra uma linha por
    devolução, cada uma com as ações dela;
  - **o Mercado Pago devolveu menos do que o pedido:** o que voltou entra no financeiro, e você escolhe **"Pedir o
    restante ao Mercado Pago"** ou **"Registrar o restante devolvido por fora"** (no cartão, só quando a regra do
    cartão deixa: o botão só aparece quando funciona);
  - **um pagamento sem reserva que chegou já devolvido em parte** ganha **"Devolver o restante ao hóspede"**; se o
    Mercado Pago não disser quanto já devolveu, o sistema pede o valor que aparece no painel dele;
  - **a devolução por fora** registra exatamente o que aquela devolução ainda deve, e só se ela nunca foi pedida ao
    Mercado Pago (ou foi recusada sem dúvida), para o hóspede não receber duas vezes;
  - uma reserva confirmada com parte devolvida no painel do Mercado Pago pode ser cancelada pela política (devolve o
    restante), informando o valor que aparece lá quando ele não diz. Se a reserva tem mais de um pagamento (a
    diferença de um aumento, por exemplo), o sistema pede o valor de cada um, com um campo para cada pagamento.
- **O que o hóspede vê:** na página da reserva, a alteração preparada (com o pagamento da diferença, quando o valor
  sobe), a alteração confirmada com a devolução (esperando a liberação, pedida ou feita), "A alteração não pôde ser
  feita" (a diferença foi paga, mas as novas datas não puderam ser seguradas: o valor volta) e "Alteração que não vale
  mais". No pagamento da diferença, a caixa de aceite diz que a reserva continua na Política de cancelamento que ele
  aceitou. Em Minha reserva, uma linha avisa a alteração esperando o pagamento ou a confirmação dele, sem valores.
  Quando a devolução sai de mais de um pagamento (a reserva no Pix e a diferença no cartão, por exemplo) ou uma parte
  foi devolvida por fora, a página explica cada caminho, e o cancelamento faz igual. Nunca o nome do Beds24 nem
  dados pessoais. As frases você edita em Configurações → Textos do site.
- **Avise o hóspede:** duas mensagens novas — a proposta (com as datas, o valor e até quando as datas ficam
  seguradas) e a alteração confirmada — e "Devolução feita", que agora serve ao cancelamento e à alteração. Enquanto as
  mensagens automáticas estiverem desligadas, a ficha mostra cada uma pronta para copiar, com "Mensagem enviada ao
  hóspede". Só quem vê o financeiro copia (elas levam valores). Depois de uma alteração, a mensagem de confirmação da
  reserva não sai de novo. Se a reserva for cancelada sem devolução depois de uma redução, a devolução da diferença
  continua, e o "Devolução feita" dela ainda sai quando o dinheiro voltar (a confirmação da alteração, não).
- **OTAs:** nada é escrito no Beds24. Quando uma alteração muda as datas, o Início avisa "mude o bloqueio nas OTAs (no
  Beds24, feche as novas datas e reabra as antigas)" e, depois de mudar, você marca **"Datas atualizadas nas OTAs"** na
  ficha. O aviso aparece mesmo com o envio ao Beds24 ligado, porque o envio manda só os bloqueios que você cria no
  SCL e nunca mexe nas datas das reservas (isso fica para o M8.3). Mudar só o número de pessoas ou o valor não mexe
  no bloqueio.
- **No Início:** as alterações com as datas seguradas (até que horas e esperando o quê), o bloqueio a mudar nas OTAs,
  as mensagens a mandar, as devoluções de parte esperando a liberação (e as atrasadas), as devoluções feitas a menos e
  o pagamento da diferença aprovado sem a alteração (para devolver).
- **Notas sem dados pessoais:** como no cancelamento, toda nota da alteração é recusada se tiver CPF, e-mail,
  telefone, chave Pix ou número de cartão; as observações da reserva ganham só as datas e as pessoas, nunca valores.
- **O que ainda não faz:** alterar depois da entrada; transformar depois em devolução por exceção um cancelamento
  que ficou sem devolução (continua por fora mais um ajuste); o hóspede pedir a alteração pelo site; contestação
  (M8.2e); e-mail automático enquanto as mensagens estiverem desligadas.

### Cancelamento de reserva paga pelo site, em teste — M8.2c (10/10)

Esta é a terceira das cinco partes do pagamento pelo site: **cancelar uma reserva que o hóspede pagou pelo
site, com a devolução pela Política de cancelamento que ele aceitou ao pagar**. Como o Pix e o cartão, está em
**modo de teste**: só nas prévias da Vercel e com a conta de teste do Mercado Pago (item 41 da seção 6).

- **Quem faz:** quem cuida do financeiro (hoje, só você). Na ficha de uma reserva paga pelo site, o botão
  "Cancelar reserva" de sempre some: o cancelamento fica dentro do quadro "Pagamento no site", em
  **Cancelamento pela política**. Quem é da operação vê "o cancelamento com devolução é feito por quem cuida
  do financeiro" e pode registrar um pedido do hóspede que chegou pelo WhatsApp, e-mail, telefone ou
  pessoalmente (dar mais que isso à operação é uma decisão sua, seção 7).
- **Em dois passos:** primeiro **"Calcular o cancelamento pela política"**: você diz quem cancela ("O hóspede
  pediu", "A SCL cancela" — apartamento sem condições ou força maior — ou "Não comparecimento") e, se o
  hóspede pediu por outro canal, quando o pedido chegou e por onde. O sistema confere o pagamento no Mercado
  Pago e mostra a prévia: a versão da política que o hóspede aceitou, o resultado (devolução integral ou
  nada) e por quê, a parte do proprietário, a comissão, a taxa, quanto já foi repassado ao proprietário, como a
  devolução vai sair e os avisos. Depois, **"Cancelar a reserva"**, com uma pergunta de confirmação que repete o
  valor, o motivo, como a devolução sai e, quando for o caso, quanto o proprietário deixa de receber. Não dá
  para desfazer. Se algo mudar entre a prévia e o clique (o pagamento, um pedido, um repasse), o sistema pede
  para calcular de novo.
- **A regra é a da política que o hóspede aceitou, no momento em que recebemos o pedido:**
  - pedido até as 23h59 do último dia do prazo (14 dias antes da entrada, na versão 1): devolução integral;
  - arrependimento: até 7 dias depois do pagamento, devolução integral mesmo com menos de 14 dias, mas só
    até o horário de entrada;
  - a SCL cancela: devolução integral, sempre;
  - não comparecimento (o hóspede não chegou e não avisou): sem devolução, e só depois de 21 horas do horário
    de entrada (com entrada às 15:00, a partir das 12:00 do dia seguinte; você muda as horas em Configurações
    → Pagamento no site). Se o hóspede já tiver um pedido de cancelamento registrado, não vale como não
    comparecimento: vale o pedido;
  - pedido depois desses prazos: sem devolução;
  - pedido que chega depois de a estadia começar, sem direito a devolução: o sistema não cancela, porque sair
    antes não é cancelar (as noites não usadas não voltam, como diz a política). A reserva continua como está.
- **O que a equipe decide, e o que não:** quando a política não dá devolução, você pode **devolver tudo por
  exceção**, escolhendo o motivo (erro da SCL, força maior, cortesia, saúde ou família, outro) e escrevendo uma
  nota. Num pagamento de antes de 9/10, que não tem a política aceita, você escolhe "Devolver tudo" ou "Não
  devolver", com o motivo (se for a SCL que cancela, é sempre tudo). Quando a política dá devolução integral,
  ninguém troca por "nada".
- **O momento que vale é o do pedido.** Pelo site (Minha reserva), é a hora do sistema, e ninguém muda. Pedido
  por outro canal: registre na ficha ("Registrar pedido de cancelamento") assim que ele chegar, com a data e a
  hora da mensagem; quem cuida do financeiro pode corrigir esse horário depois, escrevendo o motivo (fica
  registrado). Com o pedido registrado, a demora da equipe nunca tira o direito do hóspede, nem depois da data de
  saída. Se o hóspede desistir, use "Descartar pedido", com o motivo (o pedido feito pelo site só quem cuida do
  financeiro descarta, como desistência do hóspede). Nada é apagado: os pedidos descartados continuam na ficha.
- **A devolução:** é pedida ao Mercado Pago na hora, e a ficha mostra "devolução pedida" até ele confirmar (no
  teste, use **Conferir agora**). Se o Mercado Pago pedir para esperar, o sistema espera e tenta de novo, sem
  contar como falha; se ele recusar, a ficha explica o motivo (por exemplo, falta de saldo na conta). Pagamento
  com **mais de 78 dias**: o sistema não pede mais ao Mercado Pago, porque não daria tempo de conferir. No cartão,
  você devolve pelo painel do Mercado Pago e confirma na ficha ("Confirmar devolução feita no painel do Mercado
  Pago"); no Pix, faz a devolução por fora, da conta da empresa. Se o painel do Mercado Pago recusar a devolução,
  registre isso na ficha, e a devolução por fora fica liberada. Uma devolução pedida que ficou sem resposta
  depois de 85 dias pode ser parada ("Parar a devolução pedida").
- **O dinheiro, num exemplo.** Uma reserva de R$ 1.500 paga por Pix: o Mercado Pago fica com R$ 14,85 de taxa e
  entram R$ 1.485,15; com comissão de 15%, a SCL fica com R$ 222,77 e o proprietário com R$ 1.262,38.
  - **Cancelada no prazo (devolução integral):** o hóspede recebe R$ 1.500 de volta. A reserva, a comissão e a
    parte do proprietário saem do financeiro na hora. Quando o Mercado Pago confirma, sai do caixa o que tinha
    entrado (R$ 1.485,15); se a taxa não voltar, você informa os R$ 14,85 em "Registrar taxa que não voltou" e
    eles viram despesa da empresa. No fim, a SCL perde R$ 14,85 e o proprietário fica com zero.
  - **Cancelada fora do prazo (sem devolução):** os R$ 1.500 ficam e são divididos como uma reserva normal: o
    proprietário recebe R$ 1.262,38, disponível depois da data de entrada original e da liberação do Mercado
    Pago, e a SCL fica com R$ 222,77.
  - **A SCL cancela em 2/11 uma estadia de outubro a novembro, e a parte de outubro (R$ 631,19) já foi paga ao
    proprietário:** o hóspede recebe tudo de volta. Outubro fica exatamente como foi enviado ao proprietário; em
    novembro aparece "Reserva … cancelada com devolução ao hóspede: −R$ 631,19", que sai do próximo repasse
    dele, seja ele qual for. Se as partes dele não cobrirem, o repasse antecipado espera e o fechamento mostra
    que ele está devendo, sem pedir transferência. Novembro, que ainda não tinha sido pago, só sai do
    financeiro. A prévia avisa que o proprietário deixa de receber a parte dele (R$ 1.262,38), que teria se não
    houvesse devolução: quem arca nesse caso é decisão sua (seção 7).
  - Se a parte do proprietário estiver num repasse que ainda não foi pago, o sistema pede para estornar esse
    repasse antes de cancelar (ou para marcá-lo como pago, se já pagou de fato). E um repasse cuja parte já foi
    descontada por um cancelamento não pode mais ser estornado (corrija com um ajuste).
- **Devolvido direto no painel do Mercado Pago:** se alguém devolver pelo painel do Mercado Pago sem passar pelo
  sistema, a reserva fica em conferência: a parte do proprietário não é repassada e o fechamento dele espera, até
  você cancelar pela política ou registrar um ajuste e dar a conferência por resolvida. O Início avisa.
- **O que o hóspede vê:** na página da reserva, "Reserva cancelada", com a data e a hora em que recebemos o pedido,
  a decisão (por exemplo, "Pela Política de cancelamento que você aceitou (versão 1), devolvemos o valor integral
  pago, R$ 1.500,00, sem desconto de taxas."), se a devolução foi pedida ou feita e como o dinheiro volta. Sem
  devolução, ele vê os prazos da política e o motivo. Nunca o nome do Beds24 nem dados pessoais. As frases você
  edita em **Configurações → Textos do site**.
- **Minha reserva:** o hóspede vê o quadro "Cancelar a reserva", com os prazos da política dele e o botão
  **"Pedir o cancelamento"** (só antes do horário de entrada, com confirmação, sem valores). Ele só pede: a data
  e a hora ficam registradas na hora e aparecem na tela, a empresa recebe um e-mail (só com o código da reserva,
  o apartamento e a hora) e o pedido aparece no Início. Você desliga o botão em Configurações → Pagamento no site.
- **Avise o hóspede:** são três mensagens novas — pedido recebido, decisão e devolução feita. Enquanto as
  mensagens automáticas estiverem desligadas, a ficha mostra cada uma pronta para copiar (para o WhatsApp ou o
  e-mail) e o botão "Mensagem enviada ao hóspede". A de pedido recebido a operação também copia (ela não tem
  valor); as outras duas, só quem vê o financeiro. Quando você ligar as mensagens ao hóspede e escolher um
  modelo para cada uma, elas saem sozinhas por e-mail.
- **OTAs:** as datas voltam à venda no site na hora. O Início avisa "reabra as datas nas OTAs (no Beds24,
  apague o bloqueio)" e, depois de reabrir, você marca "Datas reabertas nas OTAs" na ficha. Nada é escrito no
  Beds24 por esta parte. **Mudança de 10/10:** antes, esse aviso sumia com o envio automático ao Beds24 ligado;
  agora ele aparece sempre, até o M8.3, porque o envio manda só os bloqueios que você cria no SCL e nunca reabre
  as datas de uma reserva. O mesmo vale para os avisos de reserva paga e de reserva alterada.
- **No Início:** os pedidos de cancelamento esperando (com a data do pedido e da entrada; ficam em destaque
  depois de 24 horas ou a 3 dias da entrada), as datas a reabrir nas OTAs, as mensagens a mandar ao hóspede, as
  devoluções que o Mercado Pago fez a menos, as reservas devolvidas fora do sistema e o desconto de proprietário
  esperando há mais de 7 dias. Na lista de reservas, o filtro "Pedido de cancelamento → Só com pedido esperando a
  equipe".
- **Notas sem dados pessoais:** qualquer nota (onde está o pedido, motivo da exceção, devolução por fora…) é
  recusada se tiver CPF, e-mail, telefone, chave Pix ou número de cartão.
- **O que ainda não faz:** devolver só uma parte do valor (vai para o M8.2d, junto com a alteração de reserva
  paga); cancelar pela política um pagamento que o Mercado Pago mostra devolvido em parte, contestado ou com
  devolução em andamento (o sistema espera isso se resolver); desfazer um cancelamento; contestação (M8.2e);
  e-mail automático ao hóspede enquanto as mensagens estiverem desligadas. **Desde 10/10 (M8.2d, acima):** a
  devolução de parte do valor ficou pronta, e o pagamento devolvido em parte no painel do Mercado Pago já se cancela
  pela política (devolve o restante); contestado ou com devolução em andamento, continua esperando.

### Pagamento com cartão no site, em teste — M8.2b (9/10)

Esta é a segunda das cinco partes do pagamento pelo site: o **cartão de crédito**, também em **modo
de teste** (sem dinheiro de verdade), só nas prévias da Vercel e só com a conta de teste do Mercado
Pago. Ele vem **desligado**: você liga quando quiser testar (item 40 da seção 6).

- **Para o hóspede:** depois de segurar as datas, o quadro "Pagamento" mostra a escolha **Pix
  (recomendado)**, já marcado e em destaque, ou **Cartão de crédito**. No cartão, ele marca primeiro o
  aceite das páginas legais; só então aparece o formulário do Mercado Pago, com a marca do Mercado Pago
  e as bandeiras aceitas. O número do cartão é digitado no formulário do Mercado Pago e nunca passa pelo
  nosso sistema. Só cartão de crédito: débito e pré-pago não são aceitos. Aprovado, a página confirma a
  reserva sozinha, como no Pix. Quem já estava com um Pix na tela pode trocar ("Prefere pagar com
  cartão?"): o sistema cancela o Pix no Mercado Pago antes, para ninguém pagar duas vezes.
- **Parcelas e juros:** o hóspede paga os juros do parcelamento, como você decidiu em 4/10. A página
  avisa: "No cartão parcelado há juros do Mercado Pago, pagos por você; o total aparece no formulário
  antes de confirmar." A reserva, a taxa e a parte do proprietário são calculadas sobre o valor da
  reserva, sem os juros, que ficam com o Mercado Pago. O máximo de parcelas você escolhe no painel
  (vazio = o máximo que o Mercado Pago permitir). Se um dia o Mercado Pago cobrar da empresa o custo das
  parcelas (o "parcelamento sem acréscimo" ligado na conta), o sistema avisa e não lança a taxa sozinho,
  para esse custo não sair da parte do proprietário sem você decidir.
- **Verificação do banco:** às vezes o banco pede que o hóspede confirme a compra (no app do banco ou com
  um código). Isso aparece num quadro do Mercado Pago na própria página, e as datas ficam seguradas por
  até 42 minutos enquanto isso. Se a verificação não for concluída, a página diz só isso e oferece outro
  cartão ou o Pix. No painel você escolhe quando o banco pede a verificação: **"quando houver risco"**
  (recomendado, já vem assim) ou **"nunca"**. A diferença é quem arca quando alguém contesta uma compra
  dizendo que o cartão foi roubado (decisão na seção 7).
- **Cartão em análise:** às vezes o Mercado Pago analisa o pagamento antes de aprovar (pode levar até 2
  dias úteis). As datas ficam seguradas por mais um tempo, uma vez por cotação: 60 minutos, ou o que você
  escolher em **Configurações → Calendário e preços**. Enquanto a análise não termina, a cotação não
  aceita outro pagamento (o Mercado Pago não deixa cancelar um cartão em análise) e o mesmo e-mail não
  segura outras datas (até 5 dias, ou até o Mercado Pago decidir). Se a análise aprovar depois do prazo
  das datas, a reserva confirma se as noites ainda estiverem livres; senão, o pagamento fica para devolver,
  como no Pix. Se o mesmo e-mail já tiver outra reserva confirmada pelo site, o painel avisa que o
  hóspede pode ter pago duas vezes. O texto que o hóspede lê nessa situação você edita em
  **Configurações → Site**.
- **Recusa:** o hóspede vê sempre a mesma mensagem, qualquer que seja o motivo: "Não foi possível aprovar
  o pagamento com este cartão. Confira os dados, use outro cartão ou pague com Pix." É de propósito: quem
  testa cartões roubados usa o motivo como pista. O motivo aparece na ficha da reserva só para quem vê o
  financeiro, com o lembrete de não contar ao hóspede.
- **Freios contra teste de cartão roubado:** até 3 tentativas de cartão por cotação, 5 por hora por
  endereço de internet e 30 por hora na empresa toda. Com 8 recusas em meia hora, o cartão desliga sozinho
  por 1 hora; na terceira vez no mesmo dia, ou com 20 recusas no dia, ele só volta quando alguém clicar
  **Religar o cartão**. O Pix nunca desliga. O Início avisa quando o cartão desligou, quando o dia passa
  de 10 recusas e quando várias recusas seguidas parecem ser chave do Mercado Pago trocada.
- **No painel:** em **Configurações → Pagamento no site**, as opções **Oferecer cartão de crédito** (vem
  desligada), **Número máximo de parcelas** e **Verificação do banco (3DS)**, e o quadro **Cartão**, com a
  situação do freio, as recusas do dia, os últimos desligamentos, os limites e o botão **Religar o cartão**
  (com confirmação, só para quem edita o financeiro). Na **ficha da reserva**, o quadro "Pagamento no
  site" mostra, por exemplo, "Cartão de crédito · Visa · 3x" e os números do pagamento no Mercado Pago,
  com botão de copiar, para você achar o pagamento lá. Só quem vê o financeiro vê o motivo de uma recusa,
  o resultado da verificação do banco e os juros que o hóspede pagou. O número do cartão não aparece em
  lugar nenhum.
- **O dinheiro:** a taxa do cartão (cerca de 4% a 5%, conforme o prazo de liberação da conta) entra na
  reserva como a do Pix. O Mercado Pago libera o dinheiro do cartão conforme o plano da conta (na hora, em
  14 ou em 30 dias); como você decidiu, a parte do proprietário só fica disponível depois do check-in
  **e** da liberação, e a empresa não adianta. Se o Mercado Pago liberar parcela por parcela, o sistema
  avisa e você registra a liberação à mão.
  **Conferência de 10/10:** os três prazos foram comparados com provedor e banco fictícios. Mesmo
  depois da data prevista, sem a confirmação do dinheiro liberado não há recebimento nem parte
  disponível para repasse. Leituras repetidas registram um único recebimento; a liberação imediata
  continua esperando o check-in. Os valores do teste não são uma tabela de taxas comerciais.
- **Devolução:** devolva pela ficha da reserva (**Devolver pelo Mercado Pago**). No cartão, **Registrar
  devolução feita por fora** só é aceito quando o Mercado Pago não conseguiu devolver ou o pagamento tem
  mais de 180 dias: senão a cobrança continuaria no cartão e o hóspede poderia contestar e receber duas
  vezes (decisão na seção 7). Desde 10/10 (M8.2c), "não conseguiu" ficou mais estrito: uma recusa
  definitiva do Mercado Pago, a recusa que você registra depois de ver no painel dele ("Registrar que o
  Mercado Pago recusou a devolução no painel") ou a nossa devolução que ele mostra como falhada; falta de
  saldo e "espere" não liberam.
- **O que fica guardado:** só a bandeira, o número de parcelas, o valor pago com os juros e o resultado da
  verificação do banco; nunca o número do cartão, o CPF ou o nome do titular. O texto-base da Política de
  privacidade já diz isso; publique uma versão nova antes de ligar o cartão (item 40).
- **O que ainda não faz:** cancelar reserva paga (M8.2c, pronto em 10/10, acima), alterar reserva paga (M8.2d) e contestação
  (M8.2e; o sistema já guarda o que ela vai precisar). Antes do dinheiro de verdade faltam também a
  decisão sobre o campo de e-mail do formulário do cartão (seção 7) e uma proteção a mais da página do
  pagamento, que eu faço antes de ligar a produção.

### Páginas legais do site — M7.4 (9/10)

O site agora tem as três páginas que a lei pede para vender pela internet: **Termos de uso**,
**Política de privacidade** e **Política de cancelamento**. Elas são a base para o pagamento de verdade.

- **O que o hóspede vê:** os três links no rodapé de todas as páginas do site e, se a razão social ou
  o CNPJ estiverem preenchidos, a identificação da empresa (razão social, CNPJ e endereço). Enquanto
  você não publicar, cada página diz só que está **em preparação** — nada do texto-base aparece.
- **Antes de gerar o Pix:** o hóspede vê o **resumo da política de cancelamento**, a data-limite do
  reembolso integral **daquela reserva** ("até 23h59 de 28/09/2026", por exemplo) e marca a caixa
  "Li e aceito os Termos de uso e a Política de cancelamento, e li a Política de privacidade", com o
  link de cada uma. Sem marcar, o Pix não sai. Quem já aceitou vê só a linha "Você aceitou… em
  dd/mm às hh:mm"; na reserva confirmada, essa linha fica com a data-limite.
- **Ao segurar as datas:** nada a marcar; o formulário só diz que os dados servem para a reserva,
  com o link da Política de privacidade.
- **Onde você edita:** **Configurações → Páginas legais do site**. Um documento por vez, com a
  situação dos três, a **prévia** de como fica no site (o que falta aparece como "[falta: CNPJ]"),
  o botão para copiar o texto (para mandar ao advogado) e **Publicar a versão N**, sempre com
  confirmação. Cada publicação vira uma **versão numerada e datada**; as anteriores continuam no site
  para quem aceitou. O histórico mostra a data, quem publicou e **quantos hóspedes aceitaram** cada
  versão. Não dá para despublicar.
- **Dados da empresa entram sozinhos:** nome, razão social, CNPJ, endereço, e-mail, telefone e o
  **encarregado pela proteção de dados** (campo novo em **Configurações → Empresa**). Se o texto usa
  um dado que está em branco, publicar é recusado e a tela diz qual preencher. Se você mudar um dado
  da empresa depois, o site continua com o da versão publicada e o painel avisa para publicar de novo.
- **Os 14 dias são um campo da política:** "Reembolso integral até quantos dias antes da entrada"
  fica no formulário da Política de cancelamento e entra no texto sozinho. O texto e a devolução
  (do cancelamento pelo site, desde 10/10) usam sempre o mesmo número.
- **Versão nova vale para os próximos pagamentos:** quem já aceitou fica com a versão que aceitou. Um
  Pix ainda válido continua valendo; um Pix novo pede o aceite da versão nova. Um pagamento aprovado
  nunca é recusado por causa de versão.
- **Onde ver o que o hóspede aceitou:** na ficha da reserva, no painel. Cada tentativa de pagamento
  tem a linha "Aceite" (Termos v1 · Privacidade v1 · Cancelamento v1, o prazo do reembolso e a hora),
  e a seção **Páginas legais aceitas** lista todos os aceites da reserva. Nada do hóspede é copiado
  para esse registro (nem e-mail, nem IP): ele fica ligado à reserva.
- **Os textos são um ponto de partida:** escrevi a partir da lei e ninguém do direito conferiu ainda.
  A lista do que levar ao contador e ao advogado está no item 39 da seção 6.

### Sobras de feriado e evento com reserva — M3.10 (9/10)

Em 6/10 você decidiu: se um feriado ou evento (Réveillon, Carnaval, um feriadão) já tem uma reserva
no imóvel, as noites que sobraram livres nesse período não precisam mais do mínimo especial. Agora o
sistema faz isso sozinho:

- **Com reserva confirmada no período:** cada noite livre do período pede o **mínimo normal da
  semana**: 1 noite de domingo a quinta, 2 na sexta e no sábado (e o mínimo do cadastro do imóvel, se
  ele tiver um). Se a sobra até a próxima reserva for menor, o mínimo cai para caber nela: um sábado
  que sobrou sozinho pede 1 noite, para não encalhar.
- **O preço não muda:** todas as noites do período continuam com o preço do evento ou do feriadão,
  antes e depois da reserva. Depois do período, tudo volta ao normal da data.
- **Sem reserva confirmada, nada muda:** consulta, pedido do site ainda não pago ou reserva pendente
  não contam. Enquanto não há reserva confirmada, vale o mínimo especial no período inteiro.
- **Feriado dentro do evento:** se um feriadão cai dentro do Réveillon ou do Carnaval (Natal, 1º de
  janeiro, um feriado estadual), nas noites em que o evento já cedeu o feriadão cede junto. Fora do
  evento, o feriadão segue a própria regra: só cede se tiver reserva confirmada na janela dele.
- **Período do cadastro do imóvel continua mandando:** se você cadastrou na ficha do imóvel um
  período com mínimo próprio, ele vale como antes.
- **Onde aparece:** no envio ao Beds24, na prévia do envio (a coluna do mínimo explica a regra
  usada) e no site, que usa o mesmo cálculo.
- **Liga e desliga no painel:** em **Configurações → Calendário e preços**, cada evento mostra na
  coluna **Com reserva** se usa o mínimo normal nas noites livres, com um botão para trocar. Nos
  feriadões, a opção fica junto do mínimo do feriadão. Vem ligada; desligue nas temporadas longas,
  como a alta temporada (senão uma reserva em dezembro tiraria o mínimo da temporada inteira).

### Pagamento pelo site, em teste — M8.2a (8/10)

O pagamento pelo site começou. Ele foi dividido em cinco partes, e esta é a primeira: **Pix**, em
**modo de teste** (sem dinheiro de verdade), com toda a base que as outras partes usam. Depois vêm o
cartão (M8.2b), o cancelamento com devolução (M8.2c), a alteração de reserva paga (M8.2d) e a
contestação de cartão (M8.2e). O dinheiro de verdade só liga com as cinco partes, as páginas legais
(M7.4) e as decisões que ainda faltam.

- **Para o hóspede:** depois de segurar as datas, a página da cotação mostra o **Pix**: o código
  copia e cola (com botão de copiar), o QR e o prazo. O hóspede paga no app do banco e a página
  confirma sozinha: "Pagamento aprovado: reserva SCL-… confirmada", com o link para Minha reserva. Se
  o pagamento chegar mas as datas não puderem ser garantidas, a página diz que a equipe vai falar com
  ele e devolver o valor integral, e nunca o manda pagar de novo. Só quem segurou as datas naquele
  aparelho vê o Pix; em outro aparelho, o hóspede usa **Continuar o pagamento** com o e-mail que deu.
- **As datas ficam seguradas até o fim do Pix.** O Mercado Pago exige que o Pix valha pelo menos 30
  minutos, então gerar um Pix segura as datas por pelo menos esse tempo (até 3 Pix por cotação, um
  de cada vez). Um Pix pago no último minuto não perde a reserva.
- **A reserva confirma sozinha** quando o pagamento é aprovado com as datas ainda seguradas. Pedido
  que você ou a equipe cancelaram nunca volta sozinho. Até o M8.3, o Início
  avisa "reserva do site paga: feche as datas nas OTAs" (feche como **bloqueio** no Beds24, nunca
  como reserva, senão a importação cria uma segunda reserva). Desde 10/10 o aviso aparece mesmo com o
  envio ao Beds24 ligado: o envio manda só os bloqueios que você cria no SCL, não as datas das reservas.
- **O dinheiro:** a taxa real do Mercado Pago entra na reserva. A parte do proprietário só fica
  disponível depois do check-in **e** de o Mercado Pago liberar o dinheiro. A data de liberação que
  o Mercado Pago mostra é só uma previsão; a liberação conta quando ele disser que liberou (o
  recebimento entra no caixa no dia em que o sistema viu isso), ou quando você registrar à mão,
  conferindo no Mercado Pago (vale a data que você informar; se depois o Mercado Pago confirmar o
  mesmo valor, o registro fica conferido).
- **No painel:** a ficha da reserva ganha o quadro **Pagamento no site** (situação, valores e os botões
  **Conferir agora**, **Registrar liberação** (e **Estornar liberação**, se registrou errado),
  **Devolver pelo Mercado Pago**, **Registrar devolução feita por fora** e, depois de uma devolução,
  **Registrar taxa que não voltou**, só para quem edita o financeiro, sempre com confirmação). Em **Financeiro →
  Pagamentos do site** está a lista de todos, com o filtro "pede atenção". Em **Configurações →
  Pagamento no site** você liga e desliga o pagamento e vê, imóvel por imóvel, se o Pix é oferecido
  ou por que não. Em **Integrações** aparece a situação da conexão com o Mercado Pago.
- **Onde roda o teste:** só nas **prévias** da Vercel (os links dos PRs), que usam um banco separado.
  No endereço de produção o site continua com o pedido pela conversa, porque ali está a operação
  real (os recebimentos de outubro). Por isso as chaves de teste vão só no ambiente **Preview** da Vercel.
  Nas prévias nada confere sozinho: a página do hóspede confere o próprio Pix e o botão **Conferir
  agora** faz o resto.
- **Travas:** o sistema só cobra se o Mercado Pago confirmar que a conta das chaves é **de teste** e se
  você ligar **Oferecer pagamento no site** (vem desligado). Chave de produção, mesmo por engano, não
  cobra nada nesta parte.
- **O que ainda não faz:** cartão (M8.2b, pronto em 9/10, acima); cancelar uma reserva já paga (M8.2c, pronto em 10/10,
  acima); alterar reserva paga (M8.2d); contestação (M8.2e). Nenhum e-mail novo vai ao
  hóspede: a confirmação do M9.2 passa a valer para as reservas pagas quando você ligar as mensagens.

### Página para proprietários — M7.7 (8/10)

Você pediu em 7/10 uma página de verdade para quem tem imóvel, junto com o site. "Anuncie seu imóvel"
agora é essa página, no mesmo visual do site:

- **Capa** com o convite e dois botões: pedir uma análise do imóvel (gestão completa) ou cadastrar no
  marketplace.
- **As duas formas de trabalhar:** gestão completa (a empresa cuida de tudo) e marketplace (o
  proprietário cuida do imóvel e a empresa vende pelo site).
- **Como gerimos:** os passos, do anúncio ao repasse.
- **Vitrine** com os imóveis públicos do site e **"Portfólio pequeno, de propósito"**.
- **Como funciona:** o mesmo documento que cada proprietário aceita no portal, na versão publicada.
  Só aparece quando há uma versão publicada.
- **Faixa de mercado:** diária média, ocupação e, se quiser, o líquido por mês, por tipo de imóvel.
  **Só aparece quando você digitar números reais**, com o mês e de onde vêm, e sempre com o aviso de
  que é estimativa, sem garantia. Sem números, a seção não existe.
- **Pedido de contato (gestão completa):** a pessoa deixa nome, e-mail, WhatsApp, bairro e uma
  mensagem. O pedido chega em **Proprietários → Pedidos de contato**, aparece nas pendências do
  **Início** do painel e vai por e-mail para o e-mail da empresa (Configurações → Empresa). Ali você
  responde pelo e-mail ou WhatsApp e marca como respondido, ou arquiva. Contra envio em massa, há
  limites que se desfazem sozinhos: 3 pedidos por e-mail em 24 horas, 5 por hora do mesmo endereço
  de internet e 30 por hora no total. Ninguém precisa arquivar nada para o formulário voltar a funcionar.
- **Cadastro do marketplace:** igual ao de antes (e-mail, código e dados do imóvel). No meio do
  cadastro, a página mostra só ele.

Tudo que é texto se muda em **Configurações → Página para proprietários**, com um texto-base para você
revisar. O texto-base só diz o que a empresa de fato faz (o mesmo do "Como funciona").

### Site do hóspede no visual do estudo — M7.6 (7/10)

Você pediu em 7/10 para deixar o site "bonitinho de acordo com aquelas referências". Comparei página a
página com o estudo do Sage e trouxe o que faltava. Tudo que é texto ou foto se muda no painel; nada de
dado inventado.

- **Página inicial:**
  - **Capa com foto:** a foto que você escolher em **Configurações → Site → Imagens do site** fica atrás
    do título, de ponta a ponta. Pode ser a original do celular: o sistema reduz antes de subir. Sem foto,
    a capa continua no fundo verde, nunca uma imagem genérica.
  - **Legenda vertical:** o texto pequeno no canto da foto ("Leblon, do nosso jeito.") e o link
    "Encontre seu lugar".
  - **Vitrine "Seu endereço no Leblon":** um carrossel com setas que anda sozinho. Para ao passar o mouse
    e tem o botão "Pausar movimento". Não anda para quem pediu menos movimento no aparelho. No celular,
    mostra um cartão por vez.
  - **Cartões das casas:** a capa (M7.3) com um selo ("Studio · Leblon"), até quatro ícones das
    comodidades do cadastro e "Até N hóspedes".
  - **"Por que reservar direto":** começa com um texto-base para você revisar perto da entrada no ar
    (conversa direta, valor claro desde o início, um bairro para viver). Se você já tinha escrito algo
    ali, o seu texto continua valendo.
- **Página do imóvel:**
  - **"O bairro à sua porta":** os lugares perto do imóvel (nome, distância, frase curta e foto opcional).
    Você cadastra em **Configurações → Site → O bairro à sua porta**. As fotos de lugares do estudo não
    entram, porque os direitos delas não foram liberados: só fotos suas. Sem lugar cadastrado, a seção
    não aparece.
  - **Comodidades com ícone:** a lista "O que você encontra" ganhou os ícones.
- **Escolha de datas:** a entrada e a saída são escolhidas num calendário do próprio site, em português
  (dois meses lado a lado no computador, um no celular). As noites já ocupadas aparecem marcadas assim
  que o hóspede escolhe o lugar. A conferência final (mínimo de noites, regras) continua no servidor,
  como antes.
- **Consulta:** em duas colunas, como no estudo. À esquerda fica o formulário; à direita, o quadro
  "Resumo da viagem", com a situação, o valor por partes, "Segurar estas datas" e a mensagem para o
  WhatsApp. Antes da consulta, o quadro diz "a confirmar". A escolha Pix ou cartão entra com o pagamento
  (M8.2).
- **Marca:** o ícone do logotipo aparece no topo e no rodapé. Vale a marca do estudo até você enviar
  outra, também em Imagens do site.
- **Textos novos editáveis** em Configurações → Site:
  - a legenda vertical;
  - o olho, o título e a frase da vitrine;
  - o olho e o título de "Por que reservar direto";
  - o olho da chamada final;
  - o olho, o título e a frase da página de consulta.

### Equipe entra sem e-mail — M6.8 (7/10)

Você decidiu em 7/10: vários jeitos de entrar, sem verificação em duas etapas, e o acesso bem contido.
Ficou assim:

- **Usuário e senha criados por você:** em **Limpezas → Profissionais**, em cada profissional, escreva
  um usuário (ex.: `maria.limpeza`) e, se quiser, a senha; deixando a senha em branco, o sistema cria
  uma fácil de ditar (tipo `kp7m-x3cd-h9ta`). Ao salvar, aparece uma mensagem pronta com usuário e
  senha para copiar e mandar pelo WhatsApp. **A senha aparece só essa vez** — depois nem você vê; se a
  pessoa esquecer, é só definir outra (e quem estava entrado com a antiga sai na hora). Só você (admin)
  vê essa parte.
- **Como ela entra:** em `/entrar`, abre "Entrar com usuário e senha" e digita o usuário (ou o e-mail,
  se tiver) e a senha. Não precisa de e-mail. Quem tem e-mail continua podendo entrar pelo código, e
  quem tem conta Google com o mesmo e-mail, pelo Google.
- **A senha é dela:** no acesso dela aparece "Minha senha" para trocar a provisória por uma que só ela
  saiba (pelo menos 8 caracteres). Quem entrou pelo código ou pelo Google pode criar uma senha ali.
- **Segurança sem complicar:** a senha não fica guardada, só uma "impressão digital" dela. Cinco
  erros seguidos para o mesmo usuário e é preciso esperar 15 minutos; se ela pedir socorro, a senha
  nova que você cria vale na hora, sem esperar. Contra quem tenta adivinhar em massa, o sistema também
  segura tentativas demais vindas do mesmo lugar ou todas juntas (passa sozinho em poucos minutos).
  "Tirar acesso" corta todos os jeitos de entrar na hora.
- **Cada uma vê só a cidade dela:** na mesma tela, marque a cidade da agenda de cada profissional. O
  acesso dela mostra as limpezas dela e a **agenda da equipe** só daquela cidade, no mesmo formato da
  agenda de sempre (Búzios com as reservas dos próximos 30 dias; Rio com as limpezas por dia e as
  entradas e saídas à parte). Sem cidade marcada, ela não vê agenda nenhuma e a tela avisa. Nada de
  financeiro, proprietários ou o resto do painel.
- **Cadastro inconsistente:** se o acesso da profissional estiver ligado a uma conta de outro perfil
  ou outra empresa, tentar criar/trocar/retirar esse acesso mostra um aviso e preserva a conta. Não
  aparece o acesso dessa outra conta nem vai aviso de limpeza para ela. Arquivar a profissional
  também preserva a conta que estiver vinculada por engano; a correção do vínculo precisa ser conferida.
- **Avisos:** o aviso de limpeza por e-mail só vai para quem tem e-mail; para os outros, a limpeza
  aparece na tela dela. O aviso pelo WhatsApp entra quando o WhatsApp for ligado (M10).

### Fotos reais dos imóveis — M7.3 (7/10)

Você liberou em 7/10 as fotos dos anúncios do Airbnb (ou as que você separa). Agora elas têm lugar
no sistema:

- **Onde subir:** Imóveis → o imóvel → parte **Fotos**, logo abaixo do cadastro completo. Escolha
  várias de uma vez e clique em "Subir fotos". Pode mandar a foto original do celular: cada uma é
  reduzida no seu navegador antes de subir (uma versão grande para a galeria e uma pequena para os
  cartões e o relatório), então sobe rápido e não ocupa espaço à toa. Até 40 fotos por imóvel.
- **Capa e ordem:** a primeira foto é a capa. Cada foto tem as setas para mudar de lugar, "Usar como
  capa", a legenda (o texto que descreve a foto; no site, ela aparece sobre a foto e ajuda quem usa
  leitor de tela) e "Remover", que pede confirmação. Tudo fica no histórico do imóvel.
- **No site:** os cartões da página inicial e de "Nossas casas" mostram a capa; a página do imóvel
  ganha a galeria com a foto em destaque, o contador (3 / 9) e as miniaturas ao lado (no celular,
  embaixo, rolando para o lado). Imóvel sem foto continua com o quadro "foto em breve", nunca uma
  imagem genérica. Foto de imóvel que não está no site não aparece para ninguém de fora.
- **No relatório mensal:** a capa do PDF usa a primeira foto da ficha — no portal, no e-mail do
  fechamento e no painel (no painel você ainda pode escolher outra foto só para aquele PDF).
- **Na aba Anúncios:** o quadro do site diz quantas fotos reais o imóvel tem.

A foto do Leblon na capa da página inicial, a vitrine em carrossel e a seção "O bairro à sua porta" vieram
no M7.6 (acima).

### Beds24 nos bastidores — M5.9 (7/10)

Você pediu em 7/10: "nem proprietários nem hóspedes precisam saber que tem Beds24 no meio". Conferi tudo o
que o proprietário e o hóspede leem (portal, site, portal do hóspede, e-mails, relatório) e o Beds24 só
aparecia no portal do proprietário. Agora:

- **Fonte de preços e preço da noite:** o portal diz "Preços automáticos da SCL", "Preços definidos por você
  ou pela sua ferramenta de preços" ou "Preços digitados no cadastro", com a explicação sem citar o Beds24.
- **Envio aos canais:** o que antes era "envio ao Beds24" virou "envio aos canais". Se o último envio falhou,
  o portal diz só que falhou e quando; o motivo técnico fica no painel, para você.
- **Bloqueio de datas:** "as datas fecham nos canais (Airbnb, Booking)"; bloqueio que veio dos canais
  aparece como "Canal", e se o proprietário tentar liberar, a mensagem pede para falar com a empresa.
- **Site:** quando o preço de uma data ainda não foi lido, o hóspede vê só "o preço dessas datas ainda não foi
  confirmado: confirmamos na conversa".
- **Para não voltar:** um teste automático varre as telas, e-mails e documentos do proprietário e do hóspede
  e falha se a palavra Beds24 aparecer num texto.
- **O painel continua dizendo Beds24**, porque é para você e a equipe.

### Relatório mensal: ocupação e indicadores do setor — M5.8 (5/10)

Depois de ver o PDF do M5.7 você pediu três coisas, e as três estão na página 2 do relatório:

- **"Noites ocupadas", sem dúvida.** O quadro que dizia "19 noites" passou a dizer **"19 noites
  ocupadas"**, com a ocupação e as noites disponíveis logo abaixo ("63% de ocupação: 19 de 30 noites
  disponíveis"). Noite vazia não aparece como número solto em lugar nenhum.
- **Indicadores do setor.** Além da diária média (que é o ADR), entrou a **receita por noite
  disponível** — o RevPAN/RevPAR que você lembrou: o bruto do mês dividido por todas as noites que
  estavam à venda, ocupadas ou não. É o número que junta ocupação e preço numa coisa só: se a diária
  sobe mas a ocupação cai, ele mostra se valeu a pena. Entrou também **reservas e estadia média**
  (quantas reservas tiveram noite no mês e quantas noites cada uma ficou, em média). Com isso os
  quadros ficaram seis, em três linhas de dois — continua tudo dois a dois, sem rolagem lateral.
- **Segundo gráfico: ocupação por mês.** Logo abaixo do gráfico do resultado, barras de 0 a 100% com
  a ocupação de cada um dos últimos 12 meses, o percentual dentro da barra e, sobre cada barra, a
  diária média daquele mês. Dá para ver de uma vez se o mês foi bom por volume ou por preço (a opção
  1 das três que te mandei; você escolheu essa em 5/10). Mês sem dado no sistema fica hachurado,
  como no outro gráfico.

Nada muda no e-mail nem no portal além do PDF; o print novo da página 2 está em "Como está ficando".

### Dia do fechamento: dia 2 — M4.13 (5/10)

Você decidiu em 5/10: o fechamento oficial e o envio do relatório passam para o **dia 2** do mês
seguinte, porque o Airbnb só paga no dia 1º a reserva com check-in no último dia do mês — no dia 2
o extrato do canal sai completo. Está no sistema assim:

- **O que mudou de dia:** o fechamento mensal, o repasse mensal (o padrão de todo proprietário) e o
  e-mail automático do relatório. No dia 1º, a rotina das 9h não manda nada e registra "sai sozinho
  a partir de 02/11/2026"; no dia 2, manda. Repasses quinzenais, semanais e "assim que disponível"
  continuam nos dias deles — só não nascem no dia do fechamento, que é o único repasse daquele dia
  (antes isso valia para o dia 1º; agora o dia 1º é um dia comum). O fechamento fica registrado com a
  data do dia do fechamento (2/11, por exemplo), mesmo que você clique depois; se fechar antes, à mão,
  fica com o dia em que você fechou. A data do Pix do fechamento nunca pode ser anterior a essa.
- **O que não mudou:** você continua clicando em "Fechar o mês" no painel, quando quiser — pode
  fechar e enviar à mão no dia 1º, se estiver tudo certo. O proprietário baixa o PDF no portal a
  qualquer momento, inclusive o parcial do mês em andamento. O que o canal ainda não pagou até o dia
  do fechamento continua "a liberar" e vai para o repasse seguinte, com aviso — nunca é suposto.
- **Onde se mexe:** **Configurações → Repasses → "Dia do fechamento mensal e do relatório"** (de 1
  a 5; já está no 2). A mudança vale do fechamento do mês atual em diante: se você mudar em
  novembro, o fechamento de outubro (feito em novembro) sai no dia que já valia e o de novembro em
  diante sai no dia novo. O que já fechou não muda. Textos do painel, do portal e do relatório
  mostram o dia que está valendo.
- **Primeiro fechamento no sistema:** o de outubro sai sozinho em **2/11/2026**. Antes dele, faça o
  item 29 da seção 6 (início do sistema e acerto por fora) e o item 32 (extratos dos canais).

### "Como funciona" para o proprietário — M5.6 (4/10)

Você pediu, em 4/10, um documento de consulta para o proprietário — o que a SCL faz, comissão e
taxas, quando e como ele recebe, relatórios, cancelamentos — com aceite registrado no cadastro. Está
pronto, e funciona assim:

- **Configurações → Como funciona (proprietário):** o texto, em oito seções (o que a empresa faz;
  marketplace; comissão e taxas; quando e como recebe; relatórios e extrato; cancelamentos;
  contestações; dúvidas). Enquanto você não publica nada, o formulário traz um **rascunho sugerido**
  a partir das regras que já valem no sistema — revise, mude o que quiser e clique em "Publicar a
  versão 1". A seção "Contestações" veio em branco de propósito (decisão pendente, seção 7): seção
  vazia não aparece para o proprietário. Escreva `{empresa}` para o nome da empresa entrar sozinho (o nome fica gravado na versão: se um dia o cadastro mudar, o texto já aceito não muda, e publicar de novo cria uma versão nova).
- **Versões:** cada publicação com texto diferente vira a versão seguinte, numerada e datada; texto
  igual não cria versão. Versão nova pede **aceite novo** de todos os proprietários; os aceites antigos
  ficam guardados. A mesma aba mostra quem já aceitou qual versão e quando, e a página de cada
  proprietário traz a mesma linha.
- **No portal:** o proprietário lê o documento em "Como funciona" (link no início do portal). Junto do
  texto aparece o quadro **"Seus dados"**, lido do cadastro: o contrato em vigor de cada imóvel (tipo,
  comissão, desde quando) e a periodicidade de repasse que ele escolheu — por isso não é para escrever
  esses números no texto. Enquanto faltar o aceite da versão atual, uma faixa no início do portal pede
  a leitura; ele marca "li e aceito" e clica em "Registrar o meu aceite" — fica gravado quem, quando e
  qual versão. Nada é bloqueado: o portal segue funcionando com a faixa.
- **No convite:** quem recebe o link do convite vê o documento ali mesmo e só consegue "Aceitar e
  entrar" depois de marcar "li e aceito"; o aceite é gravado junto com o convite, no login. Se o texto
  mudar entre o link e o login, o portal pede o aceite da versão nova.
- **O que não entra:** o documento não é contrato nem substitui o contrato assinado; é a explicação
  oficial, com aceite registrado. As páginas legais do site (termos, privacidade, cancelamento) são o
  M7.4, com aceite no checkout.

### Relatório mensal: modelo oficial — M5.7 (4/10, pronto)

Você mandou em 4/10 o relatório de setembro que a Lia montou com você e pediu que ele virasse o
padrão. Está implementado assim (no portal, no painel e no e-mail do fechamento):

- **O que o relatório vai ter, nesta ordem:** capa com a marca, o mês, o imóvel, a foto e os
  nomes (proprietário e, quando houver, representante autorizado); **seu resultado do mês** em
  destaque, com a base escrita embaixo (nunca o total de um canal como se fosse lucro); **como
  chega até você** (o que o Airbnb pagou direto, o que já foi repassado no mês, o que vai no
  fechamento — com quem paga quem e o Pix — e o que ainda está a liberar, com o motivo); do bruto
  ao resultado linha a linha; **números do mês** (noites e ocupação, diária média, comparação com
  o mês anterior e com o mesmo mês do ano passado, acumulado do ano) e um gráfico de barras dos
  últimos 12 meses; cada reserva descrita (primeiro nome do hóspede, canal, código, datas, noites,
  bruto, taxa do canal, gestão, sua parte, situação); a conciliação (do extrato de cada canal ao
  resultado, repasses feitos no mês, despesas); e, no fim, os extratos oficiais das OTAs como
  emitidos.
- **Sem dado, sem chute:** a comparação com o mês anterior e a com o mesmo mês do ano anterior só
  aparecem quando o sistema tem o dado do período inteiro; senão o relatório escreve "sem dado no
  sistema". O acumulado do ano soma desde o primeiro mês com dado e diz desde quando ("acumulado
  desde out/2026"). Como o sistema vale a partir de 1/10/2026, a comparação com o mês anterior
  começa em novembro e a com o ano anterior em outubro de 2027 (antes disso só se o histórico for
  importado — M11.1).
- **Resultado por noite, dinheiro pela data do pagamento (sua lembrança de 4/10):** o resultado e
  os números do mês continuam por noite (a regra de 24/09); já o "como chega até você" e a
  conciliação seguem a data em que o canal pagou. O Airbnb paga a reserva inteira no dia seguinte
  ao check-in, direto a você: uma reserva de 29/9 a 2/10 foi paga em 30/9, então a noite de
  outubro conta no resultado de outubro, mas não no "pago pelo Airbnb em outubro" — o relatório
  escreve a ponte entre os dois (no protótipo, a reserva de Zé). A mesma regra entra no acerto por
  fora do início do sistema: reserva paga antes de 1/10 é acertada inteira por fora, em todos os
  meses (M4.12, pronto em 4/10; para o Airbnb nada muda no acerto, porque a parte paga pelo canal já não
  entra em repasse — muda o extrato e o relatório).
- **Vale para tudo:** o PDF que o proprietário baixa no portal, o e-mail do fechamento no dia do
  fechamento (dia 2 desde 5/10 — M4.13) e o relatório do marketplace (vendas do site separadas das vendas do dono nas OTAs dele).
  E-mails e, quando ligado, WhatsApp seguem a mesma família: saudação pelo nome, uma frase do que
  é, o número ou a data em destaque, uma lista curta, o próximo passo.
- **Onde ver:** o protótipo navegável, com dados fictícios, está em
  `prototipos/relatorio-mensal/relatorio.html` (abra no navegador; "Imprimir" mostra as quatro
  páginas em A4); a especificação completa, em `requisitos/product/RELATORIO-MENSAL.md`. O PDF que
  você mandou tem dados reais e **não** foi para o GitHub — só a estrutura dele.
- **O que você vê agora:** o PDF tem quatro páginas em A4 (capa e resultado; números e reservas do
  mês com o gráfico; conciliação, repasses e despesas; extratos dos canais), cada uma numa folha,
  numeradas "página N de M"; os quadros dos números ficam dois a dois e nada precisa de rolagem
  lateral no celular (seu pedido de 4/10). O do portal sai sem os extratos (o rodapé diz que eles
  ficam com a equipe); o do painel (ficha do proprietário → Relatório em PDF) aceita foto e um
  extrato na hora, agora com o nome do canal; o do e-mail do fechamento leva os extratos que você
  guardar em **Financeiro → Repasses → "Extratos dos canais para o relatório"** (um PDF por imóvel,
  proprietário favorecido, mês e canal, com as páginas a usar — só o relatório daquele proprietário o anexa) — sem extrato guardado, o relatório sai sem anexos e a seção
  do proprietário avisa, antes e depois do envio. Os e-mails do fechamento e do repasse saem em
  texto e numa versão bonita (HTML), na ordem combinada: saudação pelo primeiro nome, uma frase do
  que é, o valor em destaque, lista curta, próximo passo, assinatura — o seu texto editável
  continua valendo (a saudação do seu texto é trocada pela saudação pelo primeiro nome, e o "qualquer dúvida" do fim não sai duas vezes).
- **O que ficou para os itens próprios:** foto real da capa (M7.3 — até lá o quadro "foto em breve"),
  linhas do modelo B no relatório do marketplace (M12.2), comparações com meses anteriores a
  1/10/2026 (M11.1) e WhatsApp (M10). Dia do fechamento no dia 2: feito em 5/10 (M4.13, acima).
  Seus pedidos de 5/10 para o relatório (quadro "noites ocupadas", RevPAN e o segundo gráfico)
  entraram no M5.8 (acima).

### Portal do proprietário marketplace — M12.4 (4/10)

Quem tem imóvel em **contrato marketplace** passa a ver no portal a seção "Seu imóvel no
marketplace" (quem é gestão total ou online não vê nada diferente). Lá o proprietário:

- **Define preços e regras de venda** do próprio imóvel: preço da noite, taxa de limpeza, hóspede
  extra, estadia mínima e máxima, antecedência, até quantos dias à frente aceita reserva, dias de
  entrada e saída e horários — pela mesma validação do cadastro do painel (o que ele não edita
  continua como você deixou). Embaixo do preço aparece a conta do site, ao vivo: quanto o hóspede
  paga, quanto ele recebe e quanto fica com a empresa, pelo modelo B de Configurações →
  Marketplace. Também cria e exclui períodos especiais (Réveillon, Carnaval).
- **Vê se a mudança chegou às OTAs**, sem suposição: se o imóvel está na lista de envio ao
  Beds24, se o envio é automático e quando foi o último. Fora da lista, o texto diz que o site da
  empresa já usa o preço novo, mas o Airbnb e o Booking continuam com o anterior até você incluir
  o imóvel no envio (Configurações → Calendário e preços).
- Se os preços do imóvel são **definidos no Beds24** (fonte de preços escolhida por você), o preço
  da noite fica só de leitura no portal; limpeza, hóspede extra, regras e horários continuam
  editáveis. Período especial só com estadia mínima.
- **Limpezas por conta própria:** a lista das saídas de hóspede (de 3 dias atrás a 2 semanas à
  frente), com "atrasada" e "entra hóspede no mesmo dia", e o botão "Marcar como feita" a partir do
  dia. A limpeza fica registrada sem custo para a empresa (nenhuma despesa é lançada).
- **Manutenção por conta própria:** registra o conserto que ele mesmo fez (o quê, quando, detalhes);
  entra no histórico do imóvel como realizada, por conta do proprietário, sem orçamento nem despesa.

Tudo é decidido no servidor: imóvel que não é dele, ou sem contrato marketplace em vigor na data,
não passa. Bloqueio de datas para uso próprio continua como antes (M5.5, pela permissão do
contrato). As mudanças ficam no histórico do imóvel com o nome do proprietário.

### Extrato e repasses por periodicidade — M4.10 (4/10)

O proprietário passa a ver, no portal, **a parte dele em cada reserva**, mês a mês, com a situação:

- **Paga pelo canal** — o canal transfere a parte dele direto (hoje, o Airbnb): só informação,
  não entra em repasse nenhum.
- **A liberar** — a empresa recebe, mas ainda falta algo, e o motivo está escrito: o check-in
  ainda não aconteceu; o dinheiro do canal ainda não foi registrado na empresa; a reserva está
  em conferência; ou "quem recebe" está a confirmar (essa fica fora de qualquer repasse até você
  definir).
- **Disponível** — check-in já passou (entrada até ontem) e o dinheiro está com a empresa: entra
  no próximo repasse, com a data prevista.
- **Repassada** — já saiu num repasse, com a data e se está pago.

**Como ele quer receber:** no portal (e você, no cadastro do proprietário) escolhe-se mensal no
dia do fechamento (dia 2 desde 5/10 — M4.13; padrão e intervalo máximo), quinzenal (dias 1 e 16), semanal (segundas) ou assim que
disponível (dia seguinte ao check-in, com o dinheiro já na empresa). Sem escolha vale o padrão do
tipo de contrato, que você define em **Configurações → Repasses**, junto com o dia da semana do
semanal e os dois dias do quinzenal. A escolha vale a partir do próximo repasse.

**Repasses antecipados:** todo dia às 8h o sistema gera o repasse de quem está no dia da
periodicidade dele, com tudo o que estava disponível até ontem; o proprietário também pode pedir
um avulso no portal ("Pedir repasse agora") e você pode gerar no painel. Nunca no dia do fechamento
— nesse dia o único repasse é o fechamento. Cada parte de reserva só entra num repasse (mesmo que a
rotina e o botão rodem no mesmo dia, nada é pago duas vezes), e no máximo um antecipado por
proprietário por dia. O antecipado entra no acerto como "repasse", então o fechamento do mês o
desconta sozinho.

**O fechamento mensal mudou em dois pontos:** só entra o que já está disponível — a parte de
uma reserva cujo dinheiro ainda não foi registrado na empresa fica fora, com aviso, e passa para
o repasse seguinte; e noites de meses seguintes já disponíveis (ex.: reserva que começou no dia
31 de quem recebe assim que disponível) entram no mesmo repasse como adiantamento, para a
reserva ser paga inteira. Esse adiantamento é lançado no mês das noites, então o mês seguinte
fecha zerado — a reserva que atravessa o mês não aparece como "dívida" no fechamento.

**Recebimento do canal:** é você quem diz ao sistema que o dinheiro entrou. Na página da reserva
há **"Registrar recebimento"** (data e valor; o valor já vem preenchido com o que falta do
líquido do canal). Sem esse registro, a parte do proprietário fica "a liberar" e **fora do
fechamento** — a regra é nunca repassar o que a empresa ainda não recebeu. Quando a conciliação
automática do extrato (M4.4) e a liberação do Mercado Pago (M8.2) chegarem, elas farão esse
registro sozinhas, pela mesma regra.

**Comprovante e e-mail:** ao marcar um repasse como pago, você informa o identificador do Pix
e/ou anexa o comprovante do banco (PDF, PNG ou JPG até 5 MB; fica guardado no próprio banco de
dados, só você e o proprietário baixam). Com o comprovante, sai na hora o e-mail ao proprietário
(e aos representantes com cópia) com valor, data, reservas pagas — integral ou parcial — e o
arquivo anexado; sem comprovante, o repasse fica "pago sem comprovante" e o e-mail espera você
anexar. Uma vez por repasse; precisa do Resend configurado (ação 9). Se o provedor de e-mail não confirmar o envio, o sistema repete o mesmo e-mail de hora em hora ao longo do dia (sem risco de duplicar); passado um dia sem confirmação, ele para e espera você decidir reenviar.

Decisões que tomei sozinho, com a sua autorização de 4/10 (dá para mudar): o fechamento mensal
continua disparado por você no painel (a rotina só gera antecipados), para você conferir antes;
o antecipado não desconta adiantamentos e despesas (isso continua no fechamento, como você
decidiu); o Pix em lote automático fica para quando houver API do banco ou do Mercado Pago.

**Fechamentos feitos antes deste sistema (decisão sua, 4/10):** os fechamentos de setembro você
entregou por fora, e o primeiro fechamento feito aqui será o de outubro, já com a parte de cada
reserva registrada. Por isso o sistema não tenta reconstruir fechamentos antigos de verdade: isso só
existe na homologação, com dados fictícios, e lá um caso raro (parte de reserva recalculada depois de
dois fechamentos antigos) fica com uma trava de segurança a menos no estorno de recebimento — aceito
como limite documentado. Na operação real, você decidiu (também em 4/10) que o sistema vale a partir
de 1/10/2026 e que tudo de antes já foi acertado por fora: o bloco seguinte (M4.11) marca isso de uma
vez, e o fechamento de outubro sai sem tratamento à mão.

### Início do sistema e acerto por fora — M4.11 (4/10)

Você decidiu: **o sistema vale a partir de 1º de outubro de 2026**, e tudo o que é de antes — a parte
dos proprietários em cada reserva, comissões, despesas, ajustes — já foi acertado fora dele. Para
o sistema não pagar nem cobrar nada disso de novo, ele agora tem:

- **Configurações → Repasses → "Início do sistema para valer":** a data (1/10/2026). É sempre o
  dia 1º de um mês, porque a parte de cada reserva é contada por mês, e nunca no futuro.
- **Financeiro → Repasses → "Antes do início do sistema":** uma lista, por proprietário, de quantas
  partes de reserva anteriores ao início ainda estão fora de repasse e de quanto é o acerto em
  aberto até a véspera (30/9). O botão **"Marcar como acertado por fora"** cria, para cada
  proprietário, um repasse chamado "acerto por fora até 30/09/2026", já pago, sem Pix e sem e-mail,
  com a parte dele em cada reserva de setembro e antes, e deixa o acerto daqueles meses em zero.
- **O que isso garante:** essas partes nunca entram em repasse antecipado (nem pedido pelo portal)
  nem em fechamento; uma reserva que atravessa setembro e outubro (entrada 29/9, saída 2/10) segue a
  data em que o canal pagou (M4.12, bloco seguinte): paga em setembro, é toda de antes; paga em
  outubro, entra inteira; o extrato do proprietário mostra a parte de antes como **"acertada por
  fora, antes do início do sistema"**, separada do que o sistema pagou.
- **Pode repetir:** o botão só marca o que ainda não foi marcado. Se surgir algo novo de antes de
  1/10 (uma reserva importada atrasada), a lista mostra de novo e você clica de novo. Se um
  proprietário tiver um bloqueio (lançamento em conferência, ajuste a esclarecer ou adiantamento em
  aberto de antes de 1/10), ele fica de fora com o motivo escrito, e os outros são marcados.
- **Errou?** O repasse "acerto por fora" se estorna como qualquer outro: as partes voltam ao extrato.
- **A data não passa por cima de repasse:** enquanto houver acerto por fora em vigor, o sistema não
  deixa mudar o início para antes dele nem apagá-lo; e não deixa colocar o início depois de uma parte
  que um repasse normal (fechamento ou antecipado) em vigor já pagou, nem de um mês já fechado, nem de
  um acerto de antes que um fechamento posterior já quitou (o fechamento de outubro paga tudo o que
  estava em aberto na hora dele, inclusive um ajuste de setembro; parte de reserva que ficou fora do
  fechamento e lançamento feito depois dele não contam, e crédito e débito de antes que se anulam
  também não) — senão a data diria "acertado por fora"
  sobre algo que o sistema pagou, e a marcação acertaria de novo. Em todos os casos, estorne primeiro.
- **Nada de antes passa pelos repasses normais:** com a data definida, a parte de reserva de antes
  do início nunca fica "disponível" (o extrato diz "reserva paga antes do início do sistema: aguarda a
  marcação"), então nem antecipado nem pedido pelo portal a pagam; e o fechamento não roda enquanto
  houver algo de antes sem marcar — ele avisa e pede a marcação. Isso vale também para uma reserva
  antiga que apareça depois (importação atrasada): basta marcar de novo.

### Reserva paga antes do início: a data do pagamento decide — M4.12 (4/10)

Sua lembrança de 4/10: o Airbnb paga a reserva inteira no dia seguinte ao check-in, direto a você.
Uma reserva de 29/9 a 2/10 foi paga em 30/9 — a noite de outubro junto — e já foi acertada por fora.
Então o corte do início do sistema não é por noite: **é pela data em que o canal pagou a reserva.**

- **Paga antes de 1/10:** a reserva inteira é de antes, em qualquer mês. A marcação ("Marcar como
  acertado por fora") leva todas as partes dela, inclusive as de outubro, e deixa em zero só o que é
  dessas reservas naquele mês; o fechamento de outubro não a paga.
- **Paga a partir de 1/10:** a reserva inteira entra no sistema, inclusive as noites de setembro —
  elas ficam disponíveis e saem no antecipado ou no fechamento normalmente.
- **De onde vem a data:** quando o canal paga você direto (Airbnb), é o check-in mais o prazo do
  canal — campo novo em **Configurações → Regras financeiras, "em quantos dias depois do check-in o
  canal paga"** (Airbnb: 1; vazio = sem regra; a regra vale pela data de entrada da reserva, como as
  outras, mas reserva antiga de canal sem prazo na época usa o prazo de hoje — configurar agora resolve a
  reserva que atravessa o início). Quando a empresa recebe (Booking, site, direta), é a data do recebimento que você
  registra na reserva (o que completou o valor do canal). Por isso, registre o recebimento **com a
  data em que o canal pagou**, não com a de hoje.
- **Sem data conhecida:** reserva inteira antes de 1/10 é de antes; inteira depois, de depois. A que
  atravessa (29/9 → 2/10) sem recebimento registrado fica **indefinida**: o sistema não supõe — a
  parte fica "a liberar", o proprietário aparece com bloqueio na lista "Antes do início do sistema"
  até você registrar o recebimento com a data certa, e o fechamento avisa. Se a data de um recebimento
  de reserva já marcada mudar (estorno e novo registro), o sistema bloqueia a marcação daquele
  proprietário e pede: estorne o acerto por fora e marque de novo. O contrário também: se a reserva
  já saiu num antecipado ou fechamento e depois a data do pagamento passa para antes de 1/10, a
  marcação é bloqueada até você estornar esse repasse (senão o valor seria descontado duas vezes).
- **O que não muda:** o resultado por noite (números do mês, relatório) e o Airbnb no acerto — a
  parte paga pelo canal nunca entrou em repasse; para ele muda só o texto do extrato, que passa a
  mostrar a data do pagamento ("pago em 30/09/2026, 1 dia depois do check-in").

Passo a passo na seção 6, item 29.
### Identidade visual nova — M7.5 (4/10)

O site, o portal do proprietário, a tela da equipe de limpeza, a entrada (login), o convite e o
painel inteiro passaram para o visual do estudo que você aprovou em 4/10, com os ajustes que
você pediu: os verdes ficaram, o bege virou um off-white de papel, o grão de papel aparece só
nos fundos (nunca atrás de texto corrido), a busca da capa é translúcida com desfoque, e os
títulos são em serifa. O painel usa a mesma paleta, só mais compacto (tabelas e formulários
menores) por ser lugar de trabalho.

O que você consegue mexer sozinho, em Configurações → Site: além do título, do subtítulo, do
"sobre", do "como reservar", do contato e do rodapé, agora há o **olho da capa** (a linha pequena
acima do título, ex.: "RIO DE JANEIRO · BRASIL") e a **chamada final** (o título da faixa verde
antes do rodapé, ex.: "O Rio está logo ali."). No título e na chamada, a palavra entre
asteriscos sai em itálico dourado ("Um lugar *seu*."). O texto "sobre" virou a seção "Por que
reservar direto": cada bloco separado por uma linha em branco vira uma coluna numerada, e a
primeira linha do bloco é o título dela. O nome da empresa (Empresa → nome) aparece no
logotipo com a última palavra em itálico ("Sua Casa *Leblon*").

O que ficou de fora: as fotos (capa, cartões e galeria) continuam como quadros "foto em breve"
até você liberar os direitos (M7.3); o botão flutuante do WhatsApp só aparece quando há telefone
no cadastro da empresa; o PDF do relatório mensal manteve a paleta anterior (parecida), fica
para quando o relatório for revisto. Todas as cores vêm de um único arquivo de tokens: nenhuma
tela tem cor digitada à mão, então uma mudança de paleta é feita num lugar só. O contraste dos
pares de cores usados foi conferido (mínimo 4,5:1 em texto normal; o dourado só em decoração e
em texto grande).

### Fonte de preços por imóvel — M3.9 (4/10)

Na ficha de cada imóvel (Preço e taxas) existe agora o campo **Fonte de preços**, com três
opções explicadas na própria tela:

- **Preços automáticos do SCL** (padrão, como era): preço base, períodos, eventos, feriadões,
  última hora e pisos; o SCL envia ao Beds24, que repassa ao Airbnb e ao Booking.
- **Preços definidos no Beds24**, pelo proprietário ou pela ferramenta dele: o SCL **só lê e
  nunca escreve preço**. O envio ao Beds24 manda só calendário, mínimos e bloqueios (a lista de
  envio em Configurações → Calendário marca esses imóveis). O site e a cotação usam o preço da
  última leitura do Beds24; noite sem preço lido, ou com leitura vencida, fica "a confirmar",
  sem valor e sem "segurar as datas" — nunca o preço base do cadastro como palpite.
- **Preços digitados no cadastro**: vale o preço base e os períodos exatamente como estão, sem
  eventos, feriadões e última hora e sem os limites mínimo/máximo do preço dinâmico; o SCL envia
  ao Beds24. A edição pelo próprio proprietário, no portal, chega com o M12.4.

Em qualquer opção, o **desconto do site** (M12.1) entra por cima do valor cheio, e o calendário
(mínimos, máximos e bloqueios) é sempre do SCL. Na prévia de calendário aparecem a fonte do
imóvel e uma coluna **"Site (≈)"**, o preço aproximado da noite no site, para você conferir
contra o Airbnb e o Booking se a promessa "pague menos" está de pé. O portal do proprietário
mostra um bloco "De onde vêm os preços" com a explicação.

Decisões suas de 4/10 que ficaram registradas no plano: última hora e desconto do site
**acumulam** (de propósito); a comunicação é genérica ("pague menos que no Airbnb"), sem
garantia absoluta; para o marketplace que define preço no Beds24, a promessa fica garantida
pelo desconto sobre o preço lido, pela cláusula do contrato (quando o M12.3/M12.4 chegar) e pela
conferência periódica com a coluna "Site (≈)". Os pesos 6/3/3 do modelo B estão com você para
confirmar (seção 7). E o **visual do estudo de 4/10** (Sage e site de julho) virou o item M7.5:
verdes mantidos, off-white de papel no lugar do bege, grão sutil só em fundos, busca
translúcida, serifa nos títulos; site, portais e painel com a mesma paleta, o painel só mais
denso.

### Sistema antigo cruzado com o plano — M0.6 (4/10)

Você mandou o "acervo isolado" do sistema de julho (um arquivo só, dados fictícios, integrações
desligadas) e eu percorri as 37 telas: painel financeiro, conversas, assistente e "Franco",
apartamentos, reservas diretas, hóspedes, limpezas, contador, despesas, docs de condomínio,
dynamic pricing, prospecção, marketing, campanhas, cupons, configurações, reconciliação,
relatórios, e-mails, importação, integrações, site público, landing para proprietários, portal
do proprietário e as telas de celular. O inventário completo e a tabela de comparação estão em
`arquivo/sistema-antigo` (só texto; nenhuma credencial, foto ou dado real foi copiado).

- **Minha leitura:** o sistema de julho era amplo e cheio de intenção, mas boa parte era casca
  (as próprias telas dizem "entra no próximo PR", "pendente até termos API confiável"). O SCL
  2.0 é mais estreito e mais fundo: regras de dinheiro testadas, histórico de tudo, permissões,
  "avisar em vez de supor". Não vale portar código; vale portar ideias.
- **O que o plano já cobre:** financeiro (sem os indicadores de diária média, RevPAR e RevPAN,
  que entraram na lista de ideias), despesas, reservas diretas e cotação, portal do
  proprietário, limpezas e equipe, site com disponibilidade real, portal do hóspede e mensagens
  automáticas, importação do Beds24, calendário e preços, cadastro marketplace, WhatsApp com
  revisão humana (M10).
- **Ideias que não estão no plano, para você decidir** (em ordem de valor, na minha opinião):
  reconciliação do CSV de ganhos do Airbnb com as reservas e o site; "recusado pelo dono" nas
  reservas do site para o marketplace; formulário público de cadastro no condomínio para o
  hóspede; exportação para o contador; recomendador de preço com dados de mercado e preço para
  "buraco de uma noite" (depois do M3.9); cupons; importação de extrato bancário e fatura;
  papel "convidado só leitura"; diária média, RevPAR e RevPAN no painel inicial. Prospecção de
  anúncios fracos, gerador de posts e campanhas ficaram anotados como ideias de crescimento.
- **O que não veio:** fotos reais (aparecem como "imagem omitida"), o código de julho e os
  dados de produção. O site antigo não está mais no ar.

### Marketplace e desconto do site — M12.1 (4/10)

O modelo B em partes iguais, que você decidiu em 4/10, está no sistema como **uma regra só**,
num lugar só: **Configurações → Marketplace e desconto do site**.

- **O que a tela tem:** as três taxas de referência (Airbnb, só do anfitrião, 16%; Booking, 15%,
  só para a coluna de comparação; pagamento no site, 4%) e os três pesos da divisão (hóspede,
  proprietário e SCL, hoje 1/1/1). Embaixo, a **simulação**: você digita diária, noites e
  limpeza e vê lado a lado o que o hóspede paga e o que cada um recebe no Airbnb, no Booking e
  no site — com os valores que estão nos campos, antes mesmo de salvar. Salvar fica registrado no
  histórico e vale para as cotações novas; as já feitas guardam o que mostraram.
- **A conta, em palavras:** sobre o valor cheio (diárias + limpeza + hóspede extra, o que o dono
  pediria na OTA), a margem é a taxa do Airbnb menos a taxa do pagamento (12% hoje). Ela é
  dividida pelos pesos: a parte do hóspede vira **desconto no site**, a da SCL é a receita da SCL
  e a do proprietário é o que ele recebe a mais que no Airbnb. Como a taxa do pagamento é cobrada
  só sobre o que o hóspede paga (já com desconto), sobra um pouco, e esse pouco fica com o
  proprietário. Exemplo de R$ 1.650 cheios: hóspede paga R$ 1.584 (−R$ 66), pagamento R$ 63,36,
  SCL R$ 66, proprietário R$ 1.454,64 (contra R$ 1.386 no Airbnb). Nada se perde nem se cria.
- **No site:** toda consulta e toda cotação mostram **Valor cheio**, **Desconto do site** e
  **Total**, para qualquer imóvel e qualquer contrato (gestão total inclusive — um modelo por
  contrato, desconto igual para todos, como você decidiu). O pedido de "segurar as datas" entra
  com o total com desconto, e a mensagem do WhatsApp diz o desconto. Se a taxa do pagamento for
  igual ou maior que a do Airbnb, não há margem: o site vende pelo valor cheio e a tela avisa.
- **O que ainda não acontece:** a divisão entre proprietário e SCL **não entra no financeiro**
  ainda — isso é o M12.2, que depende do pagamento (M8.2) e do extrato com periodicidades
  (M4.10). Até lá, o contrato marketplace aparece como "modelo B (Configurações → Marketplace)"
  e não gera lançamentos. Os percentuais são referências suas: confira de tempos em tempos nas
  tabelas das plataformas, porque o sistema não os adivinha.

### Recebimento do site: decidido — M8.0

Você decidiu em 4/10: **a empresa recebe e repassa**, pelo Mercado Pago, como já é com Booking
e reservas diretas; e o contador já confirmou que só a comissão é receita da SCL (o resto é
dinheiro do proprietário que passa pela empresa). Com isso o M8.0 fecha e o pagamento do site
(M8.2) passa a depender só da Conta Negócio do Mercado Pago no CNPJ da empresa (é dela que
saem as credenciais de produção; conta pessoal não serve) e das credenciais de teste, que eu te
peço na hora.

- **Quando o proprietário recebe:** o fechamento mensal (no dia 2 desde 5/10 — M4.13) continua
  sendo o padrão e o intervalo máximo; no portal, o proprietário pode escolher receber quinzenalmente (dias 1
  e 16), semanalmente (às segundas) ou assim que o dinheiro estiver disponível (dia seguinte ao check-in, com o
  Mercado Pago já tendo liberado). Uma reserva do site só conta como disponível depois do
  check-in e da liberação, para não pagar e depois ter de pedir de volta num cancelamento.
  Para as demais reservas em que a empresa recebe (Booking, diretas e qualquer canal que você
  configure assim), a reserva fica disponível depois do check-in e de o dinheiro ter entrado e
  sido registrado no financeiro; o que ainda não entrou não é repassado. Reserva em que o canal
  paga o dono direto (o padrão do Airbnb) não entra no repasse, só aparece no extrato como
  informação — vale o que está configurado em "quem recebe" de cada imóvel e canal, não o nome
  do canal; se estiver "a confirmar", fica pendente e fora do repasse até você definir. Se uma
  reserva começa no último dia do mês e o dono recebe assim que disponível, o repasse do dia do
  fechamento paga a reserva inteira junto com o fechamento, numa só transferência. E o fechamento mensal
  passa a seguir a mesma regra: o que ainda não entrou na empresa fica para o repasse seguinte,
  com aviso no extrato.
  Cada repasse manda um e-mail ao proprietário com o comprovante e a lista das reservas (no
  Pix manual, você anexa o comprovante ao marcar pago; sem ele, o e-mail espera e o repasse
  fica com aviso). O sistema de hoje só sabe fechar uma vez por mês; o resto entrou no plano como o item
  **M4.10** (extrato e repasses), já com a regra para reserva que atravessa o mês: é paga
  inteira no check-in e se acerta no fechamento seguinte. Pix é liberado na hora; cartão
  depende do plano do Mercado Pago (na hora com taxa maior, ou em 14 ou 30 dias com taxa
  menor), que eu confirmo antes de montar o M8.2.
- **O que você pediu junto:** um documento "como funciona" para o proprietário (gestão total
  e marketplace: o que a SCL faz, comissão e taxas, quando e como recebe, relatórios,
  cancelamentos), para consulta no portal, com aceite registrado no cadastro; e as páginas
  legais do site (termos de uso, privacidade e, quando decidida, a política de cancelamento),
  com aceite no checkout. Entraram no plano como M5.6 e M7.4, com textos editáveis por você
  no painel. A sua ideia do extrato com saldo e saque virou o item M4.10 (acima).
- **Checkout do site (pedido de 4/10):** na tela de pagamento o hóspede escolhe **Pix** (QR
  code e código copia e cola com botão de copiar; a reserva confirma sozinha quando o Pix chega)
  ou **cartão de crédito** (formulário no próprio site, com a marca do Mercado Pago; os dados do
  cartão ficam protegidos pelo Mercado Pago, nunca passam pelo nosso servidor). Parcelamento:
  sim, com os juros por conta do hóspede (sua decisão de 4/10); você escolhe no painel até
  quantas vezes. Sobre as taxas, a pesquisa rápida está em
  `requisitos/product/RECEBIMENTO-SITE.md`: o que pesa é o Pix (cerca de 1%, contra cerca de 4%
  do cartão), e entre os provedores o cartão varia pouco (uns 3% a 5%, conforme o prazo de
  recebimento) — numa reserva de R$ 1.000 a diferença fica em torno de R$ 10. **Você decidiu em
  4/10: Mercado Pago para tudo (Pix e cartão), com as taxas padrão**; pedir propostas a outros
  provedores e trocar fica para mais à frente, só se compensar, porque o pagamento fica atrás
  de um adaptador. A conta tem de ser a **Conta Negócio no CNPJ da empresa** (sem mensalidade,
  Pix e TED de saída grátis, saldo rendendo), e os repasses podem sair direto dela por Pix, sem
  passar pelo banco. Pix direto pelo banco ficou de fora por ora: o Itaú cobra do PJ cerca de
  1,45% por Pix recebido (mais que o Mercado Pago) e o Nubank PJ não tem integração oficial
  confirmada; chave Pix fixa com botão de copiar não serve como caminho principal, porque o
  sistema não saberia quem pagou.
- **Ainda em aberto, antes de ligar o pagamento de verdade:** quem arca com a taxa do
  pagamento (hoje: sai antes da divisão, cada um na proporção), quem arca com uma
  contestação de cartão perdida, e a política de cancelamento do site. Nada disso impede o
  M8.2 em teste.
- **Marketplace e gestão total na mesma régua (4/10):** o marketplace também recebe pela
  empresa, sem split do Mercado Pago, com o extrato. E vale **um modelo por contrato, nunca
  por reserva**: imóvel de gestão total que vender pelo site continua com a comissão do
  contrato (sobre o que entra depois da taxa do pagamento), e o desconto do hóspede é uma
  regra única do site, já aplicada na cotação do site desde o M12.1 (abaixo). Numa reserva de R$ 1.000 pelo site com 4% de desconto, o dono de
  gestão total recebe R$ 784 (contra R$ 714 no Airbnb) e a SCL R$ 138 (contra R$ 126): o site
  é melhor para os três sem regra nova. **Você decidiu em 4/10:** a SCL não cobra nada sobre
  as reservas que o dono do marketplace vende nas OTAs dele (o modelo B vale só para o que o
  site vende). Se o dinheiro dessas reservas passar pela empresa, ele é repassado inteiro ao
  dono; se o canal pagar o dono direto, aparece só como informação no extrato. A sua ideia de uma assinatura modular — uma base e serviços opcionais, como o
  motor de preços, cada um com um valor a mais — ficou registrada como ideia para estudo, sem
  compromisso.
- **Fonte de preços por imóvel (pedido de 4/10):** virou o item M3.9. Cada imóvel vai ter, com
  uma explicação curta no painel e no portal, a escolha entre os preços automáticos da SCL, os
  preços que o proprietário (ou a ferramenta de precificação dele, como PriceLabs ou Beyond
  Pricing) define no Beds24, ou preços digitados por ele no portal. O calendário é sempre
  sincronizado pelo Beds24, nos dois sentidos. Um aviso: "usar o preço do Airbnb" só funciona
  se o preço estiver no Beds24; o preço inteligente do Airbnb não dá para ler de fora.
  **Entregue em 4/10:** ver o bloco "Fonte de preços por imóvel — M3.9" abaixo.

### Conferência automática dos PRs mais rápida — M0.8

Você perguntou em 3/10 se dava para reduzir, com segurança, o tempo da conferência automática
que roda a cada PR (quase 20 minutos, a maior parte nos testes). Ficou assim:

- **Os testes continuam todos iguais, nenhum foi pulado.** O que mudou é que o banco de dados
  de teste, que era montado do zero a cada teste (uns 600 bancos por rodada), agora é montado
  **uma vez** e cada teste parte de uma cópia pronta. Mesmo isolamento, só sem repetir o
  trabalho. Medido: no GitHub, os testes de cada PR caíram de 20 minutos para menos de 7
  (a conferência inteira, de 22 para cerca de 8 minutos).
- **PR que não mexe no app** (só documentação, roadmap, este guia, o robô de backup) não roda
  lint, testes e build do app, porque nada deles poderia ter mudado. A conferência aparece
  verde do mesmo jeito. Qualquer mudança dentro de `app/` roda tudo, como antes.
- Nada muda para você: a revisão de cada PR fica pronta em menos tempo.

### Backup do repositório — M0.7

Você pediu em 3/10 um backup automático de tudo, "para caso algum dia algo dê problema". O
que ficou pronto:

- **Um robô de backup** que vai morar numa **segunda conta do GitHub**, só sua, com e-mail e
  senha diferentes. A cada 3 dias ele copia **todo** o repositório (todas as branches, tags e
  o histórico inteiro) para um repositório privado nessa conta e marca a cópia com a data e
  a lista do que existia naquele dia. Nada é apagado, nunca: se alguém apagar ou reescrever
  algo no repositório principal, ou apagar algo no próprio backup, o backup guarda a versão
  anterior e te avisa por e-mail (uma vez por ocorrência). Todas as versões ficam, para sempre.
- **O repositório principal não sabe que o backup existe.** A única ligação é uma "chave só
  de leitura" criada na sua conta principal e guardada dentro do repositório de backup. Se
  invadirem a conta principal, não há nenhum caminho até o backup. Se a chave vazar, ela só
  permite ler o código e você a cancela em um clique. Há uma segunda chave, de **escrita**,
  mas ela é criada na própria conta de backup, só vale para o repositório de backup e nunca
  sai de lá: não liga uma conta à outra. Ela existe porque o GitHub não deixa a chave
  automática dos robôs gravar arquivos de workflow, e o SCL tem um em todas as branches (foi
  o que travou a sua primeira rodada, em 4/10). Como essa chave faz o GitHub rodar automações
  que estejam no que o robô grava, nada que vem da origem vira branch ou tag no repositório de
  backup: fica numa área interna que o site não lista e onde nada roda, e o retrato de cada
  rodada sai sem a pasta de automações. Assim, mesmo que alguém invada a origem e plante uma
  automação maliciosa, ela não roda na conta de backup (apontamento do Codex em 4/10).
- **Aqui no repositório fica só o registro** de que o backup existe, como funciona e por quê
  (`requisitos/operations/BACKUP-E-RECUPERACAO.md`, com o passo de recuperação). Nenhum nome
  de usuário, repositório ou e-mail da conta de backup aparece em lugar nenhum — isso fica só
  com você, no gerenciador de senhas. Avaliei e manter esse registro não abre brecha: saber
  que existe um backup em algum lugar não dá acesso a nada.
- **Ativado por você em 4/10:** conta, repositório, duas chaves, três segredos, primeira rodada
  verde e variável `BACKUP_INICIADO`. O passo a passo continua na seção 6, item 23, para
  consulta e para renovar as chaves daqui a um ano.

**Atenção, isso protege o código e os documentos, não os dados.** Reservas, proprietários e
financeiro vivem no banco (Neon), e dados reais nunca podem ir para o GitHub. O backup do banco
é do próprio Neon: em 3/10, com o seu "pode fazer", a restauração por ponto no tempo passou de 1
para **7 dias** e entraram snapshots **diário** (guardado 14 dias) e **semanal** (35 dias) do
banco de produção, tudo dentro do Neon (detalhes na seção 6, item 23b). Nada para você fazer aí.

### Site: cotação e "segurar as datas" — M8.1

Depois de ver "Disponível" (ou "a confirmar") com valor, o visitante pode **segurar as datas**:

- **Cotação com código:** o site grava o que mostrou (datas, pessoas, diárias, limpeza, hóspede
  extra e total) e abre uma página própria, com um código tipo COT-XXXXXXXX. Cada vez que a página
  abre, o sistema confere de novo: se o valor ou a disponibilidade mudaram, avisa e manda fazer
  nova consulta em vez de deixar passar.
- **Segurar as datas:** o visitante informa nome, e-mail e WhatsApp e as datas ficam reservadas
  para ele por **30 minutos** (você muda em Configurações → Calendário e preços → Site público).
  Isso cria um **pedido** em Reservas (origem "site", situação "pedido"), que ocupa o calendário
  como qualquer reserva, mas **não entra no financeiro** até ser confirmado. Dois visitantes nas
  mesmas noites ao mesmo tempo: só o primeiro consegue; o segundo vê "acabaram de ficar
  indisponíveis".
- **O que a equipe faz:** o pedido aparece em Reservas com o contato do visitante e o código da
  cotação nas observações. Na ficha, **Confirmar reserva** transforma em reserva confirmada (aí
  entra no financeiro) e **Cancelar** libera as datas. Se ninguém fizer nada até o prazo, o pedido
  **vence sozinho** (uma rotina roda a cada 10 minutos) e as datas voltam à venda.
- **Freios contra abuso:** um pedido em andamento por e-mail e no máximo cinco por imóvel; repetir a
  mesma consulta não cria cotação nova, e cotações que nunca viraram pedido somem depois de 30 dias.
  Pedido do site com o prazo vencido não pode mais ser confirmado: a ficha avisa e as datas voltam à venda.
- **O que ainda não acontece:** nenhum pagamento (M8.2) e nenhuma escrita no Beds24 (M8.3). Até
  lá, o visitante fecha a reserva com a equipe pelo WhatsApp, usando o botão da página da cotação,
  e o Airbnb/Booking só fecham as datas quando a reserva confirmada for enviada (M8.3) — por isso,
  confirme ou cancele os pedidos do site com rapidez.

### Portal do proprietário: bloqueio de uso próprio — M5.5

O proprietário passa a cuidar do próprio calendário no portal, sem precisar pedir à equipe:

- **Bloquear datas:** no portal, na seção "Bloquear datas para uso próprio", ele escolhe o
  imóvel (só os dele), a primeira noite, o dia em que o imóvel volta a ficar livre e um motivo
  (opcional; sem motivo fica "Uso próprio"). As datas saem de venda no sistema na hora e fecham
  no Beds24 e nos canais no próximo envio de calendário (M3.7) — como qualquer bloqueio, só
  quando o envio estiver ligado.
- **Liberar datas:** só o que ele mesmo bloqueou e que ainda não passou, sempre com
  confirmação. Bloqueio feito pela empresa, pelo titular anterior do imóvel ou que veio do
  Beds24 aparece na lista com "quem bloqueou", mas só a empresa libera.
- **Limites:** nunca no passado e nunca por cima de uma reserva — o portal avisa em vez de
  deixar passar.
- **Permissão por contrato:** cada contrato (ficha do imóvel → Contratos) tem a opção
  **"Bloqueio pelo portal"**, que vem como **Sim**. Dá para **ligar ou desligar na própria
  linha do contrato**, a qualquer momento, e vale daí para frente (o que o proprietário já
  bloqueou fica; a equipe remove no Calendário, se for o caso). Com "Não", o proprietário vê o
  calendário mas não bloqueia (o portal explica que precisa falar com a empresa). Sem contrato
  em vigor nas datas, também não dá.
- **No painel:** o bloqueio aparece no Calendário com a origem "Proprietário (portal)" e fica no
  histórico do imóvel, como os da equipe.

### Site: disponibilidade e valor reais — M7.2

Na **Consulta** do site e na página de cada apartamento (quando o link traz as datas), o
visitante passa a ver, antes de mandar a mensagem:

- **Disponível**, **Indisponível nessas datas** ou **Disponibilidade a confirmar**. Uma noite
  só conta como disponível quando não há reserva nem bloqueio no SCL **e** a última leitura do
  Beds24 é recente (padrão: até 36 horas; ajustável em Configurações → Calendário e preços →
  Site público) e informa unidade livre. Sem leitura, ou leitura velha, o site diz "a
  confirmar" — nunca "disponível" por falta de informação.
- O **motivo**, em linguagem simples: datas já reservadas, mínimo de noites para aquela entrada
  (o mesmo mínimo que vai ao Beds24, inclusive em eventos e sobras), máximo, antecedência, dia
  de entrada/saída, pessoas acima da capacidade.
- O **valor por partes** (diárias, limpeza, hóspede extra e total), usando os mesmos preços por
  noite que o SCL envia ao Beds24 (eventos, feriadões e última hora incluídos) e as taxas do
  cadastro do imóvel. Sem preço cadastrado, o valor fica "a confirmar".
- A mensagem do WhatsApp passa a trazer "O site mostrou R$ … para N noites" como referência.

Nada é cobrado pelo site; a cotação guardada e o "segurar as datas" já existem (M8.1, abaixo) e o
pagamento vem no M8.2. A precisão da disponibilidade depende da frequência da importação do Beds24
(hoje, uma vez por dia quando ligada): consultas feitas de tarde já podem estar "a confirmar"
se a importação não rodou. Estadias acima de 90 noites (ajustável) pedem contato com a equipe.

### Calendário e preços no Beds24 — M3.7

O SCL passa a ser a fonte oficial de calendário e preços: o que você cadastra aqui vai ao
Beds24 e dele ao Airbnb/Booking. Desde 4/10, para os **preços**, isso vale imóvel por imóvel
(M3.9, seção 2): onde o proprietário define os preços no Beds24 (ele ou a ferramenta dele), o
SCL só lê e não mexe — a escolha fica na ficha do imóvel e, nesses imóveis, o envio manda só
calendário, mínimos e bloqueios. O calendário é sempre sincronizado. Tudo está pronto, mas **desligado**: nada sai enquanto a
variável `BEDS24_ESCRITA` não estiver com o valor `ligada` na Vercel e o imóvel não estiver
marcado para envio. Quatro lugares novos:

1. **Configurações → Calendário e preços** (só você): as regras da operação, editáveis:
   - mínimo de noites por dia da semana da entrada (padrão: domingo a quinta 1, sexta e
     sábado 2), máximo de noites (27) e o horizonte do envio (270 noites ≈ 9 meses);
   - **feriados**, um por linha (data e nome). O sistema monta o feriadão sozinho pela regra
     aprovada: feriado na quinta → quarta a domingo; sexta → quinta a domingo; segunda → sexta
     a segunda; terça → sexta a terça; quarta, sábado e domingo não criam feriadão. No
     feriadão: mínimo 3 noites e preço = 2× o preço base (os dois editáveis), só nos imóveis
     que você marcar (Búzios pode ficar de fora). **Os feriados começam vazios**: você
     cadastra as datas de cada ano depois de conferir;
   - **temporadas e eventos** (alta temporada, Réveillon, Carnaval, Rock in Rio): noites,
     multiplicador do preço base (2×, 3×, 4×…), mínimo de noites e imóveis. Dois eventos na
     mesma noite nunca somam: vale o maior. Também começam vazios;
   - **última hora**: duas faixas pela antecedência da noite (padrão: 7 a 3 dias antes 15%,
     2 dias antes até o próprio dia 25%) e quem aplica o desconto. O padrão é **"Beds24
     aplica"**, porque as regras nativas já estão configuradas nos seis imóveis: o SCL envia
     o preço de referência e, quando o desconto do Beds24 deixaria a diária abaixo do piso,
     envia um valor maior para que o resultado fique exatamente no piso. Se um dia você
     desligar as regras nativas, troque para "SCL aplica" e o SCL manda o preço já reduzido;
   - **imóveis com envio ligado** e o **envio automático diário** (7h, depois da importação).
2. **Ficha do imóvel → Preço e taxas:** dois campos novos, os **pisos de última hora** de cada
   faixa (ex.: 350 e 300 nos estúdios; 700 e 650 no 303). Sem piso cadastrado o sistema
   avisa e não reduz por conta própria. O preço base (B) e os períodos especiais continuam
   onde estavam; o preço explícito de um período substitui qualquer regra automática.
3. **Calendário → Bloquear datas:** bloqueio manual (uso próprio, manutenção) com imóvel,
   primeira noite, dia da liberação e motivo. Vale no SCL na hora e vai ao Beds24 como
   "fechado" no próximo envio; remover (com confirmação) reabre no próximo envio, devolvendo
   a noite ao que ela tinha antes (se o Beds24 já restringia a entrada ou a saída naquela
   data, essa restrição volta). Bloqueios que vieram do Beds24 aparecem, mas mudam lá. O SCL
   **nunca reabre** um bloqueio que ele mesmo não fechou, e só reabre o seu se a leitura
   feita na hora ainda mostrar esse bloqueio lá. Se um dia o quarto Beds24 vinculado a um
   imóvel for trocado, o SCL avisa e não mexe no quarto antigo: o que ele tinha fechado lá
   precisa ser reaberto à mão no Beds24. Se, ao bloquear, remover um bloqueio ou mudar o
   vínculo Beds24 de um imóvel, aparecer "há um envio de calendário em andamento", é só
   esperar um minuto e tentar de novo.
4. **Calendário → Conferir calendário e preços:** a prévia agora mostra, por noite, o preço
   de referência, o preço que seria enviado, o preço final esperado depois da última hora,
   o mínimo pela regra e o mínimo ajustado às **sobras** (se sobram 3 noites até a próxima
   reserva num período de mínimo 5, as entradas ficam com mínimo 3, 2 e 1), o máximo, o
   bloqueio e a última leitura do Beds24 — e a ação (enviar ou já igual). Embaixo, só para
   você: **Simular envio** (não grava nada; diz quantas noites iriam) e **Enviar agora**
   (pede confirmação e cobre todo o horizonte do imóvel). Todo envio (e toda simulação)
   começa lendo o Beds24 na hora: se essa leitura falhar, nada é enviado. Depois de enviar,
   o SCL relê o Beds24 e marca cada noite como confirmada ou divergente; o histórico guarda
   antes/depois, regra usada e resultado, inclusive quando o Beds24 recusou o envio.

Regras de segurança: só vão as noites diferentes do que o Beds24 já tem (repetir o envio
não muda nada nem acumula desconto, porque a referência é sempre recalculada do cadastro);
reservas nunca são criadas, alteradas ou canceladas por aqui; se o Beds24 mudar um valor
depois do envio, a prévia avisa e o SCL reenvia o valor oficial; o que não tem preço
cadastrado não vai; o que o SCL não entende (0 unidades livres sem reserva conhecida,
bloqueio só no Beds24) vira aviso, não ação.

**Como testar no 103 (ordem sugerida):**

1. Em Configurações → Calendário e preços, confira os mínimos e cadastre os feriados do
   restante de 2026 e de 2027 e os eventos (alta temporada 15/12 ao fim de fevereiro 2×;
   Réveillon 25/12 a 1/1 mínimo 5 e 4×; Carnaval mínimo 5 e 4×; Rock in Rio 3×), marcando os
   imóveis do Leblon. Marque o **103** em "imóveis com envio ligado". Deixe o automático
   desligado.
2. Na ficha do 103, confira o preço base (450) e cadastre os pisos (350 e 300).
3. Em Calendário → Conferir, escolha o 103, leia a prévia e clique em **Simular envio**.
   Confira os números e os avisos. Repita com datas de evento e com uma sobra entre reservas.
4. Na Vercel, crie `BEDS24_ESCRITA` = `ligada` (exatamente assim) e confira que o
   `BEDS24_REFRESH_TOKEN` foi gerado com o escopo **inventory** (um token só de leitura
   recebe "sem permissão de escrita"). Faça Redeploy.
5. Volte à prévia e clique em **Enviar agora** (marque a confirmação). Veja o resultado
   (enviadas × confirmadas), abra o Beds24 e o Airbnb e confira algumas noites normais, um
   fim de semana, um evento e a última hora de hoje/amanhã.
6. Teste um bloqueio: bloqueie 2 noites no Calendário, envie, confira no Beds24; remova o
   bloqueio, envie de novo, confira que reabriu.
7. Só então ligue o **envio automático diário** e, se quiser, marque os outros imóveis.

**Limites:** a releitura confirma o que o Beds24 gravou, não a cotação final no Airbnb
(taxas, limpeza, descontos por duração ficam fora). Última hora em grandes eventos
e as tarifas próprias de Búzios continuam decisões suas (as sobras de feriado e evento com
reserva já seguem a sua regra de 6/10, no M3.10): o sistema aplica as faixas em todas as noites, como as regras nativas fazem
hoje, e não inventa preço para Búzios (cadastre eventos próprios ou deixe fora). Dias de
entrada/saída restritos no cadastro ainda não são enviados.

### Conferir calendário e preços — preparação M3.7a

Em **Painel → Calendário → Conferir calendário e preços com o Beds24**, escolha um imóvel
e a primeira/última noite. O 103 vem selecionado se existir e estiver ativo; na ausência
dele, o 403. É possível consultar qualquer imóvel da empresa, inclusive arquivado, sem reativá-lo.
Administrador e operação podem consultar; proprietário, hóspede e limpeza não acessam a tela.

- Até **92 noites por consulta**, contando a primeira e a última. O resumo diz quantas
  noites têm leitura do Beds24; avance as datas para conferir o restante do horizonte.
- Por noite: preço calculado com o cadastro SCL, preço registrado no Beds24, mínimos,
  reservas/bloqueios locais e horário da leitura externa no fuso do imóvel.
- Valor ausente é mostrado como não informado. Mesmo valor não prova igualdade atual
  no Airbnb/Booking; zero ou ausência de reservas locais não prova disponibilidade.
- O administrador tem atalhos para o cadastro e a importação existente. A prévia lê apenas
  o que já foi importado; não faz uma nova consulta ao Beds24 ao abrir a página.
- **Preços explícitos de períodos especiais são preservados**, inclusive acima do teto
  geral ou abaixo do piso. Os limites se aplicam ao preço base quando habilitados. Isso
  corrige também o simulador; não altera valores de reservas ou tarifas dos canais.

**O que você pode conferir agora:** comece pelo 103, compare algumas noites normais e de
evento com o Beds24 e veja se o cadastro representa o que você pretende usar. A cobertura
depende do intervalo importado; a prévia mostra suas lacunas.

**Atualização M3.7:** as regras operacionais, o envio com conferência e o histórico estão
implementados (seção acima). O teste no imóvel escolhido e a ativação continuam com você.

### Anúncios — atualização M2.9

Em **Painel → Anúncios**, cada imóvel tem um quadro com **Site, Airbnb e Booking.com**.
O filtro de imóveis do painel vale aqui; mês e ano não alteram anúncios. Por padrão aparecem
os ativos; é possível incluir arquivados ou selecioná-los explicitamente.

- **Site:** título, descrição e preço base vêm do cadastro do imóvel. O atalho leva ao mesmo
  cadastro para editar; não há uma segunda cópia. A situação respeita a empresa configurada
  para o site, a marcação público e o imóvel ativo. O preço base é referência interna: a
  cotação pública ainda depende do M7.2. As fotos reais continuam pendentes no M7.3.
- **Airbnb e Booking:** o administrador abre “Editar referência”, informa situação, link,
  título, descrição, preço base em reais e até 30 links de fotos. Pode marcar que conferiu no
  canal agora; a tela guarda a data e mostra no horário de Brasília. Ao editar sem marcar,
  a referência volta a aguardar conferência. A equipe de operação pode consultar, mas não editar.
- **Diferenças:** a tela compara os valores conhecidos de cada par de canais. Ausência não
  vira zero nem prova igualdade. Preços diferentes podem refletir taxas/regras do canal;
  links ou ordem de fotos diferentes pedem conferência visual, não provam imagens diferentes.
- **Limite:** são referências manuais, não uma leitura automática das OTAs. A importação de
  reservas do Beds24 não preenche estas fichas. Os IDs existentes são mostrados sem alterá-los
  e não comprovam publicação. Com vários IDs no mesmo canal, a tela avisa que a ficha é uma
  referência principal e que os demais anúncios precisam ser conferidos no canal.
- **Salvar** altera só a referência interna e registra histórico na ficha do imóvel. Não
  publica anúncios, não troca preços nas OTAs e não copia fotos para o site. Uma ficha que
  mudou em outra aba não é sobrescrita: a tela pede para recarregar e conferir.

**Como conferir:** escolha um imóvel, abra o anúncio no canal, preencha uma referência e
salve com a confirmação manual. Verifique a data, os links e os alertas. Reabra a tela para
confirmar que os dados persistiram. A operação deve conseguir ler, sem botões de edição.

**Próximo teste de envio (M3.7):** usar o 103; o 403 fica como alternativa autorizada por
Diego em 2/10. A implementação e a ativação do envio ainda estão pendentes.

### Conferência das reservas — atualização M3.8

Depois de publicar esta atualização:

1. Em **Configurações → Integrações**, faça **Importar agora** novamente. Não é preciso refazer vínculos: os mesmos registros e códigos SCL são preservados. O SCL continua apenas lendo o Beds24.
2. Em **Reservas**, há atalhos para **reservas mais recentes na origem** e **consultas**. A lista por período começa apenas com imóveis ativos. Use **Todo o histórico importado/cadastrado** para pesquisar sem o recorte de mês/ano da estadia; sem uma seleção de imóveis, inclui também os arquivados. Eles continuam identificados no filtro e podem ser selecionados explicitamente em qualquer escopo.
3. Busque por código SCL, código do canal ou nome; escolha situação, data de entrada ou mais recentes na origem, e opcionalmente últimos 7 ou 30 dias. A lista mostra 25 registros por página, total, primeira/anterior/próxima/última página, mantendo os filtros.
4. **Feita em (origem)** usa a data informada pelo Beds24, exibida no horário de Brasília. É diferente de **Cadastrada no SCL em**, no detalhe. Data não informada fica explícita, no fim da ordenação por mais recentes e fora dos filtros de 7/30 dias. Não usamos a importação como substituta. Na primeira conferência, compare uma data conhecida com o canal original.
5. **Consulta** não é reserva confirmada, não ocupa o calendário, não cria alerta de sobreposição e não gera receita. **Pedido de reserva** ainda não é receita e mantém a restrição de datas anterior até o status mudar na origem. Pendentes antigas só são distinguidas quando o Beds24 devolve o status; não se transforma todo registro pendente em consulta por suposição.
6. O resumo da última importação separa **adicionadas ao SCL**, **alteradas** e **canceladas**, com links para os registros. Cancelada significa que uma reserva existente mudou para esse estado naquela importação. Atualizar dados de uma reserva que já estava cancelada conta como alteração; trazer uma reserva cancelada pela primeira vez conta como adicionada ao SCL. A lista de cada execução começa nesta atualização; importações anteriores não ganham histórico inventado. Os detalhes dos registros mostram o estado atual; o histórico individual registra as alterações.

Não precisa preencher descrições dos apartamentos para importar. A melhoria não ativa a rotina diária, não envia mudanças às OTAs e não altera a configuração dos canais. Para conferir: encontre uma consulta pelo código, confirme seu rótulo após reimportar e confira as mesmas datas no calendário; repita a importação e verifique que não surgiram duplicatas. A primeira releitura pode aparecer como alteração apenas por recuperar a data original/status.

**Itens já prontos (na `main`):**
- M0.1: repositório limpo, plano único (ROADMAP) e regras para o Claude.
- M0.2: esqueleto do aplicativo, com testes automáticos.
- M0.3: conexão com o banco de dados (Neon) e banco de teste automático.
- M0.4: **painel interno com menu e filtro global** (imóveis + mês/ano). Todas as seções
  aparecem no menu, marcadas como "em construção" até ganharem conteúdo. Funciona no
  celular: o menu vira uma faixa que desliza para o lado.
- M1.1: **quem pode ver e fazer o quê.** Existem quatro papéis:
  - **admin** (você): pode tudo;
  - **operação** (equipe): reservas, calendário, limpezas, manutenção e mensagens, mas **não vê o financeiro**;
  - **proprietário**: só **lê** (imóvel, reservas, calendário e financeiro), e **só dos imóveis dele**. Representantes
    autorizados veem o mesmo que o proprietário que representam;
  - **hóspede**: não entra no painel; vê só a própria reserva em "Minha reserva" no site (M9.1).

  O vínculo proprietário ↔ imóvel é sempre cadastrado explicitamente, nunca deduzido por e-mail ou CPF.
  Tudo o que não está permitido é bloqueado.
- M1.2: **login com Google.** O painel só abre para quem entra com uma conta Google
  cadastrada (admin ou operação). Seu e-mail vira administrador automaticamente no
  primeiro login (configurado na Vercel, fora do GitHub). Tem botão "Sair" no topo.
- M1.3: **login por código no e-mail** (para quem não usa Google, como proprietários e
  equipe). A pessoa digita o e-mail, recebe um código de 6 dígitos e entra. Segurança:
  o código vale **10 minutos**, só pode ser usado **uma vez**, **5 erros** bloqueiam o
  código, no máximo **5 pedidos por hora** por e-mail, e pedir um novo cancela o anterior.
  A tela responde sempre igual, exista ou não o e-mail (e mesmo se o serviço de e-mail
  falhar), para ninguém descobrir quem tem acesso. Só recebe código quem está cadastrado e
  ativo; se o envio falhar, o código anterior continua valendo. Para funcionar na internet
  falta um serviço de envio de e-mail (seção 6, item 5).
- M1.4: **convite de proprietário para o portal.** Na ficha do proprietário, seção
  "Acesso ao portal": você digita o e-mail dele e clica em **Gerar convite**. Aparece um
  link para copiar e mandar (por WhatsApp, por exemplo; se o e-mail do sistema estiver
  ligado, ele também recebe por e-mail). O proprietário abre o link, clica em "Aceitar e
  entrar" e entra com **aquele e-mail** (código ou Google) — só assim o convite é aceito.
  O link vale **7 dias**, funciona **uma vez só** e você pode **cancelar** a qualquer
  momento; a ficha mostra a situação (pendente, aceito, cancelado, vencido) e o histórico
  registra quem convidou e quando foi aceito. Quem só tem o link, sem acesso ao e-mail,
  não entra. Depois de entrar, o proprietário vê o **Portal do proprietário** (por
  enquanto só os imóveis dele; relatórios e saldo chegam no M5) e **não** consegue abrir
  o painel interno.
- M1.6: **página "Sistema"** (menu **Sistema**, só para você). Três partes:
  - **Serviços:** banco, login com Google, e-mail, Beds24, WhatsApp e pagamentos — cada um
    com "Funcionando" (testado na hora, como o banco), "Configurado" (chave existe), "Falta configurar", "Com problema" ou "Ainda não construído", e o que
    falta. Nenhuma chave ou senha aparece. Mostra também se o envio para o Beds24 está
    ligado ou desligado.
  - **Automações:** o que roda sozinho, quando roda, a última vez que rodou e o resultado
    (as que ainda vão existir aparecem com o item do plano em que chegam).
  - **Regras em vigor:** as regras gerais e, para cada imóvel, o proprietário, o contrato de
    hoje (e o próximo, se já estiver cadastrado) e quem recebe em cada canal, com o botão
    **Editar**. O que estiver faltando (imóvel sem contrato, sem proprietário) aparece em
    vermelho.
- M1.7: **Configurações** (menu **Configurações**, só para você), com abas:
  - **Empresa:** nome, razão social, CNPJ, e-mail, telefone/WhatsApp, endereço e site. O
    nome aparece no painel, no portal do proprietário e nos e-mails de convite e de código.
  - **Usuários e permissões:** adicionar alguém da equipe (nome, e-mail e papel:
    Administrador ou Operação), trocar o papel, renomear, desativar (pede confirmação e
    corta o acesso na hora) e reativar. Você não consegue se desativar nem tirar o seu
    próprio papel, e o sistema nunca deixa a empresa sem nenhum administrador. Embaixo, uma
    tabela mostra o que cada papel pode fazer. Proprietários continuam entrando por convite.
  - **Regras financeiras:** sobre qual valor a comissão é calculada e **quem recebe em cada
    canal** (canal paga o proprietário direto, empresa recebe e repassa — na periodicidade que o
    proprietário escolher, mensal por padrão, M4.10 —, ou "a confirmar"). É o padrão da empresa; cada imóvel e cada reserva ainda podem ter a sua
    escolha. Ao salvar, pede confirmação e recalcula só as reservas com entrada **de hoje em
    diante**, e mostra quantas foram recalculadas. O sistema guarda cada versão da regra com
    a data em que passou a valer: uma reserva antiga continua com a regra da época, mesmo que
    o Beds24 a mande de novo.
  - **Integrações:** a situação de cada serviço e o nome exato da variável que vai na
    Vercel. Chaves e senhas nunca ficam no painel.
  - **Categorias de despesa:** as mesmas da tela de Despesas, também editáveis aqui.
  - **Modelos de mensagem:** quatro modelos prontos (confirmação, instruções de check-in,
    lembrete de check-out e agradecimento) que você edita, arquiva ou exclui, e pode criar
    outros. Use variáveis como `{hospede}` e `{checkin}`; a tela mostra uma prévia com dados
    de exemplo e recusa variável escrita errada (ex.: `{hopede}`). O envio automático chega
    no M9.2 e no WhatsApp (M10).
  - **Textos do site:** título, subtítulo, "sobre", "como reservar", contato e rodapé. O site
    novo (M7.1) vai ler daqui.
  Toda mudança fica no histórico com quem fez e quando.
- M2.1: **cadastro de imóveis** em Painel → Imóveis: código (102, 403, buzios…), nome
  comercial, bairro, endereço, capacidade, quartos, banheiros, descrição, se **aparece no site**
  e se está **em operação**. O filtro global do painel passa a usar essa lista. Búzios deve ser
  cadastrado com "Aparece no site" desmarcado. Só o admin cadastra/edita; a equipe só consulta.
- M1.5: **histórico de alterações.** Toda mudança fica registrada com quem fez, quando e o
  que mudou (ex.: "Diego alterou · Nome: Studio A → Studio B"). Aparece embaixo da ficha de
  cada imóvel e vai valer para todos os módulos (reservas, financeiro…). O histórico não pode
  ser apagado pelo sistema.
- M2.6: **cadastro completo do imóvel**, na página de cada imóvel (Painel → Imóveis → abrir):
  - **Endereço:** CEP, complemento e estado, além do que já existia.
  - **Camas e comodidades:** quantas camas de cada tipo (casal, queen, king, solteiro,
    sofá-cama, beliche, colchão extra) e a lista de comodidades para marcar, com espaço para
    outras.
  - **Regras da casa e horários:** animais, fumar, festas, texto de regras para o hóspede,
    horário de entrada e de saída.
  - **Preço e taxas:** preço base da noite, taxa de limpeza, hóspede extra (valor por noite e
    a partir de qual hóspede) e **preço dinâmico** (liga/desliga, com preço mínimo e máximo —
    o valor nunca sai dessa faixa; o cálculo dinâmico automático chega com o M3.7).
  - **Regras de venda:** estadia mínima e máxima, antecedência mínima, até quantos dias à
    frente aceita reserva, e em quais dias da semana pode entrar e sair.
  - **Períodos especiais:** Réveillon, Carnaval etc., com preço da noite e/ou estadia mínima
    próprios. Dois períodos não podem se cruzar; excluir pede confirmação.
  - **Simular uma estadia:** escolha datas e hóspedes e veja se pode ser vendida (e por quê
    não, se for o caso) e quanto dá: diárias, limpeza, hóspede extra e total. Se faltar preço
    em alguma noite, o total fica "pendente" com aviso — o sistema não inventa valor.
  Campo em branco significa "ainda não cadastrado". Tudo vai para o histórico do imóvel. O
  site, o Beds24 (M3.7) e as cotações vão usar estas mesmas regras.
- M2.2: **cadastro de proprietários** em Painel → Proprietários: nome/razão social, pessoa
  física ou jurídica, CPF/CNPJ (conferido automaticamente), e-mail, telefone, endereço,
  **chave Pix**, observações e **quais imóveis são dele**. Cada proprietário pode ter
  **representantes autorizados** (cônjuge, financeiro, procurador), com opção "recebe cópia dos
  relatórios". Essa área é **só do admin** (tem dados pessoais); na lista o CPF aparece
  mascarado (•••.•••.247-25) e o histórico nunca grava CPF nem Pix por extenso.
- M2.3: **contratos de gestão com data de início e fim**, na ficha de cada imóvel: gestão
  completa (sugestão 15%), gestão online (10%) ou marketplace (modelo B em partes iguais,
  com pesos e taxas em Configurações → Marketplace e desconto do site, M12.1; o cálculo no
  financeiro é o M12.2).
  Mudou o percentual? Encerra-se o contrato atual e cria-se um novo a partir da data nova —
  assim reservas antigas continuam com a regra da época (ex.: 102, 303 e 399 voltando a
  15/85 em 01/01/2027 = novo contrato começando nessa data). O sistema não deixa dois
  contratos valerem no mesmo dia. Só o admin mexe em contratos.
- M2.4: **canais de cada imóvel** — na ficha do imóvel, os números dele no Beds24, Airbnb e
  Booking. É por aí que, quando ligarmos o Beds24, o sistema vai saber a qual imóvel cada
  reserva pertence. Um mesmo número não pode ficar ligado a dois imóveis.
- M3.1: **base das reservas e bloqueios** (ainda sem tela — a lista e o calendário vêm nos
  próximos itens). Cada reserva tem código SCL próprio (ex.: SCL-7K2QXM), origem (Airbnb,
  Booking, site, direta), entrada/saída, hóspedes, valores (bruto, taxa do canal, líquido — o
  líquido pode ficar "desconhecido" em vez de inventado) e situação. Quando o Beds24 for
  ligado, rodar a sincronização duas vezes não duplica nada, e toda mudança vinda de lá fica
  no histórico. O sistema também já sabe detectar **overbooking** (duas reservas no mesmo
  imóvel no mesmo dia).
- M3.5: **tela de Reservas** no painel: lista filtrada pelo filtro do topo (imóveis + mês/ano),
  com código, imóvel, origem, entrada, saída, noites, hóspede, valor e situação; aviso em
  vermelho se houver overbooking; opção de mostrar canceladas; **"Nova reserva"** para lançar
  à mão (reservas diretas/WhatsApp); ficha de cada reserva com botão de cancelar e histórico.
  A equipe de operação vê as reservas, mas **não vê valores**.
- M3.4: **Calendário central** — todos os imóveis numa grade do mês, uma linha por imóvel,
  reservas coloridas por canal (Airbnb, Booking, site/direta), bloqueios listrados e
  **overbooking com borda vermelha**. Clique/toque numa reserva abre a ficha. Setas para mês
  anterior/seguinte; no celular a grade desliza para o lado com a coluna dos imóveis fixa.
- M2.5: **dados de demonstração** — um comando carrega 6 imóveis, 3 proprietários, contratos e
  ~37 reservas **fictícias** para testar/mostrar o sistema (nunca roda por cima de dados reais).

- M3.2: **leitura do Beds24 (só leitura).** O sistema já sabe ler do Beds24 as reservas,
  os bloqueios, o calendário (unidades livres, preço e estadia mínima) e a lista de
  quartos. **Por enquanto não escreve nada lá** (a escrita de calendário e preços vem no
  M3.7, ligada só quando você mandar). Cada reserva do Beds24 é ligada ao imóvel certo pelos
  "canais de cada imóvel" (na ficha do imóvel: canal Beds24, número do imóvel no Beds24 e,
  como detalhe, o número do quarto). Qualquer informação estranha vira uma
  **divergência** para conferir — nunca uma reserva inventada. O refresh token cadastrado
  na Vercel agora gera e renova automaticamente o token de acesso. Em **Configurações →
  Integrações → Testar conexão com Beds24**, o administrador confere a leitura dos imóveis.
  Esse teste não importa reservas; a importação é feita na seção abaixo, entregue no M3.3.
- M3.3: **trazer os dados do Beds24 para o SCL.** Em **Configurações → Integrações**,
  busque os quartos e escolha o imóvel SCL correspondente a cada um. O vínculo precisa
  dos números do imóvel e do quarto Beds24; a tela preenche esses números pela sua escolha.
  Salve a data inicial das reservas e quantos dias de calendário quer consultar (até 365).
  Depois, confira os vínculos, marque a confirmação e clique em **Importar agora**.
  - A mesma reserva não é criada de novo a cada execução. Se já veio por planilha, é
    reconhecida pelo canal Airbnb/Booking e pelo código da reserva, preservando o código
    SCL e o histórico. Sem código comum não há como reconhecer automaticamente; confira
    possíveis duplicidades antes do primeiro teste. Depois de vinculada ao Beds24, a
    planilha não substitui seus dados.
  - Cancelamentos precisam vir explicitamente do Beds24. Reserva ou bloqueio que não
    aparece na consulta fica como estava e gera aviso. Quartos sem vínculo não são
    importados. Moeda diferente de real, ou não informada, impede a importação financeira.
  - Valores realizados/conciliados não são reescritos. Alterações em reservas já iniciadas
    também preservam o financeiro anterior; divergências pedem conferência e ajuste manual.
    Contato corrigido no painel e anotações são preservados. A importação não dispara uma
    confirmação atrasada de reserva; as demais regras de mensagens continuam valendo.
  - Preço, estadia mínima e unidades livres ficam guardados como **observações** do calendário
    do Beds24. Dia não retornado é desconhecido. Isso ainda não liga cotações ou vendas no site.
  - O histórico mostra as últimas dez execuções e até cem avisos por execução. Uma falha
    técnica durante o processamento desfaz a transação; registros inválidos são separados
    para conferência, sem inventar dados.
  - A rotina automática começa **desligada**. Depois da conferência manual, pode ser ligada
    no mesmo painel. Roda uma vez por dia, entre **6h15 e 7h15**, horário de Brasília,
    com o agendamento configurado na Vercel. Pode importar manualmente entre as execuções.
    Essa frequência inicial não garante disponibilidade atualizada para vendas; uma rotina
    mais frequente precisa ser definida antes de usar a disponibilidade real do M7.2.
  - Nenhuma mudança é enviada ao Beds24 ou ao Airbnb nesta etapa. O envio é o M3.7.
- M2.7: **quem recebe o pagamento, por imóvel e por canal.** Na ficha de cada imóvel, seção
  "Quem recebe o pagamento": para Airbnb, Booking, site, direta (WhatsApp, indicação) e
  outros, você escolhe "canal paga o proprietário direto" ou "empresa recebe e repassa" (ou
  deixa o padrão: Airbnb direto ao proprietário, os demais pela empresa). Ao salvar, o
  financeiro das reservas daquele imóvel é recalculado. Uma reserva específica ainda pode ter
  sua própria escolha. **Um proprietário por imóvel** (pessoa ou empresa): o sistema não
  deixa ligar um imóvel que já tem dono a outro proprietário — primeiro tira de um, depois
  põe no outro.
- M3.6: **importar reservas de uma planilha** (Painel → Reservas → **Importar planilha**),
  enquanto o Beds24 não está ligado. Baixe o modelo, preencha (ou exporte de outro lugar) e
  salve do Excel como "CSV separado por ponto e vírgula". Colunas obrigatórias: imóvel
  (código, ex.: 403), origem (airbnb, booking, site, direta ou outro), código da reserva no
  canal, entrada e saída (DD/MM/AAAA). Opcionais: situação, hóspedes, nome, e-mail,
  telefone, cidade, valor bruto, taxa do canal, valor líquido, observações.
  - Primeiro o sistema **confere** (não grava nada) e mostra linha a linha: nova, a atualizar,
    já importada e igual, ou com erro (e qual o erro). Também avisa se a reserva cruza com
    outra no mesmo imóvel.
  - Depois você clica em **Importar**: só as linhas sem erro entram, e o financeiro de cada
    reserva é calculado na hora. Se faltar algo para o cálculo (valor bruto, contrato do
    imóvel), a reserva entra e a tela avisa a linha. Se uma reserva que já teve dinheiro movimentado mudar na
    planilha, o sistema atualiza a reserva, deixa o financeiro como está e avisa a linha,
    para você fazer o ajuste manual.
  - Até 500 reservas por arquivo (arquivos maiores: divida em partes). O histórico de cada
    reserva mostra quem importou.
  - Importar o mesmo arquivo de novo **não duplica**: a reserva é reconhecida pela origem +
    código do canal, e o que mudou é atualizado.
  - Acentos funcionam tanto em arquivo do Excel brasileiro quanto em UTF-8. Arquivo com
    aspas abertas sem fechar é recusado (evita sumir com linhas). Só o
    administrador importa (a planilha traz valores).
- M4.4: **adiantamentos** (Painel → Despesas → **Adiantamentos**). Quando a empresa paga uma
  despesa que é do proprietário (ex.: reparo de R$ 4.000), nasce um adiantamento: o valor que
  ele deve. A tela mostra, por proprietário, quanto há a cobrar e o que está contestado, e a
  lista de adiantamentos com a situação (a cobrar, parcialmente quitado, quitado, contestado).
  Em cada um você pode:
  - **registrar reembolso** (total ou parcial) quando o proprietário devolver o dinheiro;
  - **registrar contestação** — enquanto estiver contestado, ele não é cobrado nem descontado;
    depois você resolve: **manter a cobrança** ou **a empresa assume** o valor (vira custo da
    empresa e a dívida some);
  - **desfazer** uma quitação lançada errado (com motivo; o histórico fica).
  O que não for reembolsado é **descontado no repasse mensal** (M4.9) quando você fecha o
  mês, se o proprietário tiver o que receber. **Sem dupla
  cobrança:** nunca se quita mais do que o valor, duas pessoas quitando ao mesmo tempo não
  passam do total, e uma despesa cujo adiantamento já teve reembolso não pode ser estornada
  (desfaça a quitação antes).
- M6.1: **limpezas** (Painel → **Limpezas**). Toda reserva confirmada gera a limpeza **no dia
  da saída**, mesmo sem nova entrada e em fim de semana. Cada limpeza passa por estados
  separados, porque pedir não comprova que aconteceu:
  - **Pedida** → **Confirmada** (com a profissional escolhida) → **Realizada** (quem fez e,
    se quiser, o **custo**; o custo pode ficar para depois e aparece como pendente);
  - se a reserva muda de data ou de imóvel, a limpeza acompanha e volta a "pedida" (precisa
    confirmar de novo); se a reserva é cancelada, a limpeza é cancelada;
  - depois de realizada, nada muda sozinho: se a reserva mudar ou for cancelada, aparece um
    **aviso** para conferir;
  - limpeza cuja data passou sem registro aparece com aviso — o sistema **não** marca como
    feita por conta própria;
  - dá para criar **limpeza avulsa** (ex.: antes do uso do proprietário), **cancelar** (com
    motivo e confirmação) e **desfazer** um "feita" marcado por engano.
  - nos imóveis de **gestão completa**, o **custo** informado vira uma **despesa da empresa**
    (na categoria escolhida no fim da tela de Limpezas — começa em "Limpeza e lavanderia" e
    pode ser renomeada à vontade em Despesas —, a pagar), no imóvel e no dia da limpeza, e entra no
    resultado do Início e da aba Apartamentos. Em contrato online ou sem contrato, o sistema
    não supõe quem paga: avisa para lançar em Despesas. Mudar o custo ou desfazer o "feita" corrige a despesa sozinho; se a despesa
    já foi paga, o sistema não mexe e pede para corrigir em Despesas.
  As **profissionais** são cadastradas na própria tela (nome, telefone, observações) e
  arquivadas quando saem. A equipe de operação vê e registra as limpezas, sem ver custos.
- M6.6: **profissionais de limpeza pelo celular**. Em Limpezas → **Profissionais**, você põe o
  e-mail da profissional e aperta **"Liberar acesso"** (pede confirmação):
  - ela entra no sistema com o e-mail dela (recebe um código por e-mail) e cai direto na tela
    **"Minhas limpezas"**: só as limpezas confirmadas com ela, de alguns dias atrás até as próximas
    duas semanas, com o imóvel, o endereço, o horário de saída e, quando alguém entra no mesmo dia,
    o horário-limite para deixar pronto;
  - ela aperta **"Marcar como feita"** (pede confirmação) a partir do dia da limpeza. O custo
    continua sendo informado por você no painel: ela **não vê custo**, proprietário nem financeiro;
  - quando você confirma uma limpeza com ela, ela recebe um **e-mail** avisando (o WhatsApp entra
    quando o M10 estiver ligado);
  - **"Tirar acesso"** (ou arquivar a profissional) corta a entrada na hora.
- M6.3 e M6.7: **agenda diária da equipe** (Painel → **Agenda**). Todo dia às **20h** quem você
  escolher recebe por e-mail a agenda, com **Rio e Búzios separados** (cada seção é a cidade do
  cadastro do imóvel; nada é somado). O texto segue o **modelo que você definiu em 23/09** e o
  **pedido de 2/10** (Rio 5 dias, Búzios 30 dias):
  - **Rio (vários apartamentos), 5 dias:** um dia por linha, **só com as limpezas** (limpeza =
    dia de checkout). Nos dias vazios aparece "nenhuma limpeza". Limpeza já marcada como
    realizada, sem uso do imóvel depois, não volta para a lista. Quando alguém entra no mesmo
    dia, sai o horário-limite ("pronto até 15h, entra Ana, 2 hóspedes"). As **entradas, saídas e
    chaves** vão num bloco separado, com primeiro nome, nº de hóspedes, horários e telefone
    operacional do hóspede (só quando está no cadastro da reserva; nunca tirado da conversa);
  - **Búzios (casa única), 30 dias:** todas as reservas do período, uma por linha, com entrada,
    saída, horários, nº de hóspedes e telefone, e "troca no mesmo dia: conferir limpeza" quando
    uma sai e outra entra no mesmo dia;
  - **horários combinados com o hóspede (M6.7):** na ficha da reserva, a equipe registra um
    **pedido** de horário de entrada ou saída (canal e referência da conversa) e, depois do
    aceite do hóspede, o **acordo confirmado**. A agenda mostra "13:30 (confirmado com
    hóspede)" em vez do padrão; sem acordo, vale o horário do cadastro do imóvel ou o padrão da
    agenda. Mudou data ou imóvel, o acordo precisa ser refeito. Nada é lido das conversas
    automaticamente nem enviado ao hóspede;
  - **Rio e Búzios têm formato fixo** pela sua decisão de 2/10 (a tela mostra os dois travados);
    outra cidade que venha a existir pode ter o formato escolhido na tela (sem escolha, casa
    única vai por reserva e vários apartamentos por limpezas). Os horários padrão de entrada e
    saída (15h e 11h) continuam editáveis e valem só quando o imóvel não tem horário no
    cadastro. A tela mostra **o mesmo texto que a equipe vai receber**;
  - vêm também as **reservas novas desde a última agenda**, mesmo as de datas mais distantes;
  - termina com a frase padrão "Essa é a agenda atual e ainda pode mudar…". A agenda **só
    informa**: não confirma limpeza nem preparação;
  - do hóspede vai só o **primeiro nome** e o número de pessoas, **sem código de reserva**.
    Quando o número de pessoas não está na reserva, a agenda avisa em vez de adivinhar;
  - na mesma tela você cadastra **quem recebe** e, para cada pessoa, as cidades que ela
    recebe (sem cidade marcada = todas). Também liga ou desliga o envio das 20h e tem o botão
    **"Enviar agora"** (pede confirmação).
  - Cada pessoa recebe **uma vez por dia**. O envio das 20h aparece em **Sistema →
    Automações**, com "falhou" quando não deu certo; o "Enviar agora" fica no histórico de
    alterações e mostra na tela quantos saíram e quantos falharam.
- M5.4: **e-mail do fechamento aos proprietários** (Painel → Financeiro → **Repasses**, no
  quadro "E-mail do fechamento"):
  - a partir do **dia do fechamento** (dia 2 desde 5/10 — M4.13; antes, dia 1º), todo dia às
    **9h**, cada proprietário recebe **uma vez** o relatório do mês anterior em **PDF** (o mesmo do portal), com o valor do repasse no texto.
    Os **representantes** marcados para receber relatórios vão em cópia. Quem tem imóvel mas
    ficou com saldo zero no mês também recebe;
  - mês fechado **com atraso** também sai (o envio olha os meses desde que foi ligado, até 12
    para trás). Se o provedor não confirmar um envio por mais de um dia, o sistema **não repete
    sozinho** (poderia chegar duas vezes): a tela mostra "sem confirmação" e você decide se envia de novo;
  - só sai **depois que o mês dele está fechado**: repasse gerado, ou nada a repassar e sem
    pendência. Quem ainda tem pendência (acerto a conferir, ajuste a esclarecer) espera, e a
    tela mostra quem ficou; quem está **sem e-mail** no cadastro também aparece;
  - o **assunto** e o **texto** são editáveis na tela (use {nome} e {mes}). Começa
    **desligado**: você liga quando quiser;
  - em cada proprietário há o botão **"Enviar e-mail do fechamento"** e, depois de enviado,
    **"Enviar e-mail de novo"** (os dois pedem confirmação). Há também "Enviar agora para os
    prontos";
  - o envio das 9h aparece em **Sistema → Automações**; cada e-mail enviado fica no histórico
    do proprietário;
  - o PDF automático vai **sem o extrato do canal e sem a foto** (esses anexos continuam
    manuais, na ficha do proprietário).
- M5.1: **portal do proprietário** (o que o proprietário vê ao entrar com o e-mail dele):
  - escolhe os **imóveis dele** (quem tem mais de um marca quais quer ver), o **mês** ou o
    **ano inteiro**;
  - setas para o mês anterior e o seguinte, **até 9 meses para trás e 9 para a frente**; fora
    disso aparece um aviso e a tela volta ao limite;
  - o **mês atual aparece como "Parcial"** (ainda pode mudar) e os meses futuros como
    **"Previsto"** (só reservas já confirmadas);
  - números do período, **só com o que é dele**: reservas, valor bruto, taxas dos canais,
    comissão da empresa, **sua parte**, despesas atribuídas a ele e o acerto do período (quem
    passou a dever a quem). Se o imóvel trocou de dono, o novo proprietário não vê o histórico
    do anterior.
  O PDF chegou no M5.3 (abaixo).
- M5.3: **relatório do mês em PDF**, no modelo que você aprovou (verde sálvia, areia e
  dourado, títulos com serifa):
  - **primeira página:** nome da empresa e contatos, o mês, o nome comercial do imóvel (sem
    código), o proprietário e o representante que recebe relatórios, o período, e os números
    (os mesmos do portal). O valor em destaque é a **parte do proprietário**, com a base
    escrita embaixo: não é o total do canal nem lucro. Depois vêm a tabela de reservas (do
    hóspede, só o primeiro nome) e o saldo com a empresa. No mês atual, o PDF diz que é
    **parcial**, com a posição do dia, e que já inclui as reservas confirmadas até o fim do mês
    (como no portal);
  - **extrato oficial do canal** nas páginas seguintes, copiado como veio, sem redesenhar. Dá
    para usar só algumas páginas (ex.: "1-2"), e a primeira página avisa quais foram usadas e
    quantas o extrato tem. Sem extrato anexado, avisa "não anexado a esta versão";
  - **no painel:** na ficha do proprietário (mesmo arquivado), o link **Relatório do mês em PDF**. Lá você
    escolhe o mês e os imóveis, e pode anexar a **foto real** do imóvel e o **extrato** (até
    2 MB cada). Os arquivos servem só para montar o PDF: **não ficam guardados** no sistema.
    Cada PDF gerado fica registrado no histórico do proprietário (mês, imóveis e se levou foto
    ou extrato; nunca o conteúdo);
  - **no portal:** o proprietário baixa o PDF do mês que está vendo, só dos imóveis dele. Essa
    versão não tem foto nem extrato.
- M5.2: **reservas, calendário e saldo no portal do proprietário:**
  - **tabela de reservas** do período, com imóvel, entrada, saída, hóspede, valor bruto, a
    parte dele, situação (definido, em conferência ou sem cálculo ainda), canal e a origem que
    o hóspede informou. Origem não informada fica "não informada": o sistema não adivinha;
  - **calendário do mês** com as reservas e os bloqueios dos imóveis dele. Tocar numa reserva
    leva à linha dela na tabela, com os valores;
  - **saldo com a empresa**, somando todos os imóveis dele e já com os repasses. Enquanto o mês
    não terminou ou há algo em conferência, aparece como **parcial**, sem quem paga e sem Pix.
    Com o mês terminado e sem pendências, mostra o **credor**:
    - se a empresa deve, o valor e a chave Pix dele;
    - se ele deve, o valor e a **chave Pix da empresa**, com botões para copiar a chave e o valor.
    Depois do fechamento aparece "mês fechado" ou "pago em dd/mm". Tudo segue a mesma conta da
    tela de Repasses.
- M4.9: **repasse mensal aos proprietários** (Painel → **Financeiro** → Repasses). No dia do
  fechamento (dia 2 desde 5/10 — M4.13), a tela abre no mês anterior e mostra, para cada proprietário:
  - o **crédito dele até o fim do mês**, os **adiantamentos descontados** e os
    **contestados** (esses ficam de fora do desconto até você resolver);
  - o valor **a transferir**. Se o que ele deve for maior do que tem a receber, a tela diz
    quanto ele deve e nada é transferido (registre o reembolso ou fica para o próximo mês);
  - **avisos antes de fechar:** mês que ainda não terminou, acerto pendente (sem
    proprietário, "quem recebe" a confirmar, ajuste a esclarecer) — esses **impedem** o
    fechamento; lançamentos ainda previstos (dinheiro que pode não ter entrado) e falta de
    chave Pix aparecem como aviso.
  **Fechar mês e gerar repasse** (com confirmação) grava o repasse no livro e marca os
  adiantamentos descontados. Depois: **Copiar Pix**, **Copiar valor**, faça o Pix no banco e
  **Marcar como pago** com a data. Errou? **Estornar este repasse** (com motivo e
  confirmação) desfaz tudo: os adiantamentos voltam a ficar em aberto e o mês pode ser
  fechado de novo. Algo que entrar no mês depois do fechamento aparece como aviso e vai
  sozinho para o repasse do mês seguinte. Proprietário com mais de um imóvel recebe um
  repasse só; se um imóvel dele deu prejuízo, é compensado com o outro.
- M4.5: **ajustes e divergências** (Painel → **Financeiro** → Ajustes). Achou uma diferença
  (ex.: o Airbnb pagou R$ 150 a menos)? Registre no mesmo dia: data, reserva (código) ou
  imóvel, o efeito (entrou/saiu dinheiro da empresa, ou a empresa deve/o proprietário deve),
  o valor e **o que foi consultado** (obrigatório). Regras, como você pediu:
  - sem motivo conhecido, a descrição fica "Ajuste de reserva — motivo não identificado";
  - "feito pelo Airbnb" (ou outro) só aparece se você marcar **origem comprovada**;
  - valor desconhecido não é inventado: fica em branco e nada entra no financeiro até você
    completar;
  - o ajuste fica **pendente** até ser esclarecido, e só pode ser esclarecido com motivo e
    valor conhecidos. Depois de esclarecido, não muda mais (se precisar, registre outro).
  Dá para completar depois (motivo, origem, valor, comprovante); o financeiro é corrigido
  sozinho e o histórico guarda cada mudança. A página Financeiro mostra quantos ajustes
  estão pendentes (o painel com os números do mês chega no M4.6).
- M4.6: **tela inicial do painel** (Início) com os números do período escolhido no filtro
  (imóveis + mês ou ano):
  - **ocupação** (noites vendidas ÷ noites disponíveis; dias bloqueados não contam), total e
    por imóvel, com barras;
  - **receita bruta** das reservas, **taxas dos canais**, **comissões SCL**, **despesas da
    empresa** e **resultado da empresa** (comissões − despesas, mais os ajustes que afetam a
    empresa). O que é do proprietário e as taxas passam pela conta, mas não entram no resultado;
  - **gráfico** de receita e comissões mês a mês no ano, com o mês escolhido em destaque;
  - **entradas e saídas dos próximos 7 dias**, com link para a reserva;
  - **pendências e alertas**: reservas sobrepostas, imóvel sem contrato ou sem proprietário,
    reserva sem valor, acertos pendentes, ajustes a esclarecer, adiantamentos a cobrar ou
    contestados e despesas a pagar — cada um com link.
  A equipe de operação vê ocupação e entradas/saídas, sem valores. Os números vêm das mesmas
  fontes das outras telas, então batem com Reservas, Despesas e Financeiro.
- M4.7: **aba Apartamentos** (menu lateral): uma tabela com uma linha por imóvel e o total no
  fim, para o período do filtro:
  - do lado da **empresa**: reservas, ocupação, receita bruta, taxas, comissões, despesas da
    empresa, ajustes e **resultado da empresa** daquele imóvel;
  - do lado do **proprietário**, separado: despesas dele, o que mudou no acerto no período, o
    **saldo do acerto** acumulado (com "empresa deve" ou "proprietário deve") e os
    **adiantamentos a cobrar** (os contestados aparecem marcados);
  - **você escolhe como ver:** marque as colunas que quer, ou use **De/Até** para um intervalo
    de meses (até 36). Intervalo inválido não é adivinhado: aparece um aviso e vale o filtro;
  - com "todos os imóveis", entra também uma linha **Geral da empresa** (despesas sem imóvel)
    e os imóveis arquivados que tiveram movimento, então o total bate com o Início.
- M4.8: **conferência dos números entre as telas.** Um teste automático monta um mês com os
  casos que costumam dar diferença (estada que passa de um mês para o outro, reserva
  cancelada, reserva pendente, venda direta, despesa do proprietário e imóvel de outro dono) e
  confere que **Início, aba Apartamentos, portal do proprietário e PDF** mostram os mesmos
  valores (bruto, taxas, comissão, parte do proprietário, despesas, acerto e número de
  reservas). Ele achou uma diferença, já corrigida:
  - **reserva pendente** (ainda não confirmada) entrava na receita e no acerto do painel, mas
    não no portal. Agora ela **não entra em nenhum número** até ser confirmada; ao confirmar,
    aparece em todas as telas ao mesmo tempo. Reserva pendente feita no painel tem o botão
    **"Confirmar reserva"** na página dela. Ela continua ocupando o calendário e a agenda
    de limpezas, como antes. Pendentes antigas, calculadas antes desta mudança, são acertadas
    sozinhas na próxima publicação do sistema. Se uma reserva já tinha dinheiro recebido e
    voltou a ficar pendente, os valores continuam (nada que já movimentou dinheiro é mexido
    sozinho), mas ficam **em conferência**: o Início avisa, o portal e o PDF mostram a reserva
    marcada assim, e o fechamento do mês espera até você confirmar a reserva de novo (aí sai da
    conferência sozinha) ou fazer o ajuste manual e apertar **"Dar a conferência por resolvida"**
    na página da reserva (com confirmação; fica no histórico). Vale também para reserva cancelada
    nessa situação, e se a reserva mudar de novo em algo que pesa no dinheiro (situação, valor,
    datas, imóvel), a conferência volta; mudar só o nome ou contato do hóspede não reabre;
  - o contador de reservas do Início e da aba Apartamentos passou a contar **só as
    confirmadas**, igual ao portal e ao relatório.
- M6.5: **rotinas recorrentes** (menu **Rotinas**). Tarefas que se repetem, cada uma com a
  próxima data:
  - já vêm as cinco das regras de atendimento, nas datas combinadas:
    - **conferência das faxinas** toda segunda;
    - **consulta de manutenção**, separada para **Rio** e **Búzios**, de 15 em 15 dias contando
      de 21/09 (a próxima é 06/10);
    - **lembrete do dia 30**: fixos, contador, notas e condomínios. Em fevereiro cai no último
      dia e em março volta ao dia 30;
    - **caixinhas de fim de ano** em 1º de dezembro.
    Dá para mudar tudo na própria tela;
  - você cria, edita (nome, o que fazer, frequência, próxima data) e **arquiva** (com
    confirmação; o histórico fica). Arquivada não volta sozinha;
  - a equipe marca **"feita"** (com a data e uma observação) ou **"pular desta vez"** (motivo
    obrigatório). A próxima data vai para o vencimento seguinte depois do dia informado: quem
    atrasou três semanas não fica devendo três conferências;
  - nada fica "feito" sozinho: vencida e não registrada, a rotina aparece como **atrasada**.
- M6.4: **documentos de portaria** (menu **Portaria**). É só uma lista de controle:
  **nenhum documento, número ou foto é guardado** no sistema.
  - você marca na própria tela quais imóveis exigem documentos (hoje, o 403). Nada fica fixo
    no código;
  - para cada reserva confirmada desses imóveis nos próximos 30 dias, a tela diz o próximo
    passo:
    - **aviso inicial** na reserva;
    - **segundo pedido** entre 5 e 7 dias antes da entrada, se faltar documento;
    - **pedido final** na véspera;
  - reserva de última hora não recebe os três pedidos de uma vez. Depois da entrada, não há
    mais cobrança: fica só o registro do que falta;
  - a equipe registra quantos hóspedes já mandaram documento. Com todos completos, confere o
    destinatário e registra o **encaminhamento**, depois a **entrega confirmada**. Entrega não
    é aprovação da portaria;
  - dá para anotar uma **pendência** concreta (falha de entrega, dúvida). Tudo fica no
    histórico da reserva.
- M6.2: **manutenção** (menu **Manutenção**). Cada serviço segue quatro passos:
  - a equipe registra o **pedido** (imóvel e o que precisa ser feito) e depois o **orçamento**
    (quem vai fazer e o valor);
  - **você aprova** e escolhe **quem paga**: empresa ou proprietário. Nada é decidido pelo valor.
    Enquanto não aprovar, a tela avisa "não execute antes". Se chegar um orçamento novo depois
    da aprovação, ele volta para você aprovar de novo;
  - feito o serviço, a equipe registra a **data**;
  - quem cuida do financeiro **lança o custo final**. Ele vira uma despesa com o imóvel, o
    fornecedor e quem paga já preenchidos. Se o proprietário paga e a empresa adiantou, vira
    adiantamento a cobrar, como nas outras despesas.

  A tela avisa quando o custo passa do orçamento, quando falta lançar o custo e quando a
  despesa foi estornada. Também dá para recusar ou cancelar, sempre com motivo e confirmação.
  A equipe de operação cuida dos pedidos, mas não aprova nem lança custo.
- M4.1: **base do financeiro (o "livro" de lançamentos).** Cada fato financeiro vira um
  lançamento: valor bruto da reserva, taxa do canal, comissão SCL, parte do proprietário,
  recebimentos, repasses, despesas da empresa, despesas do proprietário, adiantamentos,
  reembolsos e ajustes. Regras que atendem ao que você pediu:
  - **nada é apagado nem editado** — erro se corrige com **estorno** (um lançamento espelho,
    com motivo), e tudo fica no histórico;
  - cada lançamento tem situação: **previsto, realizado, conciliado ou pendente** (reserva
    futura não é dinheiro recebido);
  - separa o **resultado da empresa** do **acerto com o proprietário** ("quem deve quanto a
    quem"): ex. a empresa adianta R$ 4.000 de reparo → o proprietário fica devendo R$ 4.000; o
    saldo só zera quando houver reembolso/compensação registrado — e isso não vira receita nem
    despesa duplicada da empresa;
  - valores sempre em centavos, sem arredondamento escondido.
- M4.2: **cálculo automático de cada reserva.** Ao lançar, importar, alterar ou cancelar uma
  reserva, o sistema gera (ou corrige com estorno) os lançamentos: valor bruto, taxa do canal,
  **comissão SCL** pelo contrato vigente na data de entrada, e **parte do proprietário**. A
  ficha da reserva mostra esse financeiro (só para o admin). Regras **confirmadas por você em
  24/09**: comissão sobre o valor que o canal repassa (depois da taxa do canal); estadia que
  atravessa o mês é **dividida igualmente por noite** (valor total, com a limpeza); no
  **Airbnb** o proprietário recebe a parte dele direto (split) e isso não entra no acerto; no
  **Booking, site e direta** a empresa recebe tudo e repassa (decidido em 4/10 para o site:
  continua assim; o repasse segue a periodicidade que o proprietário escolher, mensal por
  padrão, e a reserva do site só fica disponível depois do check-in e da liberação pelo
  Mercado Pago — item M4.10). Dá para mudar
  reserva a reserva no campo "Quem recebe do canal". Imóvel com **mais de um proprietário**
  (ainda não há cadastro de cotas) ou sem proprietário fica com o acerto **pendente** — nada
  é atribuído a alguém por chute.
- M4.2c: **mudança vale só daquela data para frente.** Quando você muda uma regra (contrato,
  percentual, quem recebe por canal) ou sai uma versão nova do sistema, o recálculo só
  alcança as reservas com **entrada a partir da data da mudança** (nunca antes de hoje).
  O passado fica exatamente como foi. E qualquer lançamento que **já movimentou dinheiro**
  (pago ou conciliado) nunca é mexido automaticamente: se algo mudar numa reserva assim, o
  sistema avisa e a correção vira um ajuste manual.
- M4.3: **despesas** (menu **Despesas**). Cada despesa tem categoria, valor, data, imóvel
  (opcional para as da empresa), fornecedor, comprovante (por enquanto um link ou referência,
  ex.: link do recibo no Drive — o envio de arquivo vem depois) e situação (a pagar / paga).
  Dois tipos, sem misturar:
  - **da empresa** — custo da SCL (equipe, mercado, pequenos reparos absorvidos): entra no
    resultado da empresa;
  - **do proprietário** — gasto que é dele (ex.: conserto do ar-condicionado). **Não** conta
    como custo da empresa. Quando a empresa **efetivamente paga** (marcar "paga"), o
    proprietário passa a dever esse valor no acerto — conta ainda a pagar não vira dívida;
    se ele mesmo pagou, fica só o registro.
  - Errou? **Estornar** (com motivo) anula sem apagar o histórico.
  - **Categorias** editáveis em Despesas → Categorias: criar, renomear, arquivar (some das
    opções novas, continua nas antigas) e excluir (só se nunca foi usada). Começa com
    Equipe, Limpeza e lavanderia, Manutenção, Mercado e consumo, Contas e Outros (só na
    primeira vez — se você apagar, elas não voltam).
  - Só o admin vê e lança despesas.

### Como está ficando (prints com dados fictícios)

| Calendário | Reservas |
|---|---|
| ![Calendário](docs/telas/calendario.png) | ![Reservas](docs/telas/reservas.png) |

| Calendário no celular | Imóveis |
|---|---|
| ![Calendário no celular](docs/telas/calendario-celular.png) | ![Imóveis](docs/telas/imoveis.png) |

| Ficha da reserva com o financeiro | Despesas |
|---|---|
| ![Reserva com financeiro](docs/telas/reserva-financeiro.png) | ![Despesas](docs/telas/despesas.png) |

| Página Sistema | Configurações · Regras financeiras |
|---|---|
| ![Sistema](docs/telas/sistema.png) | ![Regras financeiras](docs/telas/configuracoes-regras.png) |

| Configurações · Modelos de mensagem | Imóvel · simular estadia |
|---|---|
| ![Modelos de mensagem](docs/telas/configuracoes-mensagens.png) | ![Simulador](docs/telas/imovel-simulador.png) |

| Imóvel · cadastro completo | Adiantamento |
|---|---|
| ![Cadastro completo](docs/telas/imovel-cadastro-completo.png) | ![Adiantamento](docs/telas/adiantamento.png) |

| Ajuste esclarecido | Início no celular |
|---|---|
| ![Ajuste](docs/telas/ajuste.png) | ![Início no celular](docs/telas/inicio-dashboard-celular.png) |

| Início (painel com números e alertas) | Repasses no celular |
|---|---|
| ![Início](docs/telas/inicio-dashboard.png) | ![Repasses no celular](docs/telas/repasses-celular.png) |

| Repasses aos proprietários (fechamento do mês) | Apartamentos no celular |
|---|---|
| ![Repasses](docs/telas/repasses.png) | ![Apartamentos no celular](docs/telas/apartamentos-celular.png) |

| Apartamentos (resultado por imóvel) | Manutenção no celular |
|---|---|
| ![Apartamentos](docs/telas/apartamentos.png) | ![Manutenção no celular](docs/telas/manutencao-celular.png) |

| Manutenção (pedido, orçamento, aprovação e custo) | Portaria no celular |
|---|---|
| ![Manutenção](docs/telas/manutencao.png) | ![Portaria no celular](docs/telas/portaria-celular.png) |

| Portaria (documentos: pedidos, encaminhamento e entrega) |
|---|
| ![Portaria](docs/telas/portaria.png) |

| Apartamentos (resultado por imóvel) | Portal do proprietário no celular |
|---|---|
| ![Apartamentos](docs/telas/apartamentos.png) | ![Portal no celular](docs/telas/portal-celular.png) |

| Rotinas | Rotinas no celular |
|---|---|
| ![Rotinas](docs/telas/rotinas.png) | ![Rotinas no celular](docs/telas/rotinas-celular.png) |

| Portal do proprietário | Portal no celular (reservas e saldo) |
|---|---|
| ![Portal](docs/telas/portal.png) | ![Portal com reservas no celular](docs/telas/portal-reservas-celular.png) |

| Portal do proprietário: calendário, reservas e saldo | Relatório mensal · capa e resultado |
|---|---|
| ![Portal com reservas](docs/telas/portal-reservas.png) | ![Relatório mensal · capa e resultado](docs/telas/relatorio-mensal-1.png) |

| Relatório mensal · números e reservas do mês | Relatório mensal · conciliação e repasses |
|---|---|
| ![Relatório mensal · página 2](docs/telas/relatorio-mensal-2.png) | ![Relatório mensal · página 3](docs/telas/relatorio-mensal-3.png) |

| Relatório mensal · extratos dos canais no fim | |
|---|---|
| ![Relatório mensal · página 4](docs/telas/relatorio-mensal-4.png) | |

| Limpezas | Limpezas no celular |
|---|---|
| ![Limpezas](docs/telas/limpezas.png) | ![Limpezas no celular](docs/telas/limpezas-celular.png) |

| Agenda da equipe | Agenda no celular |
|---|---|
| ![Agenda](docs/telas/agenda.png) | ![Agenda no celular](docs/telas/agenda-celular.png) |

- M7.1: **site público novo, dentro do sistema** (o endereço principal, sem login). Tem a
  página inicial, a lista de apartamentos, a página de cada apartamento e a **consulta**:
  - aparecem **só os imóveis marcados como "público" e ativos** no cadastro (Búzios fica de
    fora enquanto não for público). Nome, bairro, capacidade, quartos, banheiros, descrição,
    camas, comodidades, horários de entrada e saída, mínimo de noites e regras da casa vêm
    do **cadastro do imóvel** — mudou lá, o site mostra na hora. **Endereço exato,
    proprietário, preços e reservas nunca aparecem**;
  - os textos da página inicial (título, subtítulo, "Sobre", "Como reservar", contato e
    rodapé) ficam em **Configurações → Site**;
  - **consulta:** o visitante escolhe o apartamento, as datas e quantas pessoas; o sistema
    confere (datas no futuro, saída depois da entrada, pessoas dentro da capacidade) e monta
    uma mensagem pronta que ele envia pelo **WhatsApp da empresa** (o telefone em
    Configurações → Empresa; sem telefone, vai por e-mail). **Nada é gravado nem cobrado**:
    disponibilidade e valor são combinados na conversa (a cotação automática é o M7.2);
  - **fotos:** as fotos reais que você sobe na ficha do imóvel (M7.3, 7/10); imóvel sem foto
    mostra um quadro com o nome do apartamento;
  - há um link discreto **"Área da equipe"** no rodapé, que leva ao login do painel.
- M9.1: **portal do hóspede — "Minha reserva"** (link no topo do site):
  - o hóspede digita o **e-mail que está na reserva** e recebe um **código de 6 dígitos**
    (vale 10 minutos, uso único, até 5 tentativas e 5 códigos por hora — as mesmas regras
    do login da equipe). O código da reserva sozinho **não** dá acesso;
  - a tela responde sempre igual, tenha ou não reserva com aquele e-mail (ninguém descobre
    quem está hospedado). Só recebe código quem tem reserva **confirmada** que ainda não
    terminou há mais de 30 dias. O código do hóspede não serve para entrar no painel;
  - ele vê **só as próprias reservas**: apartamento, bairro, datas, horários de entrada e
    saída, noites, pessoas e o contato da empresa (WhatsApp/e-mail de Configurações →
    Empresa). **Valores e dados de outras pessoas nunca aparecem**;
  - o **endereço completo** (com complemento) só aparece **2 dias antes da entrada, às 10h**
    (horário de São Paulo), e some no horário de saída do imóvel. Estar logado não antecipa;
  - só contam as reservas da empresa do site (se um dia houver outra empresa no sistema, uma
    não vê as reservas da outra);
  - a permissão é conferida a cada acesso: **trocar o e-mail da reserva ou cancelá-la tira
    o acesso na hora**. O acesso dura até 7 dias no mesmo aparelho, com botão "Sair";
  - no painel, o detalhe da reserva agora tem o campo **"E-mail do hóspede"** para cadastrar
    ou corrigir, e um **aviso** quando a reserva está sem e-mail. O e-mail salvo ali **vale
    sobre o da planilha ou do Beds24** (a próxima importação não desfaz a correção).
- M9.2: **mensagens automáticas ao hóspede, por e-mail** (Configurações → Modelos de mensagem,
  no alto da página):
  - quatro mensagens, cada uma com o **modelo que você escolher** (os modelos continuam
    editáveis ali mesmo): **confirmação** (logo depois de confirmada), **check-in** (2 dias
    antes da entrada, às 10h — o mesmo momento em que o endereço aparece em "Minha reserva"),
    **check-out** (1 dia antes da saída, às 14h) e **agradecimento** (3 dias depois da saída,
    às 10h). Horário de São Paulo; o sistema confere de hora em hora (cada mensagem sai até
    cerca de 1 hora depois do momento previsto);
  - vem **desligado**: você liga com a caixinha "Envio automático ligado". Vale **daquele
    momento em diante** — nada previsto para antes é mandado atrasado;
  - escolha as **origens**: vem marcado só **site e direta** (o Airbnb e o Booking já mandam as
    mensagens deles). Dá para deixar uma mensagem sem modelo ("não enviar");
  - **cada mensagem sai uma vez só**. Reserva cancelada não recebe; se a data mudar, vale a
    nova. Reserva feita em cima da hora recebe a confirmação e o check-in logo, mas nunca
    depois da entrada;
  - **avisar em vez de supor:** se faltar algo que o modelo usa (e-mail, nome do hóspede,
    endereço do imóvel…), ou o modelo tiver sido arquivado, a mensagem **não sai** e o motivo
    aparece na página **Sistema**. A confirmação **não pode usar {endereco}** (o endereço só vai
    2 dias antes da entrada);
  - no fim da seção aparecem as **últimas mensagens** com a situação: enviada, recusada pelo
    provedor (o sistema tenta de novo, até 3 vezes) ou **sem confirmação — confira** (quando
    o provedor não respondeu: não é repetida sozinha, para não mandar duas vezes).
- M12.3: **cadastro de proprietários marketplace pelo site** ("Anuncie seu imóvel", no topo
  do site):
  - a pessoa confirma o **e-mail com um código** (as mesmas regras do login; um abuso aqui não
    atrapalha o login da equipe) e preenche os dados dela (nome, pessoa física ou empresa,
    telefone) e do imóvel (nome, bairro, cidade, endereço, pessoas, quartos, banheiros,
    descrição). Diz se **já anuncia** em outra plataforma (cola até 3 links) ou se quer um
    **anúncio novo**, e autoriza o uso dos dados para a análise;
  - o pedido fica **esperando análise** — nada é criado nem publicado sozinho. Cada e-mail
    pode ter até 3 pedidos em análise, e o site para de aceitar pedidos novos se houver 100
    esperando;
  - em **Proprietários → "Cadastros pelo site"** você vê cada pedido com todos os dados e
    decide: **Aprovar** (você dá o código do imóvel no sistema) cria de uma vez o
    proprietário, o imóvel (**não público** — publicar continua sendo no cadastro do imóvel)
    e manda o **convite do portal** para o e-mail confirmado; **Recusar** pede um motivo, que
    fica registrado. Se algo impedir (código de imóvel repetido, e-mail que já é da equipe),
    nada é criado e a tela avisa;
  - depois de aprovar, complete na ficha do proprietário o **documento, o Pix e o contrato**
    (o contrato marketplace usa o modelo B de Configurações → Marketplace e desconto do site,
    M12.1; o cálculo no financeiro é o M12.2).

A lista completa e detalhada, item por item, está em [ROADMAP.md](ROADMAP.md).

---

## 3. Como o trabalho acontece

1. A **rotina automática** roda a cada 3 horas nesta conversa do Claude Code. Ela pega o
   próximo item do ROADMAP, programa, testa e abre um **PR** no GitHub.
2. Cada PR tem no título o código do item (ex.: `[M1.2] Login com Google`) e uma
   descrição em português com: *O que muda / Como conferir / Testes / Limites*.
3. Dois robôs conferem cada PR automaticamente:
   - **CI** (GitHub Actions): roda todos os testes. Verde = passou.
   - **Codex**: revisão automática de código. O Claude corrige o que ele apontar.
4. **Claude e Codex fazem o merge** do trabalho autorizado (regra atualizada por você em
   9/10), somente depois de todas as checagens aplicáveis e da revisão automática do Codex
   no GitHub concluídas para o último commit, com os apontamentos tratados e sem conflito.
   Corrigem e cumprem quantas rodadas forem necessárias, sem teto, e te avisam com um resumo
   curto do que mudou. Você pode revogar a autorização a qualquer momento.
5. Pode haver até **3 PRs de roadmap abertos** ao mesmo tempo aguardando as checagens,
   as correções e a revisão antes do merge pelos agentes.

**Onde ver o sistema:** assim que a Vercel estiver conectada (seção 6), cada PR ganha um
link de *preview*, e a `main` fica publicada num endereço fixo de homologação. O painel
fica em `/painel`.

**Se quiser acompanhar ou pedir algo:** abra esta conversa no app Claude (área *Code*)
e escreva normalmente.

---

## 4. Onde encontrar cada coisa no GitHub

| Pasta ou arquivo | O que tem | Precisa ler? |
|---|---|---|
| `GUIA-DIEGO.md` | Este guia | ✅ sim |
| `ROADMAP.md` | Plano completo, item por item, com o que falta | Se quiser detalhe |
| `requisitos/` | Suas decisões de negócio, escritas e organizadas por tema | Só para conferir regras |
| `docs/telas/` | Prints das telas (dados fictícios), atualizados a cada entrega visual | Se quiser ver |
| `requisitos/operations/FINANCEIRO-PORTAIS.md` | Regras do financeiro e dos portais | Quando chegarmos no M4/M5 |
| `app/` | **O sistema novo** (código) | ❌ não |
| `app/drizzle/` | Histórico das mudanças no banco de dados | ❌ não |
| `prototipos/` | Protótipos antigos (site e gestão), só como referência | ❌ não |
| `arquivo/` | Papelada dos agentes antigos (Rivers, Lia, Sage...), guardada como histórico | ❌ não |
| `CLAUDE.md` | Regras que o Claude segue ao programar | ❌ não |
| `.github/workflows/` | Configuração dos testes automáticos (CI) | ❌ não |
| `infra/backup/espelho-github.yml` | O robô de backup (o arquivo que você copia para a conta de backup) | Só na hora de ativar (seção 6, item 23) |
| `.github/workflows/scl-tests.yml` | A conferência automática que roda em cada PR (lint, tipos, testes, build) | Só se um PR ficar vermelho e você quiser ver o motivo |
| `requisitos/operations/BACKUP-E-RECUPERACAO.md` | Como o backup funciona, por quê, e como recuperar | Se um dia precisar restaurar |

---

## 5. Contas e serviços

| Serviço | Para que serve | Situação | O que falta |
|---|---|---|---|
| **GitHub** (`al-life/scl-reconstrucao`) | Guarda o código e o histórico | ✅ conectado; backup automático ativo em conta separada desde 4/10 (M0.7) | Olhar a aba *Actions* da conta de backup quando o lembrete chegar; renovar as duas chaves em um ano (seção 6, item 23, passo 8) |
| **Claude Code** | Programa o sistema; rotina a cada 3h | ✅ ativo | — |
| **Codex** (revisor automático) | Revisa cada PR | ✅ ativo no repositório | — |
| **Neon** | Banco de dados (Postgres) | ✅ projeto `scl-sistema` com duas branches: `main` (produção) e `preview` (versões de teste dos PRs); as 41 migrações até o M5.5 aplicadas nas duas, conferido em 3/10 | **Backup:** desde 3/10, 7 dias de histórico e snapshots diário (14 dias) e semanal (35 dias) da `main`, dentro do Neon (seção 6, item 23b). Cópia fora do Neon e checklist ficam para o M11.3 |
| **Vercel** | Publica o sistema na internet (homologação e depois produção) | ✅ site acessível (27/09); conferido em 3/10 que produção usa a branch `main` do Neon e as previews dos PRs usam a branch `preview` — bancos separados | Variáveis já presentes: banco, login Google, Beds24 (leitura), Resend, agendador. Faltam só as que ligam coisas novas (`BEDS24_ESCRITA`, item 3) |
| **Beds24** | Channel manager (Airbnb/Booking), reservas, calendário e preços | 🟡 importação feita por Diego (1 e 2/10); envio de calendário/preços pronto e **desligado** | Testar o envio no 103 (simular → `BEDS24_ESCRITA=ligada` com refresh token de inventário → enviar → conferir no Beds24/Airbnb) e só então ligar o automático (seção 6, item 3) |
| **Mercado Pago** | Pagamentos da reserva direta | 🟡 Conta Negócio no CNPJ aberta por você (8/10); Pix em teste pronto (M8.2a); cartão em teste pronto (M8.2b, 9/10); cancelamento com devolução em teste pronto (M8.2c, 10/10); alteração e devolução de parte do valor em teste prontas (M8.2d, 10/10) | Criar a aplicação, pôr as chaves de teste só no ambiente Preview da Vercel e testar um Pix (seção 6, item 37); depois, o cartão (item 40), o cancelamento (item 41), a alteração (item 44) e os ajustes da conta logo abaixo |
| **Meta / WhatsApp Business** | Atendimento pelo WhatsApp da empresa | ⚪ não conectado | Entrar no Meta (o login voltava para a tela de entrada, 8/10) e decidir qual número o sistema vai usar; a verificação da empresa pode esperar o site no ar (seção 6, item 4) |
| **Google Cloud (login)** | Botão "Entrar com Google" | ✅ login confirmado por Diego em 27/09 | — |
| **Resend** (envio de e-mail) | E-mails do sistema: código de login, convites, agenda da equipe, relatórios, mensagens ao hóspede | 🟡 conta criada (e conector no Claude) | Cadastrar o domínio e pôr a chave na Vercel (seção 6, item 5) |
| **Cloudflare** | Domínio e e-mail | ⚪ não conectado | Só no final (M11) |

**Páginas legais (M7.4):** a Política de privacidade cita o Mercado Pago, a Vercel e o Neon; se
trocar algum desses serviços, publique uma versão nova dela.

**Mercado Pago e o cartão (M8.2b):** a chave pública que você pôs na Vercel no item 37 passa a ser usada
pelo formulário do cartão. Na conta do Mercado Pago (se não achar alguma opção, me chame que eu te
guio tela a tela):
- deixe **desligado** o "parcelamento sem acréscimo": o hóspede paga os juros, e com ele ligado o
  Mercado Pago cobra da empresa o custo das parcelas;
- deixe **ligado** o "receber à vista" (o dinheiro de cada venda no cartão é liberado de uma vez, não
  parcela por parcela);
- escolha o prazo de liberação do cartão: na hora (4,98%), em 14 dias (4,49%) ou em 30 dias (3,98%) — as
  taxas de 4/10, a conferir na conta. Quanto mais longo, mais barato, e a parte do proprietário espera a
  liberação (seção 7);
- uma devolução no cartão **antes** da liberação pode precisar de saldo disponível na conta do Mercado
  Pago; se o sistema disser que a devolução não deu, confira o saldo lá.

**Mercado Pago e as devoluções do cancelamento (M8.2c):**
- devolver pode pedir **saldo disponível** na conta do Mercado Pago (principalmente no cartão ainda não
  liberado): se a ficha disser que o Mercado Pago pediu saldo, ponha saldo e use "Pedir a devolução de novo";
- **Pix com mais de 90 dias** provavelmente não volta pelo Mercado Pago (regra do Banco Central): a devolução é
  por fora, da conta da empresa;
- **cartão:** o Mercado Pago devolve até 180 dias depois do pagamento; depois disso, só por fora;
- **78 dias:** o sistema para de pedir devoluções ao Mercado Pago (não daria tempo de conferir); com 85 dias,
  para de conferir. Daí em diante, no cartão, devolva pelo painel do Mercado Pago e confirme na ficha;
- ainda não sabemos se a taxa do Mercado Pago volta numa devolução integral: confira no primeiro teste (item 41).

**Mercado Pago e as devoluções de parte do valor (M8.2d):**
- a devolução de **parte** do valor (a diferença de uma alteração, o restante de um pagamento) só é pedida ao Mercado
  Pago **depois que ele libera o pagamento** e informa a taxa: no cartão, devolver parte antes da liberação muda as
  parcelas que ele ainda vai liberar, e o caixa deixaria de bater. A devolução do valor inteiro de um pagamento
  continua saindo na hora;
- **no teste, o Mercado Pago nunca avisa a liberação:** registre a liberação à mão no quadro do pagamento antes de
  esperar uma devolução de parte (item 44);
- um mesmo pagamento pode ter **várias devoluções de parte**, uma de cada vez; ainda vamos conferir na conta de teste
  como o Mercado Pago responde à segunda;
- **a taxa da parte devolvida** sai da reserva na proporção do que foi devolvido, e o que o Mercado Pago não devolver
  dessa taxa fica com a empresa (decisão sua, seção 7). Ainda não sabemos se ele devolve a taxa (e os juros do cartão)
  numa devolução de parte: confira no primeiro teste e informe em "Registrar taxa que não voltou";
- devolver parte também pode pedir **saldo disponível** na conta, como no cancelamento.

**Conector do Claude × chave do sistema:** os "conectores" que você liga no Claude (ex.: o
do Resend) deixam **o Claude** usar aquele serviço nas conversas. O **sistema SCL**, rodando
na Vercel, precisa da **sua própria chave** em *Settings → Environment Variables*. São duas
coisas diferentes — as duas são úteis. Em 27/09, o conector Vercel no ChatGPT encontra a
equipe AL Apps, mas não enxerga seus projetos, mesmo após reconexão. Isso não impede o
site de funcionar nem o teste manual de conexão pelo painel.

**Onde ficam senhas e chaves:** nunca no GitHub e nunca no chat. Elas ficam nas
configurações da Vercel e nas configurações do ambiente do Claude Code (variáveis de
ambiente).

---

## 6. O que você precisa fazer agora

> A lista viva do que depende de você, com a marcação de feito e as perguntas e respostas, fica na
> página **Pendências do Diego** (https://claude.ai/artifact/PVim3wJVrYgsRVvzabUv6K), que só você abre. Esta seção continua como a referência
> completa de cada passo.

1. **Vercel + Neon — feito:** site publicado (27/09), bancos de produção e de preview
   conferidos (3/10) e M0.5 fechado por você em 4/10. Passos abaixo ficam como referência:
   1. Entre em vercel.com → *Add New… → Project* → escolha `al-life/scl-reconstrucao`.
   2. Em **Root Directory**, escolha `app`. Clique em *Deploy*.
   3. No projeto criado: *Storage* (ou *Integrations*) → **Neon** → conecte sua conta
      Neon. Isso cria a variável `DATABASE_URL` automaticamente.
   4. Me avise aqui na conversa: eu confiro se o site de homologação abriu.
2. **Login com Google:** funcionando, confirmado por Diego (27/09). Referência para reconfigurar:
   1. Em console.cloud.google.com → crie um projeto "SCL" → *APIs e serviços → Tela de
      consentimento OAuth* (tipo "Externo", nome "Sua Casa Leblon").
   2. *Credenciais → Criar credenciais → ID do cliente OAuth → Aplicativo da Web*.
      Em "URIs de redirecionamento autorizados" coloque
      `https://scl-reconstrucao.vercel.app/api/auth/callback/google` (o endereço que a Vercel der).
   3. Na Vercel, em *Settings → Environment Variables*, crie:
      `AUTH_GOOGLE_ID` e `AUTH_GOOGLE_SECRET` (os dois valores que o Google mostrar),
      `AUTH_SECRET` (qualquer texto longo e aleatório, ex.: gerado em 1password ou similar) e
      `ADMIN_EMAILS` = seu e-mail do Google.
   4. Faça *Redeploy* e entre em `/entrar`. Se travar em algum passo, me chame que eu guio.
3. **Beds24:** o Airbnb já está conectado/mapeado e a leitura dos quartos pelo SCL foi
   confirmada por Diego em 28/09. O 403 duplicado foi removido. Não precisa gerar outra credencial.
   - Use **`BEDS24_REFRESH_TOKEN`** para o refresh token. O sistema o troca por um token de
     acesso e renova quando necessário. Um **invite code** precisa ser trocado primeiro;
     ele não pode ser colocado nessa variável.
   - **`BEDS24_API_KEY`** fica como alternativa para um token de acesso direto. Um *long life
     token* só permite leitura; nunca colocar refresh token nesse campo. Se as duas
     variáveis existirem, o sistema usa `BEDS24_REFRESH_TOKEN`.
   - Após publicar M3.3, abra **Configurações → Integrações → Buscar quartos para vincular**.
     Confira os seis quartos e escolha o imóvel SCL de cada um. Para corrigir um vínculo,
     abra a ficha do imóvel e a seção **Canais e IDs externos**. Não deduza o imóvel pelo
     proprietário ou pelo e-mail do hóspede.
   - Deixe a importação automática desligada, escolha a data inicial e **salve a configuração**.
     Para o primeiro teste, escolha um período que você consiga conferir. Marque a confirmação
     dos vínculos e clique em **Importar agora**. Confira a contagem, os avisos, **Reservas** e
     **Calendário**, comparando com o Beds24. Confira também códigos de reservas que já vieram
     por planilha. Repita a importação: não deve criar cópias.
   - Só depois dessa conferência, ligue a rotina diária se quiser. Ela usa a variável
     **`CRON_SECRET`**, já usada pelas outras rotinas. O botão manual não depende dela.
     Se o banco tiver mais de uma empresa, **`BEDS24_ORGANIZACAO_ID`** precisa apontar a
     empresa atendida pela credencial; o sistema recusa copiar reservas para várias empresas.
   - O teste **Testar conexão com Beds24** continua disponível e apenas lê quartos. Não
     comprova importação de reservas nem execução do agendamento. Os e-mails recebidos do
     Beds24 também não comprovam que as reservas chegaram ao SCL.
   - As variáveis precisam estar no ambiente do deploy que será testado (Production no
     endereço principal; Preview se for testar um PR). Alteração de variável exige novo
     deploy. Chaves nunca vão no chat, Git ou tela do sistema.
   - **Envio de calendário e preços (M3.7):** pronto e desligado. Você prefere esperar (7/10); eu te lembro antes da entrada no ar. O passo a passo do teste no
     103 está na seção 2 ("Calendário e preços no Beds24"). Resumo: regras e feriados em
     Configurações → Calendário e preços; pisos na ficha do imóvel; simular na prévia; só
     depois criar `BEDS24_ESCRITA` = `ligada` na Vercel (o refresh token precisa do escopo
     **inventory**; um token só de leitura recebe "sem permissão de escrita") e fazer
     Redeploy; enviar; conferir no Beds24 e no Airbnb; por último ligar o automático diário.
     Sem a variável, nenhum caminho do sistema escreve no Beds24.
   - **Histórico do acesso:** o teste de 27/09 falhou; após salvar novamente a variável,
     Diego confirmou a leitura. Isso não comprova qual foi a causa da falha anterior.
     Caso reapareça, informe só a mensagem sanitizada do painel, nunca a chave.
4. **Meta / WhatsApp (atualizado em 8/10):** para o WhatsApp do sistema, o caminho é o site de
   desenvolvedores do Meta (developers.facebook.com), com o login do Facebook: empresa com endereço
   no Brasil não consegue criar a conta do WhatsApp pelo Business Suite. Antes de cadastrar número,
   decida qual o sistema vai usar (o número que entra sai do aplicativo WhatsApp do celular). A
   verificação da empresa não é necessária para começar e pode esperar o site no ar: com o
   suacasaleblon.com fora do ar, ela seria recusada. Os passos para o login que volta para a tela de
   entrada estão na página de pendências.
5. **E-mail do sistema (Resend) — feito:** domínio `suacasaleblon.com` verificado no Resend e com envio liberado
   (conferido em 5/10) e remetente `contato@suacasaleblon.com` posto por você na Vercel em 7/10. Falta só
   o teste: peça um código em `/entrar` com um e-mail que não seja o seu. Passos originais, para referência:
   1. Crie conta grátis em resend.com e cadastre o domínio de onde os e-mails vão sair
      (ex.: suacasaleblon.com.br). Ele pede para adicionar alguns registros no DNS
      (Cloudflare) — eu te guio nessa hora.
   2. Crie uma *API key* e coloque na Vercel como `RESEND_API_KEY`, e crie
      `EMAIL_REMETENTE` = `Sua Casa Leblon <acesso@seudominio.com.br>`. **Não cole no chat.**
6. **Agenda da equipe (20h) — e-mail não serve para a equipe (você, 7/10):** a agenda já está no acesso
   próprio de cada pessoa, só da cidade dela (M6.8, item 7); o aviso pelo WhatsApp entra quando ele
   ligar. Não ligue o envio diário por e-mail para a equipe. Referência do que existe (se um dia quiser
   o e-mail para alguém da empresa; depois da Vercel e do Resend, itens 1 e 5):
   1. Na Vercel, em *Settings → Environment Variables*, crie `CRON_SECRET` com um texto
      longo e aleatório. É a senha que o agendador da Vercel usa para chamar a agenda; sem
      ela, a chamada é recusada. **Não cole no chat.**
   2. No painel, em **Agenda**, cadastre os e-mails da equipe (marque Rio ou Búzios para cada
      pessoa), marque "Enviar todo dia às 20h" e salve.
   3. Use "Enviar agora" uma vez para conferir como o e-mail chega.
7. **Profissionais de limpeza pelo celular (M6.8, pronto em 7/10):** em **Limpezas → Profissionais**,
   para cada profissional:
   1. marque a **cidade da agenda** dela (Búzios ou Rio) e salve;
   2. em "Usuário (para entrar sem e-mail)", escreva um usuário (ex.: `maria.limpeza`), deixe a senha em
      branco para o sistema criar uma e aperte "Criar usuário e senha";
   3. copie a mensagem que aparece (a senha só aparece essa vez) e mande para ela pelo seu WhatsApp;
   4. peça para ela entrar em `/entrar` → "Entrar com usuário e senha" e trocar a senha em "Minha
      senha".
   Quem tem e-mail pode, além disso, receber o acesso pelo e-mail ("Liberar acesso") e entrar pelo
   código. Esqueceu a senha? Defina outra no mesmo lugar.
8. **Chaves Pix — conferidas por você em 7/10:**
   - confira no cadastro de cada proprietário (Painel → Proprietários) se a chave Pix está
     preenchida. A tela de Repasses usa essa chave para o botão "Copiar Pix" e avisa quando
     falta; o portal mostra ao proprietário a chave para onde vai o repasse;
   - cadastre a **chave Pix da empresa** em Painel → Configurações → Empresa. Ela aparece no
     portal para o proprietário que deve à empresa, depois do fechamento do mês. Sem ela, o
     portal pede que ele fale com a empresa.
9. **Booking:** criar os anúncios (você começou em 7/10; ver "Copiar anúncios do Airbnb para o Booking" na seção 7).
10. **Relatórios em PDF:** para o fechamento, gere o PDF na ficha do proprietário, anexando o
   **extrato oficial** do canal e uma **foto real** do imóvel. Antes de mandar, abra o PDF e
   confira se o extrato é só daquele imóvel e daquele mês. O **envio automático por e-mail**
   (M5.4) está pronto em Financeiro → Repasses, mas começa desligado e manda o PDF **sem** o
   extrato e sem a foto. Se quiser o automático, confira o texto, ligue e use "Enviar e-mail do
   fechamento" em um proprietário primeiro. Ele depende do Resend e do `CRON_SECRET` (itens 5
   e 6).
11. **Portaria:** em Painel → **Portaria**, marque os imóveis que exigem documentos de
   portaria (hoje, o 403). Sem marcação, a tela só avisa e não lista nada.
12. **Rotinas:** em Painel → **Rotinas**, confira as cinco rotinas que já vêm prontas, com as
   datas das suas regras. Arquive a que não usar.
13. **Manutenção:** quando aparecer "aguardando aprovação" (no menu **Manutenção**), confira o
   orçamento, escolha quem paga (empresa ou proprietário) e aprove, ou recuse com o motivo.
   Só você (administrador) vê esses botões.
14. **Sistema antigo (referência) — feito em 4/10:** você mandou o museu e eu cruzei com o
   plano (seção 2). Falta só você dizer **quais das ideias listadas viram item do plano**. Se
   um dia quiser que eu veja o código de julho ou as fotos reais, os caminhos são liberar o
   repositório antigo para o Claude no GitHub ou mandar o zip; não é necessário para o plano.
   O visual novo do site que você me mostrou em capturas (verde e bege, "Um pouco de Rio. Um
   lugar seu.") não está em lugar nenhum do repositório: quando você reunir as imagens do
   ChatGPT e do Google Fotos numa pasta, eu guardo em `prototipos/` como referência.
15. **Site novo** (você, 7/10: fica para perto da entrada no ar): em **Configurações → Site**, escreva os textos (título, "Sobre", "Como
   reservar", contato, rodapé); em **Configurações → Empresa**, confira o **telefone do
   WhatsApp** da consulta; e, em cada imóvel, marque **público** só nos que devem aparecer e
   confira a descrição, as camas e as comodidades. Para a disponibilidade e o valor reais
   (M7.2) funcionarem: preço base, taxa de limpeza e hóspede extra no cadastro de cada imóvel
   público, e a importação do Beds24 rodando (manual ou diária); confira em Configurações →
   Calendário e preços → Site público a validade da leitura. O site ainda não substitui o
   atual: o domínio só muda na entrada em uso (M11).
16. **Minha reserva (hóspede):** depende do e-mail do sistema (Resend, item 5) — sem ele o
   código não sai. Confira se as reservas têm o **e-mail do hóspede** (o detalhe da reserva
   avisa quando falta) e se o **endereço e o complemento** de cada imóvel estão no cadastro,
   porque é isso que o hóspede vê 2 dias antes da entrada.
17. **Mensagens automáticas ao hóspede** (você, 7/10: esperar e ligar junto com o desligamento das
   mensagens do Airbnb; eu te lembro): depois do Resend (item 5), em **Configurações →
   Modelos de mensagem**, confira o texto de cada modelo, escolha as origens (vem site e
   direta) e marque "Envio automático ligado". Até lá, nada é enviado.
18. **Cadastros pelo site (marketplace):** de vez em quando, abra **Proprietários → Cadastros
   pelo site** e aprove ou recuse os pedidos. O código de confirmação depende do Resend
   (item 5). Quem é recusado ainda não recebe e-mail automático — responda você mesmo.
19. **Recebimento do site — feito em 4/10:** você manteve "empresa recebe e repassa" e o
   contador confirmou que só a comissão é receita. Nada mais aqui; o próximo passo do pagamento
   são a Conta Negócio do Mercado Pago no CNPJ da empresa e as credenciais de teste, que eu peço
   quando chegar o M8.2.

20. **Bloqueio pelo portal (M5.5):** é a chave, em cada contrato, que deixa (Sim) ou não (Não) o proprietário
   bloquear sozinho, pelo portal, as datas de uso próprio; com Não, só a equipe bloqueia. Confira em cada contrato (ficha do imóvel → Contratos) se
   "Bloqueio pelo portal" deve ficar em Sim (como vem) ou Não — o botão Ligar/Desligar fica na
   própria linha —, e avise os proprietários que já podem bloquear datas de uso próprio pelo
   portal. As datas só fecham nos canais quando o envio
   de calendário ao Beds24 estiver ligado (item 3).
21. **Data de início dos contratos (registrado em 2/10):** nada a fazer agora. Na carga de dados
   reais (M11.1), o início do contrato de cada um dos seis imóveis será a data da primeira
   reserva dele (nunca mudaram de proprietário), e **1/10/2026** fica como o marco oficial de
   preços e reservas pelo Beds24 e pelo sistema. O histórico anterior à conexão do Airbnb ao
   Beds24 não vem pela API do Beds24 — é limitação do canal, não do sistema — e fica fora da
   conferência.

22. **Pedidos do site (M8.1):** quando aparecer em **Reservas** uma linha com origem "site" e
   situação "pedido", é um visitante que segurou datas pela cotação. Fale com ele (contato na
   ficha) e **confirme ou cancele antes do prazo** das observações; se não, o pedido vence sozinho.
   O prazo padrão é de 30 minutos, em Configurações → Calendário e preços → Site público.

23. **Backup do repositório (M0.7) — ativado por você em 4/10; passo a passo mantido para
   consulta e para renovar as chaves.** Pode fazer pelo celular. Guarde
   cada senha e chave no gerenciador de senhas na hora em que criar; **nada vai para o chat**.
   Nunca me passe o nome da conta nova nem do repositório de backup: não preciso deles e é
   melhor que fiquem só com você.
   1. **Conta nova no GitHub** com outro e-mail seu, senha própria e **2FA** ligado
      (*Settings → Password and authentication → Two-factor authentication*). Salve os
      **códigos de recuperação** no gerenciador de senhas. Não use o nome da empresa na conta.
   2. **Repositório privado** nessa conta: *New repository*, qualquer nome discreto, visibilidade
      **Private**, marque *Add a README file*, *Create repository*.
   3. **Chave só de leitura, na sua conta principal** (a do `al-life`): *Settings → Developer
      settings → Personal access tokens → Fine-grained tokens → Generate new token*.
      - *Token name*: algo como "leitura para espelho"; *Expiration*: o máximo (1 ano);
        anote a data de validade no gerenciador de senhas.
      - *Resource owner*: **al-life** (se não aparecer, em *al-life → Settings → Personal
        access tokens* permita tokens fine-grained e volte aqui).
      - *Repository access*: **Only select repositories** → `scl-reconstrucao`.
      - *Permissions → Repository permissions → Contents*: **Read-only**. Nada mais.
      - *Generate token* e copie a chave (ela aparece uma vez só).
   4. **Chave de escrita, na conta nova, e os três segredos.** O robô grava no repositório de
      backup com uma chave da própria conta nova. A chave automática que o GitHub dá aos robôs
      não serve: o GitHub não a deixa criar nem atualizar arquivos de workflow
      (`.github/workflows/`), e o SCL tem um em todas as branches, então toda branch seria
      recusada (foi exatamente o erro da sua primeira rodada, em 4/10: "Recusas inesperadas no
      push do espelho"). Essa chave não liga as contas: só vale dentro da conta nova, para o
      repositório de backup.
      - **Criar a chave:** logado na **conta nova**, *Settings → Developer settings → Personal
        access tokens → Fine-grained tokens → Generate new token*. *Token name*: algo como "robô
        de backup"; *Expiration*: o máximo (1 ano), anote a validade no gerenciador de senhas;
        *Resource owner*: a própria conta nova; *Repository access*: **Only select
        repositories** → o repositório de backup; *Permissions → Repository permissions*:
        **Contents: Read and write** e **Workflows: Read and write**. Nada mais. *Generate
        token* e copie a chave (aparece uma vez só).
      - **Os três segredos**, no repositório de backup: *Settings → Secrets and variables →
        Actions → New repository secret*, um de cada vez, nomes exatamente assim, em maiúsculas:
        - `ORIGEM_REPO` = `al-life/scl-reconstrucao`
        - `ORIGEM_TOKEN` = a chave só de leitura do passo 3
        - `DESTINO_TOKEN` = a chave de escrita criada logo acima.
   5. **O robô.** É este passo que faz o robô aparecer na aba *Actions* do repositório de
      backup: enquanto o arquivo não existir lá, a aba *Actions* só mostra modelos do GitHub
      ("Get started with GitHub Actions"), e não há nada para escolher. Nada é digitado à mão:
      é copiar um arquivo pronto e colar.
      - **Copiar:** no repositório principal (`al-life/scl-reconstrucao`, aba *Code*, branch
        `main`), abra a pasta `infra`, depois `backup`, e toque no arquivo
        `espelho-github.yml`. No alto do arquivo há um botão *Raw* e, ao lado dele, um ícone de
        dois quadradinhos (*Copy raw file*): toque nele e o arquivo inteiro vai para a área de
        transferência. Se preferir o *Raw*: selecione tudo (Ctrl+A ou Cmd+A) e copie. Pelo
        celular é mais difícil selecionar tudo; se der, faça este passo no computador.
      - **Colar no repositório de backup** (na conta nova, aba *Code*): botão *Add file →
        Create new file*. Na caixa do nome, digite `.github/workflows/backup.yml` **com o ponto
        no começo**: ao digitar cada barra, o GitHub transforma a parte anterior numa pastinha
        e segue; no fim deve aparecer `.github / workflows / backup.yml`. Na caixa grande de
        baixo, cole o conteúdo (a primeira linha começa com `# Robô de backup`). Toque em
        *Commit changes...*, deixe marcado *Commit directly to the main branch* e confirme em
        *Commit changes*.
      - **Caminho alternativo**, se preferir: aba *Actions* do repositório de backup → link
        *set up a workflow yourself*. Abre um editor já na pasta certa, com o nome `main.yml`:
        troque o nome por `backup.yml`, apague o texto de exemplo que vem na caixa, cole o
        conteúdo copiado e confirme em *Commit changes*.
      - Conferir: em *Code* deve existir a pasta `.github`, dentro dela `workflows`, dentro dela
        `backup.yml`; e a aba *Actions* passa a listar, à esquerda, "Backup do repositório de
        origem" (o nome vem de dentro do arquivo).
      - **Se você já tinha copiado o robô antes de 4/10/2026**, atualize-o: no repositório de
        backup, abra `.github/workflows/backup.yml`, toque no lápis (*Edit this file*), selecione
        tudo (Ctrl+A), cole o conteúdo novo copiado do repositório principal e confirme em *Commit
        changes*. A versão nova é a que usa o segredo `DESTINO_TOKEN` do passo 4.
   6. **Proteção extra contra apagar e reescrever** (opcional). **Só existe em repositório
      privado com plano pago do GitHub** (Pro, cerca de US$ 4 por mês, na conta nova). No plano
      Free, **pule este passo**: o robô já nunca apaga nem reescreve e te avisa se o backup
      perder algo; a trava só protege a mais contra um erro manual seu. Se assinar o Pro:
      *Settings → Rules → Rulesets → New ruleset → New branch ruleset*. Nome "nunca apagar";
      *Enforcement status*: **Active**; *Target branches → Add target → Include all branches*;
      em *Rules*, marque **só** *Restrict deletions* e *Block force pushes*; *Create*. Repita
      com *New tag ruleset* → *Include all tags*, as mesmas duas regras.
   7. **Primeira rodada à mão:** aba *Actions* do repositório de backup → na lista da
      esquerda, "Backup do repositório de origem" (esse nome só existe depois do passo 5; se
      não aparecer, volte lá) → botão *Run workflow* (à direita, na faixa azul) → botão verde
      *Run workflow*. Em um ou dois minutos deve ficar verde. Confira em *Code* que
      apareceu a branch `backup-marcos` e, em *Tags*, uma `backup/` com a data de hoje (abra
      a tag: são os arquivos do sistema naquele momento, e o texto do commit lista todas as
      branches e tags da origem com o código de cada uma). As branches e tags copiadas da
      origem ficam numa área interna que o site do GitHub não lista, de propósito: assim
      nenhuma automação vinda da origem roda na conta de backup. Na branch principal vai
      aparecer também um commit do robô
      com um arquivo `.backup/iniciado`: é o marcador de que o backup já existe; não apague.
      **Depois dessa primeira rodada verde**, crie uma variável no repositório de backup:
      *Settings → Secrets and variables → Actions → aba Variables → New repository variable*,
      nome `BACKUP_INICIADO`, valor `sim`. É um registro que o robô só lê e nunca cria: se um
      dia alguém apagar tudo (até o marcador), o robô ainda vai saber que o backup já existia e
      avisar, em vez de recomeçar em silêncio. Se ficar vermelho, abra a rodada e me mande **só o texto da mensagem de erro**
      (ela não contém chave).
      - Se o erro for "Faltam segredos neste repositório", ele lista quais: confira os nomes
        no passo 4 (maiúsculas, sem espaço).
      - Se o erro for "Recusas inesperadas no push do espelho" e citar *workflow* ou
        *permission*, falta o segredo `DESTINO_TOKEN` ou a chave dele está sem **Workflows: Read
        and write** (passo 4). Também acontece se o `backup.yml` do repositório de backup ainda
        for a versão anterior a 4/10 (passo 5, último item).
      - Se o erro for "O push do espelho para este repositório falhou", a chave `DESTINO_TOKEN`
        não serve para gravar: confira se ela é da conta nova, se inclui o repositório de backup,
        se tem **Contents: Read and write** e se não venceu.
      - Se o erro falar do marcador `.backup/iniciado`, é a branch principal recusando o commit
        do robô (alguma regra de "só por pull request"): em *Settings → Branches* (ou *Rules*)
        tire essa exigência da branch principal e rode de novo. Até resolver, a rodada fica
        vermelha de propósito.
   8. **Depois:** o robô roda sozinho a cada 3 dias, às 03:17. Uma vez por mês, dê uma olhada
      na aba *Actions* (verde). Rodada vermelha gera e-mail para a conta nova e diz exatamente
      o que sumiu, foi reescrito ou foi alterado, e onde (é aviso, não perda), ou que a chave
      venceu. Se a mensagem falar em algo "alterado" ou "movido" no backup, a correção é
      apagar aquela ref lá; o robô regrava sozinho na rodada seguinte. Antes de cada chave
      vencer, gere outra (leitura: passo 3; escrita: passo 4) e troque o segredo
      correspondente (`ORIGEM_TOKEN` ou `DESTINO_TOKEN`). **Confira
      também a data da última rodada:** se o próprio robô for apagado ou desligado, ele não
      roda e, sem rodar, não avisa nada. O passo 9 cobre isso.
   9. **Batimento (opcional, recomendado, grátis, 5 minutos):** um serviço que espera um sinal
      do robô a cada rodada e te manda e-mail se o sinal faltar. Crie uma conta em
      healthchecks.io (ou serviço parecido) com o e-mail da conta nova; *New check*, nome
      "backup", *Period* 3 dias, *Grace* 1 dia; copie a URL de *ping*. No repositório de
      backup, crie o segredo `BATIMENTO_URL` com essa URL (como no passo 4). Pronto: se o
      backup parar por qualquer motivo, você recebe um e-mail em até 4 dias. Rodada vermelha
      por aviso ainda manda o sinal; e-mail do serviço quer dizer que o robô não rodou ou não
      conseguiu gravar. O serviço só recebe o sinal, não tem acesso a nada.

23b. **Backup do banco (Neon) — feito em 3/10, com o seu "pode fazer".** O Neon agora guarda
   **7 dias** de histórico para voltar no tempo (antes era 1 dia) e tira um **snapshot diário**
   do banco de produção às 3h (guardado 14 dias) e um **semanal** (guardado 35 dias). Esses
   backups ficam **dentro do próprio Neon**, na mesma conta e projeto, guardados à parte do banco
   vivo: protegem contra erro nos dados (apagar algo sem querer, migração ruim), não contra
   perder a conta do Neon. A cópia **fora** do Neon (despejo cifrado num lugar privado, nunca no
   GitHub) fica para o M11.3, quando houver volume de dados reais. Nada para você fazer agora;
   custa um pouco de armazenamento a mais (o banco tem poucos megabytes).
24. **Marketplace e desconto do site (M12.1):** abra **Configurações → Marketplace e desconto do
   site**, confira as taxas de referência (Airbnb 16%, Booking 15%, pagamento 4% — eu coloquei os
   valores aproximados que a gente usou nas contas; se a sua tabela do Mercado Pago ou do Airbnb
   disser outro número, corrija ali) e brinque com a simulação. Enquanto não salvar nada, vale o
   padrão 6/3/3 (hóspede 1, proprietário 1, SCL 2), decidido por você em 7/10: desconto no site de
   cerca de 3% do valor cheio. Se você já tinha salvo a aba com o 1/1/1 antigo, ela mostra um aviso
   com o botão "Usar o padrão novo" (troca só os pesos; as taxas ficam). Se preferir que o site não
   dê desconto por enquanto, ponha 0 no peso do hóspede.
25. **Fonte de preços de cada imóvel (M3.9):** abra a ficha de cada imóvel → Preço e taxas →
   **Fonte de preços**. Os seis imóveis atuais ficam em "automáticos do SCL", o nosso motor (já é o padrão; você confirmou em 7/10). Imóveis novos escolhem se querem os nossos preços ou só a sincronização de calendário. Para um
   imóvel de marketplace em que o dono ou a ferramenta dele define os preços no Beds24, escolha
   "definidos no Beds24": aí ele pode entrar na lista de envio sem risco de o SCL sobrescrever
   preço. Depois, na prévia de calendário, confira a coluna "Site (≈)" contra o anúncio.
26. **Identidade visual (M7.5) — implementada em 4/10:** o zip do Sage está guardado em
   `prototipos/acervo-visual-2026-10` e a especificação (cores, fontes, espaçamentos, busca
   translúcida, grão sutil, painel mais denso) em `requisitos/product/DESIGN.md`; o site, os
   portais e o painel já estão nesse visual (seção 2). O que é seu: abrir a preview, olhar o
   site no celular e no computador e me dizer o que destoa; preencher em Configurações → Site
   o olho da capa, a chamada final e os blocos de "Por que reservar direto" (cada bloco
   separado por linha em branco; a primeira linha é o título). As fotos já têm lugar (M7.3, item 34).
27. **Recebimentos das reservas (M4.10) — outubro registrado por você em 7/10:** a partir de agora o fechamento só paga a parte de
   reserva cujo dinheiro você registrou como recebido. Antes do próximo fechamento (dia 2), abra as reservas
   de Booking, site e direta já recebidas e clique em "Registrar recebimento" (o valor vem
   preenchido). Sem isso, a parte fica "a liberar", fora do repasse, com aviso no painel e no
   portal. O Airbnb (paga direto) não precisa. O fechamento de outubro é o primeiro feito no sistema:
   antes dele, faça o item 29 (início do sistema e acerto por fora), que tira setembro e antes do
   caminho de uma vez.
28. **Periodicidade dos repasses (M4.10):** confira **Configurações → Repasses** (padrão mensal
   para todos; segunda-feira no semanal; dias 1 e 16 no quinzenal) e avise os proprietários que
   eles podem escolher no portal. Se quiser outro padrão para o marketplace (ex.: semanal),
   mude ali. E, ao marcar um repasse pago, anexe o comprovante: é ele que libera o e-mail.
29. **Feito por você em 7/10 (início do sistema gravado e acerto por fora marcado).** **Antes do fechamento de outubro — o primeiro feito no sistema (decisão sua, 4/10): marque o que é
   de antes como acertado por fora (M4.11).** Faça uma vez, antes do fechamento de outubro (2/11; pode ser hoje):
   1. **Configurações → Repasses → "Início do sistema para valer":** informe **1/10/2026** e salve
      (é sempre dia 1º de um mês).
   2. **Financeiro → Repasses → "Antes do início do sistema":** a lista mostra, por proprietário, as
      partes de reserva paga antes de 1/10 que estão fora de repasse e o acerto em aberto de antes.
      Clique em **"Marcar como acertado por fora"** e confirme. Para cada proprietário nasce um
      repasse "acerto por fora até 30/09/2026", já pago, sem Pix nem e-mail, com a parte dele em
      cada reserva paga até 30/9; o acerto desses meses fica em zero. Essas partes nunca mais
      entram em antecipado (nem pedido pelo portal) nem em fechamento. **Reserva que atravessa
      setembro/outubro** (ex.: entrada 29/9, saída 2/10): vale a data em que o canal pagou (M4.12).
      Airbnb: pelo prazo do canal (1 dia depois do check-in), nada a fazer. Booking, site e direta:
      **antes de marcar, registre o recebimento dela com a data em que o canal pagou** — paga até
      30/9, a reserva inteira entra na marcação (a noite de outubro junto); paga de 1/10 em diante,
      entra inteira no sistema e sai no fechamento de outubro. Sem o recebimento registrado, o
      proprietário aparece bloqueado na lista até você registrar.
   3. Se um proprietário aparecer com **bloqueio** (lançamento em conferência, ajuste a esclarecer,
      adiantamento em aberto de antes de 1/10 ou reserva que atravessa 30/9→1/10 sem recebimento
      registrado), resolva o que o texto pedir e clique de novo: o
      botão só marca o que ainda não foi marcado. Se depois surgir algo novo de antes de 1/10 (uma
      importação atrasada, por exemplo), a lista volta a mostrar e você clica de novo — até lá essa
      parte fica "a liberar" (nunca entra em antecipado) e o fechamento desse proprietário avisa e
      espera a marcação.
   4. Errou? O repasse "acerto por fora" se estorna como qualquer outro (Financeiro → Repasses, na
      própria seção): as partes voltam ao extrato. Se já houver um repasse mais novo do mesmo
      proprietário, o sistema pede para estornar esse primeiro.
   - **Daí em diante o fechamento de outubro é o normal:** registre o recebimento das reservas de
     outubro de Booking, site e direta já pagas pelo canal (Airbnb não precisa), confira os avisos no
     cartão de cada proprietário ("fora do fechamento", "diferença de recálculo") e, depois do Pix,
     marque pago com o comprovante — é ele que dispara o e-mail.
   - **Despesas e adiantamentos de setembro já acertados por fora:** não lance no sistema (um
     adiantamento de antes de 1/10 em aberto trava a marcação até ser quitado). Só o que for de
     outubro em diante.
   - **Reserva de outubro que você já tenha acertado por fora** (paga pelo canal até 30/9): registre
     o recebimento dela com a data em que o canal pagou e ela entra inteira na marcação (M4.12) — não
     precisa mais me avisar nem fazer ajuste à mão.
30. **Marketplace no portal (M12.4):** para cada imóvel marketplace, confira três coisas: o
   contrato está como "marketplace" (é isso que libera a seção no portal); a fonte de preços na
   ficha do imóvel está certa ("automáticos do SCL" ou "digitados no cadastro" deixam o
   proprietário editar o preço; "definidos no Beds24" deixa só as regras); e o imóvel está na
   lista de envio ao Beds24, senão o que o proprietário mudar vale só no site. Na página de
   Limpezas, as limpezas de imóvel marketplace feitas pelo proprietário aparecem como realizadas
   com custo zero e a observação "feita pelo proprietário".
31. **"Como funciona" (M5.6) — versão 1 publicada por você em 7/10.** Referência: em **Configurações → Como funciona (proprietário)**, leia o
   rascunho sugerido com calma (é um texto meu a partir das regras do sistema, não uma decisão sua),
   ajuste o que quiser e clique em "Publicar a versão 1". Até isso, o portal não mostra o documento
   nem pede aceite a ninguém. Depois: cada proprietário vê a faixa no portal e aceita; quem entrar por
   convite novo aceita no próprio link. Quando decidir quem arca com contestação de cartão (seção 7),
   preencha a seção "Contestações" e publique a versão 2 — todos vão aceitar de novo, e é assim mesmo.
   Não escreva no texto a comissão nem a periodicidade: elas aparecem sozinhas, do cadastro.

32. **Guarde os extratos dos canais antes do fechamento (M5.7), entre 1/11 e 2/11 para outubro:** em **Financeiro → Repasses**, abra
    "Extratos dos canais para o relatório de {mês}" e suba, para cada imóvel, o PDF que o Airbnb
    emitiu ("Ganhos" do período; Booking quando houver), escolhendo o proprietário favorecido e
    indicando as páginas que são só daquele imóvel, daquele proprietário e daquele mês (se o imóvel
    trocou de dono no meio do mês, um extrato para cada um — o de um nunca vai no relatório do outro). Esse arquivo vai no fim do relatório que o e-mail do fechamento manda. Sem
    ele, o relatório sai sem anexos e a seção do proprietário avisa — nada é inventado. Antes do
    primeiro envio, gere o PDF de um proprietário na ficha dele (Relatório em PDF) e confira as
    quatro páginas; me diga o que ajustar.

33. **Dia do fechamento (M4.13):** já está no **dia 2**, como você decidiu em 5/10 — nada a fazer se
    ficar assim. Se quiser outro dia (de 1 a 5), mude em **Configurações → Repasses → "Dia do
    fechamento mensal e do relatório"**: vale do fechamento do mês atual em diante. Lembre que no
    dia 1º o e-mail do relatório **não** sai sozinho; se quiser adiantar algum mês, feche e envie à
    mão pelo painel (Financeiro → Repasses).

34. **Fotos dos imóveis (M7.3, pronto em 7/10):** para cada imóvel do Leblon, abra **Imóveis → o
    imóvel → Fotos** e suba as fotos do anúncio do Airbnb (no Airbnb, como anfitrião, em Anúncios →
    o anúncio → Fotos, dá para baixar cada uma) ou as do seu catálogo. Escolha a capa (a foto que
    melhor vende o imóvel; ela vai no cartão do site e na capa do relatório) e, se quiser, escreva
    uma legenda curta em cada foto ("Sala com vista", "Varanda"). Só fotos que você tem direito de
    usar. Depois abra a página do imóvel no site da preview e confira a galeria no celular.
35. **Site do hóspede (M7.6, pronto em 7/10):** em **Configurações → Site**:
    - **Imagens do site:** suba a foto de capa da página inicial (uma foto do Leblon que você tem
      direito de usar; pode ser a original do celular). Se quiser outra marca, suba também; até lá,
      vale a do estudo.
    - **O bairro à sua porta:** cadastre os lugares que você quer mostrar na página de cada imóvel
      (praia, padaria, livraria…), com a distância ("5 min a pé"), uma frase curta e, se tiver, uma
      foto sua. Só fotos com direito de uso.
    - **Textos:** leia o texto-base de "Por que reservar direto" e os textos novos (vitrine, consulta,
      legenda vertical) e ajuste. Pode deixar para perto da entrada no ar, como combinamos.

    Depois abra o site da preview no celular e no computador. Confira o carrossel, o calendário das
    datas e a consulta, e me diga o que destoa.
36. **Página para proprietários (M7.7, pronta em 8/10):**
    - **Textos:** em **Configurações → Página para proprietários**, leia o texto-base (capa, gestão
      completa, marketplace, como gerimos, portfólio, pedido de contato) e ajuste. Pode ser perto da
      entrada no ar.
    - **Números de mercado (opcional):** se quiser mostrar, digite na mesma tela, por tipo de imóvel,
      a diária média e a ocupação (e, se quiser, o líquido por mês), com o mês e de onde vêm os
      números. Só dados reais que você conferiu. Sem números, a seção não aparece.
    - **Pedidos de contato:** quando chegar um, ele aparece no Início do painel e por e-mail. Responda
      e marque como respondido em **Proprietários → Pedidos de contato**.

37. **Pagamento pelo site em teste (M8.2a):**
    - **Aplicação no Mercado Pago:** em mercadopago.com.br/developers, com a Conta Negócio do CNPJ
      (confira no canto de cima), **Suas integrações → Criar aplicação**, criar manualmente,
      solução **Checkout Transparente**, tipo de API **Orders**.
    - **Chaves de teste na Vercel, só no ambiente Preview:** em Testes → Credenciais de teste, copie
      a Public Key e o Access Token. Na Vercel, em *Settings → Environment Variables*, crie
      `MERCADOPAGO_PUBLIC_KEY` e `MERCADOPAGO_ACCESS_TOKEN` (marque *Sensitive*), marcando só
      **Preview**. Nunca mande as chaves no chat.
    - **Chave Pix na conta do Mercado Pago:** sem ela, o Pix não aparece. Se o CNPJ já é chave em
      outro banco, use uma chave aleatória.
    - **Conferir:** abra o link da prévia do PR, entre no painel e veja em **Integrações** que aparece
      "conta de teste conferida".
    - **Ligar a oferta:** em **Configurações → Pagamento no site**, marque **Oferecer pagamento no
      site** e salve. Ela vem **desligada**: sem isso, o site não oferece o Pix (por segurança, nada
      cobra enquanto você não ligar). Na mesma tela, veja se o imóvel do teste tem ✓. Desde 9/10, o
      Pix também só aparece com as três páginas legais publicadas no banco das prévias (item 39).
    - **Testar um Pix:** no site da prévia, faça uma consulta, segure as datas (no nome, escreva
      **APRO**: no teste, o Mercado Pago aprova sozinho o Pix de quem tem esse nome), gere o Pix e
      espere a página confirmar. Se demorar, use **Conferir agora** na ficha da reserva. Depois,
      registre a liberação à mão na mesma ficha (no teste o Mercado Pago não informa liberação).
    - **Aviso de pagamento (webhook), depois:** quando eu avisar, em Suas integrações → a aplicação →
      Webhooks → Configurar notificações, use o endereço que aparece em **Integrações**, marque só
      o evento "Order (Mercado Pago)", salve, copie a assinatura secreta para a Vercel como
      `MERCADOPAGO_WEBHOOK_SECRET` (marque **Preview** e **Production**: o aviso chega no endereço
      de produção, que só confere a assinatura e registra que chegou) e use o botão **Simular**. As
      outras duas chaves continuam só em Preview.
    - **Na conta do Mercado Pago:** deixe **desligado** o "parcelamento sem acréscimo" (o hóspede paga
      os juros) e não use cupons do Mercado Pago (o desconto do site já vem no preço).
    - **Devolva pela ficha da reserva**, para o sistema saber. No cartão, só se o sistema disser que não
      deu, devolva pelo painel do Mercado Pago e depois use **Conferir agora** (ou registre a devolução
      por fora; desde 10/10, no cartão, só depois de o Mercado Pago recusar de vez, de você registrar a recusa
      que viu no painel dele, ou depois de 180 dias). Antes de registrar uma devolução **feita por fora**, o sistema confere no Mercado Pago
      se o dinheiro já não voltou por lá (se não der para conferir, ele não registra).
    - **Depois de uma devolução pelo Mercado Pago:** veja no Mercado Pago quanto da taxa ficou com ele
      e informe em **Registrar taxa que não voltou**, na ficha (em reais, com vírgula, ex.: 18,06; zero se
      voltou toda; a confirmação mostra o valor digitado, e valor maior que a taxa que ele cobrou é
      recusado). O Mercado Pago não
      informa isso sozinho; até você informar, fica um aviso. A regra de a empresa ficar com a taxa que
      não volta, quando o pagamento ficou sem reserva por falha do sistema, é minha sugestão: confirme
      se concorda. Desde 10/10, numa devolução **por fora** o sistema calcula sozinho a taxa que não voltou (o
      que foi devolvido menos o que tinha entrado); se um valor estiver errado, use **Corrigir taxa que não
      voltou** na ficha (essa despesa não se estorna mais em Despesas).
    - **No teste, nada confere sozinho:** a página do hóspede confere o Pix dela; o resto (devolução
      pedida, Pix que sobrou, um pagamento que ficou sem resposta) você confere com **Conferir agora**.
38. **Sobras de feriado e evento com reserva (M3.10, pronto em 9/10):** em **Configurações →
    Calendário e preços**:
    - Ao cadastrar um evento, deixe marcada a caixa "Quando já houver reserva confirmada no período,
      as noites livres usam o mínimo normal da semana" para Réveillon, Carnaval e outros eventos
      curtos. **Desmarque na alta temporada** e em qualquer temporada longa.
    - Nos eventos já cadastrados, confira a coluna **Com reserva** e troque com o botão, se precisar.
    - Nos feriadões, a mesma opção fica no quadro "Feriados e feriadões" (vem marcada).
    - Antes de ligar o envio, abra a **prévia do envio** numa data de evento que já tenha reserva e
      confira o mínimo das noites livres.
39. **Páginas legais (M7.4, pronto em 9/10):**
    1. **Preencha a empresa:** em **Configurações → Empresa**, razão social, CNPJ, endereço, e-mail,
       telefone e o novo campo **encarregado pela proteção de dados** (quem atende os pedidos sobre
       dados pessoais; se a empresa puder usar a dispensa para pequeno porte, confirme o texto com o
       advogado).
    2. **Leia os três textos-base** em **Configurações → Páginas legais do site** e leve ao contador
       e, de preferência, a um advogado (o botão "Copiar o texto" ajuda), com a lista abaixo.
    3. **Publique a versão 1 de cada um:** no painel de produção, para o site de verdade, e também
       uma vez numa prévia da Vercel, para o teste do Pix continuar (a prévia usa um banco separado).
       Sem as três, o site não oferece o Pix.
    4. **Teste numa prévia:** segure as datas, marque a caixa, gere o Pix e confira, na ficha da
       reserva, as versões aceitas.
    5. **Depois de qualquer mudança** (texto, prazo dos dias ou dados da empresa), publique uma
       versão nova. Ela vale para os próximos pagamentos.

    **O que conferir com o contador e o advogado:**
    - **Arrependimento de 7 dias:** a posição do texto (o hóspede pode desistir em até 7 dias depois
      do pagamento e recebe tudo, mesmo dentro dos 14 dias) e o limite que eu acrescentei: só até o
      início da estadia.
    - Se o **Código de Defesa do Consumidor** vale aqui; se "locação para temporada" é a melhor
      descrição ou se é hospedagem; e se o site deve limitar as estadias a 90 dias.
    - **Ficar com 100% com menos de 14 dias** pode ser questionado; uma saída seria devolver o valor
      das noites que forem alugadas de novo.
    - **A taxa do Mercado Pago:** conferir no primeiro reembolso em teste se ela volta.
    - **O que a lei do comércio eletrônico pede antes de vender:** o e-mail de confirmação da reserva
      ligado antes do pagamento de verdade; um jeito de desistir pelo próprio site (feito em 10/10, M8.2c: o
      botão "Pedir o cancelamento" em Minha reserva; confira com o advogado se um pedido, que a equipe executa,
      basta); a confirmação por escrito do pedido de cancelamento (o e-mail está pronto e sai quando você ligar
      as mensagens ao hóspede, item 43); e uma resposta automática no e-mail fora do horário da equipe.
    - **Encarregado** pelo nome, ou a dispensa para pequeno porte.
    - **Por quanto tempo guardar os dados dos hóspedes** (hoje ficam para sempre): uma regra, por
      exemplo tantos anos depois da saída.
    - **Servidores fora do Brasil** (Vercel e Neon): conferir as regiões nas contas e a base legal da
      transferência.
    - **Registros de acesso por 6 meses** (Marco Civil da Internet): se a empresa precisa guardar.
    - **Fornecedores citados por categoria** (o serviço de e-mail e o sistema de reservas, sem nome):
      se o advogado pede os nomes.
    - Se os dados vão de fato para a **contabilidade**, como a política diz.
    - **Cópias dos documentos da portaria** que passam pelo WhatsApp ou pelo e-mail: uma regra para
      apagar.
    - **Formulários dos proprietários:** a autorização é obrigatória, mas o sistema não registra quando
      foi dada.
    - **Idade mínima de 18 anos** para reservar.
    - **Encerrar a estadia por violação grave** (festa, mais pessoas que o reservado): hoje não está no
      texto.
    - **Reservas diretas fechadas pelo WhatsApp:** se seguem a mesma política.
    - **Alteração para um valor menor:** a diferença seguir as regras de cancelamento (M8.2d). Feito em 10/10 com o
      padrão: contando da entrada original ou da nova, a que vier primeiro. Leve também: o pagamento da diferença não
      abre outro arrependimento de 7 dias, e a devolução de parte do valor espera a liberação do pagamento (decisões 1,
      9 e 11 da alteração, seção 7).
40. **Pagamento com cartão em teste (M8.2b, pronto em 9/10):** tudo numa prévia da Vercel, com as mesmas
    chaves de teste do item 37 (a do Pix já precisa estar funcionando).
    1. **No Mercado Pago:** faça os ajustes da conta da seção 5 ("Mercado Pago e o cartão":
       "parcelamento sem acréscimo" desligado, "receber à vista" ligado e o prazo de liberação do
       cartão). Em **Integrações**, se aparecer que a chave pública e o token parecem de contas
       diferentes, copie de novo as duas da mesma tela de credenciais de teste.
    2. **Publique uma versão nova da Política de privacidade** em **Configurações → Páginas legais do
       site**: o texto-base agora diz o que guardamos do cartão (bandeira, parcelas, valor pago com os
       juros e o resultado da verificação do banco, nunca o número do cartão). Na prévia, para o teste; e,
       antes de ligar o cartão de verdade, também no painel de produção.
    3. **Revise o convite para pagar** em **Configurações → Site** ("Pagamento no site: convite para
       pagar"): se você já salvou essa tela, o seu texto ainda fala só de Pix (o texto-base novo não cita
       a forma de pagamento). Na mesma tela, leia o texto novo do cartão em análise.
    4. **Ligue o cartão:** em **Configurações → Pagamento no site**, marque **Oferecer cartão de
       crédito** (vem desligado); em **Número máximo de parcelas**, deixe vazio (o máximo do Mercado
       Pago) ou escolha um número; em **Verificação do banco (3DS)**, deixe **Quando houver risco
       (recomendado)**. Salve. Confira no quadro **Cartão** que aparece "Ligado".
    5. **Teste:** na prévia, segure as datas, escolha **Cartão de crédito**, marque o aceite e use um
       cartão de teste: Mastercard 5480 8328 0103 3311 ou Visa 4235 6477 2802 5682, código de segurança
       123, validade 11/30, CPF 12345678909. **No formulário do cartão, no campo "Nome do titular"**
       (não no nome da reserva, ao contrário do teste do Pix), escreva:
       - **APRO** (aprova), **OTHE** (recusa) ou **CONT** (fica em análise);
       - **APRO-CHOK** ou **OTHE-CHNO** (o banco pede a verificação: aprova ou recusa);
       - **APRO-AUTH**, **APRO-ATMT** ou **OTHE-NAUT** (verificação do banco sem desafio).
       Faça também um em 3 parcelas e confira na ficha da reserva "Cartão de crédito · Mastercard · 3x"
       e os juros. Se a página demorar, use **Conferir agora** na ficha.
    6. **O freio vai aparecer no teste:** depois de 8 recusas em meia hora, o cartão desliga por 1 hora
       (é o freio funcionando; o Pix continua). Na terceira vez no mesmo dia, ou com 20 recusas no dia,
       use **Religar o cartão** no quadro Cartão. Tentativas seguidas com os mesmos dados podem ser
       recusadas pela segurança do Mercado Pago e contam no freio: espere alguns minutos entre elas.
    7. **Para achar um pagamento no Mercado Pago:** use os números da linha "No Mercado Pago" na ficha da
       reserva (o botão copia).
    8. **Regra para a equipe:** não informe ao hóspede o motivo de uma recusa de cartão; peça outro
       cartão ou o Pix.
    9. **Me conte o que viu:** o tamanho do quadro da verificação do banco, se o formulário mostrou os
       juros em cada parcela e se algum passo não bateu com este roteiro. Eu ajusto antes da produção.
41. **Cancelamento de reserva paga pelo site, em teste (M8.2c, pronto em 10/10):** tudo numa prévia da Vercel,
    com as chaves de teste do item 37.
    1. **Só na prévia mais nova:** use o link da prévia deste PR (ou de um mais recente). As prévias antigas usam
       o mesmo banco e não sabem tratar estas devoluções.
    2. **Cancelamento no prazo (devolução integral):** faça um Pix de teste como no item 37 (nome **APRO**). Na
       ficha da reserva, em "Pagamento no site" → **Cancelamento pela política**, escolha "O hóspede pediu",
       informe quando e por onde o pedido chegou (por exemplo, agora, WhatsApp), clique **Calcular o
       cancelamento pela política**, leia a prévia e clique **Cancelar a reserva**. Use **Conferir agora** até a
       devolução aparecer como confirmada. Depois, veja no Mercado Pago quanto da taxa ficou com ele e informe em
       **Registrar taxa que não voltou** (zero se voltou toda).
    3. **Pedido pelo hóspede:** faça outra reserva de teste com um e-mail seu, entre em **Minha reserva** com o
       código que chega nesse e-mail e clique **Pedir o cancelamento**. Confira o e-mail que chega na empresa, o
       aviso no Início e, na ficha, que o horário do pedido aparece travado. Depois, cancele pela ficha.
    4. **Sem devolução:** um pagamento feito agora está sempre dentro dos 7 dias do arrependimento, então "O
       hóspede pediu" sempre dá devolução integral no teste. Para ver o caso sem devolução, use o não
       comparecimento: faça uma reserva de teste com a entrada o mais perto que o imóvel aceitar e, depois do
       horário de entrada mais a tolerância, cancele como **Não comparecimento** (sem pedido registrado). Para não
       esperar até o meio-dia seguinte, na prévia você pode pôr 0 em "Não comparecimento: horas depois do horário
       de entrada" (Configurações → Pagamento no site) e voltar para 21 depois. O valor fica e é dividido como
       uma reserva normal.
    5. **Mensagens e página do hóspede:** na ficha, copie as mensagens prontas e use **Mensagem enviada ao
       hóspede**; abra a página da reserva no site para ver o que o hóspede vê.
    6. **Me conte o que viu:** quanto tempo o Mercado Pago levou para confirmar, se a taxa voltou e qualquer passo
       que não bateu com este roteiro. Eu ajusto antes da produção.
42. **Publique a versão 2 da Política de cancelamento e do "Como funciona" (M8.2c e, desde 10/10, M8.2d):** os formulários mostram o
    texto publicado, então as frases novas não aparecem sozinhas. Cole-as assim:
    1. Em **Configurações → Páginas legais do site → Política de cancelamento**, na seção "Como pedir o
       cancelamento", depois do primeiro parágrafo (o do e-mail e do WhatsApp), cole:
       > Se preferir, use o botão "Pedir o cancelamento" em Minha reserva, no site: o horário do pedido fica registrado na hora.

       Confira que a caixa **"O arrependimento vale só até o horário de entrada"** está marcada (ela vem marcada)
       e publique a versão 2: numa prévia, para o teste; e no painel de produção antes de ligar o pagamento de
       verdade. Se o advogado tirar o limite do arrependimento, desmarque a caixa e ajuste o texto da seção
       "Direito de arrependimento" junto: o sistema recusa a caixa desmarcada com o texto ainda falando do limite.
    2. Em **Configurações → Como funciona (proprietário)**, na seção "Cancelamentos", depois do parágrafo que já
       existe, cole (deixe o {empresa} assim: o sistema troca pelo nome da empresa):
       > Nas reservas pagas pelo site vale a Política de cancelamento do site, na versão que o hóspede aceitou: com devolução integral, não há nada a dividir e a taxa do pagamento que não voltar fica com a {empresa}; sem devolução, o valor pago entra na divisão como uma reserva normal e a sua parte fica disponível depois da data de entrada original. Se a sua parte de uma reserva cancelada com devolução já tiver sido repassada, ela é descontada no repasse seguinte.

       Publique a versão 2 antes de ligar o pagamento de verdade. Cada proprietário vai precisar aceitar de novo no
       portal; se tiver outras mudanças no "Como funciona", junte numa publicação só.
    3. **Alteração (M8.2d), na mesma publicação da Política de cancelamento:** na seção "Alteração de datas", no item
       "se for menor…", troque "contando os dias a partir da data de entrada original" por "contando os dias a partir
       da data de entrada original ou da nova, a que vier primeiro". Depois da lista, cole:
       > Depois de uma alteração, os prazos contam da data de entrada original ou da nova, a que vier primeiro. A devolução de parte do valor (numa alteração) é pedida ao Mercado Pago quando ele liberar o pagamento.

       Confirme antes as decisões 1 e 11 da alteração (seção 7): se mudar alguma, eu mudo as frases junto.
    4. **Alteração (M8.2d), na mesma publicação do "Como funciona":** na seção "Cancelamentos", depois do parágrafo do
       passo 2, cole:
       > Se o hóspede de uma reserva paga pelo site alterar as datas ou o valor antes da entrada, a divisão é refeita com os valores novos; se a política reter parte da diferença, ela entra na divisão como uma reserva normal.
43. **Revise as mensagens e os textos novos do cancelamento (M8.2c):**
    - Em **Configurações → Modelos de mensagem**, no quadro das mensagens automáticas ao hóspede, leia o texto-base
      de "Cancelamento: pedido recebido", "Cancelamento: decisão" e "Cancelamento: devolução feita" (cada um tem
      o botão "Copiar o texto-base"). Para mudar, crie um modelo (pode começar pelo texto-base) e escolha-o para a
      mensagem. As palavras entre chaves o sistema preenche: {recebido} (data e hora do pedido), {decisao} (a
      decisão em frases prontas, só na decisão), {valor}, {data} e {comovolta} (só na devolução feita) e {link} (a
      página da reserva). A de pedido recebido não pode ter {valor}: quem copia pode ser da operação, que não vê
      valores.
    - Em **Configurações → Textos do site**, leia as frases que começam com "Cancelamento:": elas aparecem na
      página da reserva, em Minha reserva e nas mensagens.
    - Quando ligar as mensagens ao hóspede (item 17), escolha um modelo para cada uma das três: aí o recibo do
      pedido, a decisão e a devolução saem sozinhos por e-mail. **Isso precisa estar ligado antes do pagamento de
      verdade:** a lei do comércio eletrônico pede a confirmação do pedido de cancelamento por escrito.
44. **Alteração de reserva paga pelo site, em teste (M8.2d, pronto em 10/10):** tudo numa prévia da Vercel, com as
    chaves de teste do item 37.
    1. **Só na prévia mais nova:** use o link da prévia deste PR (ou de um mais recente). As prévias antigas usam o
       mesmo banco e não conhecem as alterações nem as devoluções de parte (uma prévia antiga poderia até oferecer
       "Confirmar" nas datas seguradas de uma alteração). Nas prévias, a rotina automática não roda: as datas
       seguradas vencem na próxima ação na ficha, no "Conferir agora", num novo pedido do site ou num bloqueio do
       mesmo apartamento.
    2. **Aumento:** faça um Pix de teste como no item 37 (nome **APRO**) para uma estadia daqui a alguns dias. Na
       ficha, em "Pagamento no site" → **Alteração da reserva**, ponha um dia a mais na "Nova saída", deixe "O hóspede
       pediu" e "Pela cotação do site (preços de hoje)", informe quando e por onde o pedido chegou, clique **Calcular
       a alteração**, leia a prévia e clique **Segurar as novas datas e liberar o pagamento da diferença**. Copie a
       proposta e abra a página da reserva no site: pague a diferença por Pix e veja "Alteração confirmada". Na ficha,
       confira o financeiro antes e depois, mês a mês.
    3. **Redução (a diferença volta):** em outra reserva de teste paga por Pix, tire uma noite e clique **Aplicar a
       alteração** (como o pagamento foi feito agora, os 7 dias do arrependimento garantem a devolução). A devolução
       aparece "aguardando a liberação do pagamento": **registre a liberação à mão no quadro do pagamento** (no teste
       o Mercado Pago nunca avisa a liberação). Depois, use **Conferir agora** até a devolução aparecer confirmada,
       veja no Mercado Pago quanto da taxa da parte devolvida ficou com ele e informe em **Registrar taxa que não
       voltou** (zero se voltou toda). **Este primeiro teste é também uma conferência:** me conte o que a ficha mostrou
       (confirmada, pedida ou algum aviso), porque ainda não sabemos como o Mercado Pago responde a uma devolução de
       parte; se não bater, eu ajusto antes de você seguir.
    4. **Só segurar e aplicar depois:** numa redução ou no mesmo valor, use **Só segurar as datas (o hóspede ainda
       decide)**, copie a proposta e, quando o "hóspede" aceitar, clique **Conferir para aplicar (o hóspede aceitou)**
       e **Aplicar a alteração**.
    5. **Prazo e desistência:** prepare outra alteração e deixe o prazo passar (na prévia, você pode pôr 5 em
       "Minutos que as novas datas de uma alteração de reserva paga pelo site ficam seguradas", em Configurações →
       Calendário e preços, e voltar para 60 depois): na próxima ação na ficha, ela aparece vencida e as noites voltam
       à venda. Em outra, use **Desistir da alteração**, com o motivo.
    6. **A SCL propõe:** escolha "A SCL propõe" e veja que o valor começa em "Manter o valor atual".
    7. **Sem devolução (opcional, leva dias):** a diferença só fica quando já passaram os 7 dias do arrependimento e o
       pedido chega depois do prazo de 14 dias. Faça uma reserva de teste para daqui a uns 20 dias e, 8 dias depois,
       tire uma noite: a prévia diz que a diferença não é devolvida e que as noites liberadas voltam à venda.
    8. **Cancelar uma reserva alterada:** cancele pela política (item 41) a reserva do passo 2: a ficha mostra uma
       devolução de cada pagamento (a da reserva e a da diferença). Para ver a devolução de uma redução entrar no
       cancelamento, aplique uma redução e cancele **antes** de registrar a liberação: ela aparece "substituída pela
       devolução do cancelamento", e o valor inteiro volta de uma vez.
    9. **OTAs, mensagens e página do hóspede:** veja no Início "mude o bloqueio nas OTAs" e marque **Datas atualizadas
       nas OTAs** na ficha; copie as mensagens e use **Mensagem enviada ao hóspede**; abra a página da reserva e Minha
       reserva para ver o que o hóspede vê.
    10. **Me conte o que viu:** quanto tempo o Mercado Pago levou para confirmar a devolução de parte, se a taxa dessa
        parte voltou e qualquer passo que não bateu com este roteiro. Eu ajusto antes da produção.
45. **Revise as mensagens, os textos e o prazo novos da alteração (M8.2d):**
    - Em **Configurações → Modelos de mensagem**, leia o texto-base de "Alteração: proposta (e pagamento da diferença,
      se houver)" e "Alteração: confirmada" (cada um com o botão "Copiar o texto-base"). A mensagem que se chamava
      "Cancelamento: devolução feita" agora se chama **"Devolução feita (cancelamento ou alteração)"** e serve às duas:
      se você já escolheu um modelo para ela, confira se o texto serve também para a devolução da diferença. A palavra
      nova entre chaves é {alteracao} (as frases prontas da alteração: datas, valor, diferença e até quando as datas
      ficam seguradas), que só vale nas mensagens da alteração; a proposta precisa de {alteracao} e {link}, e a
      confirmada, de {alteracao}.
    - Em **Configurações → Textos do site**, leia as frases que começam com "Alteração" e a "Devolução de parte do
      valor esperando o Mercado Pago liberar o pagamento": elas aparecem na página da reserva e nas mensagens.
    - Em **Configurações → Calendário e preços**, confira "Minutos que as novas datas de uma alteração de reserva paga
      pelo site ficam seguradas" (padrão 60, de 5 a 2.880, isto é, até 48 horas).
    - Quando ligar as mensagens ao hóspede (item 17), escolha um modelo para as duas mensagens da alteração: aí a
      proposta, a confirmação e a devolução saem sozinhas por e-mail.

---

## 7. Decisões pendentes e respostas às suas perguntas

**Preciso de você (sem pressa):**
- **Alteração de reserva paga pelo site (M8.2d, 10/10) — decisões suas** (o teste está no item 44 da seção 6). Em
  cada uma deixei um padrão, e o sistema já funciona assim; as marcadas com ★ preciso antes do pagamento de verdade:
  1. ★ **A redução segue a política de cancelamento, contando da entrada original ou da nova, a que vier primeiro.**
     É a sua pergunta de 9/10 (logo abaixo, em "Páginas legais"), com um ajuste, e vai também ao advogado. Padrão:
     sim — dentro do prazo do reembolso integral (ou do arrependimento), a diferença volta; depois, fica. O ajuste:
     contar só da entrada original deixaria um hóspede que adiantou a estadia cancelar com devolução integral no meio
     dela (exemplo "Adiantar e depois cancelar", na seção 2); com "a que vier primeiro", adiar nunca reabre o prazo e
     adiantar o fecha. Vale também para um cancelamento depois da alteração. A frase para a política está no item 42.
  2. **Alteração só antes da entrada.** Padrão: sim. Durante a estadia, mais noites viram uma reserva nova; sair antes
     não tem devolução, a reserva fica como está, as noites continuam ocupadas e a limpeza de saída fica na data
     original (um item futuro pode liberar as noites).
  3. **O valor novo.** Padrão: a cotação do site da estadia inteira, com os preços de hoje; a equipe pode manter o
     valor atual ou digitar outro, com o motivo. **Quando a SCL propõe, o padrão é manter o valor atual** (a SCL
     absorve uma cotação maior); cobrar do hóspede pede uma escolha explícita.
  4. **Tempo para pagar ou aceitar a alteração.** Padrão: 60 minutos, numa configuração separada (de 5 minutos a 48
     horas, em Configurações → Calendário e preços), estendido pelo Pix da diferença e nunca além do horário de
     entrada. Não muda o tempo do visitante do site.
  5. ★ **A taxa do Mercado Pago sobre a parte devolvida.** Padrão: sai da reserva na proporção do valor devolvido, e o
     que o Mercado Pago não devolver dela fica com a SCL (é a sua decisão de 7/10, estendida à parte devolvida).
     Alternativa: a taxa fica na reserva, dividida entre o proprietário e a SCL.
  6. **A diferença retida é dividida como uma reserva normal, e as noites liberadas voltam à venda.** Padrão: sim
     (como a decisão 6 do cancelamento). Ligada à pergunta "com menos de 14 dias, ficar com tudo ou devolver o valor
     das noites que forem alugadas de novo?" (em "Páginas legais", abaixo) e à lista do advogado.
  7. **Depois de um aumento, a parte do proprietário da reserva inteira espera a liberação do pagamento da diferença**
     (uma regra do dinheiro por reserva). Padrão: sim; a data do pagamento da reserva passa a ser o dia dessa
     liberação. Alternativa: só a diferença espera.
  8. **Contrato e comissão quando a entrada muda.** Padrão: os que valem na nova entrada, com aviso na prévia quando
     mudam.
  9. ★ **Que política vale depois de uma alteração.** Padrão: a versão aceita no pagamento da reserva, para a
     alteração e para um cancelamento depois. No pagamento da diferença, a caixa diz "Li e aceito os Termos (versão T)
     e li a Privacidade (versão P). A sua reserva continua na Política de cancelamento versão N, aceita em dd/mm.", e
     esse pagamento **não abre outro prazo de arrependimento de 7 dias** (conta do primeiro pagamento). As duas coisas
     vão ao advogado.
  10. **Quem prepara alterações e mexe nas devoluções.** Padrão: só quem cuida do financeiro (hoje, só você), como no
      cancelamento.
  11. ★ **A devolução de parte do valor espera o Mercado Pago liberar o pagamento.** Padrão: sim, com o hóspede avisado
      ("será pedida quando o Mercado Pago liberar o pagamento, previsto para dd/mm") e um aviso no Início quando a data
      prevista passa. Isso se afasta do texto publicado ("Pedimos a devolução ao Mercado Pago logo depois de confirmar"
      e, no arrependimento, "pedimos a devolução imediatamente"): a frase nova da política está no item 42, e o caso do
      arrependimento vai ao advogado. Se a conta de teste mostrar que dá para afrouxar, eu proponho.
  12. ★ **Mensagens automáticas da alteração.** Padrão: desligadas até você ligar as mensagens ao hóspede; copiar à mão
      funciona enquanto isso (item 45).
  13. **O número de pessoas entra na alteração.** Padrão: sim, até a capacidade do apartamento (sem a capacidade
      cadastrada, o número de pessoas não muda).
  14. **Um cancelamento sem devolução que depois vira devolução por exceção.** Padrão: fica fora desta parte; por fora
      mais um ajuste.
  15. **Pagamento devolvido em parte no painel do Mercado Pago numa reserva confirmada.** Padrão: o cancelamento pela
      política devolve só o restante; quando o Mercado Pago não diz quanto devolveu, a equipe informa o valor que
      aparece no painel dele; uma decisão "sem devolução" com dinheiro já devolvido fora do sistema fica com a equipe
      (exceção ou ajuste).
  16. **Revisar as duas mensagens novas, a "Devolução feita (cancelamento ou alteração)", as frases novas do site e o
      tempo das datas seguradas** (item 45). Padrão: os textos-base que eu escrevi.
  17. **Como o financeiro mostra a diferença.** Padrão: antes da entrada, a diferença é o recálculo (os lançamentos de
      antes saem com a referência da alteração e os novos entram), mostrado item a item e mês a mês na alteração, em
      vez de lançamentos separados "de diferença", como dizia o texto do plano. Os lançamentos separados vêm com a
      alteração depois da entrada.
  18. **O cancelamento absorve a devolução de uma redução que ainda não chegou ao Mercado Pago.** Padrão: sim — num
      cancelamento com devolução integral, ela entra na devolução única do cancelamento (que sai na hora quando o
      pagamento não teve outra devolução); num cancelamento sem devolução, a devolução da redução continua.
- **Cancelamento de reserva paga pelo site (M8.2c, 10/10) — decisões suas** (o teste está no item 41 da seção
  6). Em cada uma deixei um padrão, e o sistema já funciona assim; as marcadas com ★ preciso antes do pagamento
  de verdade:
  1. ★ **Taxa e parte do proprietário quando a SCL cancela ou dá uma exceção:** padrão: a SCL fica com a taxa do
     Mercado Pago que não voltar e o proprietário não recebe nada. A prévia e a confirmação sempre mostram "o
     proprietário deixa de receber R$ X que receberia pela política". Concorda?
  2. ★ **Exceção por conta do proprietário?** Padrão: sim, como acima, com o motivo escolhido numa lista
     (erro da SCL, força maior, cortesia, saúde ou família, outro) e uma nota. Alternativa, para depois: a SCL
     paga ao proprietário a parte que ele teria.
  3. **Desconto da parte que já foi repassada:** padrão: sai do próximo repasse de qualquer tipo, inclusive o
     antecipado (é o "desconto no repasse seguinte" do plano). Se as partes dele não cobrem, o antecipado espera
     e o fechamento mostra que ele está devendo. Alternativa: só o fechamento mensal desconta (como os
     adiantamentos e as despesas no M4.10), mas aí quem recebe toda semana nunca tem o desconto feito.
  4. **Botão "Pedir o cancelamento" em Minha reserva:** padrão: ligado (o hóspede só pede; a equipe cancela).
     Desliga em Configurações → Pagamento no site.
  5. ★ **Arrependimento só até o horário de entrada** (confira com o advogado): padrão: mantido, como no texto
     da versão 1 da política.
  6. **Dinheiro retido dividido como uma reserva normal**, com a parte do proprietário disponível depois da data
     de entrada original e da liberação do Mercado Pago. Padrão: sim.
  7. **Quando o Mercado Pago pede saldo para devolver:** padrão: o sistema pede de novo (até três vezes, de 10
     em 10 minutos); depois, no Pix, a devolução por fora fica liberada; no cartão, ponha saldo na conta e use
     "Pedir a devolução de novo", ou registre a recusa que você viu no painel do Mercado Pago.
  8. **Tolerância do não comparecimento:** padrão: 21 horas depois do horário de entrada (12:00 do dia
     seguinte), editável em Configurações → Pagamento no site.
  9. **Quem cancela reservas pagas pelo site e mexe nas devoluções:** padrão: só quem cuida do financeiro (hoje,
     só você). Alternativa: dar à operação a permissão de editar o financeiro.
  10. ★ **E-mails automáticos ao hóspede no cancelamento** (recibo do pedido, decisão, devolução): padrão:
      desligados até você ligar as mensagens ao hóspede; os modelos estão prontos e copiar à mão funciona
      enquanto isso (item 43 da seção 6).
  11. **Publicar a versão 2 da Política de cancelamento e do "Como funciona"** com as frases novas (item 42 da
      seção 6). Padrão: nada muda até você publicar.
  12. **Revisar as três mensagens e os textos novos do site** (item 43 da seção 6). Padrão: os textos-base que
      eu escrevi.
- **Pagamento com cartão (M8.2b, 9/10) — decisões suas, antes do cartão de verdade** (o teste está no
  item 40 da seção 6):
  - **Verificação do banco (3DS):** deixei **"quando houver risco"** como padrão: o banco pede a
    verificação só nos pagamentos que acha arriscados; quando o hóspede passa pela verificação, a
    contestação por cartão roubado fica com a bandeira do cartão; nos outros pagamentos, continua com a
    empresa. A outra opção é **"nunca"**: nenhuma verificação, menos trabalho para o hóspede, e toda
    contestação por cartão roubado fica com a empresa. "Sempre" não aparece para o Brasil na
    documentação do Mercado Pago. Confirma "quando houver risco"?
  - **Prazo de liberação do cartão:** na hora (4,98%), em 14 dias (4,49%) ou em 30 dias (3,98%). Quanto
    mais longo, mais barato; mas a parte do proprietário só fica disponível depois da liberação (a
    empresa não adianta). Qual você escolhe?
  - **Campo de e-mail do formulário do cartão na produção:** no teste, o formulário já vem com o e-mail
    de teste e o campo fica escondido. Na produção, ou o formulário pede o e-mail ao hóspede (o Mercado
    Pago manda a ele os e-mails do pagamento), ou o sistema preenche. Antes, vou perguntar ao Mercado
    Pago se o e-mail de cartão recusado diz o motivo (o que ajudaria quem testa cartões roubados) e se
    dá para desligá-lo; no teste isso não aparece. Decidimos com a resposta.
  - **Devolução por fora no cartão:** deixei só quando o Mercado Pago não consegue devolver ou depois de
    180 dias, porque no cartão a cobrança continuaria na fatura e o hóspede poderia contestar e receber
    duas vezes. Desde 10/10 (M8.2c), "não consegue" é uma recusa definitiva do Mercado Pago, a recusa que você
    registra depois de ver no painel dele ou a nossa devolução que ele mostra como falhada (falta de saldo e
    "espere" não liberam). Concorda, ou prefere permitir sempre, com o aviso?
  - **Taxa do pagamento (pergunta 3, ainda pendente):** no cartão a taxa é de cerca de 4% a 5% (no Pix,
    cerca de 1%). Hoje ela sai antes da divisão, cada um na proporção. Continua assim também no cartão?
- **Páginas legais (M7.4, 9/10) — decisões suas, antes de ligar o pagamento de verdade** (o
  passo a passo e a lista para o advogado estão no item 39 da seção 6):
  - idade mínima para reservar: o texto diz 18 anos (a maioridade); quer outra?
  - encerrar a estadia por violação grave das regras (festa, mais pessoas que o reservado): entra no
    texto, com destaque, ou não?
  - reservas diretas fechadas pelo WhatsApp seguem a mesma política de cancelamento (mandando o link
    na conversa) ou não?
  - alteração para um valor menor: a diferença segue as regras de cancelamento, contando da entrada
    original, para a alteração não virar um cancelamento sem perda (é o M8.2d). Confirma? **Respondida pelo
    padrão em 10/10 (M8.2d), falta você confirmar:** sim, com um ajuste — contando da entrada original ou da nova,
    a que vier primeiro (decisão 1 da alteração, acima). A pergunta de 9/10 fica aqui como histórico.
  - com menos de 14 dias, ficar com tudo ou devolver o valor das noites que forem alugadas de novo? (Ligada à
    decisão 6 da alteração, acima: na redução fora do prazo, a diferença fica e as noites liberadas voltam à venda.)
  - por quanto tempo guardar os dados dos hóspedes depois da saída (hoje, para sempre)?
  - guardar um resumo do endereço de internet (IP) de quem aceitou, como prova a mais? Hoje não
    guardo: a prova é a reserva e o link que só quem tem o e-mail abre. Decida com o advogado.
- **Como receber as reservas do site (M8.0) — decidido em 4/10:** mantém "empresa recebe e
  repassa" pelo Mercado Pago; o contador confirmou que só a comissão é receita; o repasse segue
  a periodicidade que o proprietário escolher (seção 2 e item M4.10). **Ainda preciso de você,
  só antes de ligar o pagamento de verdade:** se a taxa do cartão/Pix segue a regra de hoje
  (sai antes da divisão, cada um na proporção) ou muda; contestação de cartão perdida
  (decidido em 7/10: arca quem deu causa ao motivo, caso a caso, registrado); e a política de
  cancelamento do site (implementada em teste em 10/10, M8.2c; base decidida em 7/10: reembolso integral até 14 dias antes da entrada,
  nenhum com menos de 14 dias; no reembolso integral, a taxa que o Mercado Pago não devolver fica
  com a empresa, decidido por você em 7/10; falta só você conferir com o contador a posição sobre o
  arrependimento de 7 dias da compra pela internet, do Código de Defesa do Consumidor, que eu escrevi
  nas páginas legais em 9/10 — item 39 da seção 6). Histórico (24/09 a
  4/10): a comparação entre "empresa recebe e repassa", split do Mercado Pago e Stripe está em
  `requisitos/product/RECEBIMENTO-SITE.md`; a pergunta ao contador e a do cartão com
  recebimento em 30 dias já foram respondidas.
- **Modelo do marketplace — decidido em 4/10: B, em partes iguais** (a margem do Airbnb menos
  a taxa do pagamento dividida igualmente entre hóspede, proprietário e SCL), com os pesos
  editáveis no painel — **implementado em 4/10 (M12.1)**: a tela é Configurações → Marketplace e
  desconto do site, com a simulação embutida (seção 2 e item 24 da seção 6). Histórico:
  as fórmulas antigas não estão em lugar nenhum, então montei
  uma proposta com as contas feitas: `requisitos/product/MARKETPLACE-PRECIFICACAO.md`.
  Resumo, numa reserva de R$ 1.650 que no Airbnb custaria R$ 1.881 ao hóspede e daria
  R$ 1.600 ao proprietário:
  - **A — taxa de serviço menor (8%):** hóspede paga R$ 1.782, proprietário recebe
    R$ 1.650, SCL fica com ~R$ 52;
  - **B — dividir a economia em três (minha sugestão):** hóspede paga R$ 1.815,
    proprietário recebe R$ 1.667, SCL fica com ~R$ 66;
  - **C — mensalidade fixa + preço limpo:** hóspede paga R$ 1.728, proprietário recebe
    R$ 1.650, SCL vive da mensalidade.
  Os percentuais das OTAs e do pagamento são aproximados e precisam ser conferidos. A ideia
  é ter uma **tela de simulação** com tudo editável para você testar com números reais antes
  de decidir. Decidido: B, em partes iguais.
- **Ideias do sistema antigo (M0.6):** diga quais das nove ideias da seção 2 viram item do
  plano, e em que ordem. Nenhuma entra sem a sua decisão.
- **Repasses (M4.10):** três escolhas minhas que você pode mudar — o fechamento mensal
  continua manual (você clica, depois de conferir); o repasse antecipado não desconta
  adiantamentos nem despesas (ficam para o fechamento; desde 10/10, o desconto de um cancelamento com
  devolução entra também no antecipado — decisão 3 do cancelamento, acima); e o adiantamento das noites de meses
  seguintes é lançado no mês das noites, para o mês seguinte fechar zerado. Se preferir
  fechamento automático no dia do fechamento ou desconto de adiantamentos no antecipado, é um PR pequeno.
- **Pesos do modelo B (6/3/3):** você propôs SCL 6%, hóspede 3% e proprietário 3% da margem
  de 12 pontos; eu achei justo e defensável (hóspede paga 3% a menos que no Airbnb, proprietário
  recebe cerca de 3,7% a mais, SCL fica com 6%). **Confirmado por você em 7/10 e já é o padrão do
  sistema (M12.5):** hóspede 1 / proprietário 1 / SCL 2.
- **Búzios — decidido em 7/10:** fica no sistema interno; no site público, só o Leblon no começo.
  Búzios e avaliações próprias ficam para depois, junto com a decisão do nome fantasia.
- **Marketplace — decidido em 7/10:** relatório e extrato mostram só o que passa pela SCL: as
  reservas do site e, no caso raro de a empresa receber o dinheiro de uma reserva de outra
  plataforma, essa reserva. As vendas que o proprietário faz nas outras plataformas e recebe
  direto entram só no calendário. Consolidar fica para depois, se houver procura (M12.2).
- **Beds24 nos bastidores — decidido em 7/10:** nenhum texto para proprietário ou hóspede cita o
  Beds24 (item M5.9). Conferi: só o portal do proprietário cita hoje.
- **Serviços à parte (sua ideia de 7/10) — preciso de você:** a lista dos serviços, o valor mensal
  de cada um e quais vêm sempre com a base (item M4.14). Minha opinião: boa ideia, combina com o
  contrato que já separa gestão completa e marketplace.
- **Como a equipe entra sem e-mail — decidido em 7/10:** vários jeitos (conta Google, e-mail com
  senha escolhida pela pessoa, ou usuário e senha criados por você no painel e entregues à pessoa),
  sem verificação em duas etapas, para ninguém deixar de entrar. Em troca, o acesso é bem contido:
  cada pessoa vê só a agenda da cidade dela (Búzios só Búzios, Rio só Rio) e só o que interessa à
  limpeza. Item M6.8.
- **Reembolso integral e a taxa do Mercado Pago — decidido em 7/10:** se o Mercado Pago não devolver
  a taxa dele, a empresa arca; se pesar com o tempo, revemos. Não achei regra oficial do Brasil sobre
  a taxa voltar (na Argentina, volta); confirmamos no primeiro reembolso de teste.
- **Arrependimento de 7 dias — combinado em 7/10:** eu escrevo a posição com base na lei, nas páginas
  legais (M7.4), e você confere com o contador; no ponto do consumidor, o ideal é também um advogado.
  As 24 horas que você lembrou são a regra das passagens aéreas (ANAC); para hospedagem vale o Código
  de Defesa do Consumidor.
- **Site — pedido de 7/10:** comparei as referências do Sage com o site de hoje. O que falta virou
  dois itens: o site do hóspede pronto (M7.6: foto de capa do Leblon, vitrine em carrossel, seção "O
  bairro à sua porta", calendário próprio para escolher datas, consulta e cotação em duas colunas) e a
  página para proprietários (M7.7). Os dois vêm depois das fotos (M7.3). As fotos de lugares do bairro
  do estudo não entram, porque os direitos não foram liberados: você sobe as suas pelo painel.

**Respostas:**
- **Segundo gráfico do relatório e indicadores (5/10):** você achou "19 noites" ambíguo, lembrou o
  RevPAR/RevPAN e escolheu, entre as três opções que te mandei, a **ocupação por mês nos 12 meses
  com a diária média sobre cada barra**. Feito no M5.8 (seção 2), junto com "noites ocupadas", a
  receita por noite disponível e reservas/estadia média.
- **Telas do sistema antigo:** o **dashboard** inicial com vários indicadores (M4.6) e a aba
  **Apartamentos** com tabela de todos e filtros para escolher como ver (M4.7) já estavam
  no plano — deixei as descrições mais completas. A aba **Anúncios** (M2.9) e as
  **Configurações com sub-abas** (M1.7) entraram agora. O cruzamento completo foi feito em
  4/10 com o museu que você mandou (M0.6): a lista do que faltava está na seção 2 e em
  `arquivo/sistema-antigo`.
- **Avisar em vez de supor:** virou regra do projeto — faltou um dado ou algo não bate, o
  sistema avisa e deixa pendente; nunca preenche com um palpite.
- **Beds24 só leitura?** Não — como o SCL vai ser a fonte oficial de calendário e preços (para
  os preços, imóvel por imóvel desde 4/10 — M3.9), a chave precisa de **leitura e escrita**
  (seção 6, item 3). Entrou no plano o **M3.7** (SCL
  manda calendário, preços e regras para o Beds24 → OTAs) e o **M5.5** (proprietário mexe
  no calendário do imóvel dele pelo portal; a mudança passa pelo SCL e segue para as OTAs).
  A escrita fica **desligada** até você mandar ligar, depois de testarmos num imóvel.
- **Repasse e relatório mensal:** combinado em 24/09 o dia 1º do mês seguinte; **desde 5/10, dia
  2** (M4.13: o Airbnb só paga no dia 1º a reserva com check-in no último dia do mês), editável de
  1 a 5 em Configurações → Repasses, valendo do fechamento do mês atual em diante. O relatório e o
  fechamento continuam mensais, mas o **repasse** pode ser quinzenal, semanal ou assim que
  disponível, à escolha do proprietário (M4.10); o dia do fechamento é o padrão e o intervalo
  máximo. No dia 1º você ainda pode fechar e enviar à mão; o proprietário baixa o PDF no portal a
  qualquer hora.
- **E-mail no cadastro de todos:** o e-mail do proprietário passou a ser **obrigatório**
  (convite do portal, relatórios, avisos, às vezes a chave Pix). Hóspedes entram no portal
  pelo e-mail (M9.1). Nas reservas das OTAs o e-mail às vezes vem mascarado pelo canal; o
  sistema guarda o que vier.
- **Tudo editável por você, sem código nem banco:** virou regra do projeto (está no
  `CLAUDE.md`, que toda sessão do Claude segue): cadastros, contratos, taxas, regras de venda,
  textos do site, modelos de mensagem, categorias — tudo com tela de edição. E **uma regra
  fica num lugar só**: quando você muda (um contrato, quem recebe num canal), o sistema
  recalcula o que depende dela na hora; a cada nova versão publicada, recalcula tudo. Não
  ficam duas versões da mesma regra. E a mudança vale **daquela data para frente**: o
  passado e o dinheiro que já movimentou nunca são recalculados. Desde o M1.7, as regras
  gerais, os usuários, os modelos de mensagem e os textos do site estão em **Configurações**.
- **Excluir com confirmação:** todo botão de excluir, remover, cancelar ou estornar agora
  pergunta "tem certeza?" antes. Onde há histórico (financeiro, reservas), o sistema
  prefere arquivar ou estornar em vez de apagar de vez.
- **Área para ver serviços, automações e regras:** entrou no plano como **M1.6** — uma
  página "Sistema" no painel mostrando os serviços ligados (banco, Beds24, e-mail,
  WhatsApp, Mercado Pago) e se estão funcionando, as automações com a última vez que
  rodaram, e as regras em vigor, com atalho para editar.
- **Recebimento do site com divisão automática (como o Airbnb):** existe. O **Mercado Pago**
  tem o modelo "marketplace": cada proprietário liga a conta Mercado Pago dele ao nosso
  sistema, e cada pagamento cai direto na conta dele com a comissão da SCL separada
  automaticamente para a conta da empresa. O **Stripe** faz algo parecido (Stripe Connect), mas o
  pagamento entra primeiro na conta da SCL e depois é transferido ao proprietário.
  Pontos de atenção: cada proprietário precisa ter conta própria e a parte fiscal muda (ele
  recebe direto, como no Airbnb). Quem arca com estorno e contestação de cartão depende do
  provedor — no Stripe o dinheiro sai da conta da SCL; no Mercado Pago ainda é **a conferir**.
  Se a SCL repassa essa perda ao proprietário é decisão sua (pergunta 4 da comparação). A comparação completa (M8.0) está em "Como receber as reservas do
  site", acima, e em `requisitos/product/RECEBIMENTO-SITE.md`.
- **Copiar anúncios do Airbnb para o Booking:** é **semiautomático** pelo Beds24 — ele
  reaproveita os dados e fotos que já importou do Airbnb e cria o anúncio no Booking. Mas
  exige a conta Booking da empresa (com os dados da pessoa jurídica) conectada ao Beds24, e
  depois é preciso conferir fotos, políticas, comodidades, camas e preços, porque o Booking
  valida tudo e às vezes pede complemento na extranet. Minha sugestão: fazer **um apartamento
  do Rio primeiro**, até ficar 100% aberto para reservas, e só depois repetir nos outros. Se
  algum anúncio já existir no Booking, a gente **liga** em vez de criar outro. Quando você for
  fazer, me chame que eu te guio tela a tela.
- **Modelos de cliente:** o sistema já tem os dois tipos de contrato — **gestão completa**
  (os cinco do Rio) e **marketplace** (tipo separado; modelo B em partes iguais, com pesos
  editáveis e simulação desde o M12.1). Agora o marketplace
  ganhou um bloco próprio no plano (**M12**): fórmula, cálculo e repasse, auto-cadastro do
  proprietário e portal dele com calendário e preços.
- **Site público:** é a parte que estava mais adiantada, mas ainda como **protótipo
  separado** (`prototipos/scl-publico`): home, catálogo dos 5 imóveis, página de cada um,
  galeria, calendário, formulário de consulta e uma demonstração de checkout sem cobrança.
  Não está no ar, não usa banco e está sem as fotos (faltava autorização de uso). No plano,
  o **M7.1** traz esse site para dentro do sistema novo lendo os imóveis do banco; o **M7.2**
  liga disponibilidade e preço reais (depois do Beds24); o **M7.3** coloca as fotos quando
  você autorizar.
- **Cadastro de apartamento novo:** hoje o cadastro tem código, nome, bairro, endereço,
  capacidade, quartos, banheiros, descrição, se aparece no site, proprietário(s) com todos os
  dados, contratos e os números nos canais. Criei o **M2.6** para o cadastro **completo**:
  endereço completo, camas e comodidades, regras da casa, horários, taxas (limpeza, hóspede
  extra), estadia mínima/máxima **com exceções por período**, antecedência, dias de
  chegada/saída, preço base e **preço dinâmico liga/desliga** — tudo editável pelo painel,
  como nas OTAs. O portal do proprietário puxa daí.
- **Equipe de limpeza:** já estava a agenda diária para a equipe (M6.3); acrescentei o
  **M6.6** — acesso próprio pelo celular (ver a agenda e marcar faxina feita) **e** aviso por
  WhatsApp quando o WhatsApp estiver ligado (por e-mail enquanto isso). As duas formas
  funcionando, como você sugeriu.

---

## 8. Glossário rápido

- **Repositório:** a "pasta" do projeto no GitHub, com todo o histórico.
- **Branch:** uma cópia paralela onde uma mudança é preparada sem mexer no principal.
- **PR (pull request):** o pedido para juntar uma branch ao principal. É onde você revisa.
- **Merge:** aceitar o PR. A mudança passa a fazer parte da versão principal (`main`).
- **CI:** os testes automáticos que rodam em cada PR. Verde = tudo certo.
- **Deploy / publicar:** colocar o sistema no ar (na Vercel).
- **Homologação:** versão de teste no ar, com dados fictícios, antes da versão real.
- **Migração de banco:** um arquivo que cria ou altera tabelas do banco de dados de
  forma controlada.


## Calendário e preços — referência operacional de 1/10/2026

As regras aprovadas de mínimos, feriadões, temporada, multiplicadores, última hora e sobras estão reunidas em [Calendário, preços e duração](requisitos/operations/CALENDARIO-PRECOS-OPERACAO.md), com as exceções e decisões ainda pendentes. Desde 2/10 (M3.7) elas vivem no painel, em Configurações → Calendário e preços, e o envio ao Beds24 existe, mas só é ativado por você. Enquanto o envio do SCL não estiver ligado, a rodada autorizada em 1/10 continua usando o Beds24 conectado, com conferência no Airbnb — e não deve haver dois responsáveis escrevendo no mesmo calendário: ao ligar o SCL, pare de editar preços à mão no Beds24 **nos imóveis em que a fonte de preços é a SCL** (preços automáticos ou digitados no portal); nos imóveis em que você ou o proprietário definem os preços no Beds24 ou numa ferramenta de precificação (M3.9, opção b), continuem editando lá — o SCL só lê. Não aplicar descontos repetidos sobre diárias já reduzidas.

