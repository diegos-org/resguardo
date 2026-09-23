# SCL 2.0 — base compartilhável de construção

Workbench privado de revisão, não produção. Extraído da base local em 20/09/2026, preservando o site existente no Mac. Não redesenha nem substitui esse site.

## Executar e testar

Requer Node.js 22+. Sem dependências, instalação, credenciais ou serviços externos.

```sh
cd prototipos/scl-publico
node --test test/*.test.mjs
node src/server.mjs
```

Abra http://127.0.0.1:4173. Se a porta estiver ocupada, use `PORT=4174 node src/server.mjs`. O servidor aceita somente conexões locais. Clonar/baixar esta branch e rodar é necessário: o PR não é uma URL de preview hospedado. Lia pode revisar o código remotamente, mas precisa de ambiente com Node/navegador para validar a interface. Não expor o servidor na internet.

## Incluído

- Home, catálogo de cinco imóveis, páginas individuais, galerias, carrossel e calendário sequencial.
- Consulta com protocolo e persistência privada **local**, idempotência, convite opcional para portal ainda inexistente.
- Disponibilidade fechada por padrão; áreas internas sempre indisponíveis.
- Demonstração de checkout fictício com totais em centavos e cenários de preço alterado, indisponibilidade, falha e expiração. Nenhuma cobrança.
- Contratos de disponibilidade e jornada futura em `docs/`.
- Contato comercial público confirmado por Diego, sem importação de contatos pessoais.

## Exclusões e diferenças deliberadas

Todas as fotografias, logo e demais mídias originais ficaram fora por falta de autorização de direitos registrada para compartilhamento. URLs de imagens conhecidas exibem o marcador SVG original desta entrega; galeria mantém quantidade e funcionamento. O site completo local conserva suas imagens. O cabeçalho identifica a versão workbench. Não usar esta cópia para aprovar composição fotográfica.

Não incluídos: ZIPs legados, segredos, .env reais, dados de clientes, caixa de consultas, documentos pessoais, screenshots, configuração de produção ou credenciais. Procedência histórica e caminhos pessoais não foram copiados. Código novo, visual/UX reinterpretados a partir da referência de julho e revisões de Diego; conteúdo histórico ainda exige revisão para publicação.

## Dados e limites

Somente dados fictícios devem entrar aqui. A caixa criada durante uso fica em `private-data/scl-inquiries` dentro do projeto, ignorada pelo Git e fora de `public`. Nunca enviá-la ao GitHub. Os testes usam diretórios temporários. POST aceita apenas origem loopback, token de formulário e corpo limitado. Sem login, banco, e-mail, Beds24, Mercado Pago, reserva real ou portal. Protocolo SCL-Q não autentica ninguém. Não há licença geral de distribuição declarada.

Fluxos: `/`, `/imoveis`, `/imoveis/399`, `/consulta`. Exemplo fictício: `/demo/checkout?property=102&checkin=2026-10-10&checkout=2026-10-12&guests=2`; acrescente `&scenario=price_changed`, `unavailable`, `unknown` ou `expired`. Escolha datas futuras caso o exemplo tenha vencido.

Antes de reserva real: fonte canônica de preços/inventário, cotação persistida, revalidação, hold/concorrência, idempotência de reserva/pagamento, integração Mercado Pago, webhooks, reconciliação, outbox/e-mail e autorização do hóspede. Nada disso deve ser inferido da demo.
