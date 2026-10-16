/**
 * `setupFiles` do Vitest (M8.3): instala a barreira de rede do Beds24 antes de cada arquivo de teste e derruba o teste
 * que tentou chegar a `*.beds24.com`, mesmo que o código testado tenha tratado o erro. Ver `barreira-de-rede.ts`.
 */
import { afterEach } from "vitest";
import { fetchComBarreira, limparTentativasBloqueadas, temBarreira, tentativasBloqueadas } from "./barreira-de-rede";

// Embrulha o `fetch` que estiver valendo, uma vez só (o processo pode ser reaproveitado entre arquivos de teste).
if (typeof globalThis.fetch === "function" && !temBarreira(globalThis.fetch)) globalThis.fetch = fetchComBarreira(globalThis.fetch.bind(globalThis));

afterEach(() => {
  const tentativas = [...tentativasBloqueadas()];
  limparTentativasBloqueadas();
  if (tentativas.length) throw new Error(`Teste tentou acessar o Beds24 pela rede (${tentativas.join(", ")}). Use a versão falsa (beds24/falso.ts) ou um fetch simulado.`);
});
