# Reconstrução de 22/09/2026 — origem e seleção

Base: main be0860e46be3c209152a2c5de2f1b042128503ad. Preparação autorizada por Diego; nenhum merge automático. Esta proposta substitui a integração em cadeia de planos concorrentes por uma composição revisável. Não fechar PRs anteriores antes de comparar o resultado e receber decisão de integração.

| Origem SCL | Tratamento |
|---|---|
| PR1/2/3/4/6/7/8/9/10/12 | Já incorporados na base: preservar código, regras úteis e história; atualizar apenas entradas que descrevem estado superado |
| PR11, 50ec318e07e078f56ac180a11aff7827df415567 | Incorporar scl-publico com busca mobile e pagamento fictício; validação HTTP/visual nesta reconstrução pendente |
| PR15, dfecfd0d707b9ab2ffd18481dd1abb4f1b2c7900 | Incorporar scl-gestao-demo separado; não promover demonstração a backend autenticado |
| PR13, 7d50db57df0f04ca1ffd3d158ed2bd9a72a61fe6 | Incorporar requisitos de financeiro/portais e histórico; cálculos ainda não implementados |
| PR14, a3cea348bb6fb4ebf9ae467d01f1dcc20f744593 | Incorporar regras operacionais/comerciais, tom e histórico; reconciliar papéis Lia/Mia com decisão posterior |
| PR16/17/18/19/20 | Preservar evolução e fichas como fontes; usar contratos úteis sem importar versões contraditórias de CURRENT e sem declarar corte cloud concluído |
| PR5 | Ideia Bumble no Labs; preservar como ideia, sem priorizar implementação sobre SCL/SongKeep/Giro |

Os heads de todas as 30 branches dos dois repositórios foram inventariados e 348 blobs distintos copiados com hashes Git conferidos. Evidência completa local em reconstrucao-20260922/evidencias; não contém backup de todo o grafo Git. Referências remotas e histórias originais permanecem preservadas. Nenhuma gravação, recibo, transcrição privada ou credencial é parte desta entrega.

Testes da candidata: SCL 31/31 e gestão 8/8 passaram em 22/09/2026, após execução autorizada com abertura temporária de localhost. As primeiras tentativas haviam sido bloqueadas por EPERM. Revisão visual e independente ainda pendentes. CI anterior comprova apenas seus próprios heads, não o futuro commit de reconstrução.

Reversão: proposta aditiva sobre base conhecida; manter refs e artefatos anteriores. Após merge humano, regressão se trata por revert revisado, sem force push ou reescrita de histórico. Estado atual e guias devem acompanhar o código aceito, não gerar outro PR só para anunciar que um anterior foi integrado.

## Coerência de entrada
Recuperados critérios de relatórios do PR14 em operations/RELATORIOS-E-TOM.md; responsáveis tornados explícitos por execução sem presumir migração. Entradas lia/mia apontam para contrato atual. Fichas antigas LIA/SAGE/RIVERS mantidas como história com aviso inicial; originais também arquivados. Links internos de handoffs antigos permanecem evidência histórica, não guias de execução atuais.
