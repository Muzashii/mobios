# Fenda Studio

Corte modelos 3D em partes imprimíveis, gere encaixes que encaixam na primeira impressão e exporte tudo pronto para o Bambu Studio — direto no navegador.

Especificação: [docs/SPEC.md](docs/SPEC.md) · Decisões: [docs/ADR](docs/ADR) · Regras para agentes: [CLAUDE.md](CLAUDE.md)

## Rodar

```bash
npm install
npm run dev          # http://localhost:5173
npm run test         # unidade + propriedade (fast-check)
npm run bench        # orçamento de desempenho (500k triângulos)
npm run build        # typecheck + build de produção (com service worker)
npm run lighthouse   # com `npx vite preview --port 4173` rodando
npx playwright install chromium && npm run e2e   # E2E com screenshot
```

## O que já faz (Fases 0–8)

| Área | Recursos |
|---|---|
| Importar | STL (binário/ASCII), OBJ, 3MF multi-objeto; arrastar e soltar; **reparo automático** (solda, faces degeneradas/duplicadas, normais, buracos, cascas sobrepostas) com relatório; aviso de escala suspeita |
| Cortar | Plano com gizmo (mover/girar), alinhar a X/Y/Z, posição/ângulos numéricos, **preview fantasma ao vivo**; **corte limitado** (separa só a ilha dentro de uma esfera — ex.: um braço sem cortar o tronco) |
| SmartCut | Pincele (ou clique) a região — braço, cabeça — e o app propõe o corte na articulação (anel mais estreito e côncavo, via Shape Diameter Function + anéis geodésicos); a sugestão é um corte limitado editável |
| Cortes livres | Desenhe um traço na tela e ele vira uma superfície de corte; perfis de junta **degrau, zigue-zague e onda** que escondem a emenda e travam a rotação |
| Encaixes | Pino cilíndrico, **quadrado e hexagonal** (anti-rotação), **chaveta** (orientação única), pino solto, **ímã** e **rabo-de-andorinha** deslizante; folga por tecnologia (FDM/Resina), chanfro, parede mínima; posição automática (polo de inacessibilidade); **nunca fura a parede**; peça de calibração de folga |
| Montagem | **Verificação de inserção sem colisão** por encaixe; **animação de montagem** passo a passo (M); vista explodida; **numeração gravada** (J1, J2…) nas duas faces, longe dos encaixes |
| Histórico | Undo/redo ilimitado; linha do tempo editável — editar um corte antigo recalcula tudo depois; remover etapa remove dependentes |
| Multicolor | 4 slots de filamento (AMS/BMCU), ferramenta de pintura por parte |
| Preparação | **Auto-split**: divide a peça com o menor número de cortes para caber na impressora, nas seções mais estreitas, com pinos soltos e numeração; **análise de impressão** (balanços > 45°, base, paredes finas); **orientação sugerida** aplicada na exportação; **oco para resina** com drenos e aviso de ventosa |
| Análise | Dimensões, volume, material estimado, cabe na impressora (Bambu A1/A1 mini/X1, Mars 5 Ultra), área de colagem |
| Exportar | 3MF com um objeto por parte e slot de filamento (Bambu Studio), STL/OBJ em ZIP (pinos soltos empacotados, orientação aplicada), projeto `.fenda`, **guia de montagem HTML** com imagens de cada passo |
| Projeto | Autosave no IndexedDB, abrir/salvar `.fenda`, tema claro/escuro, paleta de comandos (Ctrl+K), **tour de primeiros passos**, **PWA instalável e offline** (abre .stl/.3mf direto do sistema) |
| Acessibilidade | Navegação por teclado, link para pular ao painel, contraste AA nos dois temas, respeita "reduzir movimento" |

## Atalhos

`C` corte · `S` SmartCut · `B` pincel · `L` curva livre · `T` pintar cor · `V` selecionar · `[` `]` raio do pincel · `P` encaixe · `M` simular montagem · `E` explodir · `F` focar · `H` ocultar · `Enter`/`Esc` confirmar/cancelar · `Ctrl+Z/Y` · `Ctrl+S` salvar · `Ctrl+E` exportar 3MF · `Ctrl+K` comandos

## Arquitetura

```
UI (React 19 + R3F)  ──commands──▶  Store (Zustand, documento imutável, undo/redo)
        ▲                                   │ sources + operations
        │ malhas de exibição (transferíveis) ▼
   Geometry Worker (Comlink) ── Engine: reexecuta o histórico com cache por prefixo
                               └ manifold-3d (WASM): corte, booleanos, reparo
```

Toda geometria roda no worker via manifold-3d — toda parte exportada é fechada (manifold). Ver ADRs 0001–0007.

## Desempenho medido

`npm run bench` (Windows, Node 24): corte oblíquo de 500k triângulos ≈ 830 ms (meta da SPEC: 500 ms — ver [ADR 0003](docs/ADR/0003-orcamento-de-desempenho.md)); bundle inicial 180 KB gzip (three.js, viewport e WASM carregam sob demanda). Lighthouse: desktop 100/100/100/100, celular 93/100/100/100 (desempenho/acessibilidade/boas práticas/SEO) — [ADR 0007](docs/ADR/0007-polimento-pwa-e-lighthouse.md).
