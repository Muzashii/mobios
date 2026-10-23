# Mobios — Plano de correção: Corte Inteligente 100% + Raio-X da malha na importação

> Documento para um **time de agentes de IA** (Claude Code + subagentes de `.claude/agents/`).
> Repositório: https://github.com/Muzashii/mobios — leia `CLAUDE.md`, `docs/SPEC.md` e `docs/ADR/0004-smartcut-e-cortes-livres.md` antes de começar.
> Prioridade absoluta: **o corte e o SmartCut precisam funcionar em modelos reais** (figuras baixadas, esculturas, scans), não só nas figuras sintéticas dos testes.

---

## 0. Resumo do problema (relato do dono do projeto)

1. **Cortes não acontecem**: confirmo o corte e nada muda (ou a operação fica vermelha no histórico).
2. **SmartCut separa partes "aleatórias"**: pincelo a cabeça ou o braço e ele corta outro pedaço, ou um pedaço maior/menor do que deveria.
3. Quero que, **ao importar o arquivo**, o app faça uma **análise minuciosa** da malha e me ofereça **opções de reparo** (hoje ele repara em silêncio e só mostra um toast).
4. O app parece simples demais — quero que a feature principal (corte inteligente) seja de nível profissional.
5. **O coração do programa**: o corte inteligente precisa **entender cada parte do STL** — mão, braço, cabeça, **cabelo, camiseta, calça**, sapato, acessórios — para eu cortar qualquer uma delas **de forma fácil e rápida** (passar o mouse, clicar, cortar).

> Formato principal: **STL** (OBJ/3MF continuam suportados). A análise da seção 4 vale para todos.

### 0.1 Por que "roupa" e "cabelo" exigem uma abordagem diferente de "membro"
- **Membros** (braço, perna, cabeça, mão) são **galhos** do corpo: a fronteira é um pescoço estreito/côncavo → SDF + concavidade + min-cut resolvem (seção 3.3).
- **Roupa** (camiseta, calça, saia, jaqueta) **não é um galho**: é uma **camada** sobre o corpo. A fronteira é uma **linha de barra/costura** (gola, punho, cintura, barra da calça), que na malha aparece como **degrau, vinco ou aresta viva**, nem sempre estreita. Ex.: separar a camiseta da calça = cortar na linha da cintura, onde o tecido sobrepõe.
- **Cabelo** é uma **casca** sobre o crânio: a fronteira é a **linha do cabelo** (testa, nuca, orelhas) e o corte não pode ser um plano — tem que seguir a linha do cabelo e entrar **em profundidade** formando uma "touca" com espessura, deixando um rebaixo na cabeça para encaixar.
- Conclusão: o SmartCut v2 precisa de **três sinais combinados** (geometria de membros + linhas de vinco/degrau + entendimento visual) e de um **modo de corte "casca"** (seções 3.3B e 3.6).

---

## 1. Diagnóstico (causas prováveis encontradas lendo o código)

### 1.1 Por que o corte "não acontece"

| # | Onde | Problema |
|---|---|---|
| C1 | `src/geometry/engine.ts` → `apply()` | Qualquer exceção do corte é engolida: o estado volta a ser `prev` e só fica `report.error`. O usuário vê um toast de 6 s e o card vermelho no histórico — parece que "não cortou". Não há validação **antes** do commit. |
| C2 | `src/geometry/cut.ts` → `cutByPlane()` com `bounded` | Uma ilha do lado positivo só é aceita se **todos** os vértices dela que tocam o plano estiverem dentro da esfera. Em figuras reais o plano quase sempre toca outra coisa (ombro, cabelo, capa, mão encostada) dentro do mesmo componente → ilha rejeitada → erro "Nenhuma ilha separável dentro do limite". |
| C3 | `cut.ts` | O teste "toca o plano" usa `eps = diag × 1e-5`; com malhas grandes/arredondamento float vértices da face de corte podem não ser contados (`touching = 0`) → ilha vai para `rest`. |
| C4 | `cutActions.ts` → `draftToOperation()` | Corte limitado + perfil (degrau/zigue-zague) é descartado em silêncio (o `bounded` some se tiver perfil) e, no motor, `bounded && profile` lança erro. O usuário não entende o que aconteceu. |
| C5 | `cutters.ts` → `strokeCutter()` | Traço livre assume projeção ortográfica; com câmera em perspectiva o corte desvia nas bordas e pode "não atravessar a peça". |
| C6 | `engine.ts` → `applyConnector()` / `applyLabel()` | Se o pino não cabe, a operação inteira falha e o corte parece ter falhado junto (o batch é "Corte + encaixe"). |

