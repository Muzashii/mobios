import { expect, test, type Page } from '@playwright/test';

// SmartCut v2 and Raio-X (docs/PLANO-SMARTCUT-V2.md, Fase G):
// import a broken STL → Raio-X → repair; example → hover the head → click → Enter → curved joint.

async function fresh(page: Page) {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('mobios');
    localStorage.setItem('mobios-onboarding-done', '1');
  });
  await page.reload();
}

/** Cube without its top face plus a speck of debris, as ASCII STL. */
function brokenCube() {
  const cube = (s: number, o: number[]) => {
    const v = (x: number, y: number, z: number) => [o[0] + x * s, o[1] + y * s, o[2] + z * s];
    const P = [v(0, 0, 0), v(1, 0, 0), v(1, 1, 0), v(0, 1, 0), v(0, 0, 1), v(1, 0, 1), v(1, 1, 1), v(0, 1, 1)];
    const F = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7]];
    return F.map((f) => f.map((i) => P[i]));
  };
  const tris = [...cube(30, [0, 0, 0]).filter((_, i) => i !== 2 && i !== 3), ...cube(0.4, [60, 0, 0])];
  const facets = tris.map((t) => `facet normal 0 0 0\nouter loop\n${t.map((p) => `vertex ${p.join(' ')}`).join('\n')}\nendloop\nendfacet`);
  return Buffer.from(`solid t\n${facets.join('\n')}\nendsolid t\n`);
}

test('importar não trava no reparo; "Reparar malha" abre o Raio-X depois', async ({ page }) => {
  await fresh(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Abrir arquivo/ }).first().click();
  await (await chooser).setFiles({ name: 'cubo-quebrado.stl', mimeType: 'model/stl', buffer: brokenCube() });
  // The model comes straight in: only the lossless fixes (hole closed, debris dropped).
  await expect(page.getByTestId('xray')).toHaveCount(0);
  await expect(page.getByLabel('Histórico')).toContainText('Raio-X: 1 furo(s) fechado(s)');
  const parts = page.getByRole('list', { name: 'Lista de peças' });
  await expect(parts).toContainText('27');
  // The full Raio-X stays one click away, in the Modelo step.
  await page.getByTestId('step-model').click();
  await page.getByRole('button', { name: 'Reparar malha' }).click();
  const panel = page.getByTestId('xray');
  await expect(panel).toContainText('Reparar malha', { timeout: 30_000 });
  await page.getByRole('button', { name: /Cancelar/ }).click();
  await expect(panel).toHaveCount(0);
});

test('SmartCut: hover acende a cabeça inteira → clique → Enter → corta', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('open-example').click();
  const parts = page.getByRole('list', { name: 'Lista de peças' }).getByTestId('part-row');
  await expect(parts).toHaveCount(1);
  // A first model opens the Separar step: its parts are recognised and shown in colour.
  await expect(page.getByTestId('split-all')).toBeVisible({ timeout: 30_000 });
  const viewport = page.getByTestId('viewport');
  const box = (await viewport.boundingBox())!;
  // The example is framed with the head near the top centre of the viewport.
  const head = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.27 };
  await page.mouse.move(head.x, head.y);
  await page.mouse.move(head.x + 2, head.y + 1);
  await page.mouse.click(head.x + 2, head.y + 1);
  await expect(page.getByText('SmartCut — revisar')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('cut-ok')).toContainText('Vai gerar 2 peças', { timeout: 30_000 });
  await page.keyboard.press('Enter');
  await expect(parts).toHaveCount(2, { timeout: 60_000 });
  const history = page.getByLabel('Histórico');
  await expect(history).toContainText('Cabeça');
  await expect(history).toContainText(/junta (curva|livre)/);
});

test('corte que não atravessa a peça é explicado e não é aplicado', async ({ page }) => {
  await fresh(page);
  await page.getByTestId('open-example').click();
  await page.keyboard.press('c');
  const pos = page.getByLabel('Posição', { exact: true });
  await pos.fill('400');
  await pos.press('Tab');
  await expect(page.getByTestId('cut-error')).toContainText('não atravessa');
  await expect(page.getByTestId('commit-cut')).toBeDisabled();
  await page.getByRole('button', { name: 'Centralizar o plano na peça' }).click();
  await expect(page.getByTestId('cut-ok')).toBeVisible();
});
