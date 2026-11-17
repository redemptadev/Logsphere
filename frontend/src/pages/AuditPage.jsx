import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api/client'

export default function AuditPage() {
  const [records, setRecords] = useState([])
  const [error, setError] = useState('')
  useEffect(() => {
    api.get('/audit').then(({ data }) => setRecords(data.auditLogs)).catch((requestError) => setError(getErrorMessage(requestError)))
  }, [])
  return (
    <>
      <div className="page-heading"><div><h1>Audit History</h1><p>Review important system activity</p></div></div>
      {error && <div className="inline-error">{error}</div>}
      <section className="panel logs-panel"><div className="table-scroll"><table className="logs-table"><thead><tr><th>Timestamp</th><th>User</th><th>Action</th><th>Description</th><th>IP Address</th></tr></thead><tbody>
        {records.map((record) => <tr key={record.id}><td>{new Date(record.created_at).toLocaleString()}</td><td>{record.username || 'System'}</td><td><span className="level-pill info">{record.action}</span></td><td>{record.description}</td><td>{record.ip_address || '—'}</td></tr>)}
      </tbody></table>{records.length === 0 && !error && <div className="table-empty">Loading audit history…</div>}</div></section>
    </>
  )
}
