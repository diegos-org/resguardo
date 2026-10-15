import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { FormCampos } from "./FormCampos";

it("a nota do campo (ex.: o Site, M7.13) aparece abaixo da dica só quando existe", () => {
  const salvar = async () => ({});
  const campos = [
    { nome: "site", rotulo: "Site", limite: 200, dica: "Com https:// no começo.", nota: "Sem um endereço com https:// aqui, a prévia usa o endereço da Vercel." },
    { nome: "email", rotulo: "E-mail", limite: 200, nota: null },
  ];
  const h = renderToStaticMarkup(<FormCampos titulo="Dados da empresa" campos={campos} valores={{ site: "", email: "" }} salvar={salvar} />);
  expect(h).toContain('<span role="note"');
  expect(h).toContain("Sem um endereço com https:// aqui, a prévia usa o endereço da Vercel.");
  expect(h.match(/role="note"/g)).toHaveLength(1);
});
