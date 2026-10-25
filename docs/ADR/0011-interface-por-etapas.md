# ADR 0011 — Interface por etapas e "Separar em N peças"

## Contexto

Teste com um busto real: o painel mostrava as partes detectadas (com cores, juntar e separar), mas
não havia nenhum botão para **dividir o modelo nessas partes**. As ferramentas de corte ficavam
espalhadas (barra lateral, painel da parte, atalhos), cada uma com seu menu. Feedback do usuário:
"não faz sentido, não é intuitivo; quero uma opção de corte que já me dê qualquer corte".

## Decisão

1. **O fluxo é a navegação.** A barra superior tem as etapas `1 Modelo · 2 Separar · 3 Encaixes ·
   4 Cores` (abas). O painel da esquerda mostra a etapa atual — o que fazer agora. O da direita
   mostra o que existe: peças e histórico. Exportar continua como botão principal.
2. **Separar** é a etapa central. A peça mostra as partes detectadas em cores; o botão
   **"Separar em N peças"** corta todas de uma vez, num só passo do histórico, com pino e
   número em cada junta. Clique numa parte do modelo separa só ela. Os outros cortes (plano,
   traço livre, pincel, caber na impressora) ficam num **único menu "Cortar…"**.
3. Uma tarefa aberta (revisão de corte, pincel, encaixe, Raio‑X) substitui o painel da etapa e
   tem seu próprio "voltar".
4. Ao abrir o primeiro modelo o app vai direto para **Separar**.
5. Peça = o que vai para a impressora; parte = região detectada no modelo.

## Como "Separar em N peças" corta

- **Ordem de fora para dentro** (`peelOrder`, `features/parts/groups.ts`): sempre corta uma parte
  que toca uma só das restantes (mão, cabeça, base…), a menor primeiro; a última que sobra é o
  corpo e mantém o nome dela. Assim o que sobra fica sempre numa peça só. O mapa de partes passou
  a trazer `touches` (partes vizinhas por aresta).
- **Rótulos do mapa original** (`RegionCutOperation.mapFrom`): cada corte da corrente usa o mapa
  da peça que o usuário viu e editou, levado para o que sobrou; recalcular o mapa no que sobra
  (sem braços, com furos de pino) juntava tudo numa parte só.
- Na limpeza dos rótulos, uma parte só conta para escolher o corpo se tiver ≥ 1% da área (tampas
  de cortes anteriores carregavam rótulos soltos e "venciam" a base).
- Os avisos de vários cortes de uma vez viram um só toast.

## Consequências

- Exemplo: 7 peças inteiras em ~22 s no navegador (teste `tests/unit/splitall.test.ts` e e2e
  `partmap.spec.ts`).
- Removidos: tour de primeiros passos (as etapas guiam), painel "Parte" e "Projeto" (o conteúdo foi
  para Modelo, Encaixes e Cores), barra de ferramentas (a vista ficou num controle pequeno no canto).
- No celular o painel da etapa fica embaixo; peças e histórico ficam ocultos (< 1024 px).
