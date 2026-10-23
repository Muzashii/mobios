# ADR 0002 — Documento imutável + histórico reexecutável com cache por prefixo

**Contexto.** SPEC §2 (nada destrutivo) e §3.8: editar um corte antigo deve recalcular os seguintes; undo/redo ilimitado.

**Decisão.**
- O projeto é um documento JSON imutável (`ProjectDoc`): fontes, `operations[]`, metadados de parte. Cada mudança é um *Command* (`label` + função pura doc → doc). Undo/redo guarda snapshots do documento (compartilhamento estrutural, barato). Malhas de origem ficam fora do documento (IndexedDB), referenciadas por id.
- IDs de parte são determinísticos: um corte `c1` gera `c1.a` (lado oposto à normal) e `c1.b` (lado da normal). Operações posteriores referenciam esses ids, então reexecutar o histórico reconstrói a mesma árvore.
- O `Engine` guarda o estado após cada operação; ao avaliar, compara a chave (JSON) de cada operação e recomputa só a partir da primeira diferença. Partes inalteradas não são reenviadas à UI (controle por `version`).
- Uma operação que falha (alvo inexistente, plano fora da peça) não quebra o histórico: o estado passa adiante e o erro aparece na linha do tempo.

**Consequências.** Encaixes referenciam o corte (junta) e exigem que as partes `a`/`b` ainda existam; se forem recortadas depois, o encaixe reporta erro pedindo para movê-lo.
