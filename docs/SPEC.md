# Projeto **Mobios** — Cortes inteligentes e encaixes para impressão 3D

> Documento de especificação para construir a aplicação com um **time de agentes de IA** (Claude Code + subagentes).
> Nome do produto: **Mobios** (o nome provisório era "Fenda Studio").
> Referência estudada: **Nativos Studio Pro** (page.nativos3d.com), ferramenta "Intelligent Multi-Part Cuts" / "Mesh Cut — SmartCut".

---

## 0. Como usar este documento

1. Coloque este arquivo na raiz do repositório como `docs/SPEC.md` e copie a seção **12 (CLAUDE.md)** para `CLAUDE.md`.
2. Crie os subagentes da seção **9** em `.claude/agents/*.md`.
3. Rode o prompt de kickoff da seção **13** no Claude Code. O orquestrador executa fase por fase (seção 10) e só avança quando os critérios de aceite passam.

---

## 1. O que a referência faz (engenharia reversa)

O Nativos Studio Pro é uma plataforma web (roda no navegador, sem instalação) com duas ferramentas: um modelador paramétrico de cúpulas/luminárias/vasos e a ferramenta de **cortes multipartes**. O que ele promete na parte de cortes:

| Recurso da referência | O que entendemos que faz |
|---|---|
| Seleção de região + corte | Usuário seleciona uma região do modelo e ajusta o corte; trabalha cada parte separadamente |
| Cortes profundos ("deep cuts") | Corte que atravessa a peça inteira / segue a região selecionada, não só um plano raso |
| Corte "mais natural" (do vídeo) | Corte que segue a forma da peça (ex.: separar braço no ombro) em vez de um plano reto que atravessa tudo |
| Conectores gerados automaticamente | Pinos/encaixes criados na face de corte |
| Simulação de montagem | Pré-visualiza o encaixe e checa a conexão entre as partes |
| Pintura por parte | Organiza cores por parte para multicolor (AMS / BMCU) |
| Exportação simultânea | Exporta todas as partes de uma vez; formatos STL, 3MF, OBJ (e STEP, GLB, USDZ no modelador) |
| Preview em tempo real | Viewport 3D interativo no navegador |

**Limitações observadas / oportunidades para sermos melhores:**
- Foco em FDM multicolor; nada específico para **resina** (oco, furos de drenagem, encaixes com tolerância de resina).
- Conectores aparentemente de poucos tipos; sem **chaveta anti-rotação**, rabo-de-andorinha, ímã, rosca, encaixe "puzzle" no perfil do corte.
- Não há menção a **corte automático para caber na mesa** da impressora.
- Não há menção a **numeração gravada** nas faces de corte, guia de montagem, nem análise de imprimibilidade (balanço, área de colagem, espessura mínima).

> Obs.: o reel do Instagram não pôde ser assistido automaticamente. Antes da Fase 1, assistir o vídeo e anotar na seção 1 qualquer detalhe de interação (gestos, atalhos, animações) que não esteja aqui.

---

## 2. Visão do produto

**Uma frase:** cortar qualquer modelo 3D em partes imprimíveis com cortes que seguem a anatomia da peça, gerar encaixes que realmente encaixam na primeira impressão, e exportar tudo pronto para Bambu Studio e Chitubox — num app bonito, rápido e gostoso de usar.

**Público:** makers, lojas de impressão 3D, quem imprime colecionáveis grandes em partes (resina e FDM).

**Princípios:**
1. **Nada destrutivo** — todo corte é uma operação na pilha de histórico; dá para editar o plano de um corte antigo e tudo recalcula.
2. **Preview antes de confirmar** — o corte aparece ao vivo (fantasma) enquanto o usuário arrasta.
3. **Malha sempre válida** — toda parte exportada é fechada (watertight/manifold).
4. **Fluidez** — 60 fps no viewport, corte de 500 mil triângulos em < 500 ms.

---

## 3. Funcionalidades

Legenda: **[MVP]** primeira versão utilizável · **[v1]** paridade + diferenciais · **[v2]** ainda melhor

