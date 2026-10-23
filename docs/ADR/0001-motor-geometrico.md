# ADR 0001 — manifold-3d como único motor de booleanos, rodando em Web Worker

**Contexto.** Cortes e encaixes precisam devolver malhas sempre fechadas (SPEC §2, princípio 3). Malhas de STL baixados frequentemente são quebradas.

**Decisão.** Toda operação geométrica usa `manifold-3d` (WASM) dentro de `src/geometry/worker.ts`, exposto via Comlink. A UI só recebe malhas de exibição (não indexadas, normais vincadas) como buffers transferíveis. O código de `src/geometry/` é puro (sem DOM/React) e é testado diretamente no Node.

**Consequências.**
- Partes resultantes são manifold por construção; os testes de propriedade verificam isso.
- A thread da UI nunca bloqueia; o preview de corte usa clipping planes na GPU.
- Objetos WASM precisam de `.delete()` explícito — o `Engine` faz contagem de referência por conjunto ao truncar o cache.
