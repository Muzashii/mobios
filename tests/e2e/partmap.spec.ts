import { expect, test } from '@playwright/test';

// Mapa de partes no passo Separar: juntar e desfazer; separar tudo de uma vez.
test('exemplo → partes detectadas → juntar e desfazer', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('mobios');
    localStorage.setItem('mobios-onboarding-done', '1');
  });
  await page.reload();

  await page.getByTestId('open-example').click();

  const list = page.getByRole('list', { name: 'Partes detectadas' });
  const rows = list.getByRole('listitem');
  await expect(rows).toHaveCount(7, { timeout: 30_000 });
  const names = await list.getByRole('textbox', { name: 'Nome da parte' }).evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  for (const n of ['Tronco', 'Cabeça', 'Base', 'Braço esquerdo', 'Braço direito', 'Perna esquerda', 'Perna direita']) expect(names).toContain(n);

  await page.getByRole('combobox', { name: 'Juntar Cabeça com outra parte' }).selectOption({ label: 'Tronco' });
  await expect(rows).toHaveCount(6);
  await page.keyboard.press('Control+z');
  await expect(rows).toHaveCount(7);
});

test('separar em 7 peças: cada parte sai inteira, com pino, num passo só', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await page.evaluate(() => indexedDB.deleteDatabase('mobios'));
  await page.reload();
  await page.getByTestId('open-example').click();
  const button = page.getByTestId('split-all');
  await expect(button).toHaveText('Separar em 7 peças', { timeout: 30_000 });
  await button.click();
  const pieces = page.getByRole('list', { name: 'Lista de peças' }).getByTestId('part-row');
  await expect(pieces).toHaveCount(7, { timeout: 120_000 });
  for (const n of ['Base', 'Tronco', 'Cabeça', 'Braço esquerdo', 'Braço direito', 'Perna esquerda', 'Perna direita']) await expect(page.getByRole('list', { name: 'Lista de peças' })).toContainText(n);
  await page.getByTestId('step-fit').click();
  await expect(page.getByRole('list', { name: 'Juntas' }).getByRole('listitem')).toHaveCount(6);
  await page.keyboard.press('Control+z');
  await expect(pieces).toHaveCount(1);
});
