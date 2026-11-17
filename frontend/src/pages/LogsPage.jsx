import { useCallback, useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api/client'

const severityOptions = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']
const emptyForm = { timestamp: '', severity: 'INFO', service_name: '', source: '', ip_address: '', http_status: '', message: '' }

export default function LogsPage({ user, openLog }) {
  const [logs, setLogs] = useState([])
  const [filters, setFilters] = useState({ search: '', severity: '', service: '', range: '', sort: 'desc' })
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editingId, setEditingId] = useState(null)
  const [editMetadata, setEditMetadata] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadStage, setUploadStage] = useState('')
  const [selectedFilename, setSelectedFilename] = useState('')
  const [uploadSummary, setUploadSummary] = useState(null)
  const [uploadHistory, setUploadHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [confirming, setConfirming] = useState(null)
  const [code, setCode] = useState('')
  const canWrite = ['admin', 'analyst'].includes(user.role)
  const canDelete = user.role === 'admin'
  const loadUploadHistory = useCallback(async () => {
    try {
      const { data } = await api.get('/logs/files')
      setUploadHistory(data.files)
      setHistoryError('')
    } catch (requestError) {
      setHistoryError(getErrorMessage(requestError))
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  const buildFilters = useCallback(() => {
    const params = { search: filters.search, severity: filters.severity, service: filters.service, sort: filters.sort }
    if (filters.range) {
      const since = new Date()
      if (filters.range === '24h') since.setHours(since.getHours() - 24)
      if (filters.range === '7d') since.setDate(since.getDate() - 7)
      if (filters.range === '30d') since.setDate(since.getDate() - 30)
      params.from = since.toISOString()
    }
    return params
  }, [filters])
  const fetchLogs = useCallback(async () => {
    const params = { ...buildFilters(), page, limit: 8 }
    const { data } = await api.get('/logs', { params })
    return data
  }, [buildFilters, page])
  const loadLogs = useCallback(async () => {
    try {
      const data = await fetchLogs()
      setError(''); setLogs(data.logs); setTotal(data.total)
    } catch (requestError) { setError(getErrorMessage(requestError)) }
  }, [fetchLogs])
  useEffect(() => {
    let active = true
    fetchLogs().then((data) => {
      if (active) { setError(''); setLogs(data.logs); setTotal(data.total) }
    }).catch((requestError) => { if (active) setError(getErrorMessage(requestError)) })
    return () => { active = false }
  }, [fetchLogs])
  useEffect(() => {
    let active = true
    api.get('/logs/files').then(({ data }) => {
      if (active) { setUploadHistory(data.files); setHistoryError('') }
    }).catch((requestError) => { if (active) setHistoryError(getErrorMessage(requestError)) })
      .finally(() => { if (active) setHistoryLoading(false) })
    return () => { active = false }
  }, [])

  async function createLog(event) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      if (editingId) {
        await api.put(`/logs/${editingId}`, { ...form, timestamp: form.timestamp ? new Date(form.timestamp).toISOString() : '', metadata: editMetadata || {} })
        setNotice('Log record updated.')
      } else {
        await api.post('/logs', { ...form, timestamp: form.timestamp ? new Date(form.timestamp).toISOString() : '', metadata: {} })
        setNotice('Log record created.')
      }
      setEditingId(null); setEditMetadata(null)
      setShowCreate(false); setForm(emptyForm); await loadLogs()
    } catch (requestError) { setError(getErrorMessage(requestError)) }
    finally { setBusy(false) }
  }

  async function uploadFile(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setSelectedFilename(file.name)
    setUploading(true); setUploadProgress(0); setUploadStage('Uploading'); setError(''); setNotice(''); setUploadSummary(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const { data } = await api.post('/logs/upload', body, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percentage = Math.round((progressEvent.loaded / progressEvent.total) * 100)
            setUploadProgress(percentage)
            setUploadStage(percentage >= 100 ? 'Processing records' : 'Uploading')
          }
        },
      })
      setUploadProgress(100)
      setUploadStage('Complete')
      setUploadSummary(data)
      setNotice(`${data.imported_records} records imported; ${data.rejected_records} rejected.`)
      setError('')
      setPage(1)
      setFilters({ search: '', severity: '', service: '', range: '', sort: 'desc' })
      const refreshed = await api.get('/logs', { params: { page: 1, limit: 8, sort: 'desc' } })
      setLogs(refreshed.data.logs)
      setTotal(refreshed.data.total)
      setHistoryLoading(true)
      await loadUploadHistory()
    } catch (requestError) {
      const result = requestError.response?.data
      if (result?.total_records !== undefined) {
        setUploadSummary(result)
        setNotice(result.message || '')
        setError(result.error || '')
        setHistoryLoading(true)
        await loadUploadHistory()
      } else {
        setError(getErrorMessage(requestError))
      }
    }
    finally { setUploading(false); event.target.value = '' }
  }

  async function requestDelete(id) {
    setError(''); setNotice('')
    try {
      const { data } = await api.post(`/logs/${id}/deletion-request`)
      setNotice(data.message); setConfirming(id)
    } catch (requestError) { setError(getErrorMessage(requestError)) }
  }

  async function confirmDelete(event) {
    event.preventDefault()
    try {
      const { data } = await api.post(`/logs/${confirming}/deletion-confirmation`, { code })
      setNotice(data.message); setConfirming(null); setCode(''); await loadLogs()
    } catch (requestError) { setError(getErrorMessage(requestError)) }
  }

  function beginEdit(log) {
    const date = new Date(log.timestamp)
    const localTimestamp = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    setEditingId(log.id)
    setEditMetadata(log.metadata)
    setForm({ timestamp: localTimestamp, severity: log.severity, service_name: log.service_name, source: log.source || '', ip_address: log.ip_address || '', http_status: log.http_status || '', message: log.message })
    setShowCreate(true)
  }

  return (
    <>
      <div className="page-heading logs-heading"><div><h1>Log Management</h1><p>View, search and filter server logs</p></div>
        <div className="heading-actions">{canWrite && <><label className={`secondary-button upload-button ${uploading ? 'disabled' : ''}`}>↥ {uploading ? 'Uploading…' : 'Upload Logs'}<input type="file" accept=".log,.txt,.csv" disabled={uploading} onChange={uploadFile} hidden /></label><small className="upload-hint">.log, .txt, .csv · max 5 MB</small></>}
          <button className="secondary-button" onClick={async () => { try { const response = await api.get('/reports/export', { params: buildFilters(), responseType: 'blob' }); const url = URL.createObjectURL(response.data); const a = document.createElement('a'); a.href = url; a.download = 'logsphere-logs.csv'; a.click(); URL.revokeObjectURL(url) } catch (requestError) { setError(getErrorMessage(requestError)) } }}>⇩ Export CSV</button>
          {canWrite && <button className="primary-button" onClick={() => { setEditingId(null); setForm(emptyForm); setShowCreate(true) }}>＋ Add Log</button>}
        </div>
      </div>
      {error && <div className="inline-error">{error}</div>}{notice && <div className="inline-success">{notice}</div>}
      {selectedFilename && <div className="upload-filename">Selected file: {selectedFilename}</div>}
      {uploading && <div className="upload-progress" role="status" aria-live="polite">
        <div className="upload-progress-head"><strong>{uploadStage === 'Processing records' ? 'Processing uploaded records…' : 'Uploading file…'}</strong><span>{uploadProgress}%</span></div>
        <div className="upload-progress-track"><span style={{ width: `${uploadProgress}%` }} /></div>
      </div>}
      {uploadSummary && <section className="panel upload-summary" aria-live="polite">
        <div className="panel-heading"><div><h2>Import Summary</h2><p>{selectedFilename || 'Uploaded log file'}</p></div></div>
        <div className="upload-summary-stats">
          <span>Total found: <b>{uploadSummary.total_records}</b></span>
          <span>Imported: <b>{uploadSummary.imported_records}</b></span>
          <span>Rejected: <b>{uploadSummary.rejected_records}</b></span>
        </div>
        {uploadSummary.rejection_reasons?.length > 0 && <ul className="rejection-reasons">
          {uploadSummary.rejection_reasons.map((item) => <li key={item.reason}>{item.reason}{item.count ? ` (${item.count})` : ''}</li>)}
        </ul>}
        {uploadSummary.rejected_details?.length > 0 && <details>
          <summary>Record / file issue details ({uploadSummary.rejected_details.length}{uploadSummary.rejected_records > uploadSummary.rejected_details.length ? '+' : ''})</summary>
          <pre className="rejection-details">{uploadSummary.rejected_details.map((item) => `${item.scope === 'file' ? 'File: ' : item.line ? `Line ${item.line}: ` : ''}${item.reason}${item.count > 1 ? ` (${item.count})` : ''}`).join('\n')}</pre>
        </details>}
      </section>}
      <section className="panel logs-panel">
        <div className="filter-toolbar">
          <label className="search-field"><span>⌕</span><input placeholder="Search by log ID or message…" value={filters.search} onChange={(e) => { setPage(1); setFilters({ ...filters, search: e.target.value }) }} /></label>
          <select value={filters.severity} onChange={(e) => { setPage(1); setFilters({ ...filters, severity: e.target.value }) }}><option value="">All Levels</option>{severityOptions.map((level) => <option key={level}>{level}</option>)}</select>
          <input className="filter-input" placeholder="Service" value={filters.service} onChange={(e) => { setPage(1); setFilters({ ...filters, service: e.target.value }) }} />
          <select value={filters.range} onChange={(e) => { setPage(1); setFilters({ ...filters, range: e.target.value }) }}><option value="">All Time</option><option value="24h">Last 24 Hours</option><option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option></select>
          <select aria-label="Sort logs by timestamp" value={filters.sort} onChange={(e) => { setPage(1); setFilters({ ...filters, sort: e.target.value }) }}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select>
        </div>
        <div className="table-scroll"><table className="logs-table"><thead><tr><th>#</th><th>Timestamp</th><th>Level</th><th>Service</th><th>Message</th><th>Actions</th></tr></thead>
          <tbody>{logs.map((log, index) => <tr key={log.id}><td className="row-index">{(page - 1) * 8 + index + 1}</td><td>{new Date(log.timestamp).toLocaleString()}</td><td><span className={`level-pill ${log.severity.toLowerCase()}`}>{log.severity}</span></td><td>{log.service_name}</td><td className="message-cell">{log.message}</td><td><div className="table-actions"><button className="view-button" onClick={() => openLog(log.id)}>View</button>{canWrite && <button className="view-button" onClick={() => beginEdit(log)}>Edit</button>}{canDelete && <button className="delete-button" onClick={() => requestDelete(log.id)}>Delete</button>}</div></td></tr>)}</tbody>
        </table>{logs.length === 0 && <div className="table-empty">{error ? 'Logs could not be loaded.' : 'No log records match your filters.'}</div>}</div>
        <div className="table-footer"><span>Showing {total ? (page - 1) * 8 + 1 : 0}–{Math.min(page * 8, total)} of {total.toLocaleString()} logs</span><div className="pagination"><button disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button><span>{page}</span><button disabled={page * 8 >= total} onClick={() => setPage(page + 1)}>›</button></div></div>
      </section>

      <section className="panel upload-history">
        <div className="panel-heading"><div><h2>Upload History</h2><p>Recent processed files and import results</p></div></div>
        {historyError && <div className="inline-error">{historyError}</div>}
        <div className="table-scroll"><table className="logs-table">
          <thead><tr><th>Original Filename</th><th>Uploaded</th><th>Uploaded By</th><th>Total</th><th>Imported</th><th>Rejected</th></tr></thead>
          <tbody>{uploadHistory.map((file) => <tr key={file.id}>
            <td>{file.original_name}</td><td>{new Date(file.created_at).toLocaleString()}</td><td>{file.uploaded_by || '—'}</td>
            <td>{file.total_records}</td><td>{file.valid_records}</td><td>{file.rejected_records}</td>
          </tr>)}</tbody>
        </table>
          {historyLoading && <div className="table-empty">Loading upload history…</div>}
          {!historyLoading && !historyError && uploadHistory.length === 0 && <div className="table-empty">No files have been uploaded yet.</div>}
        </div>
      </section>

      {showCreate && <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowCreate(false)}><div className="modal"><div className="modal-header"><h2>{editingId ? 'Edit Log' : 'Create Log'}</h2><button className="close-button" onClick={() => setShowCreate(false)}>×</button></div>
        <form className="edit-form" onSubmit={createLog}>
          <div className="form-row"><label>Severity<select value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{severityOptions.map((level) => <option key={level}>{level}</option>)}</select></label><label>Service<input required value={form.service_name} onChange={(e) => setForm({ ...form, service_name: e.target.value })} /></label></div>
          <div className="form-row"><label>Timestamp<input type="datetime-local" value={form.timestamp} onChange={(e) => setForm({ ...form, timestamp: e.target.value })} /></label><label>Source / Host<input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></label></div>
          <div className="form-row"><label>IP address<input value={form.ip_address} onChange={(e) => setForm({ ...form, ip_address: e.target.value })} /></label><label>HTTP status<input type="number" min="100" max="599" value={form.http_status} onChange={(e) => setForm({ ...form, http_status: e.target.value })} /></label></div>
          <label>Message<textarea rows="4" required value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>
          <button className="primary-button" disabled={busy}>{busy ? 'Saving…' : editingId ? 'Save Changes' : 'Save Log'}</button>
        </form></div></div>}
      {confirming && <div className="modal-backdrop"><div className="modal small-modal"><div className="modal-header"><h2>Confirm Log Deletion</h2><button className="close-button" onClick={() => setConfirming(null)}>×</button></div><p className="modal-copy">A confirmation code has been emailed to the configured administrator address. The record will remain until the code is verified.</p><form className="edit-form" onSubmit={confirmDelete}><label>Confirmation code<input required value={code} onChange={(e) => setCode(e.target.value)} /></label><button className="primary-button">Verify and Delete</button></form></div></div>}
    </>
  )
}
