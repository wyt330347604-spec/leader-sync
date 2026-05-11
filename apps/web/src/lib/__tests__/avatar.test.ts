import { describe, it, expect } from 'vitest';
import { getAvatar, AVATAR_PALETTE } from '../avatar';

describe('getAvatar', () => {
  it('returns vacant style when name is null', () => {
    const r = getAvatar(null);
    expect(r.vacant).toBe(true);
    expect(r.initial).toBe('?');
  });

  it('returns vacant style when name is empty string', () => {
    const r = getAvatar('');
    expect(r.vacant).toBe(true);
  });

  it('uses first char for english name', () => {
    expect(getAvatar('Harvey').initial).toBe('H');
  });

  it('uses first char for chinese name', () => {
    expect(getAvatar('建豪').initial).toBe('建');
  });

  it('handles "Tobi + Yang" → T', () => {
    expect(getAvatar('Tobi + Yang').initial).toBe('T');
  });

  it('is deterministic — same name always same colors', () => {
    const a = getAvatar('Harvey');
    const b = getAvatar('Harvey');
    expect(a.bg).toBe(b.bg);
    expect(a.fg).toBe(b.fg);
  });

  it('different names usually produce different palettes', () => {
    const harvey = getAvatar('Harvey');
    const mia = getAvatar('Mia');
    expect(harvey.bg !== mia.bg || harvey.fg !== mia.fg).toBe(true);
  });

  it('palette size is 8', () => {
    expect(AVATAR_PALETTE.length).toBe(8);
  });
});
