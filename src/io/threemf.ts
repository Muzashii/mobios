import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { MeshData } from '../geometry/types';
import type { NamedMesh } from './obj';

// 3MF transforms are row-vector 4x3: x' = x*m00 + y*m10 + z*m20 + m30.
type Mat = number[];
const IDENTITY: Mat = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

const parseMatrix = (s: string | undefined): Mat => (s ? s.trim().split(/\s+/).map(Number) : IDENTITY);
const multiply = (a: Mat, b: Mat): Mat => {
  // Apply a then b.
  const r: Mat = new Array(12).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      let v = row === 3 ? b[9 + col] : 0;
      for (let k = 0; k < 3; k++) v += a[row * 3 + k] * b[k * 3 + col];
      r[row * 3 + col] = v;
    }
  }
  return r;
};

const UNIT_SCALE: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 };

const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m?.[1];
};

interface ObjectDef {
  name?: string;
  mesh?: MeshData;
  components: { path?: string; id: string; transform: Mat }[];
}

function parseModel(xml: string, path: string, objects: Map<string, ObjectDef>) {
  const unit = attr(/<model[^>]*>/.exec(xml)?.[0] ?? '', 'unit') ?? 'millimeter';
  const s = UNIT_SCALE[unit] ?? 1;
  const objRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/g;
  let m: RegExpExecArray | null;
  while ((m = objRe.exec(xml))) {
    const head = m[1], body = m[2];
    const id = attr(head, 'id')!;
    const def: ObjectDef = { name: attr(head, 'name'), components: [] };
    const vertsBlock = /<vertices>([\s\S]*?)<\/vertices>/.exec(body);
    if (vertsBlock) {
      const verts: number[] = [];
      const vRe = /<vertex\b([^>]*)\/?>/g;
      let v: RegExpExecArray | null;
      while ((v = vRe.exec(vertsBlock[1]))) verts.push(+attr(v[1], 'x')! * s, +attr(v[1], 'y')! * s, +attr(v[1], 'z')! * s);
      const tris: number[] = [];
      const tRe = /<triangle\b([^>]*)\/?>/g;
      let t: RegExpExecArray | null;
      while ((t = tRe.exec(body))) tris.push(+attr(t[1], 'v1')!, +attr(t[1], 'v2')!, +attr(t[1], 'v3')!);
      def.mesh = { positions: Float32Array.from(verts), indices: Uint32Array.from(tris) };
    }
    const cRe = /<component\b([^>]*)\/?>/g;
    let c: RegExpExecArray | null;
    while ((c = cRe.exec(body))) {
      def.components.push({ path: attr(c[1], 'p:path'), id: attr(c[1], 'objectid')!, transform: parseMatrix(attr(c[1], 'transform')) });
    }
    objects.set(`${path}#${id}`, def);
  }
  const items: { id: string; transform: Mat; path?: string }[] = [];
  const iRe = /<item\b([^>]*)\/?>/g;
  let it: RegExpExecArray | null;
  while ((it = iRe.exec(xml))) items.push({ id: attr(it[1], 'objectid')!, transform: parseMatrix(attr(it[1], 'transform')), path: attr(it[1], 'p:path') });
  return items;
}

function transformed(mesh: MeshData, t: Mat): MeshData {
  const p = mesh.positions;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = x * t[0] + y * t[3] + z * t[6] + t[9];
    out[i + 1] = x * t[1] + y * t[4] + z * t[7] + t[10];
    out[i + 2] = x * t[2] + y * t[5] + z * t[8] + t[11];
  }
  return { positions: out, indices: mesh.indices };
}

