import { buildNodeLabel, middleTruncate } from '../labelUtils';

describe('middleTruncate', () => {
  test('returns original when shorter than max', () => {
    expect(middleTruncate('short', 10)).toBe('short');
  });

  test('truncates middle with ellipsis when longer than max', () => {
    const text = 'C:/very/long/path/to/some/deeply/nested/file.name';
    const out = middleTruncate(text, 16);
    expect(out.length).toBeLessThanOrEqual(16);
    expect(out).toMatch(/…/);
    expect(out.startsWith('C:/')).toBe(true);
    expect(out.endsWith('file.name')).toBe(true);
  });

  test('handles tiny maxLen by returning a few ellipses', () => {
    expect(middleTruncate('abcdef', 1)).toBe('…');
    expect(middleTruncate('abcdef', 2)).toBe('……');
    expect(middleTruncate('abcdef', 3)).toBe('………');
  });
});

describe('buildNodeLabel', () => {
  test('label + title + score without path', () => {
    const s = buildNodeLabel({ label: 'Routine', title: 'Foo', _score: 0.1234 });
    expect(s).toBe('Routine: Foo | score: 0.12');
  });

  test('includes path suffix when path present (non-empty)', () => {
    const s = buildNodeLabel({ label: 'Object', title: 'Bar', path: '/root/a/b/c' });
    expect(s).toBe('Object: Bar | path: /root/a/b/c');
  });

  test('omits path when empty string', () => {
    const s = buildNodeLabel({ label: 'X', title: 'Empty', path: '' });
    expect(s).toBe('X: Empty');
  });

  test('works without title and with path', () => {
    const s = buildNodeLabel({ label: 'File', path: '/long/path/here' });
    expect(s).toBe('File | path: /long/path/here');
  });

  test('applies middle truncation to long paths by default', () => {
    const long = 'C:/root/some/really/really/long/path/that/should/be/truncated/by/default/settings/file.ext';
    const s = buildNodeLabel({ label: 'File', path: long });
    expect(s.startsWith('File | path: ')).toBe(true);
    const shown = s.replace('File | path: ', '');
    expect(shown.length).toBeLessThanOrEqual(120);
    expect(shown).toMatch(/…/);
  });

  test('respects custom maxPathLen option', () => {
    const long = 'C:/root/some/really/really/long/path/that/should/be/truncated/file.ext';
    const s = buildNodeLabel({ label: 'File', path: long }, { maxPathLen: 20 });
    const shown = s.replace('File | path: ', '').replace('File', '').trim();
    expect(s).toMatch(/\| path: /);
    expect(shown.length).toBeLessThanOrEqual(20);
  });
});


