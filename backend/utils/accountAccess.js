function loginDenialMessage(user) {
  if (user?.account_status === 'PENDING') return 'Your account is awaiting administrator approval.';
  if (user?.account_status === 'REJECTED') return 'Your registration was not approved. Please contact the administrator.';
  if (!user || user.account_status !== 'APPROVED') return 'This account cannot access LogSphere.';
  if (!user.is_active) return 'Your account is inactive. Please contact the administrator.';
  if (!user.is_verified) return 'Verify your email address before signing in.';
  return null;
}

module.exports = { loginDenialMessage };
