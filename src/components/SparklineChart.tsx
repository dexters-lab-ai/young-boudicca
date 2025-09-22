/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React from 'react';

interface SparklineChartProps {
  data: number[];
  width?: number;
  height?: number;
}

const SparklineChart: React.FC<SparklineChartProps> = ({ data, width = 300, height = 100 }) => {
  if (!data || data.length < 2) {
    return <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>Not enough price data</div>;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  const points = data
    .map((point, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((point - min) / (range || 1)) * height;
      return `${x},${y}`;
    })
    .join(' ');

  const isUp = data[data.length - 1] >= data[0];
  const className = isUp ? 'sparkline-path-up' : 'sparkline-path-down';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <polyline
        className={className}
        points={points}
      />
    </svg>
  );
};

export default SparklineChart;