### 3.1 Importação
- [MVP] STL (binário/ASCII), OBJ, 3MF (incluindo multi-objeto).
- [v1] PLY, GLB/GLTF; arrastar e soltar; abrir vários arquivos.
- [MVP] **Reparo automático** na importação: fechar buracos, remover faces degeneradas, unir vértices, corrigir normais (avisar o usuário do que foi corrigido).
- [v1] Detectar unidade (mm/pol) e escala suspeita.

### 3.2 Tipos de corte
- [MVP] **Corte por plano** com gizmo (mover/rotacionar), snap a eixos, posição numérica.
- [MVP] **Corte por plano limitado** (só separa a "ilha" que o plano atravessa dentro de um raio/caixa) — essencial para separar um braço sem cortar o tronco.
- [v1] **Corte natural (SmartCut)**: o usuário clica/pincela numa região (ex.: braço) e o app sugere a melhor linha de separação seguindo **concavidades** (articulações, pescoço, cintura). Implementação: segmentação por *Shape Diameter Function* + concavidade, com o laço de corte ajustado como curva fechada mínima na superfície; a superfície de corte é gerada entre o laço e o interior.
- [v1] **Corte por curva/superfície livre**: o usuário desenha um traço na tela; o traço é extrudado em profundidade formando uma superfície curva (spline) de corte.
- [v1] **Corte em degrau / zigue-zague / ondulado** (perfil não plano) para esconder a junta e travar rotação.
- [v1] **Seleção por pincel** (tinta sobre a malha) para definir "esta região vira uma parte".
- [v2] **Auto-split para caber na mesa**: escolhe a impressora (Bambu A1 256³, A1 mini 180³, ELEGOO Mars 5 Ultra, perfil customizado) e o app propõe o menor número de cortes que fazem tudo caber, priorizando cortes em regiões escondidas/côncavas.
- [v2] **Sugestão de cortes por IA** (opcional, via Claude API com imagem do viewport): "onde cortar para minimizar suportes e esconder emendas".

### 3.3 Conectores / encaixes
Parâmetros comuns: tamanho, profundidade, **folga (tolerância)**, chanfro de entrada, quantidade, posição (auto ou manual arrastando na face).

| Tipo | Uso | Fase |
|---|---|---|
| Pino cilíndrico (macho/fêmea) | Geral | MVP |
| Pino solto (dois furos + pino impresso à parte) | Peças finas | MVP |
| Pino quadrado/hexagonal (anti-rotação) | Encaixe que não gira | v1 |
| Chaveta (key) assimétrica | Garante orientação única | v1 |
| Rabo-de-andorinha (dovetail) | Encaixe deslizante, cenários/bases | v1 |
| Snap-fit (clip) | Montagem sem cola | v2 |
| Furo para ímã (diâmetro × altura do ímã) | Partes removíveis | v1 |
| Rosca (macho/fêmea) | Partes que desrosqueiam | v2 |
| Perfil "puzzle" na própria face | Junta autoalinhante | v2 |

- [MVP] **Presets de tolerância por tecnologia**: FDM (folga padrão 0,2–0,3 mm), Resina (0,1–0,15 mm), editáveis pelo usuário.
- [v1] **Posicionamento automático inteligente**: maior círculo inscrito na face de corte (polo de inacessibilidade), respeitando espessura mínima de parede ao redor; vários pinos quando a face é grande/alongada.
- [v1] **Validação**: avisa se o conector fura a parede externa, fica perto da borda ou colide com outro corte.
- [v1] **Peça de calibração**: gera um mini-teste com 5 folgas diferentes para o usuário imprimir e escolher a sua.

### 3.4 Simulação de montagem
- [MVP] **Vista explodida** com slider (0 → 100%).
- [v1] **Animação de montagem** passo a passo (ordem sugerida), checando colisão de conectores durante a inserção.
- [v1] Indicador visual de folga (heatmap na face do conector).

### 3.5 Pintura por parte / multicolor
- [v1] Atribuir cor/filamento por parte; paleta com os slots do AMS (4) / AMS lite / BMCU.
- [v2] Pintura por pincel dentro da parte (gera sub-partes por cor).
- [v1] Export 3MF com **um objeto por parte e cada um no seu slot de filamento**, abrindo direto no Bambu Studio já colorido.

