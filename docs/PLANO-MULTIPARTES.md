# Plano — Segmentação automática em objeto multipartes

> Status: **Etapas 0 e 1 concluídas** (ADR 0010, resultados em `docs/baseline-partes.md`). Próxima: Etapa 2 (cortar por parte). Decisões que mudam a stack (modelos de ML no navegador) precisam de aprovação e ADR antes de entrar (SPEC §4).

## 1. O que é "objeto multipartes" nos slicers

No Bambu Studio e no OrcaSlicer (fork do Bambu), um **objeto** é uma coisa só na mesa: move, gira e escala junto. Ele pode ter várias **partes** (volumes), cada uma com seu filamento e suas configurações. As partes ficam na posição original e se encostam: é assim que uma figura sai colorida sem pintar triângulo por triângulo.

Hierarquia: **placa → objeto → partes**. Cada parte tem um tipo: `normal_part` (geometria impressa), `modifier_part`, `negative_part`, `support_blocker` ou `support_enforcer`. Para nós só interessa `normal_part`.

Estrutura no 3MF do Bambu/Orca:

| Arquivo | Conteúdo |
|---|---|
| `3D/3dmodel.model` | O objeto montado: `<object>` com `<components>`. Cada `<component objectid=… p:path="/3D/Objects/object_N.model" transform=…>` aponta para a malha de uma parte. Usa a extensão *Production* (ids globais no pacote). |
| `3D/Objects/object_N.model` | As malhas das partes. |
| `3D/_rels/3dmodel.model.rels` | Precisa listar cada `Objects/object_N.model`. |
| `Metadata/model_settings.config` | `<object id>` com `<metadata key="name">` e, para cada parte, `<part id subtype="normal_part">` com `name`, `matrix`, `extruder` (filamento), `source_*` e `<mesh_stat>`. Também tem os blocos `<plate>` e `<assemble>`. |

O importador do Bambu também aceita o formato antigo do PrusaSlicer: **uma malha só**, com faixas de triângulos por volume (`firstid`/`lastid`). Ele serve de reserva para outros slicers.

**Onde o Mobios está hoje:** [src/io/threemf.ts](../src/io/threemf.ts) exporta **um objeto por peça**, cada um com `model_settings.config` e `extruder`. Isso põe peças separadas na mesa. Ainda falta o modo **um objeto com N partes montadas**.

> Antes de fechar o writer, validar contra um 3MF multipartes de verdade exportado pelo Bambu Studio e pelo Orca (fixture em `tests/fixtures/`). O esquema do `model_settings.config` não tem documentação oficial: a fonte é `src/libslic3r/Format/bbs_3mf.cpp`.

## 2. Dois conceitos que precisam ficar separados

| Conceito | O que é | Saída |
|---|---|---|
| **Segmento** (parte semântica) | Região da superfície com nome e cor ("Chapéu", "Mão esquerda") | Volume dentro do objeto multipartes, com filamento próprio |
| **Ação física** | Para cada segmento: **manter junto** ou **cortar** | Peça física separada, com encaixe do SmartCut, e STL próprio |

Um segmento "manter junto" ainda vira volume separado no 3MF (para trocar a cor), mas continua colado na peça principal. Um segmento "cortar" vira uma operação `cut-region` no histórico, com conectores. Mesclar ("olhos" + "rosto") é editar o mapa de segmentos. Tudo isso passa por Commands (desfazer/refazer).

## 3. Abordagens para a segmentação semântica

### A. Geometria pura (curvatura, espessura, convexidade, min-cut)
- **Como:** sinais da malha decidem as fronteiras.
  - vincos côncavos ("regra dos mínimos");
  - **espessura local** (bola inscrita, via transformada de distância);
  - cortes curtos e convexidade aproximada.
  - Depois: corte de grafo multi-rótulo e fusão hierárquica de regiões.
- **Prós:** offline, rápido (< 1 s num proxy de 50k faces), determinístico, sem dependência nova. Funciona em STL cinza.
- **Contras:** não sabe **nomes**. Não acha fronteiras que não existem na geometria: camiseta × calça lisas, olhos pintados planos, cabelo fundido ao rosto sem vinco. Também tem ambiguidades semânticas: a aba do chapéu "pertence" à cúpula ou à cabeça?
- **Evidência no boneco de teste (lab):**
  - Só vincos (limiar fixo) vaza: braço com a mão na cintura, pernas e quadril saem juntos. A aba fica junto da cabeça, porque a junção é arredondada (filete).
  - Espessura local separa bem cúpula+faixa, aba, cabeça, braços, mãos, bengala, pernas e sapatos (cúpula/cabeça ≈ 40 mm, tronco ≈ 18, pernas ≈ 10, braço ≈ 7, mão/aba ≈ 5, bengala ≈ 2,5). Depois disso faltam: suavizar com corte de grafo (feito: expansão-α, ~2,8 s), fundir detalhes em relevo (grades e botões do rosto) e decidir partes ambíguas.
  - O SmartCut v2 atual, nas mesmas sondas: chapéu, rosto e tronco saem como "Braço/Perna" com 1–5% da área. Não serve de base para isto.

