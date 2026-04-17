import { useState } from 'react';
import type { CategoryGroup, CategoryMatchRule } from '../../types';
import { ColorPicker } from '../admin/ColorPicker';
import { generateId } from '../../utils/id';
import { getColorFromPalette } from '../../utils/colorPalettes';

export interface CategoryGroupEditorProps {
  /** Ordered list of category groups. */
  groups: CategoryGroup[];
  /** Called when the groups array changes. */
  onGroupsChange: (groups: CategoryGroup[]) => void;
  /** Optional hint values (e.g. distinct property values) for the values picker. */
  availableValues?: string[];
}

const PATTERN_OPERATORS: Array<{ value: string; label: string }> = [
  { value: 'contains',     label: 'contains' },
  { value: 'not_contains', label: 'does not contain' },
  { value: 'startsWith',   label: 'starts with' },
  { value: 'endsWith',     label: 'ends with' },
  { value: 'equals',       label: 'equals' },
  { value: 'not_equals',   label: 'not equals' },
];

const inputCls =
  'mapui:rounded mapui:border mapui:border-slate-300 mapui:px-2 mapui:py-1 mapui:text-sm mapui:outline-none focus:mapui:border-blue-500 focus:mapui:ring-1 focus:mapui:ring-blue-500';
const btnCls =
  'mapui:cursor-pointer mapui:rounded mapui:border mapui:border-slate-300 mapui:bg-white mapui:px-2 mapui:py-1 mapui:text-xs mapui:text-slate-700 hover:mapui:bg-slate-50';
const dangerBtnCls =
  'mapui:cursor-pointer mapui:rounded mapui:border mapui:border-red-200 mapui:bg-white mapui:px-2 mapui:py-1 mapui:text-xs mapui:text-red-600 hover:mapui:bg-red-50';

function matchRuleSummary(rule: CategoryMatchRule): string {
  if (rule.kind === 'catchAll') return 'Everything else';
  if (rule.kind === 'values') {
    if (rule.values.length === 0) return 'No values selected';
    if (rule.values.length <= 3) return `= ${rule.values.join(', ')}`;
    return `${rule.values.slice(0, 3).join(', ')} +${rule.values.length - 3} more`;
  }
  const opLabel = PATTERN_OPERATORS.find((o) => o.value === rule.operator)?.label ?? rule.operator;
  return `${opLabel} "${rule.pattern}"`;
}

