/** Mesma identidade usada pela busca de duplicatas, sem bloquear a organização inteira. */
export function chavesDaImportacao(
  organizacaoId: string,
  fonte: string,
  idFonte: string,
  dados: { origem: string; codigoCanal?: string | null },
): string[] {
  // Tuplas JSON evitam colisões de delimitadores nos identificadores externos.
  const chaves = [JSON.stringify(["reserva-fonte", organizacaoId, fonte, idFonte])];
  if ((fonte === "csv" || fonte === "beds24") && dados.codigoCanal && ["airbnb", "booking"].includes(dados.origem)) {
    // Sem imóvel na chave: código compartilhado em outro imóvel deve ser recusado,
    // não permitir duas inserções concorrentes antes da conferência do mapeamento.
    chaves.push(JSON.stringify(["reserva-canal", organizacaoId, dados.origem, dados.codigoCanal]));
  }
  return chaves.sort();
}