### 1.2 Por que o SmartCut corta partes "aleatórias"

| # | Onde (`src/geometry/smartcut.ts`) | Problema |
|---|---|---|
| S1 | Resultado final | O anel (que é uma curva 3D não plana) é achatado num **plano por PCA** e vira um **corte por plano limitado por esfera**. Em ombro, pescoço curto, quadril, o plano atravessa o tronco/cabelo → cai no problema C2 ou leva um pedaço extra. **Essa é a causa raiz principal.** |
| S2 | Seleção da ilha | A ilha separada é escolhida pela regra da esfera, **não** pela região que o usuário pincelou. Nada garante que a peça B contém as sementes. |
| S3 | `shapeDiameterBalls()` | A bola inscrita é inflada `×1.35`; em pescoço curto/cabeça grande ela engole ombros → a região R "vaza" para o tronco e os anéis geodésicos ficam errados. Se as normais locais estiverem invertidas ou a malha tiver cascas internas, os raios dão espessura errada. |
| S4 | Várias pinceladas | Sementes em dois membros (ou cabeça + mão) geram **vários anéis**; o PCA mistura todos num plano sem sentido. Não há agrupamento de sementes nem extração de laços fechados. |
| S5 | `forEachRingSegment()` | O "anel" é uma sopa de segmentos, não um laço ordenado. Não se verifica se é **um único laço fechado**; buracos/handles (genus > 0, ex.: braço na cintura) produzem múltiplos laços. |
| S6 | Pontuação | Pesos fixos (`−0.6·concavidade + 0.3·distância`), 72 níveis relativos a `maxD` (resolução fica grossa em peças grandes), concavidade por vértice ruidosa em malhas de scan. |
| S7 | Desempenho | Raycast **força bruta** (sem BVH, apesar de `three-mesh-bvh` estar instalado); teste de pertinência `O(vértices × sementes)` com até 4000 sementes; `refineToLength` só abaixo de 150 mil triângulos → em modelos grandes é lento e menos preciso. |
| S8 | Testes | `tests/unit/smartcut.test.ts` usa só **primitivas sintéticas** (cápsulas, esferas). Nenhum modelo real (cabelo, roupa, braço encostado, scan ruidoso, 500 k+ triângulos). Por isso os testes passam e o uso real falha. |

### 1.3 Reparo / análise na importação

| # | Onde (`src/geometry/repair.ts`, `importActions.ts`) | Problema |
|---|---|---|
| R1 | `repairMesh()` | Repara automaticamente e em silêncio; o usuário não escolhe nada. |
| R2 | `fillHoles()` | Preenche furos com **leque no centróide** — em furos não planos cria autointerseção e superfícies feias. |
| R3 | — | Não detecta **autointerseções**, cascas internas invertidas, sujeira flutuante, paredes finas, vértices não-manifold, componentes minúsculos. |
| R4 | `finalize()` | Só une cascas se todas tiverem volume > 0; casca interna invertida (comum em figuras) quebra a lógica. |
| R5 | — | Sem fallback robusto (remesh volumétrico) para malhas "irreparáveis" → importação simplesmente falha. |
| R6 | — | Sem decimação/remesh para malhas gigantes (scans de 2–5 M triângulos travam o worker). |

---

## 2. Objetivos e critérios de aceite (Definition of Done)

