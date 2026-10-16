import type { LinhaHistorico } from "@/auditoria/auditoria";
import { dataHoraNoFuso } from "@/lib/datas";

const ROTULOS: Record<string, string> = {
  codigo: "Código",
  nome: "Nome",
  publico: "No site",
  ativo: "Em operação",
  bairro: "Bairro",
  cidade: "Cidade",
  endereco: "Endereço",
  fuso: "Fuso",
  capacidade: "Capacidade",
  quartos: "Quartos",
  banheiros: "Banheiros",
  descricao: "Descrição",
  // M7.17: o mesmo nome do campo na ficha do imóvel.
  frase: "Frase de abertura (site)",
  tipo: "Tipo",
  documento: "CPF/CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  chavePix: "Chave Pix",
  observacoes: "Observações",
  imoveis: "Imóveis",
  representante: "Representante",
  contrato: "Contrato",
  idExterno: "Canal",
  estado: "Situação",
  checkin: "Entrada",
  checkout: "Saída",
  hospedes: "Hóspedes",
  hospedeNome: "Hóspede",
  valorBruto: "Valor bruto (centavos)",
  taxaCanal: "Taxa do canal (centavos)",
  valorLiquido: "Líquido (centavos)",
  recebimento: "Quem recebe do canal",
  // M8.2d: a alteração de reserva paga pelo site.
  alteracao: "Alteração",
  diferenca: "Diferença (centavos)",
};

const ACOES: Record<string, string> = {
  "imovel.criar": "criou",
  "imovel.editar": "alterou",
  "proprietario.criar": "cadastrou",
  "proprietario.editar": "alterou",
  "proprietario.imoveis": "alterou os imóveis",
  "proprietario.representante.adicionar": "adicionou representante",
  "proprietario.representante.remover": "removeu representante",
  "contrato.criar": "adicionou contrato",
  "contrato.encerrar": "encerrou contrato",
  "idexterno.adicionar": "ligou canal",
  "idexterno.remover": "desligou canal",
  "reserva.criar": "lançou a reserva",
  "reserva.importar": "importou a reserva",
  "reserva.sincronizar": "atualizou pela sincronização",
  "reserva.cancelar": "cancelou a reserva",
  "reserva.alterar": "alterou a reserva (alteração da reserva paga pelo site)",
  "bloqueio.criar": "bloqueou datas",
  "bloqueio.remover": "removeu o bloqueio",
  "configuracao.calendario_regras": "alterou calendário e preços",
  "beds24.sincronizar": "importou do Beds24",
  "beds24.enviar": "enviou calendário e preços ao Beds24",
};

/** Um instante gravado com `toISOString()` ou com o deslocamento do fuso, também no meio do texto ("COT-1 até <ISO>"). */
const INSTANTE_ISO = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})/g;

/**
 * O valor de um campo para pessoas (M7.22), também nos registros antigos, sem mexer no que está gravado: os instantes ISO
 * ("2026-10-16T18:05:00.000Z", em UTC) saem como "16/10/2026 às 15:05", no horário de Brasília, e as datas "AAAA-MM-DD"
 * soltas no texto, em dd/mm/aaaa. Os UUID ficam como estão.
 */
function valor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "sim";
  if (v === false) return "não";
  if (Array.isArray(v)) return v.length ? `${v.length} item(ns)` : "nenhum";
  const t = String(v)
    .replace(INSTANTE_ISO, (m) => {
      const d = new Date(m);
      return Number.isNaN(d.getTime()) ? m : dataHoraNoFuso(d);
    })
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$3/$2/$1");
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

export function HistoricoAlteracoes({ linhas }: { linhas: LinhaHistorico[] }) {
  return (
    <section aria-label="Histórico de alterações" style={{ maxWidth: 820 }}>
      <h2 style={{ fontSize: "1.25rem", marginBottom: 8 }}>Histórico</h2>
      {linhas.length === 0 ? (
        <p style={{ color: "var(--scl-texto-2)" }}>Sem alterações registradas.</p>
      ) : (
        <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
          {linhas.map((l) => (
            <li key={l.id} style={{ fontSize: "0.875rem", borderLeft: "3px solid var(--scl-areia)", paddingLeft: 10 }}>
              <strong>{l.autor ?? "Sistema"}</strong> {ACOES[l.acao] ?? l.acao} · {dataHoraNoFuso(l.criadoEm)}
              {!/\.(criar|importar)$/.test(l.acao) && (
                <ul style={{ listStyle: "none", color: "var(--scl-texto-2)" }}>
                  {Object.entries(l.mudancas).map(([campo, [antes, depois]]) => (
                    <li key={campo}>
                      {ROTULOS[campo] ?? campo}: {valor(antes)} → {valor(depois)}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