interface GroupRowProps {
  group: CategoryGroup;
  index: number;
  totalGroups: number;
  availableValues?: string[];
  onUpdate: (updated: CategoryGroup) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function GroupRow({
  group,
  index,
  totalGroups,
  availableValues = [],
  onUpdate,
  onRemove,
  onMoveUp,
  onMoveDown,
}: GroupRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [valuesInput, setValuesInput] = useState('');

  const rule = group.matchRule;
  const ruleKind = rule.kind;

  const setRuleKind = (kind: 'values' | 'pattern' | 'catchAll') => {
    let matchRule: CategoryMatchRule;
    if (kind === 'values') matchRule = { kind: 'values', values: [] };
    else if (kind === 'pattern') matchRule = { kind: 'pattern', operator: 'contains', pattern: '' };
    else matchRule = { kind: 'catchAll' };
    onUpdate({ ...group, matchRule });
  };

  const addValue = (val: string) => {
    if (rule.kind !== 'values') return;
    const trimmed = val.trim();
    if (!trimmed || rule.values.includes(trimmed)) return;
    onUpdate({ ...group, matchRule: { ...rule, values: [...rule.values, trimmed] } });
    setValuesInput('');
  };

  const removeValue = (val: string | number) => {
    if (rule.kind !== 'values') return;
    onUpdate({ ...group, matchRule: { ...rule, values: rule.values.filter((v) => v !== val) } });
  };

  return (
    <div className="mapui:rounded mapui:border mapui:border-slate-200 mapui:bg-white">
      {/* Row header */}
      <div className="mapui:flex mapui:items-center mapui:gap-2 mapui:p-2">
        {/* Reorder */}
        <div className="mapui:flex mapui:flex-col mapui:gap-0.5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="mapui:cursor-pointer mapui:rounded mapui:border-none mapui:bg-transparent mapui:p-0 mapui:text-slate-400 disabled:mapui:opacity-30 hover:mapui:text-slate-700"
            aria-label="Move group up"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === totalGroups - 1}
            className="mapui:cursor-pointer mapui:rounded mapui:border-none mapui:bg-transparent mapui:p-0 mapui:text-slate-400 disabled:mapui:opacity-30 hover:mapui:text-slate-700"
            aria-label="Move group down"
          >
            ▼
          </button>
        </div>

        {/* Color swatch */}
        <span
          className="mapui:h-5 mapui:w-5 mapui:shrink-0 mapui:rounded-sm mapui:border mapui:border-slate-200"
          style={{ backgroundColor: group.color }}
        />

        {/* Label + rule summary */}
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="mapui:min-w-0 mapui:flex-1 mapui:cursor-pointer mapui:rounded mapui:border-none mapui:bg-transparent mapui:px-0 mapui:py-0 mapui:text-left mapui:text-sm mapui:text-slate-700 hover:mapui:text-slate-900"
        >
          <span className="mapui:font-medium">{group.label || 'Unnamed group'}</span>
          <span className="mapui:ml-2 mapui:text-xs mapui:text-slate-400">{matchRuleSummary(group.matchRule)}</span>
        </button>

        <button type="button" onClick={onRemove} className={dangerBtnCls} aria-label="Remove group">
          ×
        </button>
      </div>

      {/* Expanded editor */}
      {expanded && (
        <div className="mapui:flex mapui:flex-col mapui:gap-3 mapui:border-t mapui:border-slate-100 mapui:p-3">
          {/* Label */}
          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <label className="mapui:w-16 mapui:shrink-0 mapui:text-xs mapui:text-slate-600">Label</label>
            <input
              type="text"
              value={group.label}
              onChange={(e) => onUpdate({ ...group, label: e.target.value })}
              className={`${inputCls} mapui:flex-1`}
              placeholder="Group name"
            />
          </div>

          {/* Color */}
          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <label className="mapui:w-16 mapui:shrink-0 mapui:text-xs mapui:text-slate-600">Color</label>
            <ColorPicker
              value={group.color}
              onChange={(color) => onUpdate({ ...group, color })}
              label={`Color for ${group.label}`}
            />
          </div>

          {/* Rule type toggle */}
          <div className="mapui:flex mapui:items-center mapui:gap-2">
            <label className="mapui:w-16 mapui:shrink-0 mapui:text-xs mapui:text-slate-600">Match by</label>
            <div className="mapui:flex mapui:overflow-hidden mapui:rounded mapui:border mapui:border-slate-300">
              {(['values', 'pattern', 'catchAll'] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setRuleKind(kind)}
                  className={[
                    'mapui:cursor-pointer mapui:border-0 mapui:px-2 mapui:py-1 mapui:text-xs mapui:outline-none',
                    'focus:mapui:ring-1 focus:mapui:ring-inset focus:mapui:ring-blue-400',
                    ruleKind === kind
                      ? 'mapui:bg-blue-500 mapui:text-white'
                      : 'mapui:bg-white mapui:text-slate-700 hover:mapui:bg-slate-50',
                  ].join(' ')}
                >
                  {kind === 'values' ? 'Values' : kind === 'pattern' ? 'Pattern' : 'Catch-all'}
                </button>
              ))}
            </div>
          </div>

          {/* Values rule */}
          {rule.kind === 'values' && (
            <div className="mapui:flex mapui:flex-col mapui:gap-2">
              {rule.values.length > 0 && (
                <div className="mapui:flex mapui:flex-wrap mapui:gap-1">
                  {rule.values.map((v) => (
                    <span
                      key={String(v)}
                      className="mapui:flex mapui:items-center mapui:gap-1 mapui:rounded mapui:bg-slate-100 mapui:px-2 mapui:py-0.5 mapui:text-xs mapui:text-slate-700"
                    >
                      {String(v)}
                      <button
                        type="button"
                        onClick={() => removeValue(v)}
                        className="mapui:cursor-pointer mapui:border-none mapui:bg-transparent mapui:p-0 mapui:text-slate-400 hover:mapui:text-red-500"
                        aria-label={`Remove ${v}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="mapui:flex mapui:gap-2">
                {availableValues.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => { if (e.target.value) addValue(e.target.value); }}
                    className={`${inputCls} mapui:flex-1`}
                  >
                    <option value="">Add a value…</option>
                    {availableValues
                      .filter((v) => !rule.values.includes(v))
                      .map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                  </select>
                ) : (
                  <>
                    <input
                      type="text"
                      value={valuesInput}
                      onChange={(e) => setValuesInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addValue(valuesInput); } }}
                      placeholder="Type a value and press Enter"
                      className={`${inputCls} mapui:flex-1`}
                    />
                    <button type="button" onClick={() => addValue(valuesInput)} className={btnCls}>
                      Add
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Pattern rule */}
          {rule.kind === 'pattern' && (
            <div className="mapui:flex mapui:items-center mapui:gap-2">
              <select
                value={rule.operator}
                onChange={(e) =>
                  onUpdate({
                    ...group,
                    matchRule: { ...rule, operator: e.target.value as typeof rule.operator },
                  })
                }
                className={`${inputCls} mapui:shrink-0`}
              >
                {PATTERN_OPERATORS.map((op) => (
                  <option key={op.value} value={op.value}>{op.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={rule.pattern}
                onChange={(e) =>
                  onUpdate({ ...group, matchRule: { ...rule, pattern: e.target.value } })
                }
                placeholder="Pattern text"
                className={`${inputCls} mapui:flex-1`}
              />
            </div>
          )}

          {/* Catch-all */}
          {rule.kind === 'catchAll' && (
            <p className="mapui:m-0 mapui:text-xs mapui:text-slate-500">
              This group matches everything not covered by other groups. Place it last.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function CategoryGroupEditor({
  groups,
  onGroupsChange,
  availableValues,
}: CategoryGroupEditorProps) {
  const addGroup = () => {
    const newGroup: CategoryGroup = {
      id: generateId(),
      label: `Group ${groups.length + 1}`,
      color: getColorFromPalette(groups.length),
      matchRule: { kind: 'values', values: [] },
    };
    onGroupsChange([...groups, newGroup]);
  };

  const addCatchAll = () => {
    const newGroup: CategoryGroup = {
      id: generateId(),
      label: 'Other',
      color: getColorFromPalette(groups.length),
      matchRule: { kind: 'catchAll' },
    };
    onGroupsChange([...groups, newGroup]);
  };

  const updateGroup = (index: number, updated: CategoryGroup) => {
    const next = [...groups];
    next[index] = updated;
    onGroupsChange(next);
  };

  const removeGroup = (index: number) => {
    onGroupsChange(groups.filter((_, i) => i !== index));
  };

  const moveGroup = (index: number, direction: -1 | 1) => {
    const next = [...groups];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onGroupsChange(next);
  };

  const hasCatchAll = groups.some((g) => g.matchRule.kind === 'catchAll');

  return (
    <div className="mapui:flex mapui:flex-col mapui:gap-2">
      {groups.length === 0 && (
        <p className="mapui:m-0 mapui:text-xs mapui:text-slate-500">
          No groups yet. Add one below.
        </p>
      )}

      {groups.map((group, i) => (
        <GroupRow
          key={group.id}
          group={group}
          index={i}
          totalGroups={groups.length}
          availableValues={availableValues}
          onUpdate={(updated) => updateGroup(i, updated)}
          onRemove={() => removeGroup(i)}
          onMoveUp={() => moveGroup(i, -1)}
          onMoveDown={() => moveGroup(i, 1)}
        />
      ))}

      <div className="mapui:flex mapui:gap-2">
        <button type="button" onClick={addGroup} className={btnCls}>
          + Add group
        </button>
        {!hasCatchAll && (
          <button type="button" onClick={addCatchAll} className={btnCls}>
            + Add catch-all
          </button>
        )}
      </div>
    </div>
  );
}