1. **Corpus real** de pelo menos **20 modelos** (seção 6) com o corte esperado anotado; SmartCut acerta a parte pedida (cabeça, braço, perna, mão, cauda, asa, acessório) em **≥ 90 %** dos casos na 1ª sugestão e **≥ 98 %** entre as 3 primeiras. Para **cabelo, camiseta, calça, sapato**: **≥ 85 %** na 1ª sugestão (IoU de faces ≥ 0,85 com o rótulo).
1b. **Fácil e rápido**: separar uma parte comum = **passar o mouse + 1 clique + Enter**, com o hover respondendo em **< 50 ms** (mapa de partes pré-calculado) e o corte final em **< 2 s**.
2. **Nenhum corte falha em silêncio**: todo corte é validado no preview antes do commit; se não for possível, o inspector explica o motivo e oferece a correção (ex.: "aumentar raio", "usar corte por região").
3. A parte separada **sempre contém as sementes pinceladas** e **nunca** contém sementes de outra região.
4. Ambas as partes saem **manifold/watertight** (teste de propriedade).
5. Desempenho: sugestão do SmartCut em **< 1,5 s** para 500 k triângulos; mapa de partes pré-calculado em **< 5 s** na importação (em background, sem travar a UI).
6. Importação mostra o **Raio-X da malha** (seção 4) com opções de reparo; nada é alterado sem o usuário ver o que mudou (com "Reparar tudo (recomendado)" em 1 clique).
7. `npm run test && npm run bench && npm run e2e` passam; novos testes cobrem cada item deste plano.

---

## 3. Nova arquitetura do Corte Inteligente (SmartCut v2)

### 3.1 Visão geral do pipeline

```
Importação ─► Raio-X + reparo ─► Malha de análise (proxy) ─► Mapa de partes (segmentação)
                                                             │
UI: hover destaca a parte inteira ◄──────────────────────────┘
UI: clique/pincel ─► região-semente ─► laço de corte ótimo (min-cut) ─► superfície de corte
                                                             │
                     preview das duas peças + validação ◄────┘ ─► commit (operação "cut-region")
```

### 3.2 Malha de análise (proxy) + BVH — `src/geometry/analysis/proxy.ts`
- Gerar uma **malha proxy** de 40–80 k triângulos (remesh isotrópico ou decimação por quádricas) só para análise; manter mapa proxy→original (face mais próxima via BVH).
- Construir **BVH** (`three-mesh-bvh` roda no worker sem DOM — usar `MeshBVH` sobre `BufferGeometry` sem renderer) para raycast/nearest. Eliminar todo raycast força bruta (`rayHits`).
- Cachear proxy + BVH por versão da parte (no `Engine`).

### 3.3 Mapa de partes (segmentação automática) — `src/geometry/segment/`
Calculado em background ao importar (e após cada corte, só para as partes novas):
1. **SDF por face** (Shape Diameter Function com cone de 30 raios + BVH, filtrar outliers, suavizar no grafo dual). Normalizar log-SDF.
2. **Concavidade por aresta** (ângulo diedro com sinal) — base da "regra dos mínimos".
3. **Sobre-segmentação** em ~30–80 regiões (k-means/GMM sobre SDF + region growing limitado por arestas côncavas).
4. **Fusão hierárquica** (grafo de regiões) até obter partes semânticas; guardar a **hierarquia** para o usuário subir/descer de nível (mão ⊂ antebraço ⊂ braço).
5. Alternativa/complemento a avaliar pelo arquiteto: **esqueleto** (contração de malha / Reeb graph geodésico) para identificar galhos (membros) e junções (articulações). Usar como desempate e para nomear partes.
6. Saída: `faceLabel: Uint32Array`, árvore de regiões e, por fronteira entre regiões, o **laço de corte** candidato já calculado.

### 3.3B Entendimento de roupa, cabelo e detalhes — `src/geometry/segment/features.ts` + `src/ai/partSeg/`
A segmentação geométrica (3.3) acha membros; para **camiseta, calça, cabelo, cinto, sapato, luva** somar dois sinais:

