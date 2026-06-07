import { describe, it, expect } from 'vitest';
import { parseCallback } from '../src/services/telegram-directory';

describe('telegram-directory · parseCallback', () => {
  it('root', () => {
    expect(parseCallback('root')).toEqual({ type: 'root' });
  });
  it('city page', () => {
    expect(parseCallback('c:0:0')).toEqual({ type: 'city', idx: 0, page: 0 });
    expect(parseCallback('c:3:2')).toEqual({ type: 'city', idx: 3, page: 2 });
  });
  it('非法/空 → null', () => {
    expect(parseCallback(undefined)).toBeNull();
    expect(parseCallback('')).toBeNull();
    expect(parseCallback('c:abc:0')).toBeNull();
    expect(parseCallback('c:1')).toBeNull();
    expect(parseCallback('garbage')).toBeNull();
  });
});
