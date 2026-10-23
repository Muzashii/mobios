# SmartCut — corpus e linha de base

Gerado por `npm run bench` (tests/bench/smartcut.corpus.test.ts). 22 casos (22 modelados em tests/corpus/synthetic.ts + 0 reais em tests/corpus/models/).

| Métrica | v1 (plano PCA + esfera) | v2 (região + min-cut) |
|---|---|---|
| Acerto 1ª sugestão | 41% (9/22) | 73% (16/22) |
| Acerto entre as 3 primeiras | — | 77% (17/22) |

| Caso | Categoria | Triângulos | v1 | v2 top-1 | v2 top-3 | Sugestão (ms) | Corte (ms) | Observação |
|---|---|---|---|---|---|---|---|---|
| Cabeça — clique no topo | cabeça | 6.648 | ✓ | ✓ | ✓ | 385 | 345 |  |
| Cabeça — clique no rosto | cabeça | 6.648 | ✗ | ✓ | ✓ | 286 | 336 |  |
| Cabeça — clique na lateral | cabeça | 6.648 | ✗ | ✓ | ✓ | 574 | 539 |  |
| Braço — pincelado na frente | membro | 6.648 | ✓ | ✓ | ✓ | 604 | 572 |  |
| Braço — clique no antebraço | membro | 6.648 | ✓ | ✓ | ✓ | 668 | 619 |  |
| Mão — clique na mão | mão | 6.648 | ✗ | ✓ | ✓ | 696 | 554 |  |
| Perna — clique na coxa (perna liga base e quadril) | membro | 6.648 | ✗ | ✗ | ✗ | 512 | 718 | B: z 0–59, 46.0% |
| Braço com a mão na cintura (forma uma alça) | membro | 6.332 | ✗ | ✗ | ✗ | 538 | 836 | B: z 27–111, 65.0% |
| Braço quase encostado no tronco (folga ~0,5 mm) | membro | 6.502 | ✗ | ✗ | ✗ | 614 | 471 | B: z 0–76, 36.6% |
| Espada na mão — separar o objeto | acessório | 6.668 | ✗ | ✓ | ✓ | 462 | 584 |  |
| Chapéu — separar da cabeça | acessório | 6.758 | ✗ | ✗ | ✓ | 502 | 601 | B: z 87–118, 13.7% |
| Cabelo — casca sobre o crânio (linha do cabelo em z ≈ 99) | cabelo | 7.048 | ✗ | ✗ | ✗ | 575 | 618 | B: z 87–112, 11.8% |
| Camiseta × calça — cortar na cintura (barra em z = 58) | roupa | 6.956 | ✗ | ✗ | ✗ | 355 | 610 | B: z 44–111, 51.4% |
| Quadrúpede — cauda | cauda/asa | 5.088 | ✗ | ✓ | ✓ | 353 | 412 |  |
| Quadrúpede — cabeça | cabeça | 5.088 | ✓ | ✓ | ✓ | 474 | 440 |  |
| Dragão — asa (placa fina) | cauda/asa | 5.112 | ✓ | ✓ | ✓ | 406 | 408 |  |
| Scan ruidoso (±0,08 mm) — cabeça | scan | 144.572 | ✗ | ✓ | ✓ | 918 | 1182 | Emenda deslocada 0.1 mm para a tampa caber. |
| Malha CAD grossa (triângulos longos) — cabeça | cad | 952 | ✓ | ✓ | ✓ | 279 | 296 |  |
| Mesma figura em escala 10× (1,1 m) — braço | membro | 6.648 | ✗ | ✓ | ✓ | 609 | 643 |  |
| Haltere — esfera | primitiva | 4.272 | ✓ | ✓ | ✓ | 227 | 378 |  |
| Cogumelo — chapéu | primitiva | 2.454 | ✓ | ✓ | ✓ | 296 | 457 |  |
| Galho em T — ramo | primitiva | 340 | ✓ | ✓ | ✓ | 274 | 329 |  |

Critério: a peça B precisa ficar dentro dos limites esperados (caixa e fração de volume) e conter as sementes. Casos de **cabelo** e **roupa** dependem de linhas de vinco/degrau e da segmentação visual (Fase D2), ainda não implementadas — falham de propósito até lá.
