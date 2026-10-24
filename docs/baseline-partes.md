# Mapa de partes — linha de base (Etapa 0)

Corpus real: boneco "single_color" (1,9 M triângulos, chapéu‑coco, cabeça com grade, bengala). O arquivo **não** está no repositório (`.lab/` é ignorado); como rodar em `tests/lab/README.md`.

Métrica: para cada parte esperada, um clique (raio, como na UI), pontos que precisam vir junto e pontos que precisam ficar de fora. "Inteira" = tudo certo.

| Parte esperada | Clique | Precisa vir junto | Não pode vir |
|---|---|---|---|
| Chapéu | topo | aba na frente, aba na lateral, nuca do chapéu | rosto, nuca |
| Cabeça | rosto | nuca, as duas orelhas | chapéu, tronco |
| Tronco | peito | costas | rosto, perna, braço |
| Braço direito | braço da bengala | mão (por trás) | tronco, bengala |
| Braço esquerdo | cotovelo | mão na cintura | tronco |
| Perna direita / esquerda | coxa | sapato | outra perna, tronco |
| Bengala | ponta | — | braço, perna |

## Resultados

| Caminho | Triângulos | SmartCut v2 (hover) | Mapa de partes | Partes | Tempo |
|---|---|---|---|---|---|
| Import do app (Raio‑X + reparo recomendado) | 343.936 | — | **8/8** | 8 | 3,5–5,3 s |
| Malha completa sem Raio‑X | 1.930.488 | 3/8 | **8/8** | 8 | 4,8–7,7 s |
| Proxy 30 mil | 29.504 | — | **8/8** | 8 | 2,1 s |
| Proxy 45 mil | 37.964 | — | **8/8** | 8 | 2,8 s |
| Proxy 60 mil | 49.936 | — | **8/8** | 8 | 3,9 s |
| Proxy 90 mil | 69.192 | — | **8/8** | 8 | 6,2 s |

Partes encontradas no import do app: Chapéu 39% (cúpula + aba + faixa) · Cabeça 32% (com grade, orelhas e rosto) · Tronco 10% (com cachecol) · Perna esquerda 6% · Perna direita 6% (com sapatos) · Braço esquerdo 3% · Braço direito 3% (com mãos) · Acessório 2% (bengala).

Tempos medidos em Node (Windows, sem GPU); no worker do navegador o tempo é parecido. SmartCut v2 na malha completa: falhou chapéu (faltou a aba), cabeça (faltaram nuca e orelhas), tronco, braço direito (levou a bengala) e braço esquerdo.

Figura sintética no CI (`tests/unit/partmap.test.ts`): base, tronco, cabeça, chapéu (cúpula + aba), braços com mãos e pernas — 5/5 testes.
