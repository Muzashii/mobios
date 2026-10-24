# Laboratório com modelos reais

Testes que precisam de modelos que não podem ir para o repositório (público). Os arquivos ficam em `.lab/` (ignorado pelo git). Nada aqui roda no CI; sem `.lab/` os testes são pulados.

```bash
# 1. Prepare a malha (decodifica, repara, gera proxies em .lab/)
MOBIOS_LAB_MODEL=caminho/modelo.stl MOBIOS_LAB_OUT=.lab NODE_OPTIONS=--max-old-space-size=8192 npm run lab -- tests/lab/load.lab.ts
cp caminho/modelo.stl .lab/boneco.stl

# 2. Métricas (anexadas em .lab/partmap-scores.txt)
npm run lab -- tests/lab/appimport.lab.ts   # caminho real do app: Raio-X + mapa de partes
npm run lab -- tests/lab/robust.lab.ts      # proxies de 30k a 90k faces
npm run lab -- tests/lab/fullmap.lab.ts     # malha completa sem Raio-X
npm run lab -- tests/lab/v2.lab.ts          # SmartCut v2, para comparar

# 3. Ver o resultado (com `npm run dev` rodando)
node tests/lab/shot.mjs "mesh=impfull&labels=impfull" .lab/mapa.png
```

As partes esperadas (clique, o que vem junto, o que fica de fora) estão em `common.ts` (`FIGURE_PARTS`), para o boneco de teste. Um modelo novo precisa da sua própria lista. Para ver regiões e papéis num proxy: `MESH=<proxy> REG=1 npm run lab -- tests/lab/partmap.lab.ts`.
