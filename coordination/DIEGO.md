## Atualização Lia — 20/9, rodada das14h15

A primeira passagem já começou e o acesso de leitura e escrita da Lia foi confirmado pelo navegador. O conector falhou nesta sessão; isso não bloqueou a documentação. O repositório está privado. Nada foi publicado ou migrado para produção.

Registrei sua orientação: informações gerais podem ser dadas a interessados, mas acesso ao imóvel exige reserva validada. Vendas diretas devem terminar no checkout do site, com dados preenchidos a partir da consulta; essa função ainda precisa ser construída/testada. Bônus de indicação continua sem regras finais.

Próximo passo para Sage: conferir seu acesso e preparar proposta/teste com dados fictícios, sem contratar serviço ou cobrar ninguém. As proteções da edição principal ainda não foram verificadas.

Você precisa escolher apenas o formato da nova rotina: o aplicativo recusou uma segunda automação nesta conversa, pois a primeira atende hóspedes. Pergunta enviada aqui: integrar coordenação à rotina atual a cada3h ou criar conversa separada. Nenhuma nova automação foi criada; a de hóspedes permanece. Não precisa repetir o convite inicial à Lia.

O texto abaixo é o painel inicial, preservado como histórico; esta atualização substitui suas pendências de convite à Lia e de verificar visibilidade.

---

# DIEGO — painel humano do SCL 2.0

## Onde estamos

O novo canteiro de construção do SCL 2.0 está funcionando no GitHub em:
`al-life/scl-reconstrucao`.

Este repositório **não é produção**. Ele existe para Rivers, Lia e Sage coordenarem construção, decisões e histórico sem misturar com o futuro sistema oficial.

## O que foi feito

- O acesso de Rivers ao GitHub foi confirmado.
- Foi criado um protocolo único dizendo como os três agentes devem trabalhar.
- Foi criada uma área de coordenação com estado atual, arquivos individuais e handoffs.
- Cada agente agora tem uma regra explícita: ao terminar, atualizar também este arquivo em linguagem humana.

## Como você acompanha sem aprender código

Você pode abrir este arquivo e ler só daqui.

A ideia é que ele sempre responda:
- o que aconteceu;
- o que está funcionando;
- o que não está;
- o que mudou;
- se existe risco;
- se você precisa fazer alguma coisa.

Se algo técnico aparecer aqui, deve vir traduzido.

## O que ainda NÃO foi feito

O conector do GitHub usado por Rivers consegue editar arquivos, mas não oferece todas as funções administrativas da conta.

Ainda falta conferir manualmente:
1. a visibilidade correta do repositório;
2. proteção da branch principal / regras de merge;
3. apagar o repo pessoal de teste `diegotavares0/scl2reconstrucao`, caso você ainda queira.

Isso não impede Lia e Sage de começarem a trabalhar no protocolo.

## Regra de merge enquanto isso

Até as proteções administrativas estarem configuradas:
- nenhum agente deve tratar `main` como lugar para despejar código livremente;
- mudanças relevantes de aplicação devem preferir branch + PR;
- coordenação pode ser atualizada diretamente;
- publicação/produção exige decisão explícita sua.

## O que você precisa fazer agora

Só duas coisas:
1. abrir o chat da Lia e mandar: **“Leia o arquivo 00-PROTOCOLO.md do repo al-life/scl-reconstrucao e siga a sua primeira missão.”**
2. quando Lia terminar, fazer o mesmo com Sage, se o protocolo/tarefa dela ainda não disparar sozinho.

Fora isso, você não precisa organizar o GitHub nem traduzir handoff entre agentes.

## Situação em uma frase

A máquina de coordenação foi montada; agora precisamos provar que Lia e Sage conseguem entrar, ler, trabalhar e devolver o estado para o próximo agente sem depender de você como carteiro.