**1. Linhas de feição (geometria, sem IA)**
- Detectar **vincos e degraus**: arestas com ângulo diedro forte, cristas/vales de curvatura (máximos da curvatura principal) e **descontinuidades de "altura"** em relação a uma superfície suavizada (o tecido sobreposto forma um degrau de 0,3–2 mm).
- Ligar os trechos em **laços fechados** (gola, punhos, cintura, barra da calça, linha do cabelo) por caminho geodésico de menor custo, fechando lacunas pequenas.
- Esses laços viram **arestas baratas** no grafo do min-cut (3.5): o corte "gruda" na costura em vez de atravessar o tecido.

**2. Segmentação visual multivista (IA local, no navegador)**
- Renderizar o modelo de 8–16 vistas (offscreen, no worker com OffscreenCanvas) gerando também um **buffer de ID de face** por pixel.
- Rodar um modelo de **segmentação interativa por clique** do tipo SAM em versão leve (ex.: MobileSAM/EfficientSAM exportado para ONNX) via `onnxruntime-web` (WebGPU, fallback WASM). O clique do usuário vira o *prompt* em cada vista onde o ponto está visível.
- **Projetar as máscaras de volta** para as faces (via buffer de ID) e votar entre vistas → rótulo por face com confiança. Regiões não vistas por nenhuma câmera herdam o rótulo pelo grafo (propagação suave limitada por vincos).
- Modelo baixado sob demanda e cacheado (PWA continua offline depois do primeiro uso); nada sai do computador.
- Avaliar também, como pesquisa do agente `segmentacao`, modelos de segmentação de partes 3D direto na malha/nuvem de pontos (família "segment any part in 3D") para um modo "segmentar tudo automaticamente" — só adotar se rodar no navegador com tempo aceitável.

**3. Fusão dos sinais**
- Energia final por face = termo visual (máscara multivista) + termo geométrico (SDF/concavidade) + termo de fronteira (vincos/degraus). Resolver com **graph-cut** (alfa-expansão) → rótulos limpos e fronteiras suaves.
- O resultado alimenta o hover: passar o mouse na camiseta acende **a camiseta inteira**, no cabelo acende **o cabelo inteiro**.
- Rótulos nomeados automaticamente quando possível (Cabeça, Cabelo, Camiseta, Calça, Mão D...), editáveis pelo usuário.

### 3.4 Interação nova
- **Hover**: ao passar o mouse com a ferramenta SmartCut, a **parte inteira** sob o cursor acende (cabeça, braço...). `Scroll`/`Alt+scroll` sobe/desce na hierarquia (mão → braço inteiro).
- **Clique** = seleciona aquela parte e já mostra o corte proposto com as duas peças coloridas.
- **Pincel** continua existindo para casos difíceis: pincelar "inclui", `Shift`+pincel "exclui" (sementes negativas = o que **não** pode sair junto, ex.: o tronco).
- **Tab** = próxima sugestão (top-3 candidatos), com a confiança de cada uma.
- **Várias partes de uma vez**: sementes em regiões diferentes viram **cortes separados** (um por cluster), aplicados em lote.
- Ajuste fino: arrastar o laço sobre a superfície (pontos de controle que deslizam na malha) e deslocar ao longo do membro.

### 3.5 Laço de corte ótimo — `src/geometry/segment/boundary.ts`
- Formular como **min-cut no grafo dual** entre "fonte" = região-semente (+ sementes positivas) e "sorvedouro" = corpo (+ sementes negativas). Peso da aresta dual = `comprimento × f(concavidade, ΔSDF)` (barato atravessar dobras côncavas e pescoços finos).
- Pós-processar: extrair **laços ordenados**, exigir **um laço fechado por cluster**; suavizar (snake geodésica restrita à malha) e afastar de vértices ruins.
- Fallback: o algoritmo atual de anéis geodésicos, mas **corrigido** (agrupar sementes, extrair laços, escolher o laço que separa as sementes, não só o "mais estreito").