### 3.6 Preparação para impressão (diferencial)
- [v1] **Numeração gravada** na face de corte (ex.: "A1" ↔ "A1"), em baixo relevo, para não errar a montagem.
- [v1] **Análise de imprimibilidade** por parte: área de contato da face de corte, balanços, espessura mínima, volume, estimativa de material.
- [v1] **Orientação sugerida** por parte (face de corte para baixo quando possível = menos suporte).
- [v2] **Resina**: oco com espessura configurável + furos de drenagem automáticos em pontos baixos; aviso de ventosa (cupping).
- [v2] **Layout na mesa** (arranjar as partes no volume da impressora antes de exportar).

### 3.7 Exportação
- [MVP] Exportar todas as partes: STL individuais em ZIP; 3MF multi-objeto.
- [v1] OBJ, GLB; nomes de arquivo com o número da parte.
- [v1] **PDF/HTML de guia de montagem** com imagens de cada passo.
- [v2] STEP (via OpenCascade WASM) para partes simples.

### 3.8 Projeto e produtividade
- [MVP] Undo/redo ilimitado; histórico de operações editável (editar um corte antigo recalcula os seguintes).
- [MVP] Salvar projeto localmente (IndexedDB) e exportar `.mobios` (JSON + malhas).
- [v1] Árvore de partes (outliner): renomear, ocultar, isolar, travar, mesclar duas partes.
- [v1] Atalhos de teclado completos + paleta de comandos (Ctrl+K).
- [v2] Biblioteca de presets de conectores do usuário.

---

## 4. Arquitetura técnica

```
┌──────────────────────── UI (React + TS) ────────────────────────┐
│  Toolbar · Viewport (R3F) · Inspector · Outliner · Histórico     │
└───────────────┬───────────────────────────────┬─────────────────┘
                │ comandos                      │ estado
        ┌───────▼────────┐              ┌───────▼────────┐
        │ Command Bus    │──────────────│ Store (Zustand)│
        │ (undo/redo)    │              │ projeto/partes │
        └───────┬────────┘              └────────────────┘
                │ jobs (transferable buffers)
     ┌──────────▼───────────────────────────────────────┐
     │ Geometry Worker(s) — Web Worker + Comlink         │
     │  manifold-3d (WASM): booleanos, corte, reparo     │
     │  three-mesh-bvh: raycast, seleção, distância      │
     │  módulos: cut/, connectors/, analysis/, segment/  │
     └──────────┬───────────────────────────────────────┘
                │
     ┌──────────▼──────────┐
     │ IO: STL/OBJ/3MF/GLB │  (3MF com metadados Bambu Studio)
     └─────────────────────┘
```

**Stack:**
- **Vite + React 19 + TypeScript (strict)**.
- **three.js + @react-three/fiber + @react-three/drei** para o viewport (gizmos, câmera, ambiente).
- **manifold-3d (WASM)** como motor geométrico: booleanos robustos que sempre devolvem malhas fechadas — é o coração do corte e dos conectores.
- **three-mesh-bvh** para raycast rápido, pincel de seleção e medição.
- **Web Workers + Comlink**: nenhuma operação geométrica na thread da UI.
- **Zustand** (estado) + **padrão Command** (undo/redo e histórico editável).
- **IndexedDB (idb)** para projetos; **fflate** para ZIP/3MF.
- **Tailwind CSS + Radix UI** (acessibilidade) + **Framer Motion** (microanimações).
- **Vitest** (unidade), **Playwright** (E2E + screenshots), **fast-check** (testes de propriedade em geometria).
- Opcional v2: **Tauri** para versão desktop; **Claude API** para sugestões de corte.

