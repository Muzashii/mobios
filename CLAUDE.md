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
- `npm run dev` · `npm run test` · `npm run e2e` · `npm run bench` · `npm run build` · `npm run lighthouse` (com `vite preview --port 4173` rodando)
- Regra de carregamento: nada de `import ... from 'three'` fora de `features/viewport`, `features/assembly`, `features/smartcut`, `StrokeOverlay` e `geometry/` (worker) — o pacote inicial não pode puxar o three.

## Mapa rápido
- `src/geometry/` — motor puro (roda no worker): `engine.ts` reexecuta o histórico com cache por prefixo (e faz o *dry-run* `checkCut`); `cut.ts` (plano, ilhas por sementes/maioria), `cutters.ts` (perfis, limitado+perfil, traço livre com perspectiva), `smartcut.ts` (orquestra o SmartCut v2 e o cache de contexto), `segment/` (região‑semente SDF, anéis geodésicos, min-cut), `regionCut.ts` (operação `cut-region`: junta curva com centro plano, casca), `mesh/` (topologia, BVH, triângulo×triângulo), `inspect/` (Raio‑X, reparo por plano, remesh volumétrico), `connectors.ts`, `labels.ts`, `autosplit.ts`, `printability.ts`, `hollow.ts`, `placement.ts`, `repair.ts`, `analysis.ts`.
- `src/io/` — STL/OBJ/3MF (import/export), ZIP e arquivo de projeto `.mobios` (abre também `.fenda`, o formato de antes do nome final).
- `src/store/` — documento do projeto (imutável), commands + histórico (undo/redo), persistência IndexedDB.
- `src/features/*` — UI por funcionalidade; `src/ui/` design system.
- Decisões: `docs/ADR/`.

## SmartCut v2 e Raio-X
- Plano em docs/PLANO-SMARTCUT-V2.md; decisões nos ADRs 0008 (SmartCut v2) e 0009 (Raio‑X).
- Mudou o SmartCut? Rode `npm run bench` e mostre a tabela de docs/baseline-smartcut.md antes/depois.
- Agentes `segmentacao` e `diagnostico-malha` em .claude/agents/.

## Fase atual
SmartCut v2 + Raio‑X da malha (plano: Fases A, B, C, E e F; D/D2 parciais — ver ADR 0008, “Limitações”). Antes: Fase 8 — Polimento (concluída). Fases 0–8 implementadas. Lighthouse: desktop 100/100/100/100, celular 93/100/100/100 (ver docs/ADR/0007). PWA offline instalável. Pendente (humano): teste de usabilidade com 3 pessoas — roteiro em docs/usability-test.md.
