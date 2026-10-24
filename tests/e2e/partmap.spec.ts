import { expect, test } from '@playwright/test';

// Etapa 1 (docs/PLANO-MULTIPARTES.md): detectar partes, juntar e desfazer.
test('exemplo → detectar partes → juntar e desfazer', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    indexedDB.deleteDatabase('mobios');
    localStorage.setItem('mobios-onboarding-done', '1');
  });
  await page.reload();

  await page.getByTestId('open-example').click();
  await page.getByRole('list', { name: 'Lista de partes' }).getByTestId('part-row').first().click();
  await page.getByRole('button', { name: 'Detectar partes' }).click();

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
