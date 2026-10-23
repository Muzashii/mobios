# ADR 0006 — Auto-split, imprimibilidade, orientação, oco para resina e guia de montagem

**Contexto.** Fase 7 (SPEC §3.2 v2, §3.6, §3.7, §10). Critério: modelo grande dividido para a A1 mini automaticamente.

## Auto-split para a mesa (`src/geometry/autosplit.ts`)
- Cabe = dimensões ordenadas ≤ volume ordenado (giros de 90° permitidos), com margem de 4 mm.
- Enquanto uma peça não cabe: escolhe o eixo da maior dimensão que excede, usa o **número mínimo de peças** nesse eixo, e desliza cada corte dentro da folga restante para a **menor seção transversal** (`slice` após permutar o eixo para Z) — pescoços e pontes estreitas escondem emendas.
- Cada corte recebe **pinos soltos** (não aumentam o tamanho das peças, ao contrário do pino macho) e **numeração**. O plano gerado é uma lista de operações normais do histórico (editável/desfazível).
- Pinos soltos ficam na posição montada na cena; na **exportação** são reempacotados lado a lado (`packComponents`).
- Teste de aceite: figura de exemplo × 3 (≈ 210 × 80 × 330 mm) → todas as partes cabem em 180³.

## Imprimibilidade e orientação (`src/geometry/printability.ts`)
- Balanço: faces viradas para baixo a mais de 45°, excluindo a base apoiada.
- Parede: ~240 amostras ponderadas por área, raio para dentro → espessura; mínimo seguro FDM 0,8 / resina 0,5 mm.
- Orientação: candidatos = 6 eixos + normais das faces de corte (face de corte para baixo); pontuação = balanço − 1,5 × área de base. O usuário aplica com um clique; a exportação gira a peça (`orientDown`) e a apoia em z = 0.

## Oco para resina (`src/geometry/hollow.ts`)
- `minkowskiDifference` (erosão exata) levou 14,5 s para 6,5 mil triângulos — descartado.
- Usamos `Manifold.levelSet` com função de distância assinada: sinal por paridade de raio e distância por `closestPointToPoint` com limite (three-mesh-bvh, no worker). Grade ≥ parede × 0,6 e ≤ ~70³ amostras.
- Drenos: cilindros a partir dos pontos mais baixos da cavidade (espaçados), saindo por baixo. Sem drenos ⇒ aviso de ventosa.
- Bug corrigido no caminho: `dropSlivers` descartava componentes de volume negativo — que é exatamente um vazio interno. Agora usa |volume|.

## Guia de montagem (`src/features/export/assemblyGuide.ts`)
HTML autocontido: visão explodida, tabela de partes (tamanho, gramas, slot), e um passo por junta na ordem da simulação de montagem, com captura do viewport em cada etapa e instruções conforme o tipo de encaixe e a numeração gravada. Imprimível (CSS de impressão) — "PDF" via imprimir do navegador.

**Consequências.** Auto-split só faz cortes alinhados aos eixos (sem procurar rotações arbitrárias). O oco usa grade relativamente grossa (superfície interna facetada, invisível por fora).
