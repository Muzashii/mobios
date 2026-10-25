import { add, dot, scale, sub } from '../../geometry/math';
import type { CutProfile, Vec3 } from '../../geometry/types';
import type { RegionCutMode } from '../../geometry/types';
import { useUI, type CutDraft } from '../../store/ui';
import { Button, cx, Field, Kbd, mm, NumberInput, Section, Segmented, Slider, Switch } from '../../ui/components';
import { IconAlert, IconCheck, IconX } from '../../ui/icons';
import { ConnectorFields } from '../connectors/ConnectorFields';
import { cancelCut, commitCut, DEFAULT_PROFILE, draftAllowsConnector, draftOffsetRange, flipNormal, HINTS, selectCandidate, snapAxis, startBrush, startDraw, updateDraft, updateRegion } from './cutActions';

const AXES = ['X', 'Y', 'Z'] as const;

/** Spherical angles of the normal (degrees) for numeric editing. */
function anglesOf(n: Vec3) {
  const tilt = (Math.acos(Math.max(-1, Math.min(1, n[2]))) * 180) / Math.PI;
  const heading = (Math.atan2(n[1], n[0]) * 180) / Math.PI;
  return { tilt, heading };
}
function normalFrom(tilt: number, heading: number): Vec3 {
  const t = (tilt * Math.PI) / 180, h = (heading * Math.PI) / 180;
  return [Math.sin(t) * Math.cos(h), Math.sin(t) * Math.sin(h), Math.cos(t)];
}

/**
 * Live pre-validation: the worker runs the real cut while the draft changes. Errors stay here
 * (not just in a toast) with the fix the engine suggests.
 */
function CheckBanner() {
  const check = useUI((s) => s.cutCheck);
  if (!check) return null;
  const r = check.result;
  if (!r) return <div className="border-t border-line px-3 py-2 text-[11px] text-muted" aria-live="polite">Validando o corte…</div>;
  if (!r.ok) {
    return (
      <div role="alert" className="space-y-1.5 border-t border-danger/40 bg-danger/5 px-3 py-2" data-testid="cut-error">
        <div className="flex items-start gap-1.5 text-[11px] text-danger">
          <IconAlert size={14} className="mt-px shrink-0" />
          <span>{r.error}</span>
        </div>
        {r.hint && (
          <Button size="sm" variant="subtle" className="w-full" onClick={HINTS[r.hint].run}>
            {HINTS[r.hint].label}
          </Button>
        )}
      </div>
    );
  }
  const total = r.volumeA + r.volumeB || 1;
  return (
    <div className={cx('space-y-0.5 border-t border-line px-3 py-2 text-[11px]', check.pending && 'opacity-60')} aria-live="polite" data-testid="cut-ok">
      <div className="text-success">
        ✓ Vai gerar {r.piecesA + r.piecesB} peça{r.piecesA + r.piecesB > 1 ? 's' : ''} · B com {mm((r.volumeB / total) * 100, 0)}% do volume
      </div>
      {r.piecesB > 1 && <div className="text-warning">A parte B sai em {r.piecesB} ilhas separadas.</div>}
      {r.warnings.map((w) => (
        <div key={w} className="text-warning">⚠ {w}</div>
      ))}
    </div>
  );
}

function Footer() {
  const blocked = useUI((s) => s.cutCheck?.result?.ok === false && !s.cutCheck.pending);
  const batch = useUI((s) => s.draft?.batch?.length ?? 0);
  return (
    <>
      <CheckBanner />
      <div className="flex gap-2 border-t border-line p-3">
        <Button variant="ghost" className="flex-1" onClick={cancelCut}>
          <IconX size={15} /> Cancelar <Kbd>Esc</Kbd>
        </Button>
        <Button variant="primary" className="flex-1" disabled={blocked} onClick={() => void commitCut()} data-testid="commit-cut">
          <IconCheck size={15} /> {batch ? `Cortar ${batch + 1}` : 'Cortar'} <Kbd>Enter</Kbd>
        </Button>
      </div>
    </>
  );
}

type ProfileKind = 'flat' | CutProfile['kind'];

