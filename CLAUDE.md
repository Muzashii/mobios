# Fenda Studio
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
- `src/geometry/` — motor puro (roda no worker): `engine.ts` reexecuta o histórico com cache por prefixo; `cut.ts`, `cutters.ts` (perfis e traço livre), `smartcut.ts`, `connectors.ts`, `labels.ts` (numeração gravada), `autosplit.ts`, `printability.ts`, `hollow.ts`, `placement.ts`, `repair.ts`, `analysis.ts`.
- `src/io/` — STL/OBJ/3MF (import/export), ZIP e arquivo `.fenda`.
- `src/store/` — documento do projeto (imutável), commands + histórico (undo/redo), persistência IndexedDB.
- `src/features/*` — UI por funcionalidade; `src/ui/` design system.
- Decisões: `docs/ADR/`.

## Fase atual
Fase 8 — Polimento (concluída). Fases 0–8 implementadas. Lighthouse: desktop 100/100/100/100, celular 93/100/100/100 (ver docs/ADR/0007). PWA offline instalável. Pendente (humano): teste de usabilidade com 3 pessoas — roteiro em docs/usability-test.md.
