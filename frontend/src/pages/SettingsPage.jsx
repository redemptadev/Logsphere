export default function SettingsPage({ user, setPage }) {
  return (
    <>
      <div className="page-heading"><div><h1>Settings</h1><p>Account details and access management</p></div></div>
      <article className="panel account-panel">
        <div className="panel-heading"><div><h2>My Account</h2><p>Your LogSphere profile</p></div></div>
        <div className="account-details">
          <span className="avatar large">{(user.full_name || 'U').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
          <div><h3>{user.full_name}</h3><span>{user.email}</span></div>
          <span className="role-tag">{user.role}</span>
        </div>
      </article>
      {user.role === 'admin'
        ? <article className="panel access-note"><h2>Administrator access</h2><p>Manage registrations, roles, and account activation in User Management.</p><button className="primary-button" onClick={() => setPage('User Management')}>Open User Management</button></article>
        : <article className="panel access-note"><h2>Account access</h2><p>Role changes and user administration are restricted to administrators.</p></article>}
    </>
  )
}
