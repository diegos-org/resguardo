import Link from "next/link";
import { formatBRL } from "@/lib/money";

const exemplo = formatBRL(123456);

export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 16px" }}>
      <h1 style={{ fontSize: "2.25rem", marginBottom: 12 }}>Sua Casa Leblon</h1>
      <p style={{ color: "var(--scl-texto-2)", marginBottom: 24 }}>
        Sistema de gestão em construção. Acompanhe o progresso no ROADMAP do repositório.
      </p>
      <p style={{ marginBottom: 24 }}>
        <Link href="/painel">Abrir o painel interno →</Link>
      </p>
      <p style={{ fontSize: "0.875rem", color: "var(--scl-texto-2)" }}>
        Formato de valores: {exemplo}
      </p>
    </main>
  );
}
