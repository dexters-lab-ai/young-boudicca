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

const SparklineChart: React.FC<SparklineChartProps> = ({ data: chartData, width = 300, height = 100 }) => {
  if (!chartData || chartData.length < 2) {
    return <div style={{width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)'}}>Not enough price data</div>;
  }

  const min = Math.min(...chartData);
  const max = Math.max(...chartData);
  const range = max - min;

  const points = chartData
    .map((point, i) => {
      const x = (i / (chartData.length - 1)) * width;
      const y = height - ((point - min) / (range || 1)) * height;
      return `${x},${y}`;
    })
    .join(' ');

  const isUp = chartData[chartData.length - 1] >= chartData[0];
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