function mergeMeshes(meshes: MeshData[]): MeshData {
  const vCount = meshes.reduce((s, m) => s + m.positions.length, 0);
  const iCount = meshes.reduce((s, m) => s + m.indices.length, 0);
  const positions = new Float32Array(vCount), indices = new Uint32Array(iCount);
  let vo = 0, io = 0;
  for (const m of meshes) {
    positions.set(m.positions, vo);
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo / 3;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}

/** Reads every build item of a 3MF as its own mesh (components flattened, transforms applied). */
export function parse3MF(data: Uint8Array, fallbackName = '3MF'): NamedMesh[] {
  const files = unzipSync(data, { filter: (f) => f.name.toLowerCase().endsWith('.model') });
  const objects = new Map<string, ObjectDef>();
  let rootPath = '';
  let items: ReturnType<typeof parseModel> = [];
  for (const [name, bytes] of Object.entries(files)) {
    const path = '/' + name.replace(/^\/+/, '');
    const found = parseModel(strFromU8(bytes), path, objects);
    if (/3d\/3dmodel\.model$/i.test(path)) {
      rootPath = path;
      items = found;
    }
  }
  if (!rootPath) throw new Error('3MF sem 3D/3dmodel.model.');

  const collect = (path: string, id: string, t: Mat, out: MeshData[], depth = 0): string | undefined => {
    const def = objects.get(`${path}#${id}`);
    if (!def || depth > 16) return undefined;
    if (def.mesh && def.mesh.indices.length) out.push(transformed(def.mesh, t));
    for (const c of def.components) collect(c.path ?? path, c.id, multiply(c.transform, t), out, depth + 1);
    return def.name;
  };

  const result: NamedMesh[] = [];
  items.forEach((item, i) => {
    const meshes: MeshData[] = [];
    const name = collect(item.path ?? rootPath, item.id, item.transform, meshes);
    if (meshes.length) result.push({ name: name || `${fallbackName} ${i + 1}`, mesh: mergeMeshes(meshes) });
  });
  if (!result.length) throw new Error('3MF sem malhas.');
  return result;
}

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);

export interface ThreeMFPart {
  name: string;
  mesh: MeshData;
  color: string;
  /** 1-based filament slot (AMS). */
  slot: number;
}

/**
 * 3MF with one object per part. Includes core basematerials (display colours) and
 * Bambu Studio's Metadata/model_settings.config so each object lands on its filament slot.
 */
export function write3MF(parts: ThreeMFPart[], opts: { layout?: 'assembled' | 'grid'; spacing?: number } = {}): Uint8Array {
  const layout = opts.layout ?? 'grid';
  const spacing = opts.spacing ?? 6;
  const offsets = parts.map(() => [0, 0, 0]);
  if (layout === 'grid') {
    const boxes = parts.map(({ mesh }) => {
      const p = mesh.positions;
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      for (let i = 0; i < p.length; i += 3) for (let k = 0; k < 3; k++) {
        if (p[i + k] < min[k]) min[k] = p[i + k];
        if (p[i + k] > max[k]) max[k] = p[i + k];
      }
      return { min, max };
    });
    const cols = Math.ceil(Math.sqrt(parts.length));
    let x = 0, y = 0, rowH = 0;
    boxes.forEach((b, i) => {
      if (i > 0 && i % cols === 0) { x = 0; y += rowH + spacing; rowH = 0; }
      offsets[i] = [x - b.min[0], y - b.min[1], -b.min[2]];
      x += b.max[0] - b.min[0] + spacing;
      rowH = Math.max(rowH, b.max[1] - b.min[1]);
    });
  }

  const objects = parts.map((part, i) => {
    const { positions: p, indices: t } = part.mesh;
    const v: string[] = [];
    for (let k = 0; k < p.length; k += 3) v.push(`<vertex x="${+p[k].toFixed(5)}" y="${+p[k + 1].toFixed(5)}" z="${+p[k + 2].toFixed(5)}"/>`);
    const f: string[] = [];
    for (let k = 0; k < t.length; k += 3) f.push(`<triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>`);
    return `<object id="${i + 2}" name="${esc(part.name)}" type="model" pid="1" pindex="${i}"><mesh><vertices>${v.join('')}</vertices><triangles>${f.join('')}</triangles></mesh></object>`;
  });
  const materials = parts.map((p) => `<base name="${esc(p.name)}" displaycolor="${p.color.toUpperCase()}FF"/>`).join('');
  const items = parts
    .map((_, i) => `<item objectid="${i + 2}" transform="1 0 0 0 1 0 0 0 1 ${offsets[i].map((n) => +n.toFixed(4)).join(' ')}" printable="1"/>`)
    .join('');
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="pt-BR" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Fenda Studio</metadata>
<resources><basematerials id="1">${materials}</basematerials>${objects.join('')}</resources>
<build>${items}</build>
</model>`;

  const settings = `<?xml version="1.0" encoding="UTF-8"?>
<config>
${parts
  .map(
    (p, i) => `  <object id="${i + 2}">
    <metadata key="name" value="${esc(p.name)}"/>
    <metadata key="extruder" value="${p.slot}"/>
    <part id="1" subtype="normal_part">
      <metadata key="name" value="${esc(p.name)}"/>
      <metadata key="extruder" value="${p.slot}"/>
    </part>
  </object>`,
  )
  .join('\n')}
</config>`;

  return zipSync(
    {
      '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
<Default Extension="config" ContentType="text/xml"/>
</Types>`),
      '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`),
      '3D/3dmodel.model': strToU8(model),
      'Metadata/model_settings.config': strToU8(settings),
    },
    { level: 6 },
  );
}
