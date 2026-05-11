import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import type { StyleConfig } from '../../types';
import { StyleCard } from './StyleCard';

const meta: Meta<typeof StyleCard> = {
  title: 'Admin/StyleCard',
  component: StyleCard,
  parameters: {
    docs: {
      description: {
        component:
          'Collapsible card wrapping a single StyleEditor. Displays the style name and type in the header; expand/collapse to edit.',
      },
    },
  },
};
export default meta;
type Story = StoryObj<typeof StyleCard>;

export const Default: Story = {
  render: () => {
    const [style, setStyle] = useState<StyleConfig>({
      type: 'fill',
      paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.6 },
    });
    return (
      <div className="mapui:max-w-sm mapui:p-4">
        <StyleCard index={0} style={style} onChange={setStyle} defaultOpen />
        <pre className="mapui:mt-4 mapui:rounded mapui:bg-slate-100 mapui:p-3 mapui:text-xs">
          {JSON.stringify(style, null, 2)}
        </pre>
      </div>
    );
  },
};

export const Collapsed: Story = {
  render: () => {
    const [style, setStyle] = useState<StyleConfig>({
      type: 'line',
      paint: { 'line-color': '#2980b9', 'line-width': 2, 'line-opacity': 1 },
    });
    return (
      <div className="mapui:max-w-sm mapui:p-4">
        <StyleCard index={1} style={style} onChange={setStyle} defaultOpen={false} />
      </div>
    );
  },
};

export const MultipleStyles: Story = {
  render: () => {
    const [styles, setStyles] = useState<StyleConfig[]>([
      { type: 'fill', paint: { 'fill-color': '#4a90d9', 'fill-opacity': 0.6 } },
      { type: 'line', paint: { 'line-color': '#2980b9', 'line-width': 2, 'line-opacity': 1 } },
      { type: 'circle', paint: { 'circle-color': '#e74c3c', 'circle-radius': 5, 'circle-opacity': 0.9 } },
    ]);

    const update = (i: number, s: StyleConfig) =>
      setStyles((prev) => prev.map((x, idx) => (idx === i ? s : x)));
    const remove = (i: number) =>
      setStyles((prev) => prev.filter((_, idx) => idx !== i));

    return (
      <div className="mapui:max-w-sm mapui:p-4 mapui:flex mapui:flex-col mapui:gap-2">
        {styles.map((style, i) => (
          <StyleCard
            key={i}
            index={i}
            style={style}
            onChange={(s) => update(i, s)}
            onRemove={styles.length > 1 ? () => remove(i) : undefined}
            defaultOpen={i === 0}
          />
        ))}
      </div>
    );
  },
};
