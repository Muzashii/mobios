# ADR 0003 — Orçamento de corte de 500k triângulos

**Contexto.** SPEC §4 pede corte de 500k triângulos em < 500 ms.

**Medição** (`npm run bench`, notebook Windows, Node 24, manifold-3d 3.5.4 WASM single-thread):
- corte por plano oblíquo, 500k tri: ~830 ms
- corte axial + pinos soltos: ~575 ms
- importação (solda + validação) de 500k tri: ~700 ms
- malha de exibição (normais vincadas): ~130 ms

Alternativas testadas: interseção/subtração com meio-espaço (cubo) — ~1,7 s; separador próprio em JS + reconstrução — a construção do `Manifold` sozinha custa ~265 ms por metade, inviável.

**Decisão.** Manter `splitByPlane`. Mitigar a percepção: o preview de corte é instantâneo (clipping planes, 60 fps), o cálculo real roda no worker sem modal e a UI mostra progresso no objeto. O teste `tests/bench/budget.test.ts` falha acima de 1500 ms (regressão) e relata a meta de 500 ms a cada execução.

**Próximos passos possíveis** (exigem decisão de stack — perguntar antes): build multithread do manifold (WASM threads, exige COOP/COEP) ou pool de workers por parte.
