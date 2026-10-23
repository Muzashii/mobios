import { expect, test } from '@playwright/test';

// SPEC §8: import → cut → connector → export, plus a viewport screenshot.
test('exemplo → corte com pino → exportar 3MF', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('fenda-studio');
    localStorage.setItem('fenda-onboarding-done', '1');
  });
  await page.reload();

  await page.getByTestId('open-example').click();
  const parts = page.getByRole('list', { name: 'Lista de partes' }).getByTestId('part-row');
  await expect(parts).toHaveCount(1);

  await page.keyboard.press('c');
  await expect(page.getByText('Corte por plano', { exact: true })).toBeVisible();
  await page.getByTestId('commit-cut').click();

  await expect(parts).toHaveCount(2);
  await expect(page.getByLabel('Histórico')).toContainText('sem colisão');

  await page.keyboard.press('e');
  await expect(page.getByTestId('viewport')).toHaveScreenshot('explodida.png', { maxDiffPixelRatio: 0.05 });

  const download = page.waitForEvent('download');
  await page.getByTestId('export-menu').click();
  await page.getByRole('menuitem', { name: /3MF/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.3mf$/);
});

test('tour de primeiros passos avança com as ações', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('fenda-studio');
    localStorage.removeItem('fenda-onboarding-done');
  });
  await page.reload();
  await page.getByTestId('open-example').click();
  const tour = page.getByTestId('onboarding');
  await expect(tour).toContainText('1/4');
  await page.keyboard.press('c');
  await page.getByTestId('commit-cut').click();
  await expect(tour).toContainText('3/4');
});
