# SCL 2.0 — Custos, Despesas e Conciliação

Documento de produto/arquitetura financeira. Serve para impedir que o sistema repita a mistura conceitual do legado.

## Princípio central

Separar claramente:

1. **Despesa da empresa**
2. **Despesa específica de apartamento / proprietário**
3. **Repasse de receita ao proprietário**
4. **Receita/comissão da empresa**
5. **Ajustes de conciliação**

Não misturar tudo numa página genérica de “despesas”.

---

## 1. Despesas reais da empresa

Exemplos atuais informados por Diego:
- equipe;
- despesas extras operacionais;
- pequenas manutenções que a empresa absorve;
- compras de mercado/limpeza/consumo comum;
- itens comprados em volume para a operação geral.

### Regra
Essas despesas pertencem à empresa e **não precisam ser rateadas por apartamento**, salvo decisão explícita.

### Estrutura desejada
Cada despesa deve poder ter:
- categoria;
- descrição;
- valor;
- data;
- recebedor/fornecedor;
- recorrência;
- comprovante/recibo opcional;
- observação;
- status de pagamento.

---

## 2. Categorias e cadastros editáveis

Diego precisa conseguir administrar o sistema sem código.

Permitir ao menos para perfil Admin:
- criar categoria;
- renomear categoria;
- editar valor fixo/recorrente;
- editar beneficiário/recebedor;
- corrigir erros de digitação;
- desativar;
- excluir.

### Exclusão
Exclusão deve ter fricção proporcional ao risco:
- confirmação explícita;
- para registros sensíveis/históricos, preferir arquivar/estornar em vez de apagar;
- exclusão destrutiva pode exigir confirmação extra e, quando fizer sentido, senha/reauth.

Não usar senha extra em qualquer coisa banal; só onde perda irreversível justificar.

---

## 3. Despesa específica de apartamento / proprietário

Exemplo:
- ar-condicionado quebrou;
- reparo estrutural relevante;
- compra extraordinária de responsabilidade do proprietário.

É comum a empresa:
1. contratar;
2. pagar;
3. registrar;
4. cobrar do proprietário na conciliação mensal.

### Regra
Esse valor **não é despesa econômica da empresa no fechamento final**. É um adiantamento/conta a receber do proprietário.

O sistema deve mostrar:
- apartamento;
- proprietário responsável;
- motivo;
- valor;
- data;
- comprovante;
- status: pago pela empresa / a cobrar / reembolsado / contestado / resolvido.

---

## 4. Onde essa informação aparece

### Área do apartamento
Linha/bloco “Despesas a cobrar / ajustes do proprietário”.

### Portal do proprietário
Mesma informação, em linguagem clara:
- o que foi pago;
- por quê;
- comprovante;
- quanto será descontado/reembolsado;
- status.

### Financeiro / conciliação
Consolidação mensal de tudo que cada parte tem a pagar/receber.

---

## 5. Conciliação mensal

Objetivo: responder sem planilha paralela:

**Quem deve quanto para quem?**

Mostrar por proprietário/apartamento:
- receitas do período;
- repasses já feitos pela plataforma;
- comissão/receita da empresa;
- despesas/adiantamentos;
- ajustes;
- saldo final;
- credor;
- devedor;
- valor final.

### PIX
Quando houver saldo a transferir:
- exibir chave PIX do credor;
- botão “Copiar PIX”;
- botão “Copiar valor”;
- marcar como pago;
- anexo/comprovante opcional.

Chave PIX pode ser dado operacional exibido às partes autorizadas, mas não deve ser publicada indiscriminadamente.

---

## 6. Diferença por canal

### Airbnb
Estado informado por Diego:
- Airbnb já pode dividir o repasse na proporção correta;
- proprietário recebe parte dele diretamente;
- empresa recebe sua parte.

O sistema deve importar/registrar isso sem fingir que toda receita passou pela empresa.

### Booking
A confirmar no desenho final:
- fluxo tende a exigir conciliação diferente;
- não presumir split automático.

### Reserva direta / Mercado Pago
Hipótese inicial:
- empresa recebe o total;
- sistema calcula o que pertence ao proprietário;
- repasse ocorre depois.

### Futuro — split automático
Roadmap:
- investigar distribuição automática de recursos/split payment;
- objetivo: separar automaticamente parte da empresa e parte do proprietário quando tecnicamente e juridicamente viável;
- não implementar sem entender taxas, chargeback, estorno, cancelamento, KYC e regras do provedor.

---

## 7. Caixa e recibos

O design preferido de Diego para o financeiro remete ao antigo `/painel`, especialmente a linguagem de **Caixa** e **Recibos**.

Esses conceitos devem sobreviver na arquitetura nova, provavelmente como:
- **Caixa**: visão de entradas, saídas, saldo e movimentos;
- **Recibos/Comprovantes**: documentos ligados a movimentos, despesas e conciliações.

Não transformar “recibo” em arquivo solto sem contexto: ele deve estar vinculado ao movimento financeiro correspondente.

---

## 8. Controles de edição

Para Admin:
- editar;
- corrigir;
- criar;
- arquivar;
- excluir com confirmação;
- auditar alterações relevantes.

Para outros perfis:
- permissões específicas por função.

Mudanças financeiras importantes devem deixar trilha de auditoria:
- quem alterou;
- quando;
- antes/depois;
- motivo quando necessário.

---

## 9. Próxima fatia de produto

Antes de implementar profundamente:
1. desenhar entidades financeiras;
2. decidir páginas/superfícies;
3. alinhar com `product/ARCHITECTURE-NOTES.md`;
4. garantir que apartamento, portal do proprietário e financeiro compartilhem a mesma fonte de dados;
5. evitar duplicar lógica em três lugares.