**Algoritmos-chave (resumo para os agentes):**
- *Corte por plano:* `Manifold.splitByPlane` → duas partes fechadas; corte limitado = interseção com caixa/esfera de influência antes do split.
- *Corte por superfície:* gerar sólido "lâmina" a partir da superfície (extrusão fina ou meio-espaço curvo) e fazer `difference`/`intersect`.
- *SmartCut:* (1) SDF por face via raycast interno; (2) agrupamento em regiões; (3) entre a região selecionada e o resto, achar o laço de menor perímetro nas zonas côncavas (caminho mínimo no grafo de arestas ponderado por curvatura); (4) ajustar superfície mínima que fecha o laço.
- *Conectores:* gerar primitivo (cilindro/prisma/dovetail) → `union` na parte macho e `difference` (primitivo + folga) na fêmea; chanfro na ponta.
- *Posicionamento auto:* rasterizar a seção de corte em 2D → transformada de distância → máximos locais = centros dos pinos.

**Orçamentos de desempenho:** viewport 60 fps com 2M triângulos; corte de 500k tri < 500 ms; import de STL de 100 MB < 3 s; app inicial < 300 KB gzip (WASM carregado sob demanda).

---

## 5. Design e experiência (visual bonito, funcional e fluido)

**Direção visual:** "oficina de precisão" — escuro por padrão, superfícies em grafite, um único acento vibrante (ex.: laranja-laser `#FF6B2C`) para ações e o plano de corte, tipografia **Inter** (UI) + **JetBrains Mono** (números/medidas). Tema claro disponível.

**Layout:**
```
┌───────────────────────────────────────────────────────────────┐
│ ◆ Mobios  Projeto: Dragão.mobios       [Desfazer][Refazer] [Exportar] │
├────┬──────────────────────────────────────────────┬───────────┤
│ 🔪 │                                              │ INSPECTOR │
│ ✋ │                VIEWPORT 3D                   │ Corte     │
│ 🖌 │      (gizmo do plano, preview fantasma)      │ Posição   │
│ 📌 │                                              │ Conector  │
│ 🎨 │                                              │ Folga     │
│ 💥 │  [ slider vista explodida ]                  │           │
├────┴───────────────┬──────────────────────────────┴───────────┤
│ PARTES (outliner)  │ HISTÓRICO (linha do tempo editável)       │
└────────────────────┴──────────────────────────────────────────┘
```

**Regras de fluidez:**
- Toda ação mostra preview ao vivo; confirmar com **Enter**, cancelar com **Esc**.
- Operações > 150 ms mostram progresso no próprio objeto (shimmer na malha), nunca um modal bloqueante.
- Transições de câmera suaves (foco na parte com duplo clique), partes destacadas com contorno ao passar o mouse.
- Cores de parte automáticas, distintas e harmônicas.
- Estados vazios com instrução clara ("Arraste um STL aqui ou abra um exemplo").
- Onboarding de 4 passos com um modelo de exemplo (importar → cortar → conector → exportar).
- Acessibilidade: contraste AA, tudo navegável por teclado, tooltips com atalho.

**Atalhos base:** `C` corte por plano · `S` SmartCut · `B` pincel · `P` conector · `E` vista explodida · `F` focar · `H` ocultar · `Ctrl+Z/Y` · `Ctrl+K` paleta de comandos.

---

## 6. Modelo de dados

```ts
type PartId = string;

interface Project {
  id: string; name: string; units: 'mm';
  printerProfile: PrinterProfile;     // volume da mesa, tecnologia FDM|RESINA
  sourceMeshes: MeshRef[];            // malhas originais (imutáveis)
  operations: Operation[];            // histórico editável e reexecutável
  parts: Record<PartId, Part>;        // resultado materializado (cache)
}

type Operation =
  | { kind: 'cut-plane'; target: PartId; plane: Plane; bounded?: Bounds; profile?: CutProfile }
  | { kind: 'cut-surface'; target: PartId; surface: SplineSurface }
  | { kind: 'smart-cut'; target: PartId; seedFaces: number[]; loop?: Vec3[] }
  | { kind: 'connector'; joint: JointId; type: ConnectorType; params: ConnectorParams }
  | { kind: 'paint'; part: PartId; filamentSlot: number; color: string }
  | { kind: 'label'; joint: JointId; text: string };

interface Part { id: PartId; name: string; meshRef: MeshRef; color: string;
  filamentSlot?: number; visible: boolean; locked: boolean; joints: JointId[] }

interface Joint { id: JointId; a: PartId; b: PartId; cutFace: Polygon3D[] }
```

