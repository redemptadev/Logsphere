import { useEffect, useState } from 'react'
import api, { getErrorMessage } from '../api/client'

function StatusBadge({ status }) {
  return <span className={`account-status ${String(status || '').toLowerCase()}`}>{status}</span>
}

export default function UsersPage({ user }) {
  const [users, setUsers] = useState([])
  const [pending, setPending] = useState([])
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [details, setDetails] = useState(null)

  useEffect(() => {
    let active = true
    const params = { search, role: roleFilter, account_status: statusFilter }
    Promise.all([api.get('/users/pending'), api.get('/users', { params })])
      .then(([pendingResult, usersResult]) => {
        if (!active) return
        setPending(pendingResult.data.users)
        setUsers(usersResult.data.users)
        setError('')
      })
      .catch((requestError) => { if (active) setError(getErrorMessage(requestError)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [search, roleFilter, statusFilter, refresh])

  async function completeApprovalAction() {
    if (!confirmation) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { id, action } = confirmation
      const { data } = await api.post(`/users/${id}/${action}`)
      setNotice(data.message)
      setConfirmation(null)
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  async function updateUser(id, changes) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { data } = await api.patch(`/users/${id}`, changes)
      setNotice(`Account settings updated for ${data.user.username}.`)
      setLoading(true)
      setRefresh((value) => value + 1)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-heading">
        <div><h1>User Management</h1><p>Review registrations and manage LogSphere access</p></div>
        <span className="role-tag">Administrator</span>
      </div>
      {error && <div className="inline-error">{error}</div>}
      {notice && <div className="inline-success">{notice}</div>}

      <section className="panel approvals-panel">
        <div className="panel-heading">
          <div><h2>Pending Approvals</h2><p>Review each registration before granting application access</p></div>
          <span className="pending-count">{pending.length} pending</span>
        </div>
        <div className="table-scroll">
          <table className="logs-table">
            <thead><tr><th>Full Name</th><th>Email</th><th>Username</th><th>Registered</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{pending.map((account) => <tr key={account.id}>
              <td>{account.full_name}</td><td>{account.email}</td><td>@{account.username}</td>
              <td>{new Date(account.created_at).toLocaleString()}</td><td><StatusBadge status={account.account_status} /></td>
              <td><div className="table-actions">
                <button className="view-button approve-button" disabled={busy || account.role !== 'viewer'} onClick={() => setConfirmation({ id: account.id, fullName: account.full_name, action: 'approve' })}>Approve</button>
                <button className="delete-button" disabled={busy} onClick={() => setConfirmation({ id: account.id, fullName: account.full_name, action: 'reject' })}>Reject</button>
              </div></td>
            </tr>)}</tbody>
          </table>
          {loading && pending.length === 0 && <div className="table-empty">Loading pending registrations…</div>}
          {!loading && pending.length === 0 && <div className="table-empty">There are no registrations awaiting approval.</div>}
        </div>
      </section>

      <section className="panel user-management">
        <div className="panel-heading"><div><h2>Registered Users</h2><p>Search accounts, assign roles, and manage activation</p></div></div>
        <div className="user-filters">
          <label className="search-field"><span>⌕</span><input aria-label="Search users" placeholder="Search name, email or username…" value={search} onChange={(event) => { setLoading(true); setSearch(event.target.value) }} /></label>
          <select aria-label="Filter users by role" value={roleFilter} onChange={(event) => { setLoading(true); setRoleFilter(event.target.value) }}>
            <option value="">All roles</option><option value="admin">Admin</option><option value="analyst">Analyst</option><option value="viewer">Viewer</option>
          </select>
          <select aria-label="Filter users by approval status" value={statusFilter} onChange={(event) => { setLoading(true); setStatusFilter(event.target.value) }}>
            <option value="">All approval statuses</option><option value="PENDING">Pending</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
          </select>
        </div>
        <div className="table-scroll">
          <table className="logs-table">
            <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Approval</th><th>Email</th><th>Account</th><th>Actions</th></tr></thead>
            <tbody>{users.map((account) => <tr key={account.id}>
              <td>{account.full_name}<small className="user-handle">@{account.username}</small></td>
              <td>{account.email}</td>
              <td><select disabled={busy || account.id === user.id || account.account_status !== 'APPROVED'} value={account.role} onChange={(event) => updateUser(account.id, { role: event.target.value })}>
                <option value="viewer">Viewer</option><option value="analyst">Analyst</option><option value="admin">Admin</option>
              </select></td>
              <td><StatusBadge status={account.account_status} /></td>
              <td><span className={`verification-status ${account.is_verified ? 'verified' : ''}`}>{account.is_verified ? 'Verified' : 'Unverified'}</span></td>
              <td><span className={`active-status ${account.is_active ? 'active' : ''}`}>{account.is_active ? 'Active' : 'Inactive'}</span></td>
              <td><div className="table-actions">
                <button className="view-button" onClick={() => setDetails(account)}>Details</button>
                {account.account_status === 'APPROVED' && <button className="view-button" disabled={busy || account.id === user.id} onClick={() => updateUser(account.id, { is_active: !account.is_active })}>{account.is_active ? 'Deactivate' : 'Activate'}</button>}
              </div></td>
            </tr>)}</tbody>
          </table>
          {loading && users.length === 0 && <div className="table-empty">Loading user accounts…</div>}
          {!loading && users.length === 0 && <div className="table-empty">No users match these filters.</div>}
        </div>
      </section>

      {confirmation && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !busy && setConfirmation(null)}>
        <section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="approval-confirm-title">
          <div className="modal-header"><h2 id="approval-confirm-title">{confirmation.action === 'approve' ? 'Approve registration?' : 'Reject registration?'}</h2><button className="close-button" disabled={busy} onClick={() => setConfirmation(null)} aria-label="Close">×</button></div>
          <p className="modal-copy">{confirmation.action === 'approve'
            ? `Approve ${confirmation.fullName}? Their account will be activated with the existing Viewer role.`
            : `Reject ${confirmation.fullName}? They will not be able to access LogSphere.`}</p>
          <div className="confirmation-actions"><button className="secondary-button" disabled={busy} onClick={() => setConfirmation(null)}>Cancel</button><button className={confirmation.action === 'approve' ? 'primary-button' : 'danger-button'} disabled={busy} onClick={completeApprovalAction}>{busy ? 'Saving…' : confirmation.action === 'approve' ? 'Approve Account' : 'Reject Registration'}</button></div>
        </section>
      </div>}

      {details && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setDetails(null)}>
        <section className="modal small-modal" role="dialog" aria-modal="true" aria-labelledby="user-detail-title">
          <div className="modal-header"><h2 id="user-detail-title">Account Details</h2><button className="close-button" onClick={() => setDetails(null)} aria-label="Close">×</button></div>
          <div className="user-detail-list">
            <div><span>Full name</span><b>{details.full_name}</b></div><div><span>Email</span><b>{details.email}</b></div>
            <div><span>Username</span><b>@{details.username}</b></div><div><span>Role</span><b>{details.role}</b></div>
            <div><span>Approval status</span><StatusBadge status={details.account_status} /></div>
            <div><span>Active</span><b>{details.is_active ? 'Yes' : 'No'}</b></div>
            <div><span>Email verified</span><b>{details.is_verified ? 'Yes' : 'No'}</b></div>
            <div><span>Registered</span><b>{new Date(details.created_at).toLocaleString()}</b></div>
          </div>
        </section>
      </div>}
    </>
  )
}
