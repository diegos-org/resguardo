/**
 * `setupFiles` do Vitest (M8.3; M10.1a): instala a barreira de rede do Beds24 e da Meta (WhatsApp) antes de cada arquivo
 * de teste e derruba o teste que tentou chegar a `*.beds24.com` ou a um domínio da Meta, mesmo que o código testado tenha
 * tratado o erro. Ver `barreira-de-rede.ts`.
 */
import { afterEach } from "vitest";
import { fetchComBarreira, temBarreira, verificarTentativasBloqueadas } from "./barreira-de-rede";

// Embrulha o `fetch` que estiver valendo, uma vez só (o processo pode ser reaproveitado entre arquivos de teste).
if (typeof globalThis.fetch === "function" && !temBarreira(globalThis.fetch)) globalThis.fetch = fetchComBarreira(globalThis.fetch.bind(globalThis));

afterEach(() => verificarTentativasBloqueadas());