---

## 7. Estrutura do repositório

```
mobios/
├─ CLAUDE.md
├─ docs/SPEC.md            (este arquivo)  docs/ADR/  docs/design/
├─ .claude/agents/         (definições dos subagentes)
├─ src/
│  ├─ app/                 (shell, rotas, providers)
│  ├─ ui/                  (design system: tokens, componentes)
│  ├─ features/
│  │  ├─ viewport/  cut/  smartcut/  connectors/  paint/
│  │  ├─ assembly/  analysis/  history/  export/  import/
│  ├─ geometry/            (worker: manifold, bvh, algoritmos puros)
│  ├─ io/                  (stl, obj, 3mf, glb, zip)
│  ├─ store/               (zustand + commands)
│  └─ lib/
├─ tests/
│  ├─ fixtures/            (malhas de teste: cubo, toro, figura humanoide, malha quebrada)
│  ├─ unit/  property/  e2e/  visual/
└─ public/examples/
```

---

## 8. Qualidade e testes

- **Invariantes de geometria (testes de propriedade):** toda parte resultante é manifold; soma dos volumes das partes ≈ volume original (± volume dos conectores); nenhuma parte com volume ~0.
- **Golden tests:** cortes em fixtures conhecidos comparados por volume, número de componentes e bounding box.
- **E2E (Playwright):** fluxo importar → cortar → conector → exportar; screenshot do viewport comparado visualmente.
- **Performance:** benchmark automático (malha de 500k tri) que falha o CI se passar do orçamento.
- **Teste físico (humano):** imprimir a peça de calibração de folga na Bambu A1 e na Mars 5 Ultra antes de fechar os presets.

---

## 9. Time de agentes

Cada agente tem dono de pastas, entradas, saídas e "pronto quando". Nenhum agente edita pastas de outro sem passar pelo orquestrador.

| Agente | Responsabilidade | Dono de |
|---|---|---|
| **orquestrador** | Lê a SPEC, quebra a fase em tarefas, delega, integra, roda os testes e decide se a fase passou | `docs/`, `CLAUDE.md` |
| **arquiteto** | Decisões técnicas (ADRs), contratos entre módulos, tipos compartilhados | `src/store/`, tipos, `docs/ADR/` |
| **geometria** | Motor de corte, SmartCut, reparo, análise; funções puras e testadas | `src/geometry/`, `features/cut`, `features/smartcut`, `features/analysis` |
| **conectores** | Todos os tipos de encaixe, tolerâncias, posicionamento automático, validação, peça de calibração | `features/connectors/` |
| **viewport-3d** | Cena R3F, gizmos, preview fantasma, seleção/pincel, vista explodida, desempenho de render | `features/viewport/`, `features/assembly/` |
| **ui-ux** | Design system, layout, inspector, outliner, onboarding, microanimações, acessibilidade | `src/ui/`, `src/app/` |
| **io-export** | Importadores/exportadores, 3MF com slots Bambu, ZIP, guia de montagem | `src/io/`, `features/export`, `features/import` |
| **qa** | Fixtures, testes de propriedade, E2E, benchmarks; revisa PRs dos outros | `tests/` |
| **revisor** | Revisão de código independente no fim de cada fase (não escreve código de feature) | — |

### Exemplo de definição (`.claude/agents/geometria.md`)
```markdown
---
name: geometria
description: Especialista em geometria computacional. Use para cortes, SmartCut, booleanos, reparo de malha e análise de imprimibilidade.
tools: Read, Edit, Write, Bash, Grep, Glob
---
Você implementa algoritmos geométricos em TypeScript dentro de src/geometry e das features de corte.
Regras:
- Use manifold-3d para todo booleano; nunca devolva malha não-manifold.
- Funções puras, sem dependência de React; rodam no Web Worker.
- Todo algoritmo novo vem com teste de propriedade (fast-check) e um golden test.
- Respeite os orçamentos de desempenho da SPEC seção 4; meça com o benchmark.
- Ao terminar, reporte: o que fez, testes adicionados, números de desempenho.
```
(Os outros agentes seguem o mesmo formato, com a responsabilidade e as pastas da tabela.)

