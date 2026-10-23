# ADR 0004 — SmartCut, cortes por curva livre e perfis de junta

**Contexto.** Fase 5 (SPEC §3.2, §10): sugerir cortes nas articulações a partir de um pincel/clique, cortar por traço livre e por perfis degrau/zigue-zague/onda. Critério: em 5 figuras de teste, o corte sugerido cai na articulação.

## SmartCut (`src/geometry/smartcut.ts`)
1. **Reamostragem**: malhas CAD com triângulos longos escondem dobras; o serviço refina para aresta ≤ diagonal/120 antes da análise (se < 150 mil triângulos).
2. **Sementes → região R via Shape Diameter Function**: o pincel só toca o lado visível do membro. Para cada pincelada (até 16 amostras) disparamos 9 raios em cone (25°) para dentro; a mediana da espessura dá a esfera inscrita no membro naquele ponto. R = vértices dentro do pincel ou dessas esferas — assim R envolve o membro.
3. **Anéis geodésicos**: Dijkstra multi-fonte a partir de R; em 72 níveis, union-find (varredura do mais longe para o mais perto) dá a maior componente restante ("corpo"). Enquanto ela tiver > 50% da área, o anel que a contorna é candidato.
4. **Escolha**: ignora a fase em que o anel ainda cresce como disco (> 1 mm de perímetro por mm de distância — anel correndo *ao longo* do membro) até ele envolver o membro ou cruzar uma dobra. Pontuação = perímetro/mediana − 0,6·concavidade + 0,3·distância relativa (regra dos mínimos: cortes em pescoços estreitos e dobras côncavas, perto da semente).
5. **Plano**: PCA do anel (menor variância = normal, orientada para a semente) deslocado ≤ 2 mm para o lado do membro; vira um **corte limitado** editável (raio = 1,35 × raio do anel).

Testes: `tests/unit/smartcut.test.ts` — figura (braço → ombro, cabeça → pescoço), haltere, cogumelo, galho em T, e uma regressão de pincelada só na frente do braço (achada no navegador).

## Cortes por "cortador" (`src/geometry/cutters.ts`)
Perfis e traços livres viram um sólido cortador: B = peça ∩ cortador, A = peça − cortador. O cortador nunca compartilha faces com a peça, então os booleanos ficam robustos.
- **Perfil**: polígono y > f(x) no referencial do plano, extrudado ao longo de v.
- **Traço livre**: o traço (suavizado por Chaikin) é projetado num plano alinhado à câmera pelo centro da peça, estendido nas pontas e fechado pela esquerda; extrudado ao longo da direção de visão. Assume projeção ortográfica (com perspectiva o traço desvia levemente nas bordas).

**Consequências.**
- Juntas não planas (`planar: false`) recusam encaixes por pino com mensagem clara; o perfil já trava a rotação. Corte limitado não combina com perfil (nesta versão).
- Área de colagem de juntas não planas = (área(A) + área(B) − área(peça)) / 2.
- O preview com clipping planes mostra o plano médio; o perfil aparece como linha. O corte limitado mostra a peça inteira + disco/esfera, sem pintar o lado B (que enganaria).
