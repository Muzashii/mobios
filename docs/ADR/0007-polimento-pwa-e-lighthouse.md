# ADR 0007 — Polimento: PWA, acessibilidade e orçamento de carregamento

**Contexto.** Fase 8 (SPEC §5, §10): onboarding, paleta de comandos, tema claro, acessibilidade, PWA/Tauri; critério Lighthouse ≥ 90.

## Medição (`npm run lighthouse`, Edge headless, build de produção)
| | Desempenho | Acessibilidade | Boas práticas | SEO |
|---|---|---|---|---|
| Antes — desktop | 97 | 90 | 100 | 91 |
| Antes — celular | 59 | 86 | 100 | 91 |
| **Depois — desktop** | **100** | **100** | **100** | **100** |
| **Depois — celular** | **93** | **100** | **100** | **100** |

Celular final: FCP 2,4 s · LCP 2,7 s · TBT ≈ 20–50 ms · CLS 0.

## Decisões de carregamento
- **three.js fora do pacote inicial** (291 → 180 KB gzip): utilitários de geometria do app passaram a usar vetores simples; `toBufferGeometry` importa o three sob demanda; o traço livre (`StrokeOverlay`) é lazy; matrizes do gizmo foram para `features/viewport`.
- **Sem 3D até existir modelo**: o viewport (three + R3F + drei) só monta quando há malha; a tela vazia é um gradiente em CSS.
- **Motor aquecido no ócio**: em início limpo, o worker + WASM carregam após o `load` com `requestIdleCallback` (com projeto salvo, imediatamente).
- **Tela de boot inline** no `index.html` (sem JS) para a primeira pintura.

## PWA
- `vite-plugin-pwa` (generateSW, `autoUpdate`): precache de JS/CSS/HTML/**WASM**/fontes/ícones (~2,7 MB) → funciona offline.
- Manifest pt-BR com ícones PNG gerados por `scripts/make-icons.mjs` (sem dependências) e **`file_handlers`** para .stl/.obj/.3mf/.mobios (e o antigo .fenda); o app instalado recebe arquivos via `launchQueue`.
- **Tauri** fica para depois: exige toolchain Rust e não acrescenta recursos que o PWA não cubra hoje (offline, instalação, abrir arquivos).

## Acessibilidade
- Uma única hierarquia de títulos (h1 = nome do app; painéis e seções = h2).
- Outliner virou lista simples: cada linha tem um botão de seleção (`aria-pressed`) e botões de travar/ocultar com nome (antes: `listbox` com interativos aninhados).
- Alvos de toque ≥ 24 px; link "Pular para o painel de propriedades"; `MotionConfig reducedMotion="user"`.
- Contraste: acento do tema claro escurecido para `#C2410C` (texto branco 5,2:1; antes 3,5:1).

## Onboarding
Tour de 4 passos (importar → cortar → encaixe → exportar) que **avança pelo que o usuário faz**, não por "próximo"; recolhe enquanto uma ferramenta está ativa; some sozinho ao concluir e não volta (localStorage).

**Pendências humanas.** Teste de usabilidade com 3 pessoas: roteiro em `docs/usability-test.md`.
