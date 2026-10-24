// Lab viewer: renders a mesh from .lab/ in 4 views, faces coloured by an optional label file.
// URL: /tests/lab/viewer/index.html?mesh=p60000&labels=seg1&parts=a,b (parts = extra meshes, exploded)
import * as THREE from 'three';
import { toDisplayMesh } from '../../../src/geometry/display';

const q = new URLSearchParams(location.search);
const base = '/.lab/';
const fetchBin = async (name: string) => {
  const r = await fetch(base + name);
  if (!r.ok) throw new Error(name + ' ' + r.status);
  return r.arrayBuffer();
};

const PALETTE = [
  0xd9d4ca, 0xff6b2c, 0x3a86ff, 0x3dd68c, 0xc3a6d8, 0xf5b544, 0x86c5c0, 0xe59a9a, 0xa7b6e8, 0x9bc89b, 0xff4d8d, 0x8d6e63,
  0x00bcd4, 0xcddc39, 0x7e57c2, 0xff9800, 0x607d8b, 0xe91e63, 0x4caf50, 0x9c27b0,
];

async function loadMesh(name: string, labelsName?: string) {
  const pos = new Float32Array(await fetchBin(`${name}.pos.bin`));
  const idx = new Uint32Array(await fetchBin(`${name}.idx.bin`));
  const labels = labelsName ? new Int32Array(await fetchBin(`${labelsName}.lab.bin`)) : null;
  const nf = idx.length / 3;
  const p = new Float32Array(nf * 9);
  const c = new Float32Array(nf * 9);
  const col = new THREE.Color();
  for (let f = 0; f < nf; f++) {
    const l = labels ? labels[f] : 0;
    col.setHex(l < 0 ? 0x222222 : PALETTE[l % PALETTE.length]);
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k];
      p.set(pos.subarray(v * 3, v * 3 + 3), f * 9 + k * 3);
      c[f * 9 + k * 3] = col.r;
      c[f * 9 + k * 3 + 1] = col.g;
      c[f * 9 + k * 3 + 2] = col.b;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  g.computeVertexNormals();
  return g;
}

async function main() {
  THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x333333, 1.6));
  const dl = new THREE.DirectionalLight(0xffffff, 1.4);
  scene.add(dl);
  const group = new THREE.Group();
  scene.add(group);
  const meshName = q.get('mesh') ?? 'p60000';
  const geoms: THREE.BufferGeometry[] = [];
  if (q.get('parts')) {
    for (const n of q.get('parts')!.split(',')) {
      if (q.get('shade') === 'app') {
        // Same normals as the app (creased at 35°), instead of flat shading.
        const d = toDisplayMesh({ positions: new Float32Array(await fetchBin(`${n}.pos.bin`)), indices: new Uint32Array(await fetchBin(`${n}.idx.bin`)) });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(d.positions, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(d.normals, 3));
        geoms.push(g);
      } else geoms.push(await loadMesh(n));
    }
  } else {
    geoms.push(await loadMesh(meshName, q.get('labels') ?? undefined));
  }
  const box = new THREE.Box3();
  geoms.forEach((g) => (g.computeBoundingBox(), box.union(g.boundingBox!)));
  const center = box.getCenter(new THREE.Vector3());
  const explode = Number(q.get('explode') ?? 0);
  geoms.forEach((g, i) => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: !q.get('parts'), color: q.get('parts') ? PALETTE[(i + 1) % PALETTE.length] : 0xffffff, flatShading: q.get('shade') !== 'app', roughness: 0.7 });
    const m = new THREE.Mesh(g, mat);
    if (explode) {
      const c = g.boundingBox!.getCenter(new THREE.Vector3()).sub(center).multiplyScalar(explode);
      m.position.copy(c);
    }
    group.add(m);
  });
  const size = box.getSize(new THREE.Vector3()).length();
  const custom = q.get('cams')?.split(';').map((c): [string, THREE.Vector3] => [c, new THREE.Vector3(...(c.split(',').map(Number) as [number, number, number]))]);
  const zoom = Number(q.get('zoom') ?? 1);
  const target = q.get('at') ? new THREE.Vector3(...(q.get('at')!.split(',').map(Number) as [number, number, number])) : null;
  const views: [string, THREE.Vector3][] = custom ?? [
    ['frente (-Y)', new THREE.Vector3(0, -1, 0.15)],
    ['costas (+Y)', new THREE.Vector3(0, 1, 0.15)],
    ['esquerda (-X)', new THREE.Vector3(-1, -0.25, 0.15)],
    ['direita (+X)', new THREE.Vector3(1, -0.25, 0.15)],
  ];
  const grid = document.getElementById('grid')!;
  if (views.length === 1) grid.style.gridTemplateColumns = grid.style.gridTemplateRows = '1fr';
  for (const [name, dir] of views) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    cell.innerHTML = `<span>${name}</span>`;
    const canvas = document.createElement('canvas');
    cell.appendChild(canvas);
    grid.appendChild(cell);
    const r = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(1);
    const w = cell.clientWidth, h = cell.clientHeight;
    r.setSize(w, h, false);
    const cam = new THREE.PerspectiveCamera(30, w / h, 0.1, size * 20);
    cam.up.set(0, 0, 1);
    const look = target ?? center;
    cam.position.copy(look).addScaledVector(dir.normalize(), (size * 1.55) / zoom);
    cam.lookAt(look);
    dl.position.copy(cam.position).add(new THREE.Vector3(0, 0, size));
    r.setClearColor(0x161616);
    r.render(scene, cam);
  }
  document.body.dataset.ready = '1';
}

main().catch((e) => {
  document.body.innerText = String(e);
  document.body.dataset.ready = 'error';
});
