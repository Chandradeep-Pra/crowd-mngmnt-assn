import { memo, useId } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { number } from '../../domain/time.ts'

export interface ChartSeries { key: string; label: string; color: string; dashed?: boolean }
export interface ChartDatum { label: string; [key: string]: string | number | null }

/** Historical buckets only; live samples need a separately agreed time-series policy. */
export const TimeSeriesChart = memo(function TimeSeriesChart({ label, description, data, series, showHeading = true }: {
  label: string; description: string; data: ChartDatum[]; series: ChartSeries[]; showHeading?: boolean
}) {
  const id = useId()
  return <figure className="ui-chart" aria-labelledby={id}>
    <figcaption className={showHeading ? undefined : 'sr-only'}><h3 id={id}>{label}</h3><p className="ui-muted">{description}</p></figcaption>
    <ul className="ui-chart-legend" aria-label="Chart series">{series.map(item => <li key={item.key}><span className={item.dashed ? 'ui-line-key ui-line-key--dashed' : 'ui-line-key'} style={{ borderColor: item.color }} aria-hidden="true" />{item.label}</li>)}</ul>
    <div className="ui-chart-plot"><ResponsiveContainer width="100%" height="100%" minWidth={0}>
      <LineChart data={data} accessibilityLayer margin={{ top: 12, right: 16, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} minTickGap={24} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: 'var(--color-text-muted)', fontSize: 12 }} />
        <Tooltip formatter={(value, name) => [number(value, 2), String(name ?? 'Value')]} contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)' }} />
        {series.map(item => <Line key={item.key} dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2.5} strokeDasharray={item.dashed ? '6 4' : undefined} dot={{ r: 3 }} activeDot={{ r: 5 }} type="linear" connectNulls={false} isAnimationActive={false} />)}
      </LineChart>
    </ResponsiveContainer></div>
    <details className="ui-chart-data"><summary>View chart data</summary><div className="ui-table-frame"><table className="ui-table"><caption className="sr-only">{label} data</caption><thead><tr><th scope="col">Time</th>{series.map(item => <th scope="col" key={item.key}>{item.label}</th>)}</tr></thead><tbody>{data.map((datum, index) => <tr key={`${datum.label}-${index}`}><th scope="row">{datum.label}</th>{series.map(item => <td key={item.key}>{datum[item.key] ?? 'Unavailable'}</td>)}</tr>)}</tbody></table></div></details>
  </figure>
})
