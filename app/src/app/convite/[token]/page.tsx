import { getDb } from "@/db/client";
import { seguirConvite } from "@/convites/acoes";
import { lerConvite } from "@/convites/convites";

const MOTIVOS: Record<string, string> = {
  invalido: "Este link de convite não é válido. Confira se copiou o endereço inteiro.",
  aceito: "Este convite já foi usado. Se foi você, é só entrar normalmente.",
  revogado: "Este convite foi cancelado. Peça um novo à Sua Casa Leblon.",
  vencido: "Este convite venceu (vale 7 dias). Peça um novo à Sua Casa Leblon.",
};

export default async function PaginaConvite({ params }: PageProps<"/convite/[token]">) {
  const { token } = await params;
  const r = await lerConvite(getDb(), token);
  return (
    <main style={{ maxWidth: 460, margin: "0 auto", padding: "80px 16px" }}>
      <h1 style={{ fontSize: "2rem", marginBottom: 8 }}>Sua Casa Leblon</h1>
      {r.ok ? (
        <>
          <p style={{ marginBottom: 16 }}>
            Olá, {r.nomeProprietario.split(" ")[0]}! Você foi convidado para acompanhar seus imóveis no portal do proprietário.
          </p>
          <p style={{ marginBottom: 24, color: "var(--scl-texto-2)" }}>
            Para aceitar, entre com o e-mail <strong>{r.convite.email}</strong>. Vamos mandar um código para ele (ou use o Google, se for uma conta
            Google).
          </p>
          <form action={seguirConvite}>
            <input type="hidden" name="token" value={token} />
            <button
              type="submit"
              style={{ width: "100%", padding: "12px 16px", fontSize: "1rem", borderRadius: 6, border: 0, background: "var(--scl-salvia)", color: "#fff", cursor: "pointer" }}
            >
              Aceitar e entrar
            </button>
          </form>
        </>
      ) : (
        <p role="alert" style={{ background: "#fbeaea", color: "#7a2020", padding: 12, borderRadius: 6 }}>
          {MOTIVOS[r.motivo]}
        </p>
      )}
    </main>
  );
}
