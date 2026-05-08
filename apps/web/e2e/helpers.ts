import { type BrowserContext, type Page, expect } from '@playwright/test';

export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:3001';
export const DEV_USER_ID = process.env.E2E_DEV_USER_ID ?? 'ou_dev_harvey';

/** Acquire dev JWT and inject as cookie on the given context. */
export async function devLogin(context: BrowserContext, userId = DEV_USER_ID) {
  const resp = await fetch(`${API_URL}/api/v1/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId }),
  });
  if (!resp.ok) {
    throw new Error(
      `dev-login failed (${resp.status}). Make sure API runs with NODE_ENV=development and seed is loaded.`,
    );
  }
  const json: any = await resp.json();
  const token = json?.token ?? json?.data?.token;
  if (!token) throw new Error('No token in dev-login response');

  // Cookie domain must match the page's host. Use both localhost and 127.0.0.1
  for (const domain of ['localhost', '127.0.0.1']) {
    await context.addCookies([
      {
        name: 'token',
        value: token,
        domain,
        path: '/',
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
      },
    ]);
  }
}

/** Force a stable theme so screenshots are deterministic. */
export async function setTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem('theme', t);
    } catch {}
    document.documentElement.setAttribute('data-theme', t);
  }, theme);
}

/** Visit a path and wait for SWR / animations to settle. */
export async function visit(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700); // grace for transitions
}

/** Stable snapshot wrapper — masks dynamic regions like dates that drift. */
export async function snap(
  page: Page,
  name: string,
  opts: { mask?: string[]; fullPage?: boolean } = {},
) {
  const masks = (opts.mask ?? []).map((s) => page.locator(s));
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: opts.fullPage ?? true,
    mask: masks,
    animations: 'disabled',
    maxDiffPixelRatio: 0.02, // tolerate <2% drift (font hinting / antialiasing)
  });
}