### 3.6 Superfície de corte e geração das peças — `src/geometry/regionCut.ts` (nova operação `cut-region`)
Três modos, escolhidos automaticamente e editáveis:
1. **Plano (quando o laço é quase planar)** — erro de planaridade < X % do raio → corte plano, que aceita conectores e numeração. Ilha escolhida **pela posse das sementes** (componente que contém a região R), nunca pela esfera.
2. **Superfície curva (laço não planar)** — triangular uma **tampa** a partir do laço (superfície mínima/harmônica, ou "cúpula" levemente convexa para a peça B encaixar), construir um **sólido cortador** (tampa extrudada para dentro da região, fechado) e fazer `B = peça ∩ cortador`, `A = peça − cortador` com manifold. A tampa nunca coincide com faces da peça (offset de 1e-4) → booleanos robustos.
3. **Cortador por região** (casos patológicos) — cortador = envoltória volumétrica da região selecionada (offset da região + tampa), garantindo que só ela sai.
4. **Corte em casca (cabelo, capa, capacete, jaqueta aberta)** — a região selecionada sai como uma **casca com espessura** (parâmetro "profundidade", ex.: 2–4 mm, com preview ao vivo): cortador = região deslocada para dentro pela normal até a profundidade escolhida, fechada pela borda (laço da linha do cabelo). A cabeça fica com um **rebaixo** no formato da touca, que funciona como encaixe autoalinhante (com folga da tecnologia). Opção "casca cheia" = tudo acima da linha do cabelo sai inteiro.
5. **Corte de roupa (camiseta, calça, saia)** — padrão: separar o **volume do tronco/pernas** nos laços de barra (gola, punhos, cintura, barra), com junta em degrau que segue a sobreposição do tecido (a emenda fica escondida na própria costura). Alternativa: modo casca para roupas soltas.

Atalho por tipo de parte (detectado em 3.3/3.3B): membro → modo 1/2 · cabelo → modo 4 · roupa → modo 5. O usuário pode trocar no inspector.

Requisitos:
- Validar: B contém todas as sementes positivas e nenhuma negativa; volumes > mínimo; ambas manifold. Se falhar, tentar o próximo modo antes de reportar erro.
- **Encaixes em junta curva**: calcular o plano médio da tampa para posicionar pinos (pino perpendicular ao plano médio, com profundidade limitada pela tampa); permitir "achatar a tampa" numa área central para caber o pino. Hoje `planar:false` recusa conectores — isso precisa acabar, pois cabeça/braço quase sempre geram junta curva.
- Numeração gravada também na junta curva (projetar o texto no plano médio e intersectar com a tampa).

### 3.7 Correções no corte por plano (vale para o corte manual também)
- `cutByPlane` limitado: escolher ilhas por **clique do usuário** ("quais pedaços vão para B?") ou pela **posse das sementes**; manter a esfera só como filtro opcional.
- **Pré-validação ao vivo**: enquanto o usuário arrasta o gizmo, pedir ao worker um *dry-run* barato (seção do plano + contagem de ilhas) e mostrar no inspector: "vai gerar 2 peças", "o plano não atravessa a peça", "3 ilhas — escolha quais".
- Erros nunca só em toast: banner fixo no inspector e no card do histórico com ação de correção.
- Separar falha de **encaixe** da falha de **corte**: o corte é aplicado e o encaixe aparece como aviso "não coube, reduza diâmetro".
- Permitir **corte limitado + perfil** (cortador perfilado intersectado com cilindro/esfera do limite).
- Traço livre: usar a matriz de projeção real da câmera (perspectiva) — construir a superfície cortadora a partir dos raios da câmera em cada ponto do traço.

### 3.8 (Opcional, depois do resto) Sugestão por IA
- Botão "Sugerir cortes para impressão": renderiza vistas do modelo + mapa de partes e pede à Claude API (visão) quais partes separar e por quê (esconder emendas, minimizar suportes, caber na mesa). A IA escolhe entre os candidatos **já calculados** pelo motor — nunca gera geometria.

---

## 4. Raio-X da malha na importação (análise minuciosa + opções de reparo)