function ProfileSection({ draft }: { draft: CutDraft }) {
  const p = draft.profile;
  const kind: ProfileKind = p && p.amplitude > 0 ? p.kind : 'flat';
  const set = (patch: Partial<CutProfile>) => updateDraft({ profile: { ...(p ?? DEFAULT_PROFILE), ...patch } });
  return (
    <Section title="Perfil da junta">
      <Segmented<ProfileKind>
        label="Perfil da junta"
        value={kind}
        onChange={(k) => updateDraft({ profile: k === 'flat' ? null : { ...(p ?? DEFAULT_PROFILE), kind: k, amplitude: p?.amplitude || DEFAULT_PROFILE.amplitude } })}
        options={[
          { value: 'flat', label: 'Reto' },
          { value: 'step', label: 'Degrau' },
          { value: 'zigzag', label: 'Zigue' },
          { value: 'wave', label: 'Onda' },
        ]}
      />
      {kind !== 'flat' && (
        <>
          <p className="text-[11px] leading-snug text-muted">Esconde a emenda e trava a rotação sem pinos. O preview colorido mostra o plano médio; a linha laranja mostra o perfil.</p>
          <Field label="Altura">{(id) => <NumberInput id={id} value={p!.amplitude} min={0.5} max={50} step={0.5} digits={1} onChange={(amplitude) => set({ amplitude })} />}</Field>
          {kind !== 'step' && <Field label="Passo">{(id) => <NumberInput id={id} value={p!.period} min={2} max={200} step={1} digits={1} onChange={(period) => set({ period })} />}</Field>}
        </>
      )}
    </Section>
  );
}

function SurfaceCutInspector({ draft }: { draft: CutDraft }) {
  const part = useUI((s) => s.parts.find((p) => p.id === draft.target));
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={draft.editingOpId ? 'Editar corte livre' : 'Corte por curva livre'} aside={<span className="truncate text-[11px] text-muted">{part?.name}</span>}>
          <p className="text-[11px] leading-snug text-muted">
            O traço vira uma superfície que atravessa a peça na direção em que você olhava. As setas laranja apontam para a parte B.
          </p>
          <div className="flex gap-1.5">
            <Button size="sm" className="flex-1" onClick={flipNormal}>
              ⇅ Inverter lado
            </Button>
            {!draft.editingOpId && (
              <Button size="sm" className="flex-1" onClick={() => startDraw(draft.target)}>
                Redesenhar
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted">
            Pontos do traço: <span className="num text-text">{draft.surface?.points.length ?? 0}</span>
          </p>
        </Section>
        <Section title="Encaixe">
          <p className="text-[11px] text-muted">Encaixes por pino precisam de um corte plano. Uma curva já trava a montagem por si.</p>
        </Section>
      </div>
      <Footer />
    </div>
  );
}

export function CutInspector({ draft }: { draft: CutDraft }) {
  if (draft.mode === 'surface') return <SurfaceCutInspector draft={draft} />;
  if (draft.mode === 'region') return <RegionCutInspector draft={draft} />;
  return <PlaneCutInspector draft={draft} />;
}

const MODES: { value: RegionCutMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'surface', label: 'Curvo' },
  { value: 'plane', label: 'Plano' },
  { value: 'shell', label: 'Casca' },
];

const MODE_HINT: Record<RegionCutMode, string> = {
  auto: 'Junta curva que segue o contorno; se não for possível, corte plano.',
  surface: 'A emenda segue exatamente o contorno (ombro, pescoço, cintura). Centro plano para pino e numeração.',
  plane: 'Corte reto no plano médio do contorno; só a parte marcada sai.',
  shell: 'Sai como uma casca com espessura (cabelo, capacete, capa). A peça fica com um rebaixo que encaixa sozinho.',
};

