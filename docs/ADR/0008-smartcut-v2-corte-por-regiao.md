# ADR 0008 — SmartCut v2: corte por região, laço por min-cut e junta curva

**Contexto.** O SmartCut v1 (ADR 0004) achatava o anel da articulação num plano (PCA) e cortava com um plano limitado por esfera. Em figuras reais o anel do ombro/pescoço não é plano: o plano atravessava tronco ou cabelo e a ilha certa era rejeitada pela regra da esfera ("corte não acontece") ou vinha um pedaço errado ("corta partes aleatórias"). O plano `docs/PLANO-SMARTCUT-V2.md` lista as causas (S1–S8, C1–C6).

## Decisão

### Operação nova `cut-region` (`src/geometry/types.ts`)
Guarda as **entradas**, não a curva: bolas da região‑semente, sementes positivas/negativas, nível geodésico, modo (`auto | surface | plane | shell`), profundidade da casca, plano médio e nome da peça. Ao reexecutar o histórico a região é recalculada sobre a malha que a peça tem naquele ponto — editar um corte anterior nunca deixa um laço “velho”. `cut-plane` continua igual (projetos antigos abrem sem migração).

### Pipeline (`src/geometry/segment/region.ts`)
1. **Contexto por peça**: topologia CSR, BVH (`three-mesh-bvh` no worker, modo `indirect` para manter a ordem dos triângulos), grade de vértices e concavidade por vértice; cache LRU por `Manifold`. Para sugestões, peças com > 300 mil triângulos usam um *proxy* simplificado (`Manifold.simplify`); malhas CAD com triângulos longos são refinadas. Raycast força bruta eliminado do SmartCut.
2. **Região‑semente**: cada pincelada vira a bola inscrita (SDF: eixo + 8 raios a 25°, mediana de `distância / cos θ` — exata para esfera, ~10% a mais para cilindro). A região cresce por *flood fill* a partir da pincelada **dentro** da bola e só por vértices cuja normal aponta para fora do centro (cos ≥ 0,4). Isso envolve a cabeça/membro inteiro e para na junção — sem engolir ombro ou tronco. Sementes negativas encolhem as bolas que as alcançariam.
3. **Anéis geodésicos** com union‑find incremental (até 220 níveis, ~1 nível por 1,5 aresta). Lado A = maior componente de `{d ≥ t}`; **todo o resto é B**, então B sempre contém as sementes. Cascas que as sementes não alcançam ficam em A.
4. **Escolha**: a regra antiga de pular “anel crescendo como disco” ganhou o teste isoperimétrico (`P² < 5·área(B)` = a região já está fechada) — clicar no rosto agora acha a junção cabeça‑tronco. Até 3 mínimos locais distintos viram candidatos (Tab na UI).
5. **Laço ótimo por min‑cut** (`segment/mincut.ts`, Dinic): numa faixa em torno do nível, grafo dual com custo `comprimento × f(dobra)` — barato atravessar vincos côncavos e, menos, arestas vivas convexas (barras, costuras). A região‑semente fica fora da faixa (senão o corte mínimo encolhe em volta do clique). Limpeza: ilhas de A cercadas por B viram B; ilhas de B sem semente voltam para A; vértices “beliscados” são resolvidos.
6. **Laços ordenados** seguindo o sentido das faces de B; mais de um laço quando há alça.

### Geração das peças (`src/geometry/regionCut.ts`)
Sem booleanos: cada lado mantém a sua superfície exata e ganha uma **tampa** no laço.
- **Curvo (padrão)**: tampa como campo de altura sobre o plano médio, com **centro plano** (até 85% do raio, transição ≤ 60°) — é ali que entram pino e numeração. Variantes, na ordem: centro plano → sem centro plano → cúpula entrando em B (afasta a tampa de um corpo próximo). Se nenhuma fecha, tenta o nível ±13–30%, e só então (modo `auto`) cai no **corte plano com a ilha escolhida pelas sementes**.
- **Casca**: a região sai com espessura (superfície deslocada pela normal suavizada + parede no laço); a peça fica com o rebaixo que encaixa sozinho.
- Validação: os dois sólidos precisam ser manifold, ter volume > 0 e somar o volume original (±1%); a tampa não pode atravessar a superfície (BVH + teste exato triângulo × triângulo, `mesh/tritri.ts`).
- **Encaixes e numeração em junta curva**: a junta ganha `faceRadius`; `faceSection` recorta o disco plano e conectores/numeração funcionam como num corte plano. Encaixe ou numeração que não cabem viram **aviso** — o corte continua aplicado.

### Correções no corte por plano (vale para o corte manual)
- Ilha limitada escolhida pela **maioria** dos vértices da face dentro da esfera (antes: todos), ou pela **posse das sementes**; ilhas restantes voltam para A. Tolerância “toca o plano” proporcional às coordenadas.
- Limitado + perfil agora funciona (`boundedProfileCut`).
- Traço livre com câmera em perspectiva: o cortador é varrido pelos raios da câmera (`extrude` com `scaleTop`).
- `Engine.checkCut`: *dry‑run* real usado na validação ao vivo e antes do commit; erros vêm com `hint` (ação de correção na UI).

## Medição
`npm run bench` roda o corpus (`tests/corpus/`) com o v1 congelado como linha de base. Resultado atual em `docs/baseline-smartcut.md`: **v1 41% → v2 73%** de acerto na 1ª sugestão (77% no top‑3) em 22 casos modelados.

## Limitações conhecidas (próximos passos)
- **Cabelo e roupa** (Fase D2): a fronteira é uma linha de barra/degrau, não um pescoço. Sem linhas de feição fechadas nem segmentação visual multivista (ONNX), o SmartCut ainda corta a cabeça inteira em vez do cabelo e o quadril em vez da cintura. O modo **Casca** já existe para quando a região certa é escolhida.
- **Membro‑ponte** (perna entre base e quadril) e **alça** (mão na cintura): com um clique, um único nível geodésico não corta as duas pontas ao mesmo tempo. Pincelar o membro inteiro resolve.
- **Mapa de partes pré‑calculado**: o hover recalcula a sugestão no proxy em cache (~150–350 ms em 5–150 mil triângulos), não lê um mapa pronto (< 50 ms). Segmentação hierárquica em background é o próximo passo (Fase D).
- Arrastar o laço sobre a superfície não existe; há “Deslocar ao longo” (nível) e os 3 candidatos.
