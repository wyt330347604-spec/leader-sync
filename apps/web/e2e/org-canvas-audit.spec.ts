import { test, expect } from '@playwright/test';
import { devLogin, setTheme, visit } from './helpers';

// 一次性截图审计：验证 /org 交互式画布树渲染（默认树 + 显示已隐藏切换）。
// 不做基线比对，仅断言 + 落地截图到 screenshots/org-canvas-audit/。

const OUT = 'screenshots/org-canvas-audit';

test('org canvas renders (admin, light+dark)', async ({ context, page }) => {
  await devLogin(context, 'ou_dev_harvey'); // role=admin, 组织编辑白名单
  await setTheme(page, 'light');

  await visit(page, '/org');
  await expect(page.getByTestId('org-canvas')).toBeVisible();
  await page.screenshot({ path: `${OUT}/canvas-default-light.png`, fullPage: true });

  await setTheme(page, 'dark');
  await visit(page, '/org');
  await expect(page.getByTestId('org-canvas')).toBeVisible();
  await page.screenshot({ path: `${OUT}/canvas-default-dark.png`, fullPage: true });

  // 展示已隐藏（离职/手动隐藏成员）
  const toggle = page.getByRole('button', { name: /显示已隐藏/ });
  if (await toggle.isVisible()) {
    await toggle.click();
    await expect(page.getByTestId('org-canvas')).toBeVisible();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/canvas-with-hidden.png`, fullPage: true });
  }
});