/** SmartCut v2 review: candidates (Tab), how the part leaves, name, shift along the limb. */
function RegionCutInspector({ draft }: { draft: CutDraft }) {
  const part = useUI((s) => s.parts.find((p) => p.id === draft.target));
  const r = draft.region!;
  const allowsConnector = draftAllowsConnector(draft);
  const base = r.candidates[r.index]?.level ?? r.level;
  const byParts = !!r.partSeeds?.length;
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={draft.editingOpId ? 'Editar corte SmartCut' : 'SmartCut — revisar'} aside={<span className="truncate text-[11px] text-muted">{part?.name}</span>}>
          <p className="text-[11px] leading-snug text-muted">Laranja = a parte que sai. Gire a vista para conferir o outro lado. <Kbd>Enter</Kbd> corta, <Kbd>Esc</Kbd> cancela.</p>
          {!byParts && r.candidates.length > 0 && (
            <div className="space-y-1" role="listbox" aria-label="Sugestões">
              {r.candidates.map((c, i) => (
                <button
                  key={i}
                  role="option"
                  aria-selected={i === r.index}
                  onClick={() => selectCandidate(i)}
                  className={cx('flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-left text-[11px]', i === r.index ? 'border-accent bg-accent-soft' : 'border-line hover:border-muted')}
                >
                  <span>
                    {i + 1}. {c.name ?? 'Parte'} <span className="text-muted">· {mm(c.areaShare * 100, 0)}% da superfície · anel {mm(c.perimeter, 0)} mm</span>
                  </span>
                  <span className={cx('num', c.confidence > 0.35 ? 'text-success' : 'text-muted')}>{mm(c.confidence * 100, 0)}%</span>
                </button>
              ))}
              {r.candidates.length > 1 && (
                <p className="text-[11px] text-muted">
                  <Kbd>Tab</Kbd> próxima sugestão
                </p>
              )}
            </div>
          )}
          {draft.batch?.length ? <p className="text-[11px] text-accent">+ {draft.batch.length} outra(s) região(ões) pincelada(s) serão cortadas junto.</p> : null}
          <Field label="Nome da parte">{(id) => <input id={id} className="h-7 w-full rounded-md border border-line bg-surface-2 px-2 text-xs" value={r.name} placeholder="Ex.: Cabeça" onChange={(e) => updateRegion({ name: e.target.value })} />}</Field>
          {!byParts && (
          <Field label="Deslocar ao longo">
            {(id) => (
              <div className="space-y-1.5">
                <NumberInput id={id} value={r.level} min={0.5} step={0.5} digits={1} unit="mm" onChange={(level) => updateRegion({ level })} />
                <Slider label="Deslocar a emenda" value={r.level} min={Math.max(0.5, base * 0.4)} max={base * 1.8 + 2} step={0.25} onChange={(level) => updateRegion({ level })} />
              </div>
            )}
          </Field>
          )}
        </Section>
        {byParts ? (
          <Section title="Parte escolhida">
            <p className="text-[11px] leading-snug text-muted">A emenda vai para o vinco entre as partes. Onde nenhuma tampa cabe (cabelo comprido), o corte segue o meio entre as partes.</p>
            <Button size="sm" variant="ghost" className="w-full" onClick={() => startBrush(draft.target)}>
              Escolher outra parte
            </Button>
          </Section>
        ) : (
        <Section title="Como a parte sai">
          <Segmented<RegionCutMode> label="Modo do corte" value={r.mode} onChange={(mode) => updateRegion({ mode })} options={MODES} />
          <p className="text-[11px] leading-snug text-muted">{MODE_HINT[r.mode]}</p>
          {r.mode === 'shell' && (
            <Field label="Profundidade">
              {(id) => (
                <div className="space-y-1.5">
                  <NumberInput id={id} value={r.depth} min={0.6} max={20} step={0.5} digits={1} unit="mm" onChange={(depth) => updateRegion({ depth })} />
                  <Slider label="Profundidade da casca" value={r.depth} min={0.6} max={10} step={0.1} onChange={(depth) => updateRegion({ depth })} />
                </div>
              )}
            </Field>
          )}
          <Button size="sm" variant="ghost" className="w-full" onClick={() => startBrush(draft.target)}>
            Pincelar de novo
          </Button>
        </Section>
        )}
        {allowsConnector && (
          <Section title="Numeração gravada" aside={<Switch label="Numerar faces" checked={draft.label} onChange={(label) => updateDraft({ label })} />}>
            <p className="text-[11px] leading-snug text-muted">Gravada no centro plano da junta, longe dos encaixes.</p>
          </Section>
        )}
        <Section
          title="Encaixe"
          aside={allowsConnector && <Switch label="Adicionar encaixe" checked={draft.connector.enabled} onChange={(enabled) => updateDraft({ connector: { ...draft.connector, enabled } })} />}
        >
          {!allowsConnector ? (
            <p className="text-[11px] text-muted">A casca encaixa no próprio rebaixo — pinos não são necessários.</p>
          ) : draft.connector.enabled ? (
            <>
              <p className="text-[11px] text-muted">O pino vai no centro plano da junta. Se não couber, o corte continua e você recebe um aviso.</p>
              <ConnectorFields value={draft.connector} onChange={(v) => updateDraft({ connector: { ...draft.connector, ...v } })} />
            </>
          ) : (
            <p className="text-[11px] text-muted">Sem conectores: as partes serão só separadas.</p>
          )}
        </Section>
      </div>
      <Footer />
    </div>
  );
}

