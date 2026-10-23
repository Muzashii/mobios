# Teste de usabilidade — roteiro (Fase 8)

Critério da SPEC §10: teste com **3 pessoas**. Este roteiro leva ~25 min por pessoa. Não ajude durante as tarefas — só observe e anote.

## Perfis
1. Maker que imprime colecionáveis em **resina** (já usou Chitubox/Lychee).
2. Usuário de **Bambu Lab** com AMS (FDM, multicolor).
3. Iniciante (imprime há < 6 meses, nunca cortou um modelo).

## Preparação
- `npm run build && npx vite preview` (ou a URL publicada), navegador limpo (sem dados do site: o tour aparece).
- Tenha um STL "grande" à mão (ex.: um busto de ~25 cm) e o exemplo do app.
- Grave a tela com áudio (peça consentimento) e use o protocolo "pense em voz alta".

## Tarefas (não leia os nomes das ferramentas para a pessoa)
| # | Tarefa | Sucesso quando | Tempo-alvo |
|---|---|---|---|
| 1 | "Abra o modelo de exemplo." | Figura no viewport | < 30 s |
| 2 | "Separe a cabeça do corpo para imprimir em partes." | Corte com encaixe criado | < 2 min |
| 3 | "Separe só um braço, sem cortar o tronco." | Corte limitado ou SmartCut no ombro | < 3 min |
| 4 | "Faça a cabeça encaixar numa única posição." | Encaixe tipo chaveta | < 2 min |
| 5 | "Você errou a altura do primeiro corte: mude para 5 mm mais baixo." | Edição pelo histórico, partes recalculadas | < 2 min |
| 6 | "Veja como as peças se montam." | Simulação de montagem (M) ou vista explodida | < 1 min |
| 7 | "Importe o busto e prepare para a impressora A1 mini." | Auto-split, todas as partes cabem | < 3 min |
| 8 | "Mande para o Bambu Studio com cores diferentes por parte." | 3MF exportado com slots | < 2 min |

## Depois das tarefas
- **SUS** (System Usability Scale, 10 perguntas, escala 1–5). Meta: média ≥ 75.
- Perguntas abertas: "O que foi mais confuso?", "O que você esperava encontrar e não encontrou?", "Usaria no lugar do que usa hoje? Por quê?"

## Registro (preencha por pessoa)
| Pessoa | Tarefa | Concluiu? | Tempo | Erros / hesitações | Citação |
|---|---|---|---|---|---|
|  |  |  |  |  |  |

## Critério de aprovação da fase
- ≥ 2 de 3 pessoas concluem as tarefas 1–6 sem ajuda;
- SUS médio ≥ 75;
- Todo problema citado por 2+ pessoas vira tarefa antes do lançamento.