### 4.1 Fluxo
1. Ao abrir STL/OBJ/3MF, o worker **não repara mais em silêncio**: guarda a malha bruta e roda o diagnóstico.
2. Abre o painel **"Raio-X da malha"** com nota geral (Pronta / Precisa de reparo / Crítica), lista de problemas por severidade e **heatmap no viewport** (arestas abertas em vermelho, faces invertidas em roxo, autointerseções em laranja, paredes finas em amarelo...).
3. Cada problema tem **"Mostrar"** (foca a câmera no problema) e **"Corrigir"** com opções. Botão **"Reparar tudo (recomendado)"**.
4. Reparos viram uma operação `repair` no histórico (dá para desfazer e comparar antes/depois).

### 4.2 Verificações (`src/geometry/inspect/`)
| Verificação | Como detectar | Opções de reparo oferecidas |
|---|---|---|
| Furos / arestas de borda | arestas com 1 face; agrupar em laços, medir perímetro | Preencher plano · Preencher suave (fairing) · Ignorar furos minúsculos |
| Arestas/vértices não-manifold | aresta com > 2 faces; vértice com leque desconexo | Dividir vértices · Remover faces excedentes · Remesh volumétrico |
| Normais invertidas / orientação | BFS de orientação + volume assinado por casca | Reorientar por casca · Inverter casca inteira |
| Autointerseções | BVH triângulo×triângulo | Resolver via união manifold das cascas · Remesh volumétrico |
| Várias cascas | componentes conexos; classificar: sobrepostas, encostadas, internas, flutuantes | Unir em um sólido · Remover internas · Remover sujeira < X mm³ · Manter como partes separadas |
| Cascas internas invertidas (vazios) | volume negativo dentro de outra casca | Manter vazio (oco intencional) · Remover |
| Faces degeneradas/duplicadas | área ~0, índices repetidos | Remover |
| Paredes finas | SDF/espessura por face (BVH) vs mínimo da tecnologia (FDM ~0,8 mm, resina ~0,4 mm) | Só avisar · Engrossar (offset local) |
| Detalhes menores que o bico/pixel | features < limite | Avisar |
| Escala / unidade suspeita | bbox < 4 mm ou > 3 m; heurística mm/cm/pol/m | Converter de pol/cm/m · Escalar para altura X |
| Malha gigante | > 1 M triângulos | Decimar para N (mostrar perda em mm) · Manter |
| Triângulos ruins (agulhas) | razão de aspecto | Remesh isotrópico local |
| Gênero / alças | `genus()` | Só informar (afeta corte: "braço encostado na cintura forma uma alça") |
| Partes que não cabem na impressora | bbox vs volume da impressora | Sugerir **auto-split** |

### 4.3 Reparo robusto
- Substituir o preenchimento em leque por **triangulação de furos com fairing** (ear-clipping no plano de melhor ajuste para furos planos; refinamento + suavização Laplaciana para os não planos).
- **Fallback volumétrico**: quando nada mais funciona, gerar um campo de distância com sinal pelo **número de enrolamento generalizado** (funciona com malhas furadas/autointersectadas) e reconstruir com `Manifold.levelSet` (verificar disponibilidade na versão do `manifold-3d`), com resolução escolhida pelo usuário (prévia da perda de detalhe).
- Relatório final legível: "12 furos fechados · 3 cascas internas removidas · 1 autointerseção resolvida · decimado de 2,1 M para 400 k triângulos (desvio máx. 0,03 mm)".

---

## 5. Outras melhorias sugeridas (depois do foco principal)

1. **Árvore de partes nomeadas** a partir da segmentação (Cabeça, Braço D, Braço E...) — nomes automáticos nas peças cortadas e no guia de montagem.
2. **"Cortar tudo para impressão"**: um clique propõe separar cabeça, braços, pernas e acessórios, com encaixes e numeração, e mostra a vista explodida.
3. Encaixes com **chaveta automática** em juntas de membros (impede rotação do braço).
4. **Comparador antes/depois** e **medição** (distância, diâmetro do encaixe) no viewport.
5. Importar **PLY / GLB / GLTF** (já previsto na SPEC v1).
6. Telemetria local de falhas (sem enviar dados): guardar casos em que o SmartCut falhou para virar caso de teste.

