import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api/client'

export default function LogDetailsPage({ id, goBack }) {
  const [log, setLog] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    api.get(`/logs/${id}`).then(({ data }) => { if (active) setLog(data.log) })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError)) })
    return () => { active = false }
  }, [id])
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && goBack()}>
      <article className="panel details-card" role="dialog" aria-modal="true" aria-labelledby="details-title">
        <div className="details-heading"><div><h2 id="details-title">Log Details</h2><p>{log ? `Record ${log.log_id}` : 'Inspect a complete server log record'}</p></div>
          {log && <span className={`level-pill ${log.severity.toLowerCase()}`}>{log.severity}</span>}
          <button className="close-button" aria-label="Close log details" onClick={goBack}>×</button>
        </div>
        {error && <div className="inline-error details-error">{error}</div>}
        {!log && !error && <div className="details-loading">Loading log details…</div>}
        {log && <div className="details-grid">
          <div className="detail-item"><span>Log ID</span><b>#{log.log_id}</b></div>
          <div className="detail-item"><span>Timestamp</span><b>{new Date(log.timestamp).toLocaleString()}</b></div>
          <div className="detail-item"><span>Level</span><b><span className={`level-pill ${log.severity.toLowerCase()}`}>{log.severity}</span></b></div>
          <div className="detail-item"><span>Service</span><b>{log.service_name}</b></div>
          <div className="detail-item"><span>Source / Host</span><b>{log.source || '—'}</b></div>
          <div className="detail-item"><span>IP Address</span><b>{log.ip_address || '—'}</b></div>
          <div className="detail-item"><span>HTTP Status</span><b>{log.http_status || '—'}</b></div>
          <div className="detail-item wide"><span>Message</span><pre>{log.message}</pre></div>
          <div className="detail-item wide"><span>Metadata</span><pre>{JSON.stringify(log.metadata || {}, null, 2)}</pre></div>
          {log.upload_name && <div className="detail-item"><span>Uploaded file</span><b>{log.upload_name}</b></div>}
          {log.uploaded_by && <div className="detail-item"><span>Uploaded by</span><b>{log.uploaded_by}</b></div>}
          <div className="details-footer"><button className="primary-button" onClick={goBack}>Close</button></div>
        </div>}
      </article>
    </div>
  )
}
