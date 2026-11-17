import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import api, { getErrorMessage } from '../api/client'

const colors = { INFO: '#2676ed', WARNING: '#ffac22', ERROR: '#ff414c', CRITICAL: '#8c3fe8', DEBUG: '#26a4cf' }
const dateToday = new Date().toISOString().slice(0, 10)
const dateMonthAgo = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

export default function ReportsPage() {
  const [data, setData] = useState(null)
  const [dates, setDates] = useState({ from: dateMonthAgo, to: dateToday })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    const params = {}
    if (dates.from) params.from = new Date(dates.from).toISOString()
    if (dates.to) params.to = new Date(`${dates.to}T23:59:59`).toISOString()
    api.get('/reports', { params }).then(({ data: result }) => { if (active) { setData(result); setError('') } })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError)) })
    return () => { active = false }
  }, [dates, refresh])

  async function exportCsv() {
    setBusy(true); setError('')
    try {
      const params = {}
      if (dates.from) params.from = new Date(dates.from).toISOString()
      if (dates.to) params.to = new Date(`${dates.to}T23:59:59`).toISOString()
      const response = await api.get('/reports/export', { params, responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url; link.download = 'logsphere-report.csv'; link.click()
      URL.revokeObjectURL(url)
    } catch (requestError) { setError(getErrorMessage(requestError)) }
    finally { setBusy(false) }
  }

  const severityData = (data?.severity || []).map((item) => ({
    name: item.severity.charAt(0) + item.severity.slice(1).toLowerCase(),
    value: item.total,
    color: colors[item.severity],
  }))
  const activityData = (data?.activity || []).map((item) => ({ day: new Date(item.day).toLocaleDateString([], { month: 'short', day: 'numeric' }), total: item.total, errors: item.errors, warnings: item.warnings }))
  const sourceData = (data?.sources || []).map((item) => ({ name: item.service_name, total: item.total }))

  return (
    <>
      <div className="page-heading reports-heading"><div><h1>Reports</h1><p>Analyse logs and generate reports</p></div>
        <div className="heading-actions"><label className="date-filter">From<input type="date" value={dates.from} onChange={(e) => setDates({ ...dates, from: e.target.value })} /></label><label className="date-filter">To<input type="date" value={dates.to} onChange={(e) => setDates({ ...dates, to: e.target.value })} /></label><button className="secondary-button" onClick={() => setRefresh(refresh + 1)}>Generate Report</button><button className="primary-button" onClick={exportCsv} disabled={busy}>{busy ? 'Preparing…' : '⇩ Export Report'}</button></div>
      </div>
      {error && <div className="inline-error">{error}</div>}
      <div className="report-total panel"><div><span className="report-total-icon">▤</span><div><span>Total logs in selected period</span><strong>{data ? data.total.toLocaleString() : '—'}</strong></div></div><small>Based on PostgreSQL records</small></div>
      <section className="reports-grid">
        <article className="panel report-panel severity-report"><div className="panel-heading"><div><h2>Log Severity Distribution</h2><p>Breakdown by severity level</p></div></div>
          <div className="donut-wrap">{severityData.length ? <><div className="donut-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={severityData} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2}>{severityData.map((item) => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer></div><div className="legend-list">{severityData.map((item) => <div key={item.name}><span><i style={{ backgroundColor: item.color }} />{item.name}</span><b>{item.value.toLocaleString()}</b></div>)}</div></> : <div className="chart-empty">{data ? 'No data in this date range.' : 'Loading report…'}</div>}</div>
        </article>
        <article className="panel report-panel trends-report"><div className="panel-heading"><div><h2>Logs Over Time</h2><p>Daily log volume in the selected period</p></div></div>
          <div className="report-chart">{activityData.length ? <ResponsiveContainer width="100%" height="100%"><LineChart data={activityData} margin={{ top: 10, right: 12, left: -18, bottom: 0 }}><CartesianGrid stroke="#e8edf5" vertical={false} /><XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#61708a', fontSize: 11 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: '#61708a', fontSize: 11 }} /><Tooltip /><Line type="monotone" dataKey="total" name="All logs" stroke="#1467e8" strokeWidth={2.5} dot={{ fill: '#1467e8', r: 3 }} /><Line type="monotone" dataKey="errors" name="Errors" stroke="#f0444d" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="warnings" name="Warnings" stroke="#f4a11a" strokeWidth={2} dot={false} /></LineChart></ResponsiveContainer> : <div className="chart-empty">{data ? 'No data in this date range.' : 'Loading report…'}</div>}</div>
        </article>
        <article className="panel report-panel sources-report"><div className="panel-heading"><div><h2>Top Sources</h2><p>Logs grouped by service</p></div></div>
          <div className="source-chart">{sourceData.length ? <ResponsiveContainer width="100%" height="100%"><BarChart data={sourceData} layout="vertical" margin={{ top: 4, right: 10, left: 4, bottom: 0 }}><CartesianGrid stroke="#e8edf5" horizontal={false} /><XAxis type="number" hide /><YAxis type="category" dataKey="name" width={86} axisLine={false} tickLine={false} tick={{ fill: '#24344e', fontSize: 11 }} /><Tooltip /><Bar dataKey="total" fill="#287cf5" radius={[0, 7, 7, 0]} barSize={14} /></BarChart></ResponsiveContainer> : <div className="chart-empty">{data ? 'No data in this date range.' : 'Loading report…'}</div>}</div>
        </article>
      </section>
      <button className="secondary-button report-download" onClick={exportCsv} disabled={busy}>⇩ Export Report as CSV</button>
    </>
  )
}