---

## 6. Corpus de teste real (obrigatório antes de mexer no algoritmo)

- Criar `tests/corpus/` com **≥ 20 modelos** de licença livre (ex.: subconjunto do Thingi10K filtrado por licença, figuras CC0/CC-BY, além de modelos próprios do dono). Incluir obrigatoriamente:
  - figura com **cabelo volumoso** e pescoço curto;
  - **braço encostado** no tronco (gap 0–2 mm) e braço que forma **alça** (mão na cintura);
  - braço **dobrado**, mão segurando objeto;
  - capa/roupa que cobre a articulação;
  - **personagem vestido** (camiseta + calça + sapato + cinto) e figura com **jaqueta aberta** sobre camiseta;
  - **cabelo** curto, longo (cobrindo pescoço/ombros), rabo de cavalo e franja; chapéu/capacete;
  - **mão aberta e mão fechada segurando arma/objeto** (separar mão do antebraço e objeto da mão);
  - animal (quatro patas, cauda, orelhas), dragão com asas;
  - **scan ruidoso** (> 1 M triângulos) e malha CAD de triângulos longos;
  - malhas quebradas (furos, normais invertidas, cascas sobrepostas, autointerseção).
- Para cada modelo, um `*.expect.json` com: partes a separar, semente(s) de clique, e o laço esperado (pontos 3D) com tolerância.
- Métricas no `npm run bench`: taxa de acerto top-1/top-3, distância média do laço ao esperado, tempo, e "peça B contém só a parte pedida" (IoU de faces vs. rótulo).
- Arquivos grandes via Git LFS ou baixados por script (não versionar binários pesados no repo).

---

## 7. Plano de execução multiagente

Usar os subagentes já existentes em `.claude/agents/` e criar dois novos: **`segmentacao`** e **`diagnostico-malha`**. Cada fase só avança quando os critérios passam. Fases marcadas com ∥ rodam em paralelo (worktrees separadas).

### Agentes
| Agente | Responsabilidade neste plano |
|---|---|
| `orquestrador` | Quebra as fases em tarefas, distribui, integra, garante os critérios de aceite. |
| `arquiteto` | ADR 0008 (SmartCut v2: segmentação + min-cut + cut-region) e ADR 0009 (Raio-X e reparo não destrutivo). Define contratos em `types.ts` (`cut-region`, `repair`, `InspectionReport`, `PartMap`). |
| `qa` | Monta o corpus (fase 1), golden tests, testes de propriedade (fast-check), bench e e2e. Roda tudo em cada PR. |
| `geometria` | Correções do corte por plano, `regionCut`, tampas curvas, encaixes em junta curva. |
| `segmentacao` *(novo)* | Proxy + BVH, SDF por face, sobre-segmentação, fusão hierárquica, min-cut do laço. |
| `diagnostico-malha` *(novo)* | Todas as verificações da seção 4.2, reparos, fallback volumétrico. |
| `viewport-3d` | Hover de partes, heatmap do Raio-X, preview das duas peças, edição do laço na superfície. |
| `ui-ux` | Painel Raio-X, inspector do SmartCut v2, mensagens de erro acionáveis (pt-BR). |
| `conectores` | Pinos/chavetas em junta curva; falha de encaixe não derruba o corte. |
| `io-export` | Importação sem reparo silencioso, guardar malha bruta, formatos PLY/GLB. |
| `revisor` | Revisão de cada PR: vazamento de memória WASM (`.delete()`), desempenho, regras do `CLAUDE.md`. |

### Fases
**Fase A — Base de medição (qa + arquiteto)**
- Corpus real + `expect.json` + métricas no bench. Rodar o SmartCut atual e registrar a linha de base (taxa de acerto, falhas de corte).
- ADRs 0008 e 0009 + contratos de tipos.
- ✅ Aceite: relatório de linha de base comitado em `docs/baseline-smartcut.md`.

