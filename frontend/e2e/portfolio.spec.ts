import { test, expect } from '@playwright/test';

test('portfolio smoke: add and remove holding', async ({ page, request }) => {
  page.on('console', (msg) => {
    // Surface frontend errors during QA runs.
    if (msg.type() === 'error') {
      console.error(`browser-console:${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => {
    console.error(`browser-pageerror:${err.message}`);
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Portfolio Atlas' })).toBeVisible();

  const existing = await request.get('http://localhost:4000/api/holdings');
  const initialCount = existing.ok()
    ? ((await existing.json()) as { holdings: Array<{ id: number }> }).holdings.length
    : 0;

  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('market-select')).toBeEnabled();
  await page.getByTestId('market-select').selectOption('NASDAQ');
  await page.getByTestId('ticker-input').fill('AAPL');
  await page.getByTestId('buy-date-input').fill('2024-01-02');
  await page.getByTestId('buy-price-input').fill('150');
  await page.getByTestId('quantity-input').fill('1');

  await expect(page.locator('.validation.valid')).toBeVisible();

  await page.getByTestId('submit-holding').click();

  const dataRows = page.locator('.table-row:not(.table-head)');
  await expect(dataRows).toHaveCount(initialCount + 1);
  const holdingRow = dataRows.first();
  await expect(holdingRow).toContainText('AAPL');

  await holdingRow.getByRole('button', { name: 'Remove' }).click();

  await expect(dataRows).toHaveCount(initialCount);
});
