# ADR 0010 — Mapa de partes: segmentação automática por espessura

**Contexto.** O SmartCut v2 (ADR 0008) parte do clique e procura um anel geodésico. Numa figura real (boneco de 1,9 M triângulos, chapéu‑coco, cabeça com grade, bengala) ele separou 3 de 8 partes inteiras: clicar no chapéu, no rosto ou no tronco devolvia pedaços de 1–5% da superfície. O pedido é outro: "tudo que é a mesma coisa sai junto" — chapéu com a aba, braço com a mão, perna com o sapato. Plano completo em `docs/PLANO-MULTIPARTES.md` (Etapas 0 e 1).

## Decisão

Um **mapa de partes** da peça inteira, calculado uma vez no worker, só com geometria (sem dependência nova). O mapa é a base de tudo o que vem depois: cores, objeto multipartes no 3MF e "cortar esta parte".

### Pipeline (`src/geometry/segment/parts.ts`, `volume.ts`, `transfer.ts`, `src/geometry/partmap.ts`)
1. **Proxy** de ~45 mil triângulos (`Manifold.simplify`, passos ×1,3 — validados de 30 mil a 70 mil faces).
2. **Espessura local** (Hildebrand & Rüegsegger): voxelização por paridade de raios, transformada de distância exata (Felzenszwalb) e pintura das bolas máximas. É o sinal que separa braço (7 mm) de tronco (16 mm), aba (5 mm) de cabeça (35 mm) e bengala (3 mm) de mão, mesmo sem vinco entre eles. Vincos sozinhos vazam (o braço com a mão na cintura e as duas pernas saem grudados no tronco); o SDF por raios é ruidoso demais no tronco.
3. **Classes de espessura**: k‑means em log(espessura) + expansão‑α (cortes de grafo, Potts) com suavidade barata em dobras côncavas — as fronteiras caem nos vincos.
4. **Regiões**: componentes de mesma classe (classes finas também param em vales fundos); relevos que ligam corpos separados são repartidos pelo hospedeiro (faixa do chapéu × grade do rosto); um membro com dois lobos (as duas pernas) é dividido no ponto de sela.
5. **Fusão por regras** sobre o grafo de regiões, alternadas até estabilizar:
   - *placa*: região fina **deitada** entre dois corpos vai para o de cima (aba → chapéu) e os mantém separados para sempre; em pé (cachecol, moldura da grade) se comporta como relevo;
   - *relevo*: região fina agarrada ao corpo ao longo do comprimento (borda × espessura / área ≥ 1,2) ou deitada sobre ele vira detalhe dele (barras, botões, orelhas);
   - *semelhante*: corpos de espessura parecida em contato direto são um só; também os corpos que um mesmo relevo atravessa como costura (frente e nuca da cabeça);
   - *remendo*: parte cercada por outra maior e não muito mais fina, que não se projeta para fora (placa do rosto, grade da boca);
   - *extremidade*: segmento distal entra no seguinte (mão → braço, sapato → perna), nunca no tronco (junção) nem num acessório longo e fino (bengala);
   - *migalhas* < 2% vão para o vizinho.
6. **Ajuste por face**: faces em pé de uma placa que estão sobre outro corpo mudam de dono (barras que sobem por baixo da aba), ilhas < 0,2% somem.
7. **Nomes** pela posição (Z para cima, frente −Y): tronco = parte onde as pernas se prendem; cabeça = maior vizinho acima; chapéu = o que está sobre a cabeça; braços ao lado, pernas no chão, acessório fino e longo.
8. **Transferência** para todos os triângulos da malha exibida (grade de voxels rotulada + vizinho mais próximo), na ordem de `manifoldToMeshData` — a mesma da malha de exibição.

### Estado e UI
- O documento guarda só as **edições** do usuário (`ProjectDoc.partMaps`: nomes e junções), como Commands com desfazer. O mapa é determinístico e recalculado no worker quando a peça muda (`store/partmaps.ts`), com cache por versão.
- Viewport (`PartMapMesh`): reaproveita os buffers da peça e adiciona cor e grupo por vértice; o realce da parte sob o cursor é feito no shader (uniform), sem refazer buffers.
- Inspector (`PartMapPanel`): "Detectar partes", lista com cor, nome editável, % da superfície, "Juntar com…" e "Separar".

## Resultado (Etapa 0 — `docs/baseline-partes.md`)
Boneco de teste, 8 partes esperadas com pontos que devem vir juntos e pontos que devem ficar de fora: SmartCut v2 3/8 → mapa de partes **8/8** no caminho real do app (Raio‑X + reparo, 344 mil triângulos) e em 4 proxies de tamanhos diferentes; 3,5–5 s por modelo. CI: figura sintética com chapéu (`tests/unit/partmap.test.ts`) e fluxo na UI (`tests/e2e/partmap.spec.ts`).

## Consequências e limites
- Fronteiras seguem as arestas do proxy transferidas por voxel: boas para cor e escolha, ainda não para corte limpo — a Etapa 2 refina a fronteira (min‑cut na faixa, corte pela isolinha) antes de gerar peças.
- Regras foram calibradas num personagem real e numa figura sintética; outras figuras (cabelo fundido ao rosto, roupa sem vinco) precisam entrar no corpus (`tests/lab`, fora do git). Fronteira sem nenhum sinal geométrico continua sendo trabalho para a camada visual (Etapa 5) ou para o pincel.
- A sobra do paletó sobre as pernas ainda sai na cor da perna em alguns pontos; corrigível pelo pincel (Etapa 4) ou pelo refinamento da Etapa 2.
- O SmartCut v2 continua existindo para cortes livres; o mapa de partes não o substitui ainda.
