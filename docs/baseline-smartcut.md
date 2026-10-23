# SmartCut — corpus e linha de base

Gerado por `npm run bench` (tests/bench/smartcut.corpus.test.ts). 22 casos (22 modelados em tests/corpus/synthetic.ts + 0 reais em tests/corpus/models/).

| Métrica | v1 (plano PCA + esfera) | v2 (região + min-cut) |
|---|---|---|
| Acerto 1ª sugestão | 41% (9/22) | 91% (20/22) |
| Acerto entre as 3 primeiras | — | 95% (21/22) |

| Caso | Categoria | Triângulos | v1 | v2 top-1 | v2 top-3 | Sugestão (ms) | Corte (ms) | Observação |
|---|---|---|---|---|---|---|---|---|
| Cabeça — clique no topo | cabeça | 6.648 | ✓ | ✓ | ✓ | 420 | 376 |  |
| Cabeça — clique no rosto | cabeça | 6.648 | ✗ | ✓ | ✓ | 275 | 323 |  |
| Cabeça — clique na lateral | cabeça | 6.648 | ✗ | ✓ | ✓ | 316 | 293 |  |
| Braço — pincelado na frente | membro | 6.648 | ✓ | ✓ | ✓ | 537 | 304 |  |
| Braço — clique no antebraço | membro | 6.648 | ✓ | ✓ | ✓ | 445 | 333 |  |
| Mão — clique na mão | mão | 6.648 | ✗ | ✓ | ✓ | 328 | 288 |  |
| Perna — clique na coxa (perna liga base e quadril) | membro | 6.648 | ✗ | ✓ | ✓ | 200 | 292 |  |
| Braço com a mão na cintura (forma uma alça) | membro | 6.332 | ✗ | ✗ | ✗ | 244 | 665 | B: z 11–111, 50.7% |
| Braço quase encostado no tronco (folga ~0,5 mm) | membro | 6.502 | ✗ | ✓ | ✓ | 857 | 671 |  |
| Espada na mão — separar o objeto | acessório | 6.668 | ✗ | ✓ | ✓ | 608 | 747 |  |
| Chapéu — separar da cabeça | acessório | 6.758 | ✗ | ✓ | ✓ | 633 | 675 |  |
| Cabelo — casca sobre o crânio (linha do cabelo em z ≈ 99) | cabelo | 7.048 | ✗ | ✗ | ✓ | 592 | 661 | B: z 87–112, 11.8% |
| Camiseta × calça — cortar na cintura (barra em z = 58) | roupa | 6.956 | ✗ | ✓ | ✓ | 684 | 653 |  |
| Quadrúpede — cauda | cauda/asa | 5.088 | ✗ | ✓ | ✓ | 407 | 436 |  |
| Quadrúpede — cabeça | cabeça | 5.088 | ✓ | ✓ | ✓ | 539 | 497 |  |
| Dragão — asa (placa fina) | cauda/asa | 5.112 | ✓ | ✓ | ✓ | 481 | 456 |  |
| Scan ruidoso (±0,08 mm) — cabeça | scan | 144.572 | ✗ | ✓ | ✓ | 1268 | 1210 | Emenda deslocada 0.2 mm para a tampa caber. |
| Malha CAD grossa (triângulos longos) — cabeça | cad | 952 | ✓ | ✓ | ✓ | 303 | 437 | Emenda deslocada 1.1 mm para a tampa caber. |
| Mesma figura em escala 10× (1,1 m) — braço | membro | 6.648 | ✗ | ✓ | ✓ | 617 | 627 |  |
| Haltere — esfera | primitiva | 4.272 | ✓ | ✓ | ✓ | 248 | 378 |  |
| Cogumelo — chapéu | primitiva | 2.454 | ✓ | ✓ | ✓ | 300 | 493 |  |
| Galho em T — ramo | primitiva | 340 | ✓ | ✓ | ✓ | 270 | 355 |  |

Critério: a peça B precisa ficar dentro dos limites esperados (caixa e fração de volume) e conter as sementes. Casos de **cabelo** e **roupa** dependem de linhas de vinco/degrau e da segmentação visual (Fase D2), ainda não implementadas — falham de propósito até lá.