function PlaneCutInspector({ draft }: { draft: CutDraft }) {
  const part = useUI((s) => s.parts.find((p) => p.id === draft.target));
  const range = draftOffsetRange(draft);
  const n = draft.plane.normal;
  const offset = dot(sub(draft.plane.origin, range.center), n);
  const { tilt, heading } = anglesOf(draft.plane.normal);
  const allowsConnector = draftAllowsConnector(draft);

  const setOffset = (v: number) => {
    // Move along the normal, keeping the in-plane position.
    updateDraft({ plane: { ...draft.plane, origin: add(draft.plane.origin, scale(n, v - offset)) } });
  };
  const setOrigin = (axis: number, v: number) => {
    const origin = [...draft.plane.origin] as Vec3;
    origin[axis] = v;
    updateDraft({ plane: { ...draft.plane, origin } });
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={draft.smartRing ? 'SmartCut — revisar' : draft.editingOpId ? 'Editar corte' : 'Corte por plano'} aside={<span className="truncate text-[11px] text-muted">{part?.name}</span>}>
          <p className="text-[11px] leading-snug text-muted">
            Arraste o gizmo no viewport ou ajuste os valores. Azul = parte A, laranja = parte B (lado da seta).
          </p>
          <Field label="Alinhar a">
            {() => (
              <div className="flex gap-1">
                {AXES.map((a, i) => (
                  <Button key={a} size="sm" variant={Math.abs(draft.plane.normal[i]) > 0.999 ? 'primary' : 'subtle'} className="flex-1" onClick={() => snapAxis(i as 0 | 1 | 2)}>
                    {a}
                  </Button>
                ))}
                <Button size="sm" variant="subtle" onClick={flipNormal} title="Inverter lado (A ↔ B)">
                  ⇅
                </Button>
              </div>
            )}
          </Field>
          <Field label="Posição">
            {(id) => (
              <div className="space-y-1.5">
                <NumberInput id={id} value={offset} step={0.5} onChange={setOffset} />
                <Slider label="Posição do plano" value={Math.max(range.min, Math.min(range.max, offset))} min={range.min} max={range.max} step={0.1} onChange={setOffset} />
              </div>
            )}
          </Field>
          <Field label="Inclinação">{(id) => <NumberInput id={id} value={tilt} unit="°" step={1} digits={1} onChange={(v) => updateDraft({ plane: { ...draft.plane, normal: normalFrom(v, heading) } })} />}</Field>
          <Field label="Direção">{(id) => <NumberInput id={id} value={heading} unit="°" step={1} digits={1} onChange={(v) => updateDraft({ plane: { ...draft.plane, normal: normalFrom(tilt, v) } })} />}</Field>
          <Field label="Origem X/Y/Z">
            {() => (
              <div className="grid grid-cols-3 gap-1">
                {[0, 1, 2].map((i) => (
                  <NumberInput key={i} value={draft.plane.origin[i]} unit="" step={0.5} digits={1} onChange={(v) => setOrigin(i, v)} />
                ))}
              </div>
            )}
          </Field>
        </Section>

        <ProfileSection draft={draft} />

        <Section title="Corte limitado" aside={<Switch label="Corte limitado" checked={draft.bounded} onChange={(bounded) => updateDraft({ bounded })} />}>
          <p className="text-[11px] leading-snug text-muted">
            Separa só a "ilha" cuja face de corte fica (na maior parte) dentro da esfera — ex.: tirar um braço sem cortar o tronco. Funciona também com perfil.
          </p>
          {draft.bounded && (
            <Field label="Raio">
              {(id) => (
                <div className="space-y-1.5">
                  <NumberInput id={id} value={draft.radius} min={1} step={1} digits={1} onChange={(radius) => updateDraft({ radius })} />
                  <Slider label="Raio do limite" value={draft.radius} min={1} max={range.max * 1.5} step={0.5} onChange={(radius) => updateDraft({ radius })} />
                </div>
              )}
            </Field>
          )}
        </Section>

        {allowsConnector && (
          <Section title="Numeração gravada" aside={<Switch label="Numerar faces" checked={draft.label} onChange={(label) => updateDraft({ label })} />}>
            <p className="text-[11px] leading-snug text-muted">Grava o código da junta (J1, J2…) em baixo-relevo nas duas faces, longe dos encaixes.</p>
          </Section>
        )}

        <Section
          title="Encaixe"
          aside={
            allowsConnector && <Switch
              label="Adicionar encaixe"
              checked={draft.connector.enabled}
              onChange={(enabled) => updateDraft({ connector: { ...draft.connector, enabled } })}
            />
          }
        >
          {!allowsConnector ? (
            <p className="text-[11px] text-muted">Com perfil, a própria junta trava a rotação — encaixes por pino ficam desativados.</p>
          ) : draft.connector.enabled ? (
            <ConnectorFields value={draft.connector} onChange={(v) => updateDraft({ connector: { ...draft.connector, ...v } })} />
          ) : (
            <p className="text-[11px] text-muted">Sem conectores: as partes serão só separadas.</p>
          )}
        </Section>
      </div>
      <Footer />
    </div>
  );
}
