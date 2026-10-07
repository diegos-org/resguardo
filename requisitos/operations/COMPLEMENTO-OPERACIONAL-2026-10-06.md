# Agenda do Rio e acompanhamento operacional — 6/10/2026

Complemento autorizado pelo usuário às 18h59 BRT, após o merge do [PR106](https://github.com/al-life/scl-reconstrucao/pull/106). Registra o formato refinado da agenda e estados operacionais agregados. Não contém a agenda real nem dados individuais de reservas. Complementa o [guia de atendimento](GUIA-LIA-ATENDIMENTO.md), o [log de manutenção](MANUTENCAO.md) e a [rodada de 6/10](RODADA-2026-10-06.md); não altera código, integrações ou permissões.

## Modelo refinado da agenda do Rio

Preservar três blocos: **LIMPEZAS → ENTRADAS → CONFERÊNCIAS**.

- Abrir com intervalo de cinco dias, dia da semana/data e data da atualização.
- Limpezas primeiro, uma linha por apartamento. Em cada saída, “arrumar para X hóspedes” usa o total da próxima reserva confirmada, mesmo além da janela; nunca o total de quem sai. Quantidade desconhecida fica a confirmar.
- Entradas abaixo, agrupadas por dia da semana/data, com total da reserva e somente logística ou exceções úteis. Horário válido confirmado prevalece sobre o padrão.
- Conferências separadas para preparo, chaves e problemas ainda não confirmados como resolvidos. **Se já está limpo e sem uso posterior, conferir o preparo sem convocar nova faxina apenas por chegada.**
- Distinguir data da reserva de chegada após meia-noite; pouso de chegada ao apartamento; total contratado de quantidade que chega primeiro. Não transportar acordo de consulta anterior para outra reserva.
- Na cópia operacional restrita, incluir telefone necessário/autorizado. **A omissão de telefones em 6/10 foi temporária**, sem mudar a regra futura. Dado inacessível não equivale a dado ausente.
- Preparar texto legível e link manual codificado, seguindo o procedimento existente do WhatsApp. Não publicar o conteúdo real do link nem os contatos no repositório.

### Exemplo exclusivamente genérico

Todos os campos abaixo são marcadores, não representam pessoas, reservas ou datas reais.

```text
Boa tarde! Agenda do Rio: [dia da semana, data inicial] a [dia da semana, data final].
Atualizada em [data da conferência].

LIMPEZAS
[Apartamento A] - [dia da semana, data]: arrumar para [N] hóspedes.
[Apartamento B] - [dia/data] e [dia/data]: arrumar para [N] e [M] hóspedes, respectivamente; [troca no mesmo dia, se confirmada].

ENTRADAS
[Dia da semana, data]:
- [Apartamento] - [primeiro nome], [total da reserva] hóspedes, [horário confirmado], [telefone necessário/autorizado].
- [Apartamento] - [exceção confirmada de chegada e logística prática, quando necessária].

Entradas e saídas: [padrões confirmados do imóvel], salvo horários diferentes já combinados.

CONFERÊNCIAS
- [Apartamento] - confirmar preparo para [total da próxima reserva] hóspedes até [prazo aplicável] e conferir chaves. Se já está limpo e sem uso posterior, basta conferir o preparo.
- [Apartamento] - [problema concreto a conferir ou cuidado reforçado autorizado], sem declarar resolução antes da confirmação.

Essa é a agenda atual e ainda pode mudar com novas reservas ou cancelamentos.
```

Conferir datas/dias da semana, próxima quantidade, trocas, acordos válidos e pendências antes de entregar. Uma agenda preparada não comprova envio; envio relatado pelo usuário e entrega relida no canal devem continuar diferenciados.

## 103 — atenção reforçada por pelo menos 30 dias

**Correção de escopo em 7/10, por esclarecimento direto do responsável:** a atenção reforçada é exclusiva do **103**. A atribuição anterior desse período ao 403 estava incorreta. Esta correção prevalece, para esse escopo, sobre a versão anterior deste complemento e sobre referências históricas divergentes nos guias. O período mínimo original é preservado, sem reiniciar a contagem em 7/10.

Manter equipe do Rio e atendimento com atenção reforçada ao **103** por **pelo menos 30 dias, cobrindo até 5/11/2026, inclusive**, para evitar novas falhas. Conferir preparo, chaves e problemas nas passagens pertinentes, tratar relatos rapidamente e registrar somente resultados confirmados, evitando repetições sem contexto novo. O fim do período mínimo não comprova resolução.

## 403 — acompanhamento comum de manutenção

Em 6/10, o responsável informou que o mofo e as demais questões do 403 **já foram encaminhados**. Encaminhamento confirmado pelo responsável; execução e resolução ainda não confirmadas.

O 403 permanece no acompanhamento comum de manutenção. Não recebe a atenção reforçada de 30 dias destinada ao 103. A coordenação dos reparos permanece com o responsável; não autoriza contato com prestadores, contratação ou gastos.

## Histórico agregado e estado confirmado

- No seguimento da tarde, **três novos retornos operacionais foram enviados e relidos, uma cópia de cada**. Dois tiveram leitura e agradecimento observados; nenhuma repetição foi necessária. Conteúdo, horários individuais e vínculos de reserva permanecem no controle restrito.
- Um aceite de nova reserva foi realizado pelo próprio usuário e confirmado na plataforma, com importação no Beds24 verificada. O atendimento subsequente não alterou reserva, preço ou mínimo.
- Decisões específicas de logística e uma exceção individual de avaliação foram preservadas, sem convertê-las em regras gerais. Combinação futura de chaves não comprova entrega física, limpeza ou reparos concluídos.
- A agenda completa do Rio e o link manual foram entregues ao responsável. Às **18h59 BRT**, o usuário **informou que enviou a agenda pelo WhatsApp** e aprovou o formato refinado. Não houve releitura independente da conversa do grupo nem comprovação técnica de entrega; não reenviar a mesma agenda apenas por falta dessa verificação.
- O **teste de recebimento/retorno por e-mail está pausado**, por orientação do usuário, até ele concluir a configuração no Work. Não foi atribuída uma causa técnica de falha. Isso não altera a entrega já verificada do resumo por e-mail às 17h52.
- A cópia na máquina permanece pendente de o computador estar aberto e acessível. Publicação no GitHub e pacote preparado não comprovam sincronização local.

Nenhuma nova automação, mudança de permissões, contato com prestadores ou envio direto pelo WhatsApp foi realizado por este complemento. Não há dados pessoais de hóspedes, documentos, identificadores de reservas ou links de conversas neste arquivo.
