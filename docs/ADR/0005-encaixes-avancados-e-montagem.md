# ADR 0005 — Encaixes avançados, numeração gravada e montagem simulada

**Contexto.** Fase 6 (SPEC §3.3, §3.4, §3.6, §10): chaveta, rabo-de-andorinha, ímã, numeração gravada e animação de montagem. Critério: montagem simulada sem colisão.

## Encaixes (`src/geometry/connectors.ts`)
- **Perfil 2D genérico**: cada pino é um `CrossSection` (círculo, quadrado, hexágono, círculo + aba = chaveta) extrudado com chanfro na ponta; o furo é o mesmo perfil `offset(folga)` com entrada alargada. Quadrado/hexágono travam a rotação; a aba da chaveta força uma única orientação (testado girando a peça 90°/180°).
- **Ímã**: furo cego nas duas faces (Ø e altura do ímã + 0,2 mm para cola), sem chanfro; descartado se não houver espessura.
- **Pino solto**: furos nos dois lados + parte "Pinos Jn" impressa separada.
- **Rabo-de-andorinha**: trapézio (base w, topo 1,5w) ao longo do eixo maior da face (PCA). O trilho é `trapézio ∩ outra parte`, então nunca sai do contorno; o rasgo atravessa a outra parte para ela deslizar. Altura reduzida se a parede não comportar; aviso se o rasgo dividir a peça.
- Todos validam contenção (nunca furam a parede) e reduzem profundidade/descartam com aviso.

## Montagem sem colisão
Após aplicar o encaixe, B é varrido ao longo da direção de inserção (normal da junta; eixo do trilho no rabo-de-andorinha) de `travel` até 0, e medimos o maior volume de interseção com A — só na vizinhança da face, para ficar rápido. > 0,01 mm³ ⇒ aviso "Colisão na montagem simulada"; senão o histórico mostra "montagem sem colisão ✓". Folga negativa (interferência) é detectada nos testes.

## Numeração gravada (`src/geometry/labels.ts`)
Fonte de 7 segmentos (traços arredondados via `hull` de círculos) — legível em baixo-relevo pequeno. O texto (código da junta, ex. "J1") é posicionado pelo campo de distância da face evitando as "pegadas" dos encaixes (`JointInfo.obstacles`), reduzido até 3 mm se preciso, gravado em A e espelhado em B (lê certo olhando cada face). A operação `label` vem logo após o encaixe para conhecer as pegadas.

## Animação de montagem (`src/features/assembly/assembly.ts`)
Cada parte carrega `lineage` (lados de junta de que descende, ex. `["c1.b", "c3.a"]`). O deslocamento de uma parte é a soma, para cada junta em que ela é o lado B, de `insertDir × distância × (1 − progresso da junta)`. As juntas fecham da última para a primeira (submontagens primeiro), com smoothstep; a barra mostra o veredito de colisão por junta.

**Consequências.** Encaixes e numeração continuam exigindo junta plana. Fonte limitada a dígitos e A–F, H, J, L, P, U (suficiente para "J12").
