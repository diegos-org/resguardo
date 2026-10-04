"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Abas({ abas }: { abas: { slug: string; titulo: string }[] }) {
  const atual = usePathname();
  return (
    <nav aria-label="Abas de configurações">
      <ul style={{ display: "flex", flexWrap: "wrap", gap: 6, listStyle: "none", padding: 0, margin: 0 }}>
        {abas.map((a) => {
          const href = `/painel/configuracoes/${a.slug}`;
          const ativa = atual === href;
          return (
            <li key={a.slug}>
              <Link
                href={href}
                aria-current={ativa ? "page" : undefined}
                style={{
                  display: "inline-block",
                  padding: "6px 12px",
                  borderRadius: 999,
                  fontSize: "0.875rem",
                  textDecoration: "none",
                  border: "1px solid var(--scl-areia)",
                  background: ativa ? "var(--scl-musgo)" : "var(--scl-papel)",
                  color: ativa ? "var(--scl-branco)" : "var(--scl-texto)",
                }}
              >
                {a.titulo}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