### Fluxo de trabalho por tarefa
1. Orquestrador cria a tarefa com critério de aceite.
2. Arquiteto define/atualiza contratos (tipos) se necessário.
3. Agente dono implementa + testes.
4. QA roda a suíte completa e o benchmark.
5. Revisor revisa; orquestrador integra e marca concluído.

---

## 10. Roadmap por fases

| Fase | Entrega | Critério de aceite |
|---|---|---|
| **0 — Fundação** | Repo, Vite/TS, design tokens, layout vazio, worker + manifold carregando, CI | App abre, worker responde, CI verde |
| **1 — Importar e ver** | STL/OBJ/3MF, reparo, viewport com câmera/iluminação bonitas, outliner | Abre STL de 100 MB em < 3 s, 60 fps |
| **2 — Corte por plano** | Gizmo, preview fantasma, corte limitado, histórico/undo | Partes sempre manifold; editar corte antigo recalcula |
| **3 — Conectores básicos** | Pino, pino solto, presets FDM/Resina, posição auto | Peça de calibração imprimível; conector nunca fura parede |
| **4 — Exportar** | STL ZIP, 3MF multi-objeto com slots, vista explodida | Arquivo abre no Bambu Studio com partes separadas e coloridas |
| **5 — SmartCut e cortes livres** | Pincel, SmartCut, superfície livre, perfis degrau/zigue-zague | Em 5 figuras de teste, corte sugerido nas articulações |
| **6 — Encaixes avançados** | Chaveta, dovetail, ímã, numeração gravada, animação de montagem | Montagem simulada sem colisão |
| **7 — Diferenciais** | Auto-split para a mesa, análise de imprimibilidade, orientação, resina (oco + drenagem), guia de montagem | Modelo grande dividido para A1 mini automaticamente |
| **8 — Polimento** | Onboarding, paleta de comandos, tema claro, acessibilidade, PWA/Tauri | Lighthouse ≥ 90; teste de usabilidade com 3 pessoas |

---

## 11. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Malhas de entrada quebradas (comuns em STL baixados) | Reparo na importação + aviso; manifold-3d como única via de booleano |
| SmartCut errar o ponto de corte | Sempre é sugestão editável; usuário ajusta o laço antes de confirmar |
| Desempenho com malhas enormes | Workers, BVH, decimação só para preview, LOD no viewport |
| Tolerâncias variam por impressora | Peça de calibração + presets do usuário |
| Escopo grande | Fases com critério de aceite; MVP utilizável já na Fase 4 |

---

## 12. Conteúdo para `CLAUDE.md`

```markdown
# Mobios
App web para cortar modelos 3D em partes imprimíveis com encaixes. Especificação completa em docs/SPEC.md — leia antes de qualquer tarefa.

## Regras
- TypeScript strict; sem `any` sem justificativa.
- Geometria só no Web Worker, só via manifold-3d para booleanos.
- Toda alteração de estado passa por um Command (undo/redo).
- Toda feature vem com testes; `npm run test && npm run bench` precisam passar.
- UI segue os tokens de src/ui/tokens.ts; nada de cores soltas.
- Português nos textos da interface; inglês no código.

## Comandos
- `npm run dev` · `npm run test` · `npm run e2e` · `npm run bench` · `npm run build`

## Fase atual
(atualizar a cada fase — ver docs/SPEC.md seção 10)
```

---

## 13. Prompt de kickoff (colar no Claude Code)

```
Você é o orquestrador do projeto Mobios. Leia docs/SPEC.md por completo.
Execute a Fase 0 e depois a Fase 1 da seção 10, delegando aos subagentes definidos em .claude/agents
conforme a tabela da seção 9. Para cada fase:
1) liste as tarefas com critério de aceite;
2) delegue ao agente dono;
3) peça ao agente qa para rodar testes e benchmark;
4) peça ao revisor uma revisão independente;
5) só avance quando todos os critérios da fase passarem.
Ao fim de cada fase, atualize "Fase atual" no CLAUDE.md e me mostre um resumo com prints do app.
Pare e me pergunte antes de qualquer decisão que mude a stack definida na seção 4.
```
