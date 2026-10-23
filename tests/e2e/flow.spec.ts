import { expect, test } from '@playwright/test';

// SPEC §8: import → cut → connector → export, plus a viewport screenshot.
test('exemplo → corte com pino → exportar 3MF', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('fenda-studio'));
  await page.reload();

  await page.getByTestId('open-example').click();
  await expect(page.getByRole('listbox', { name: 'Lista de partes' })).toContainText('Figura de exemplo');

  await page.keyboard.press('c');
  await expect(page.getByText('Corte por plano', { exact: true })).toBeVisible();
  await page.getByTestId('commit-cut').click();

  const parts = page.getByRole('listbox', { name: 'Lista de partes' }).getByRole('option');
  await expect(parts).toHaveCount(2);
  await expect(page.getByLabel('Histórico')).toContainText('pino(s)');

  await page.keyboard.press('e');
  await expect(page.getByTestId('viewport')).toHaveScreenshot('explodida.png', { maxDiffPixelRatio: 0.05 });

  const download = page.waitForEvent('download');
  await page.getByTestId('export-menu').click();
  await page.getByRole('menuitem', { name: /3MF/ }).click();
  expect((await download).suggestedFilename()).toMatch(/\.3mf$/);
});
