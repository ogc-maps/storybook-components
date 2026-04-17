import { describe, it, expect } from 'vitest';
import { categoryGroupToCql2, categoryGroupsToMaplibreExpression, categoryMatchRuleToCql2 } from '../categoryGroups';
import type { CategoryGroup } from '../../types';

// ---------------------------------------------------------------------------
// categoryMatchRuleToCql2
// ---------------------------------------------------------------------------

describe('categoryMatchRuleToCql2', () => {
  it('catchAll returns null', () => {
    expect(categoryMatchRuleToCql2({ kind: 'catchAll' }, 'state')).toBeNull();
  });

  it('values with empty array returns null', () => {
    expect(categoryMatchRuleToCql2({ kind: 'values', values: [] }, 'state')).toBeNull();
  });

  it('values with single item returns equality', () => {
    expect(categoryMatchRuleToCql2({ kind: 'values', values: ['CO'] }, 'state')).toEqual({
      op: '=',
      args: [{ property: 'state' }, 'CO'],
    });
  });

  it('values with multiple items returns in', () => {
    expect(categoryMatchRuleToCql2({ kind: 'values', values: ['CO', 'UT', 'WY'] }, 'state')).toEqual({
      op: 'in',
      args: [{ property: 'state' }, ['CO', 'UT', 'WY']],
    });
  });

  it('pattern contains returns like with surrounding wildcards', () => {
    expect(categoryMatchRuleToCql2({ kind: 'pattern', operator: 'contains', pattern: 'LLC' }, 'owner')).toEqual({
      op: 'like',
      args: [{ property: 'owner' }, '%LLC%'],
    });
  });

  it('pattern not_contains wraps like with not', () => {
    expect(categoryMatchRuleToCql2({ kind: 'pattern', operator: 'not_contains', pattern: 'LLC' }, 'owner')).toEqual({
      op: 'not',
      args: [{ op: 'like', args: [{ property: 'owner' }, '%LLC%'] }],
    });
  });

  it('pattern startsWith returns trailing wildcard like', () => {
    expect(categoryMatchRuleToCql2({ kind: 'pattern', operator: 'startsWith', pattern: 'TRUST' }, 'owner')).toEqual({
      op: 'like',
      args: [{ property: 'owner' }, 'TRUST%'],
    });
  });

  it('pattern endsWith returns leading wildcard like', () => {
    expect(categoryMatchRuleToCql2({ kind: 'pattern', operator: 'endsWith', pattern: 'LLC' }, 'owner')).toEqual({
      op: 'like',
      args: [{ property: 'owner' }, '%LLC'],
    });
  });

  it('pattern equals returns =', () => {
    expect(categoryMatchRuleToCql2({ kind: 'pattern', operator: 'equals', pattern: 'CO' }, 'state')).toEqual({
      op: '=',
      args: [{ property: 'state' }, 'CO'],
    });
  });

  it('pattern not_equals returns <>', () => {
    expect(categoryMatchRuleToCql2({ kind: 'pattern', operator: 'not_equals', pattern: 'CO' }, 'state')).toEqual({
      op: '<>',
      args: [{ property: 'state' }, 'CO'],
    });
  });

  it('values with numeric array', () => {
    expect(categoryMatchRuleToCql2({ kind: 'values', values: [1, 2, 3] }, 'zone')).toEqual({
      op: 'in',
      args: [{ property: 'zone' }, [1, 2, 3]],
    });
  });
});

// ---------------------------------------------------------------------------
// categoryGroupToCql2
// ---------------------------------------------------------------------------

