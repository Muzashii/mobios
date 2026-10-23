import { CONNECTOR_TYPES } from '../../geometry/connectors';
import { materialGrams } from '../../geometry/analysis';
import { downloadBytes, safeFileName } from '../../lib/download';
import { getDoc } from '../../store/history';
import { printerOf } from '../../store/project';
import { focus, setUI, toast, useUI } from '../../store/ui';
import { partColor } from '../paint/colors';
import { viewportRefs } from '../viewport/viewportRefs';

const nextFrames = (n = 3) =>
  new Promise<void>((resolve) => {
    const step = (k: number) => (k <= 0 ? resolve() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

/**
 * Assembly guide (HTML, self-contained): parts list, then one illustrated step per joint,
 * captured from the viewport while the assembly simulation advances.
 */
export async function exportAssemblyGuide() {
  const { parts, joints, explode, assembly } = useUI.getState();
  const canvas = viewportRefs.canvas;
  if (!canvas || !parts.length) {
    toast('warning', 'Nada para documentar', 'Importe e corte um modelo primeiro.');
    return;
  }
  const doc = getDoc();
  setUI({ busy: true, busyLabel: 'Gerando guia de montagem…', draft: null, tool: 'select', selection: null, hovered: null });
  const shots: string[] = [];
  try {
    // Step 0: everything apart; then each joint closed in assembly order.
    const order = [...joints].reverse();
    const n = order.length;
    setUI({ assembly: 0, assemblyPlaying: false, explode: 0 });
    await nextFrames(1);
    focus('all');
    await wait(600);
    await nextFrames();
    shots.push(canvas.toDataURL('image/png'));
    for (let k = 1; k <= n; k++) {
      setUI({ assembly: k / n });
      await nextFrames();
      shots.push(canvas.toDataURL('image/png'));
    }
  } finally {
    setUI({ busy: false, assembly, explode });
  }

  const order = [...joints].reverse();
  const name = (id: string) => doc.partMeta[id]?.name ?? parts.find((p) => p.id === id)?.name ?? id;
  const opFor = (jointId: string) => doc.operations.find((o) => o.kind === 'connector' && o.joint === jointId);
  const labelled = new Set(doc.operations.filter((o) => o.kind === 'label').map((o) => (o as { joint: string }).joint));
  const totalGrams = parts.reduce((s, p) => s + materialGrams(p.stats.volume, doc.technology), 0);

  const partRows = parts
    .filter((p) => doc.partMeta[p.id]?.visible !== false)
    .map((p) => {
      const size = [0, 1, 2].map((k) => (p.stats.bounds.max[k] - p.stats.bounds.min[k]).toFixed(0)).join(' × ');
      const slot = doc.partMeta[p.id]?.slot;
      return `<tr><td><span class="sw" style="background:${partColor(doc, p)}"></span>${esc(name(p.id))}</td><td>${size} mm</td><td>${materialGrams(p.stats.volume, doc.technology).toFixed(1)} g</td><td>${slot ? `Slot ${slot}` : '—'}</td></tr>`;
    })
    .join('');

  const steps = order
    .map((j, k) => {
      const c = opFor(j.id);
      const type = c && c.kind === 'connector' ? CONNECTOR_TYPES.find((t) => t.value === c.type) : undefined;
      const parts2 = `<strong>${esc(name(j.b))}</strong> em <strong>${esc(name(j.a))}</strong>`;
      const how = !type
        ? 'Sem encaixe: alinhe as faces e cole.'
        : c!.kind === 'connector' && c!.type === 'dowel'
          ? `Coloque os pinos soltos (“Pinos ${j.label}”) nos furos de uma das partes, depois encaixe a outra.`
          : c!.kind === 'connector' && c!.type === 'magnet'
            ? 'Cole os ímãs nos furos das duas faces — confira a polaridade antes de a cola secar.'
            : c!.kind === 'connector' && c!.type === 'dovetail'
              ? 'Deslize uma parte sobre o trilho até o fim.'
              : `Encaixe ${type.label.toLowerCase()} no furo correspondente${c!.kind === 'connector' && c!.type === 'key' ? ' (só entra numa posição)' : ''}.`;
      const verdict = j.assemblyClear === false ? '<p class="warn">⚠ A simulação detectou colisão nesta junta — aumente a folga.</p>' : '';
      return `<section class="step"><div class="txt"><h3>Passo ${k + 1} · Junta ${esc(j.label)}</h3><p>Una ${parts2}.</p><p>${how}</p>${
        labelled.has(j.id) ? `<p class="hint">As duas faces têm “${esc(j.label)}” gravado: confira antes de colar.</p>` : ''
      }${verdict}</div><img alt="Passo ${k + 1}" src="${shots[k + 1] ?? ''}"/></section>`;
    })
    .join('');

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Guia de montagem — ${esc(doc.name)}</title>
<style>
:root{--ink:#17181b;--muted:#5e616b;--line:#e4e1da;--accent:#e85512;--bg:#faf9f6}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;color:var(--ink);background:var(--bg)}
main{max-width:920px;margin:0 auto;padding:32px 20px 64px}h1{margin:0 0 4px;font-size:28px}h2{margin:36px 0 12px;font-size:18px}
.sub{color:var(--muted);margin:0}table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:8px 6px;border-bottom:1px solid var(--line);text-align:left}
th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}.sw{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:8px;vertical-align:-1px;border:1px solid #0002}
.step{display:grid;grid-template-columns:1fr 1.4fr;gap:20px;align-items:center;padding:18px 0;border-bottom:1px solid var(--line)}
.step img,.hero{width:100%;border-radius:12px;background:#111;display:block}h3{margin:0 0 6px;color:var(--accent);font-size:16px}
.hint{color:var(--muted);font-size:13px}.warn{color:#b42318}@media(max-width:640px){.step{grid-template-columns:1fr}}
@media print{body{background:#fff}.step{break-inside:avoid}}
</style></head><body><main>
<h1>${esc(doc.name)}</h1>
<p class="sub">Guia de montagem · ${parts.length} partes · ${order.length} junta(s) · ${printerOf(doc).name} · ${doc.technology === 'FDM' ? 'FDM' : 'Resina'} · ≈ ${totalGrams.toFixed(0)} g de material sólido</p>
<h2>Visão explodida</h2><img class="hero" alt="Todas as partes separadas" src="${shots[0] ?? ''}">
<h2>Partes</h2><table><thead><tr><th>Parte</th><th>Tamanho</th><th>Material</th><th>Filamento</th></tr></thead><tbody>${partRows}</tbody></table>
<h2>Passo a passo</h2>${steps || '<p class="sub">Nenhuma junta — a peça é inteira.</p>'}
<p class="hint" style="margin-top:32px">Gerado pelo Mobios. Imprima a peça de calibração para escolher a folga ideal da sua impressora.</p>
</main></body></html>`;
  downloadBytes(html, `${safeFileName(doc.name)}-montagem.html`, 'text/html');
  toast('success', 'Guia de montagem gerado', `${order.length} passo(s) com imagens.`);
}
