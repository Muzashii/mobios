# Corpus do SmartCut

`npm run bench` roda `tests/bench/smartcut.corpus.test.ts`: cada caso é cortado pelo SmartCut v2 (top‑1 e top‑3) e pelo v1 congelado em `legacy/` (linha de base). O resultado vai para `docs/baseline-smartcut.md`.

- `synthetic.ts` — casos modelados com resposta conhecida (cabeça, braço, mão, perna, alça, braço encostado, espada, chapéu, cabelo, camiseta × calça, quadrúpede, asa, scan ruidoso, CAD grosso, escala 10×, primitivas).
- `models/` — **modelos reais** (figuras baixadas, scans). Não versione binários grandes: use Git LFS ou baixe por script. Use só modelos com licença livre (CC0/CC‑BY, subconjunto do Thingi10K filtrado por licença) ou próprios.

## Adicionar um modelo real

Coloque `models/figura.stl` e `models/figura.expect.json`:

```json
{
  "file": "figura.stl",
  "parts": [
    {
      "name": "Cabeça",
      "category": "cabeça",
      "seeds": [[0, -12, 140]],
      "radius": 4,
      "expect": { "bMin": [null, null, 120], "share": [0.04, 0.2] }
    }
  ]
}
```

- `seeds`: pontos (mm, coordenadas do arquivo) onde o usuário clicaria; são projetados na superfície.
- `negSeeds` (opcional): o que deve ficar no corpo (Shift + pincel).
- `expect.bMin` / `bMax`: limites da caixa da peça B por eixo (`null` = livre). `share`: fração do volume que vai para B.
- `category`: `cabeça | membro | mão | cauda/asa | cabelo | roupa | acessório | scan | cad | primitiva`.

O plano pede ≥ 20 modelos reais (cabelo volumoso, braço encostado, mão segurando objeto, personagem vestido, jaqueta aberta, animal, dragão, scan > 1 M triângulos, CAD, malhas quebradas).