**Fase B — Consertos rápidos do corte ∥ (geometria + ui-ux + conectores)**
- C1–C6: pré-validação ao vivo, seleção de ilhas por semente/clique, erros acionáveis, encaixe falhando sem derrubar o corte, limitado + perfil, traço com perspectiva.
- ✅ Aceite: nenhum corte do corpus "some" sem explicação; testes de regressão para cada bug.

**Fase C — Raio-X da malha ∥ (diagnostico-malha + io-export + ui-ux + viewport-3d)**
- Seção 4 completa, operação `repair` no histórico, heatmap, fallback volumétrico.
- ✅ Aceite: todas as malhas quebradas do corpus importam; relatório correto (testes com malhas sintéticas quebradas de propósito).

**Fase D — Segmentação (segmentacao + qa)**
- Proxy + BVH, SDF por face, mapa de partes hierárquico em background após importar.
- ✅ Aceite: IoU ≥ 0,85 entre partes detectadas e rótulos do corpus; < 5 s para 500 k triângulos.

**Fase D2 — Roupa e cabelo ∥ com D (segmentacao + qa)**
- Linhas de feição (vincos/degraus → laços de barra e linha do cabelo) e segmentação visual multivista com modelo leve em ONNX; fusão por graph-cut (seção 3.3B).
- ✅ Aceite: IoU ≥ 0,85 em cabelo/camiseta/calça/sapato do corpus; modelo carrega e roda offline após o 1º uso.

**Fase E — SmartCut v2 (segmentacao + geometria + viewport-3d + ui-ux)**
- Hover/clique de partes, sementes positivas/negativas, min-cut do laço, `cut-region` (plano/curvo/região/**casca**/**roupa**), top-3 candidatos, cortes múltiplos em lote.
- ✅ Aceite: critérios 1–5 da seção 2 no corpus completo, incluindo cortar cabelo como casca com rebaixo e separar camiseta da calça na cintura.

**Fase F — Encaixes e numeração em junta curva (conectores + geometria)**
- ✅ Aceite: cabeça e braços do corpus saem com pino + numeração, montagem simulada sem colisão.

**Fase G — Polimento e regressão (qa + revisor + ui-ux)**
- e2e do fluxo completo: importar figura → Raio-X → reparar → clicar cabeça → cortar → encaixe → exportar 3MF.
- Atualizar `CLAUDE.md`, `docs/SPEC.md` e o README.

---

## 8. Regras para os agentes
- Seguir `CLAUDE.md` (TypeScript strict, geometria só no worker, manifold para booleanos, toda mudança de estado via Command, textos da UI em pt-BR).
- **Nenhuma alteração no SmartCut é aceita sem rodar o corpus** e mostrar a métrica antes/depois no PR.
- Todo `Manifold`/`CrossSection` temporário recebe `.delete()`; o revisor verifica.
- Não quebrar projetos `.mobios` antigos: as operações `cut-plane` continuam funcionando; `cut-region` é nova.
- Ao final de cada fase, o agente reporta: o que fez, testes adicionados, números de desempenho e de acerto.

---

## 9. Prompt de kickoff (colar no Claude Code, na raiz do repo)

```
Leia CLAUDE.md, docs/SPEC.md, docs/ADR/0004 e este arquivo (docs/PLANO-SMARTCUT-V2.md).
Você é o orquestrador. Objetivo principal: o corte inteligente precisa ENTENDER cada parte do STL
(mão, braço, cabeça, cabelo, camiseta, calça, sapato, acessórios) e separá-la de forma fácil e
rápida (hover + clique + Enter), funcionando em modelos reais. A importação também precisa mostrar
o Raio-X da malha com opções de reparo.
1. Crie os subagentes `segmentacao` e `diagnostico-malha` em .claude/agents/ seguindo o padrão dos existentes.
2. Execute as fases A→G da seção 7, nesta ordem, paralelizando B e C, e D e D2, em worktrees separadas.
3. Não avance de fase sem cumprir o critério de aceite; mostre as métricas do corpus a cada fase.
4. Comece pela Fase A: monte o corpus real e meça a linha de base do SmartCut atual.
```