describe('categoryGroupToCql2', () => {
  const makeGroup = (matchRule: CategoryGroup['matchRule']): CategoryGroup => ({
    id: 'g1',
    label: 'Test',
    color: '#ff0000',
    matchRule,
  });

  it('delegates to matchRule', () => {
    const group = makeGroup({ kind: 'values', values: ['CO'] });
    expect(categoryGroupToCql2(group, 'state')).toEqual({
      op: '=',
      args: [{ property: 'state' }, 'CO'],
    });
  });

  it('returns null for catchAll group', () => {
    const group = makeGroup({ kind: 'catchAll' });
    expect(categoryGroupToCql2(group, 'state')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// categoryGroupsToMaplibreExpression
// ---------------------------------------------------------------------------

describe('categoryGroupsToMaplibreExpression', () => {
  it('builds case expression from values groups', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'In-state', color: '#blue', matchRule: { kind: 'values', values: ['CO'] } },
      { id: '2', label: 'Out-of-state', color: '#red', matchRule: { kind: 'catchAll' } },
    ];
    expect(categoryGroupsToMaplibreExpression(groups, 'state', '#gray')).toEqual([
      'case',
      ['==', ['get', 'state'], 'CO'],
      '#blue',
      '#red',
    ]);
  });

  it('uses fallbackColor when no catchAll group', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'LLC', color: '#red', matchRule: { kind: 'pattern', operator: 'contains', pattern: 'LLC' } },
    ];
    const result = categoryGroupsToMaplibreExpression(groups, 'owner', '#gray');
    expect(result).toEqual([
      'case',
      ['in', 'LLC', ['get', 'owner']],
      '#red',
      '#gray',
    ]);
  });

  it('builds multi-value condition for values with more than one entry', () => {
    const groups: CategoryGroup[] = [
      {
        id: '1',
        label: 'Region A',
        color: '#blue',
        matchRule: { kind: 'values', values: ['AK', 'WA', 'OR'] },
      },
    ];
    const result = categoryGroupsToMaplibreExpression(groups, 'state', '#gray');
    expect(result).toEqual([
      'case',
      ['in', ['get', 'state'], ['literal', ['AK', 'WA', 'OR']]],
      '#blue',
      '#gray',
    ]);
  });

  it('skips groups with empty values array', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'Empty', color: '#red', matchRule: { kind: 'values', values: [] } },
    ];
    const result = categoryGroupsToMaplibreExpression(groups, 'state', '#gray');
    expect(result).toEqual(['case', '#gray']);
  });

  it('contains pattern uses ["in", pattern, ["get", prop]]', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'LLC', color: '#red', matchRule: { kind: 'pattern', operator: 'contains', pattern: 'LLC' } },
    ];
    expect(categoryGroupsToMaplibreExpression(groups, 'owner', '#gray')).toEqual([
      'case',
      ['in', 'LLC', ['get', 'owner']],
      '#red',
      '#gray',
    ]);
  });

  it('not_contains wraps in !', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'No LLC', color: '#green', matchRule: { kind: 'pattern', operator: 'not_contains', pattern: 'LLC' } },
    ];
    expect(categoryGroupsToMaplibreExpression(groups, 'owner', '#gray')).toEqual([
      'case',
      ['!', ['in', 'LLC', ['get', 'owner']]],
      '#green',
      '#gray',
    ]);
  });

  it('startsWith uses slice with pattern.length', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'Trust', color: '#purple', matchRule: { kind: 'pattern', operator: 'startsWith', pattern: 'TRUST' } },
    ];
    expect(categoryGroupsToMaplibreExpression(groups, 'owner', '#gray')).toEqual([
      'case',
      ['==', ['slice', ['get', 'owner'], 0, 5], 'TRUST'],
      '#purple',
      '#gray',
    ]);
  });

  it('endsWith uses slice with length minus pattern length', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'LLC suffix', color: '#red', matchRule: { kind: 'pattern', operator: 'endsWith', pattern: 'LLC' } },
    ];
    expect(categoryGroupsToMaplibreExpression(groups, 'owner', '#gray')).toEqual([
      'case',
      ['==', ['slice', ['get', 'owner'], ['-', ['length', ['get', 'owner']], 3]], 'LLC'],
      '#red',
      '#gray',
    ]);
  });

  it('equals uses ==', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'Colorado', color: '#blue', matchRule: { kind: 'pattern', operator: 'equals', pattern: 'CO' } },
    ];
    expect(categoryGroupsToMaplibreExpression(groups, 'state', '#gray')).toEqual([
      'case',
      ['==', ['get', 'state'], 'CO'],
      '#blue',
      '#gray',
    ]);
  });

  it('not_equals uses !=', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'Not CO', color: '#orange', matchRule: { kind: 'pattern', operator: 'not_equals', pattern: 'CO' } },
    ];
    expect(categoryGroupsToMaplibreExpression(groups, 'state', '#gray')).toEqual([
      'case',
      ['!=', ['get', 'state'], 'CO'],
      '#orange',
      '#gray',
    ]);
  });

  it('multiple groups produce multiple case branches', () => {
    const groups: CategoryGroup[] = [
      { id: '1', label: 'LLC', color: '#red', matchRule: { kind: 'pattern', operator: 'contains', pattern: 'LLC' } },
      { id: '2', label: 'Trust', color: '#purple', matchRule: { kind: 'pattern', operator: 'contains', pattern: 'TRUST' } },
      { id: '3', label: 'Other', color: '#gray', matchRule: { kind: 'catchAll' } },
    ];
    expect(categoryGroupsToMaplibreExpression(groups, 'owner', '#black')).toEqual([
      'case',
      ['in', 'LLC', ['get', 'owner']],
      '#red',
      ['in', 'TRUST', ['get', 'owner']],
      '#purple',
      '#gray',
    ]);
  });

  it('empty groups array returns ["case", fallbackColor]', () => {
    expect(categoryGroupsToMaplibreExpression([], 'state', '#gray')).toEqual(['case', '#gray']);
  });
});
