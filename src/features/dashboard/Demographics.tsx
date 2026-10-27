import { memo, useMemo, useState } from 'react'
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'
import type { DemographicsResponse } from '../../api/contracts.ts'
import { demographicPoints, distribution } from '../../domain/analytics.ts'
import { formatTime, number } from '../../domain/time.ts'
import { EmptyState, Surface } from '../../components/ui/Display.tsx'
import { Select } from '../../components/ui/Select.tsx'
import { TimeSeriesChart } from '../../components/ui/TimeSeriesChart.tsx'

export const Demographics = memo(function Demographics({ response, timezone }: { response?: DemographicsResponse; timezone: string }) {
  const { buckets, points } = useMemo(() => demographicPoints(response?.buckets, timezone), [response?.buckets, timezone])
  const [chosen, setChosen] = useState<number | null>(null)
  const bucket = buckets.find(item => item.utc === chosen) ?? buckets.at(-1)
  const shares = distribution(bucket?.male, bucket?.female)
  if (!response?.buckets) return <Surface heading="Demographics"><EmptyState heading="Demographic buckets unavailable">The response did not include a bucket list. This is different from a measured zero.</EmptyState></Surface>
  return <div className="demographics-layout">
    <Surface heading="Hourly breakdown">
      {buckets.length > 0 && <Select label="Hour" value={String(bucket?.utc ?? '')} onValueChange={value => setChosen(Number(value))} options={buckets.map(item => ({ value: String(item.utc), label: formatTime(item.utc, timezone, true) }))} />}
      {shares && bucket ? <><div className="demographic-donut" role="img" aria-label={`Reported male share ${number(shares.male, 1)} percent; female share ${number(shares.female, 1)} percent`}><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={[{ name: 'Male', value: bucket.male }, { name: 'Female', value: bucket.female }]} dataKey="value" innerRadius="66%" outerRadius="88%" paddingAngle={3} stroke="none" isAnimationActive={false}><Cell fill="var(--chart-primary)" /><Cell fill="var(--chart-secondary)" /></Pie></PieChart></ResponsiveContainer><div className="donut-center" aria-hidden="true"><span>Reported share</span><strong>100%</strong></div></div><dl className="demographic-key"><div><dt><svg className="demographic-person-icon demographic-person-icon--male" viewBox="0 0 24 48" aria-hidden="true" focusable="false"><use href="/icons/male.svg#male" /></svg>Male</dt><dd>{number(shares.male, 1)}% <span>({number(bucket.male, 2)})</span></dd></div><div><dt><svg className="demographic-person-icon demographic-person-icon--female" viewBox="0 0 24 48" aria-hidden="true" focusable="false"><use href="/icons/female.svg#female" /></svg>Female</dt><dd>{number(shares.female, 1)}% <span>({number(bucket.female, 2)})</span></dd></div></dl></> : <EmptyState heading="No distribution available">This bucket has no complete, non-zero reported values.</EmptyState>}
    </Surface>
    <Surface heading="Gender trend">{points.length ? <TimeSeriesChart label="Male and female over time" description="Reported hourly values · selected site timezone" showHeading={false} data={points} series={[{ key: 'male', label: 'Male', color: 'var(--chart-primary)' }, { key: 'female', label: 'Female', color: 'var(--chart-secondary)', dashed: true }]} /> : <EmptyState heading="No demographic history">Try another date window.</EmptyState>}</Surface>
  </div>
})
