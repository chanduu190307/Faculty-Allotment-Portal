import React from 'react';

interface WorkloadDistributionChartProps {
  distribution: Record<number, number>; // duties -> faculty count
  avg: number;
  median: number;
  variance: number;
}

export const WorkloadDistributionChart: React.FC<WorkloadDistributionChartProps> = ({
  distribution,
  avg,
  median,
  variance,
}) => {
  const entries = Object.entries(distribution).map(([duties, count]) => ({
    duties: Number(duties),
    count,
  }));

  entries.sort((a, b) => a.duties - b.duties);

  const maxCount = Math.max(...entries.map((e) => e.count), 1);

  return (
    <div style={{ padding: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-main)' }}>
          Duty Frequency Distribution
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <span>Average: <strong className="mono-metric" style={{ color: 'var(--primary-forest)' }}>{avg}</strong></span>
          <span>Median: <strong className="mono-metric" style={{ color: 'var(--primary-forest)' }}>{median}</strong></span>
          <span>Variance: <strong className="mono-metric" style={{ color: 'var(--primary-forest)' }}>{variance}</strong></span>
        </div>
      </div>

      <div className="chart-histogram">
        {entries.map(({ duties, count }) => {
          const heightPct = Math.max((count / maxCount) * 100, 4);
          return (
            <div key={duties} className="chart-bar-container">
              <div
                style={{
                  fontSize: '0.75rem',
                  fontFamily: 'var(--font-data)',
                  color: 'var(--text-secondary)',
                  marginBottom: '4px',
                }}
              >
                {count}
              </div>
              <div
                className="chart-bar"
                style={{ height: `${heightPct}%` }}
                title={`${count} faculty assigned ${duties} duties`}
              />
              <div className="chart-bar-label">{duties}d</div>
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: 'center', fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
        Assigned Duties per Teacher (Horizontal: Duties Count, Vertical: Number of Faculty)
      </div>
    </div>
  );
};
