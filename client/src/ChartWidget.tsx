import React from 'react';
import { init as initECharts, use as useECharts } from 'echarts/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

useECharts([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type ChartType = 'bar' | 'line' | 'pie';

export default function ChartWidget({ headers, rows }: {
  headers: string[];
  rows: Array<Record<string, string>>;
}) {
  const [type, setType] = React.useState<ChartType>('bar');
  const chartRef = React.useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = React.useRef<ReturnType<typeof initECharts> | null>(null);

  React.useEffect(() => {
    if (!chartRef.current) return;
    const instance = initECharts(chartRef.current);
    chartInstanceRef.current = instance;
    const xKey = headers[0];
    const yKey = headers[1];
    const x = rows.map(row => row[xKey]);
    const y = rows.map(row => Number(String(row[yKey]).replace(/[^\d.-]/g, '')));

    if (type === 'pie') {
      instance.setOption({
        tooltip: { trigger: 'item' },
        legend: { bottom: 0 },
        series: [{
          type: 'pie',
          radius: ['35%', '70%'],
          center: ['50%', '45%'],
          data: x.map((name, index) => ({ name, value: y[index] })),
          itemStyle: { borderColor: '#fff', borderWidth: 2 },
        }],
      });
    } else {
      instance.setOption({
        grid: { left: 30, right: 10, top: 20, bottom: 30 },
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: x },
        yAxis: { type: 'value' },
        series: [{ type, data: y, itemStyle: { color: '#8b5cf6' } }],
      });
    }

    const handleResize = () => instance.resize();
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      instance.dispose();
      chartInstanceRef.current = null;
    };
  }, [type, headers, rows]);

  const exportChart = (format: 'png' | 'jpg') => {
    const instance = chartInstanceRef.current;
    if (!instance) return;
    const link = document.createElement('a');
    link.download = `chart_${new Date().toISOString().slice(0, 10)}.${format}`;
    link.href = instance.getDataURL({
      type: format === 'jpg' ? 'jpeg' : 'png',
      pixelRatio: 2,
      backgroundColor: '#fff',
    });
    link.click();
  };

  return (
    <div className="chart-widget">
      <div className="chart-table">
        <table>
          <thead><tr>{headers.map(header => <th key={header}>{header}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{headers.map(header => <td key={header}>{row[header]}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chart-toolbar">
        <select value={type} onChange={event => setType(event.target.value as ChartType)}>
          <option value="bar">柱状图</option>
          <option value="line">折线图</option>
          <option value="pie">饼图</option>
        </select>
        <div style={{ marginLeft: 12, display: 'flex', gap: 4 }}>
          <button onClick={() => exportChart('png')}>PNG</button>
          <button onClick={() => exportChart('jpg')}>JPG</button>
        </div>
      </div>
      <div ref={chartRef} style={{ width: '100%', height: 300, marginTop: 6 }} />
    </div>
  );
}
