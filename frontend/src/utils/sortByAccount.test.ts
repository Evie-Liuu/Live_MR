import { describe, expect, it } from 'vitest';
import { sortByAccount } from './sortByAccount.ts';

const ids = (list: string[]) => sortByAccount(list.map(identity => ({ identity }))).map(p => p.identity);

describe('sortByAccount', () => {
  it('compares numbers by value', () => {
    expect(ids(['S10', 'S2', 'S01'])).toEqual(['S01', 'S2', 'S10']);
  });

  it('ignores case', () => {
    expect(ids(['b', 'A', 'c'])).toEqual(['A', 'b', 'c']);
  });

  it('does not change the input', () => {
    const input = [{ identity: 'b' }, { identity: 'a' }];
    sortByAccount(input);
    expect(input[0].identity).toBe('b');
  });
});
