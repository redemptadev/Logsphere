import { useEffect, useState } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api, { getErrorMessage } from '../api/client'

const cards = [
  { key: 'total', label: 'Total Logs', icon: '▤', color: 'blue' },
  { key: 'errors', label: 'Errors', icon: '!', color: 'red' },
  { key: 'critical', label: 'Critical', icon: '✦', color: 'purple' },
  { key: 'warnings', label: 'Warnings', icon: '⚠', color: 'orange' },
  { key: 'info', label: 'Info Logs', icon: 'i', color: 'green' },
  { key: 'debug', label: 'Debug', icon: '·', color: 'cyan' },
]

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function DashboardPage({ setPage, openLog }) {
  const [range, setRange] = useState('7d')
  const [dates, setDates] = useState({ from: '', to: '' })
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const incompleteRange = range === 'custom' && (!dates.from || !dates.to)
  useEffect(() => {
    if (incompleteRange) return undefined
    let active = true
    const params = { range }
    if (range === 'custom') {
      params.from = new Date(dates.from).toISOString()
      params.to = new Date(`${dates.to}T23:59:59`).toISOString()
    }
    api.get('/dashboard', { params }).then(({ data: result }) => {
      if (active) { setData(result); setError('') }
    }).catch((requestError) => { if (active) setError(getErrorMessage(requestError)) })
    return () => { active = false }
  }, [range, dates, incompleteRange])
  const displayData = incompleteRange ? null : data
  const chartData = (displayData?.activity || []).map((point) => ({
    day: new Date(point.day).toLocaleDateString([], { weekday: 'short' }),
    total: point.total,
  }))
  const metricValues = {
    total: displayData?.total ?? '—', errors: displayData?.errors ?? '—',
    critical: displayData?.critical ?? '—', warnings: displayData?.warnings ?? '—',
    info: displayData?.info ?? '—', debug: displayData?.debug ?? '—',
  }
  return (
    <>
      <div className="page-heading"><div><h1>Dashboard</h1><p>Overview of your server logs</p></div><span className="live-indicator"><i /> Live database data</span></div>
      {(error || incompleteRange) && <div className="inline-error">{incompleteRange ? 'Choose both dates to view a custom range.' : error}</div>}
      <section className="metric-grid">
        {cards.map((card) => <article className="metric-card" key={card.key}>
          <div className={`metric-icon ${card.color}`}>{card.icon}</div>
          <strong>{displayData ? Number(metricValues[card.key]).toLocaleString() : '—'}</strong>
          <div className="metric-bottom"><span>{card.label}</span><small className="metric-period">Selected range</small></div>
        </article>)}
      </section>
      <section className="dashboard-grid">
        <article className="panel activity-panel">
          <div className="panel-heading"><div><h2>Log Activity</h2><p>Log events over time</p></div>
            <div className="activity-filters"><select value={range} onChange={(event) => setRange(event.target.value)} aria-label="Dashboard date range"><option value="24h">Last 24 Hours</option><option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option><option value="custom">Custom Range</option></select>
              {range === 'custom' && <><input type="date" aria-label="Custom range start" value={dates.from} onChange={(event) => setDates({ ...dates, from: event.target.value })} /><input type="date" aria-label="Custom range end" value={dates.to} onChange={(event) => setDates({ ...dates, to: event.target.value })} /></>}
            </div>
          </div>
          <div className="chart-area">{chartData.length ? <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}>
              <defs><linearGradient id="activityFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2379f5" stopOpacity={0.28} /><stop offset="100%" stopColor="#2379f5" stopOpacity={0.02} /></linearGradient></defs>
              <CartesianGrid stroke="#e8edf5" vertical={false} />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#61708a', fontSize: 11 }} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#61708a', fontSize: 11 }} />
              <Tooltip />
              <Area type="monotone" dataKey="total" stroke="#1467e8" strokeWidth={2.5} fill="url(#activityFill)" />
            </AreaChart>
          </ResponsiveContainer> : <div className="chart-empty">{displayData ? 'No log activity in this time range.' : incompleteRange ? 'Choose dates above.' : 'Loading log activity…'}</div>}</div>
        </article>
        <article className="panel recent-panel">
          <div className="panel-heading"><div><h2>Recent Logs</h2><p>Latest activity from your systems</p></div><button className="text-button" onClick={() => setPage('Log Management')}>View All →</button></div>
          <div className="recent-list">
            {(displayData?.recentLogs || []).map((log) => <button className="recent-row" key={log.id} onClick={() => openLog(log.id)}>
              <span className={`severity-dot ${log.severity.toLowerCase()}`} />
              <span className={`severity-word ${log.severity.toLowerCase()}`}>{log.severity}</span>
              <span className="recent-message"><b>{log.message}</b><small>{log.service_name}</small></span>
              <time>{formatTime(log.timestamp)}</time>
            </button>)}
            {displayData && displayData.recentLogs.length === 0 && <p className="empty-note">No recent logs to display.</p>}
            {!displayData && !incompleteRange && <p className="empty-note">Loading recent logs…</p>}
          </div>
        </article>
      </section>
    </>
  )
}
