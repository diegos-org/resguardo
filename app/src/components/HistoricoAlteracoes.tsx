import type { LinhaHistorico } from "@/auditoria/auditoria";

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
  tipo: "Tipo",
  documento: "CPF/CNPJ",
  email: "E-mail",
  telefone: "Telefone",
  chavePix: "Chave Pix",
  observacoes: "Observações",
  imoveis: "Imóveis",
  representante: "Representante",
};

const ACOES: Record<string, string> = {
  "imovel.criar": "criou",
  "imovel.editar": "alterou",
  "proprietario.criar": "cadastrou",
  "proprietario.editar": "alterou",
  "proprietario.imoveis": "alterou os imóveis",
  "proprietario.representante.adicionar": "adicionou representante",
  "proprietario.representante.remover": "removeu representante",
};

function valor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (v === true) return "sim";
  if (v === false) return "não";
  if (Array.isArray(v)) return v.length ? `${v.length} item(ns)` : "nenhum";
  const t = String(v);
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
}

const quando = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

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
              <strong>{l.autor ?? "Sistema"}</strong> {ACOES[l.acao] ?? l.acao} · {quando.format(l.criadoEm)}
              {!l.acao.endsWith(".criar") && (
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
