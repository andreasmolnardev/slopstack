import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DataChart } from './data-chart';

describe('data chart pattern', () => {
  it('uses series labels and renders accessible chart structure', () => {
    const markup = renderToStaticMarkup(<DataChart
      data={[{ month: 'Jan', income: 20 }]}
      categoryKey="month"
      series={[{ key: 'income', label: 'Income', color: '#16a34a' }]}
      kind="bar"
    />);
    expect(markup).toContain('data-slot="chart"');
    expect(markup).toContain('--color-income: #16a34a');
  });
});