### B. Multivista 2D + modelo de segmentação projetado na malha
- **Como:**
  1. Renderizar 12–24 vistas (sombreamento + buffer de id de face).
  2. Rodar um segmentador 2D zero-shot (SAM 2, EfficientSAM/SlimSAM) em cada vista.
  3. Levar cada máscara para as faces visíveis.
  4. Fundir máscaras entre vistas por sobreposição de faces (grafo + detecção de comunidades, como no SAMesh).
  5. Fechar com corte de grafo na malha.
- **Prós:** as fronteiras batem com a percepção humana (cabelo × rosto, roupa × pele, mesmo com sinal geométrico fraco). Funciona com detalhes de escultura.
- **Contras:**
  - Modelos de 40–150 MB e inferência pesada: com WebGPU, ~0,2–1 s por vista; com WASM, bem mais lento.
  - Áreas ocultas (axila, sob a aba) dependem de vistas extras ou da geometria.
  - Render cinza dá menos contraste que textura.
  - O SAM não dá **nomes**: precisa de outra etapa (CLIP com vocabulário fechado, ou um modelo de visão e linguagem).
- **Viabilidade:** boa como etapa opcional, baixada sob demanda e guardada pelo service worker. **Muda a stack** (onnxruntime-web + pesos): precisa de ADR e de aprovação.

### C. Modelos 3D nativos (PartField, SAMPart3D, Point-SAM, P3-SAM…)
- **Como:** uma rede lê a malha ou a nuvem de pontos e devolve um campo de partes hierárquico.
- **Prós:** melhor consistência 3D e hierarquia natural (parte → subparte).
- **Contras:** PyTorch e GPU num servidor. Sem offline, com custo de infraestrutura e privacidade (o modelo do usuário sai da máquina). Licenças variadas: verificar cada uma, algumas são não comerciais.
- **Viabilidade:** só se o Mobios ganhar um backend. Fica como pesquisa futura.

### Nomes (vale para A e B)
- **Heurística local:** posição na figura (alto/baixo, esquerda/direita da figura), forma (fina e longa = bengala/braço) e vizinhança. O `guessName` já faz uma versão disso. Grátis, mas erra em acessórios.
- **CLIP local** com vocabulário fixo (chapéu, cabelo, rosto, olho, tronco, camiseta, calça, braço, mão, sapato, base, acessório) sobre recortes renderizados de cada segmento.
- **Modelo de visão e linguagem na nuvem** (opcional, com consentimento explícito): manda as vistas com os segmentos numerados e recebe os nomes. É o melhor resultado, mas envia o modelo para fora.

## 4. Recomendação

**Híbrido em camadas, com a geometria como espinha dorsal.**

1. **MVP só geométrico:** espessura local + vincos em escala + corte de grafo + fusão hierárquica. Já dá chapéu, cabeça, tronco, braços, mãos, pernas, sapatos, bengala e base, que são as **peças físicas** que a pessoa quer cortar. Nomes por heurística, editáveis. Sem dependência nova.
2. **Camada visual (fase 2, opcional):** SAM multivista em WebGPU para fronteiras sem sinal geométrico (cabelo × rosto, camiseta × calça, olhos). A saída entra como **evidência** no mesmo corte de grafo, não como resultado final.
3. **Nomes melhores (fase 3, opcional):** CLIP local, ou um modelo de visão e linguagem com opt-in.

A pintura manual fica só como pincel de correção sobre o mapa. O pincel mexe nos rótulos, e o refinamento de fronteira (§6) recalcula só a vizinhança.

## 5. Arquitetura no Mobios

```
importar → Raio-X/reparo → proxy (≈60k faces) ─┐
                                               ├─ PartMap (worker de geometria)
    [fase 2] render multivista → SAM (worker ML) ┘     │
                                                       ▼
                    árvore de segmentos (store, Commands) ⇄ UI: lista/árvore, cores, hover, pincel
                                                       │
                ┌──────────────────────────────────────┴───────────────────────┐
         "manter junto": volumes que se encostam                  "cortar": op cut-region por segmento
         (divisão por fronteira, sem encaixe)                     + conectores (SmartCut / connectors.ts)
                └──────────────────────────────┬───────────────────────────────┘
                                 3MF multipartes (1 objeto, N partes, extruder por parte)
                                 + STL por peça física
```

