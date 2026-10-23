# ADR 0009 — Raio-X da malha e reparo não destrutivo na importação

**Contexto.** A importação reparava em silêncio (`repairMesh`) e mostrava um toast. O usuário não via o que estava errado nem escolhia como corrigir; furos eram fechados com leque no centróide, e malhas “irreparáveis” simplesmente não entravam.

## Decisão

### Fluxo
1. `GeometryService.inspectFile` decodifica o arquivo e roda o diagnóstico **sem alterar nada**; a malha bruta fica no worker (por id) até a decisão.
2. A UI abre o painel **Raio‑X** (inspector) com nota (Pronta / Precisa de reparo / Crítica), estatísticas e a lista de problemas por severidade. O viewport mostra a malha bruta com o **heatmap** (bordas abertas vermelhas, não‑manifold magenta, faces invertidas roxas, autointerseções laranja, paredes finas amarelas, cascas ciano); “Mostrar” isola e enquadra um problema.
3. Cada problema traz opções (a primeira é a recomendada). “Reparar tudo (recomendado)” aplica as recomendadas; `finishImport(id, plano)` repara e registra a fonte. Uma malha sem nada a decidir entra direto.
4. O resumo do reparo (“1 furo fechado (suave) · 1 sujeira removida”) fica no card de importação do histórico (`SourceRef.repair`). Desfazer a importação remove tudo.

### Verificações (`src/geometry/inspect/index.ts`)
Furos (laços de borda, perímetro) · arestas com > 2 faces e vértices não‑manifold · normais invertidas (arestas em sentido igual) e cascas do avesso · autointerseções (grade + teste exato, com orçamento de tempo) separadas em “na mesma casca” e “entre cascas” · cascas: sobrepostas, separadas, internas, sujeira flutuante · vazios internos (casca negativa dentro de outra, por paridade de raio a partir do centróide de uma face) · faces degeneradas/duplicadas · paredes finas (raios para dentro via BVH vs mínimo da tecnologia) · escala/unidade · malha gigante (> 1 M) · triângulos‑agulha · gênero (alças) · não cabe na impressora.

### Reparo (`src/geometry/inspect/repairPlan.ts`)
Solda → escala → limpeza → remoção de faces excedentes (aletas soltas primeiro) → divisão de vértices beliscados → orientação → **furos**: “suave” (anéis concêntricos + relaxamento laplaciano) ou “plano” (plano de melhor ajuste / ear clipping) → orientação por casca (vira cascas do avesso; vazios mantidos ou removidos) → manifold. Se nada fecha, ou se o usuário escolheu, **remesh volumétrico** (`inspect/volumetric.ts`): ocupação por número de enrolamento em raios nos 3 eixos (votação 2 de 3 — resiste a furos e cascas sobrepostas) → `Manifold.levelSet`; resolução escolhida no painel, com a perda de detalhe mostrada. Depois: união das cascas e remoção de sujeira, ou cascas como partes separadas; decimação com `Manifold.simplify` informando o desvio.

Corrigido no caminho: o preenchimento de furos antigo truncava laços de 4+ vértices (a condição de parada usava o tamanho do mapa que encolhia durante o percurso).

## Consequências
- Nenhuma alteração na malha acontece sem o usuário ver o que muda.
- O reparo não é uma operação reexecutável do histórico: as fontes do motor são sólidos manifold e a malha bruta (às vezes aberta) não cabe nesse modelo. O registro fica no card de importação; refazer com outras opções = desfazer a importação e importar de novo.
- “Detalhes menores que o bico” entram no aviso de paredes finas; engrossar paredes localmente e remesh isotrópico local não foram implementados.
