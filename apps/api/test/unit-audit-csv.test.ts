/**
 * 单元测试 · audit-log CSV 导出的 RFC 4180 转义
 *
 * 重点验证：
 * - 普通字符串不加引号
 * - 含逗号 / 双引号 / 换行 → 引号包裹
 * - 双引号在引号包裹内 → 翻倍 ""
 * - null / undefined → 空字符串
 * - jsonb 对象 → JSON.stringify 后再转义
 */

import { describe, it, expect } from 'vitest';
import { csvCell, CSV_COLUMNS } from '../src/routes/admin-audit';

describe('csvCell · RFC 4180 转义', () => {
  it('null / undefined → 空字符串', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('数字 → 直接 toString', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(0)).toBe('0');
  });

  it('普通字符串不加引号', () => {
    expect(csvCell('hello')).toBe('hello');
    expect(csvCell('user.suspend')).toBe('user.suspend');
  });

  it('含逗号 → 用引号包裹', () => {
    expect(csvCell('hello, world')).toBe('"hello, world"');
  });

  it('含换行 → 用引号包裹', () => {
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('a\rb')).toBe('"a\rb"');
  });

  it('含双引号 → 包裹 + 翻倍 ""', () => {
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('混合：逗号 + 双引号 + 换行', () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });

  it('对象 → JSON.stringify 后转义', () => {
    expect(csvCell({ status: 'paid', amount: 5000 })).toBe('"{""status"":""paid"",""amount"":5000}"');
    expect(csvCell({ key: 'val' })).toBe('"{""key"":""val""}"');
  });

  it('数组 → JSON.stringify 后含逗号触发引号包裹', () => {
    expect(csvCell([1, 2, 3])).toBe('"[1,2,3]"');
    expect(csvCell([])).toBe('[]');
  });

  it('空字符串保留为空（不加引号）', () => {
    expect(csvCell('')).toBe('');
  });
});

describe('CSV_COLUMNS · 表头', () => {
  it('包含 12 列，第一列是 created_at', () => {
    expect(CSV_COLUMNS).toHaveLength(12);
    expect(CSV_COLUMNS[0]).toBe('created_at');
  });

  it('安全字段覆盖（actor / target / before / after）', () => {
    expect(CSV_COLUMNS).toContain('actor_user_id');
    expect(CSV_COLUMNS).toContain('actor_role');
    expect(CSV_COLUMNS).toContain('action');
    expect(CSV_COLUMNS).toContain('target_type');
    expect(CSV_COLUMNS).toContain('target_id');
    expect(CSV_COLUMNS).toContain('before');
    expect(CSV_COLUMNS).toContain('after');
    expect(CSV_COLUMNS).toContain('reason');
    expect(CSV_COLUMNS).toContain('request_id');
    expect(CSV_COLUMNS).toContain('ip');
    expect(CSV_COLUMNS).toContain('user_agent');
  });
});