- **`src/geometry/segment/parts.ts`** (implementado na Etapa 1, ver ADR 0010):
  - grade sólida;
  - transformada de distância exata e espessura local;
  - concavidade em escala;
  - classes de espessura por expansão-α.
  - **Falta:** fusão hierárquica (detalhe em relevo → pai), regra para placas ensanduichadas (aba) e transferência proxy → malha completa.
- **Documento:** cada peça ganha `partMap?: { proxyKey; labels (Uint16, comprimido com fflate); segments: { id, name, color, slot, action: 'keep' | 'cut', parent? }[] }`, guardado no IndexedDB. Editar (mesclar, renomear, mudar ação, pincelar) é Command. Os rótulos vão comprimidos e não são recalculados no histórico, para não depender de determinismo numérico entre versões.
- **Operações:**
  - `cut-region` ganha o modo `segment`: as entradas são o id do segmento e um hash do mapa, não bolas e nível.
  - Nova op de exportação **sem corte físico**: `split-volumes`, que divide a peça em volumes encostados para o 3MF.
- **Workers:** o mapa de partes roda no worker de geometria atual (Comlink). A fase 2 usa um **worker de ML separado** (onnxruntime-web/WebGPU), carregado só quando a pessoa ativa a função.
- **Agentes (.claude/agents):**

| Agente | Responsabilidade |
|---|---|
| `arquiteto` | ADR 0010 (mapa de partes + objeto multipartes) e ADR 0011 (ML no navegador, se aprovado) |
| `diagnostico-malha` | Reparo antes de segmentar (não-manifold, cascas internas, autointerseções) e geração do proxy |
| `segmentacao` | PartMap: espessura, vincos, corte de grafo, fusão, nomes heurísticos, refinamento de fronteira; fase 2: fusão das máscaras do SAM |
| `geometria` | Divisão em volumes encostados (tampas coincidentes), op `cut-region` modo `segment`, validação de volume/manifold |
| `conectores` | Encaixes nas fronteiras dos segmentos "cortar"; regra para partes finas (aba, bengala): sem pino → cola/chaveta |
| `io-export` | Writer/reader do 3MF multipartes (components + `model_settings.config`), ida e volta, fixtures reais do Bambu/Orca |
| `viewport-3d` | Cor por segmento (atributo de cor por face), hover/toque com destaque, pincel de correção |
| `ui-ux` | Árvore de partes: renomear, mesclar, manter/cortar, slot de filamento |
| `qa` | Corpus de figuras reais (fora do git), métricas por parte, testes de regressão sintéticos no CI |
| `revisor` / `orquestrador` | Revisão e sequência das etapas |

## 6. Refinamento da fronteira (cortes limpos)

1. **Proxy → malha completa:** cada face recebe o rótulo da face mais próxima do proxy (BVH). Rótulos isolados são corrigidos por maioria dos vizinhos.
2. **Ajuste por corte de grafo numa faixa** em volta de cada fronteira:
   - termo de dado: probabilidade do segmento, mais o voto do SAM na fase 2;
   - termo de suavidade: barato em vinco côncavo e na transição de espessura, caro em superfície lisa.
   - Usa o `FlowGraph`/min-cut que já existe. A fronteira "gruda" no vinco real.
3. **Curva sem serrilhado:**
   - suavizar o indicador de cada segmento (Laplaciano limitado à faixa);
   - **cortar os triângulos pela isolinha 0.5** (dividir arestas), em vez de seguir a escadinha das arestas.
   - Assim a junta fica lisa na impressão.
4. **Higiene topológica:** `fixPinches` (já existe) e área mínima. Cada fronteira entre dois segmentos vira laço(s) fechado(s), sem vértices de "pescoço".
5. **Fechar os volumes:**
   - laços simples usam as tampas do `regionCut` (centro plano para pinos);
   - fronteiras com vários laços ou muito curvas usam partição volumétrica pelo segmento mais próximo (`levelSet` do manifold).
   - Validação: manifold, volumes somam o original, tampa não fura a superfície. Se falhar, cai para corte plano com aviso.
6. **Pincel:** muda os rótulos e roda de novo os passos 2–5 só na região tocada.

## 7. Riscos e casos difíceis

