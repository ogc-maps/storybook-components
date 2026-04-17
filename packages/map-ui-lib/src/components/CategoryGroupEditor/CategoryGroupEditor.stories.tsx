import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import type { CategoryGroup } from '../../types';
import { CategoryGroupEditor } from './CategoryGroupEditor';

const meta: Meta<typeof CategoryGroupEditor> = {
  title: 'Admin/CategoryGroupEditor',
  component: CategoryGroupEditor,
  parameters: {
    docs: {
      description: {
        component:
          'Configure named category groups with rule-based matching. Groups compile to CQL2 filters and MapLibre case expressions, avoiding the need to manually enumerate thousands of values.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof CategoryGroupEditor>;

export const Empty: Story = {
  render: () => {
    const [groups, setGroups] = useState<CategoryGroup[]>([]);
    return (
      <div className="mapui:max-w-lg mapui:p-4">
        <CategoryGroupEditor groups={groups} onGroupsChange={setGroups} />
        <pre className="mapui:mt-4 mapui:rounded mapui:bg-slate-100 mapui:p-3 mapui:text-xs">
          {JSON.stringify(groups, null, 2)}
        </pre>
      </div>
    );
  },
};

/** Owner location grouping — Colorado vs. Out of State. */
export const OwnerLocation: Story = {
  render: () => {
    const [groups, setGroups] = useState<CategoryGroup[]>([
      {
        id: 'co',
        label: 'Colorado Owners',
        color: '#3b82f6',
        matchRule: { kind: 'values', values: ['CO'] },
      },
      {
        id: 'out-of-state',
        label: 'Out of State Owners',
        color: '#f59e0b',
        matchRule: { kind: 'pattern', operator: 'not_equals', pattern: 'CO' },
      },
      {
        id: 'unknown',
        label: 'Unknown',
        color: '#94a3b8',
        matchRule: { kind: 'catchAll' },
      },
    ]);

    const availableValues = [
      'AK', 'AL', 'AR', 'AZ', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
      'HI', 'IA', 'ID', 'IL', 'IN', 'KS', 'KY', 'LA', 'MA', 'MD',
      'ME', 'MI', 'MN', 'MO', 'MS', 'MT', 'NC', 'ND', 'NE', 'NH',
      'NJ', 'NM', 'NV', 'NY', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
      'SD', 'TN', 'TX', 'UT', 'VA', 'VT', 'WA', 'WI', 'WV', 'WY',
    ];

    return (
      <div className="mapui:max-w-lg mapui:p-4">
        <h4 className="mapui:mb-2 mapui:text-sm mapui:font-semibold mapui:text-slate-700">
          Owner State Groups
        </h4>
        <CategoryGroupEditor
          groups={groups}
          onGroupsChange={setGroups}
          availableValues={availableValues}
        />
        <pre className="mapui:mt-4 mapui:rounded mapui:bg-slate-100 mapui:p-3 mapui:text-xs">
          {JSON.stringify(groups, null, 2)}
        </pre>
      </div>
    );
  },
};

/** Owner name grouping — LLC, Trust, individual owners. Handles ~21,000 unique values via patterns. */
export const OwnerNamePatterns: Story = {
  render: () => {
    const [groups, setGroups] = useState<CategoryGroup[]>([
      {
        id: 'llc',
        label: 'LLC / Corp',
        color: '#ef4444',
        matchRule: { kind: 'pattern', operator: 'contains', pattern: 'LLC' },
      },
      {
        id: 'trust',
        label: 'Trust',
        color: '#8b5cf6',
        matchRule: { kind: 'pattern', operator: 'contains', pattern: 'TRUST' },
      },
      {
        id: 'inc',
        label: 'Incorporated',
        color: '#f97316',
        matchRule: { kind: 'pattern', operator: 'contains', pattern: 'INC' },
      },
      {
        id: 'individual',
        label: 'Individual Owners',
        color: '#22c55e',
        matchRule: { kind: 'catchAll' },
      },
    ]);

    return (
      <div className="mapui:max-w-lg mapui:p-4">
        <h4 className="mapui:mb-2 mapui:text-sm mapui:font-semibold mapui:text-slate-700">
          Owner Name Groups
        </h4>
        <p className="mapui:mb-3 mapui:text-xs mapui:text-slate-500">
          Pattern rules handle ~21,000 unique owner names without manual selection.
        </p>
        <CategoryGroupEditor groups={groups} onGroupsChange={setGroups} />
        <pre className="mapui:mt-4 mapui:rounded mapui:bg-slate-100 mapui:p-3 mapui:text-xs">
          {JSON.stringify(groups, null, 2)}
        </pre>
      </div>
    );
  },
};

/** Demonstrates multi-value selection from a known list (e.g. county parcels by zone type). */
export const MultiValueGroup: Story = {
  render: () => {
    const [groups, setGroups] = useState<CategoryGroup[]>([
      {
        id: 'residential',
        label: 'Residential',
        color: '#84cc16',
        matchRule: { kind: 'values', values: ['SF', 'MF', 'MH', 'MFR'] },
      },
      {
        id: 'commercial',
        label: 'Commercial',
        color: '#0ea5e9',
        matchRule: { kind: 'values', values: ['C1', 'C2', 'C3', 'CH'] },
      },
      {
        id: 'industrial',
        label: 'Industrial',
        color: '#f59e0b',
        matchRule: { kind: 'values', values: ['I1', 'I2', 'I3'] },
      },
      {
        id: 'other',
        label: 'Other / Unzoned',
        color: '#94a3b8',
        matchRule: { kind: 'catchAll' },
      },
    ]);

    const availableValues = ['SF', 'MF', 'MH', 'MFR', 'C1', 'C2', 'C3', 'CH', 'I1', 'I2', 'I3', 'AG', 'PF', 'OS'];

    return (
      <div className="mapui:max-w-lg mapui:p-4">
        <h4 className="mapui:mb-2 mapui:text-sm mapui:font-semibold mapui:text-slate-700">
          Zoning Groups
        </h4>
        <CategoryGroupEditor
          groups={groups}
          onGroupsChange={setGroups}
          availableValues={availableValues}
        />
        <pre className="mapui:mt-4 mapui:rounded mapui:bg-slate-100 mapui:p-3 mapui:text-xs">
          {JSON.stringify(groups, null, 2)}
        </pre>
      </div>
    );
  },
};