| Caso | Tratamento |
|---|---|
| Malha não-manifold, cascas internas, autointerseção | Raio-X/reparo antes. Segmentar sempre o sólido reparado (proxy), mapear de volta. Se o arquivo vier com **cascas separadas** (subtools do ZBrush), elas já são segmentos prontos: detectar e usar primeiro. |
| Partes coladas (mão na cintura, mão na bengala, braço encostado) | A espessura separa; o contato vira um segundo laço da fronteira. Preferir o corte no pescoço (pulso) e deixar o contato com a peça maior. Mostrar aviso quando o segmento tem mais de um laço. |
| Roupa fundida ao corpo, cabelo sem vinco | Sem sinal geométrico. MVP: sugerir pela espessura/cor da vizinhança e corrigir com pincel. Fase 2: o SAM resolve a maioria. |
| Ambiguidade semântica (aba da cúpula ou da cabeça?) | Placa fina entre duas peças grossas vai para a de cima (chapéus, tampas). A árvore mostra a outra opção. |
| Relevos pequenos (botões, grades, olhos em relevo) | Fundidos no pai por "saliência" baixa (pouca protrusão em relação à espessura). Ficam como subsegmentos opcionais na árvore, para colorir sem cortar. |
| Partes finas demais para encaixe (aba, bengala, dedos) | O agente `conectores` escolhe cola/chaveta, ou bloqueia o "cortar" com explicação. |
| Esquerda/direita invertida | Detectar a frente da figura (vista do rosto/olhos, simetria) antes de nomear. |
| Malhas grandes (2M triângulos, 92 MB) | Tudo no proxy de 50–100k faces. Na malha cheia só a transferência e a faixa da fronteira. Reparo do arquivo de teste: ~15 s (otimizar à parte). |
| Compatibilidade do 3MF | Fixtures exportadas pelo Bambu e pelo Orca. Teste de ida e volta. Reserva no estilo Prusa (`firstid`/`lastid`). |
| Download e licença dos modelos (fase 2) | Sob demanda, com cache offline. Escolher só pesos com licença permissiva (o SAM 2 é Apache-2.0; conferir cada alternativa). |

## 8. Plano em etapas

**Etapa 0 — base de teste** ✅
- Corpus lab com 3–5 figuras reais (fora do git, em `.lab/`) + figuras sintéticas para o CI.
- Para cada figura, um gabarito de rótulos.
- Métrica: IoU por parte e "a parte sai inteira com 1 clique".
- Pronto quando: tabela de base em `docs/baseline-partes.md`.

**Etapa 1 — MVP do mapa de partes (geométrico)** ✅ (8/8 no boneco de teste, ~4 s)
- Fechar o `parts.ts`: fusão hierárquica, regra das placas, transferência proxy → malha completa, nomes heurísticos.
- UI: segmentos coloridos no viewer, hover destaca a parte inteira, árvore com renomear/mesclar.
- Pronto quando: no boneco, chapéu (cúpula + aba), cabeça, tronco, 2 braços com mão, 2 pernas com sapato e bengala aparecem como partes distintas, em < 3 s depois do import.

**Etapa 2 — ação "cortar" por segmento**
- `cut-region` modo `segment` + refinamento da fronteira (§6, passos 2–5) + conectores.
- Pronto quando: cortar cada parte do boneco gera peças manifold com encaixe, e os volumes somam o original.

**Etapa 3 — objeto multipartes no 3MF**
- `split-volumes` para os segmentos "manter junto". Writer com components + `model_settings.config` (uma parte por segmento, `extruder` = slot). STLs das peças físicas no ZIP.
- Pronto quando: o 3MF abre no Bambu Studio e no OrcaSlicer como **um** objeto com N partes nomeadas e coloridas, e a ida e volta preserva tudo.

**Etapa 4 — pincel de correção**
- Pincel que muda rótulos e refaz só a fronteira local.

**Etapa 5 — camada visual (precisa de aprovação + ADR)**
- SAM multivista em WebGPU como evidência extra no corte de grafo, ligado sob demanda.
- Medir o ganho no corpus (cabelo × rosto, roupa × corpo) antes de ligar por padrão.

**Etapa 6 — nomes melhores (opcional)**
- CLIP local com vocabulário fixo, ou modelo de visão e linguagem com opt-in explícito.

## Fontes
- Esquema do 3MF do Bambu: código `bambulab/BambuStudio` — `src/libslic3r/Format/bbs_3mf.cpp` (constantes `components`, `p:path`, `model_settings.config`, `part`/`subtype`, `firstid`/`lastid`).
- Notas de terceiros sobre `model_settings.config` e `Objects/object_N.model`: printago.io/blog/3mf-file-format; gist queso/b5a33103e13b0d2b35e5fbdc2101bf8f.
- Segmentação: Shapira et al. 2008 (SDF); Golovinskiy & Funkhouser 2008 (randomized cuts); Kaick et al. 2014 (WCSeg); Hildebrand & Rüegsegger 1997 (espessura local); SAMesh / "Segment Any Mesh" (2024); PartField (NVIDIA, 2025); SAMPart3D (2024).
