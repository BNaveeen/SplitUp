// Capacitor native apps run with hostname=localhost but have no dev proxy — always use prod
const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
const isLocal = !isNative && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.startsWith('192.') ||
  window.location.hostname.startsWith('172.')
)

// ── Load Balancer ─────────────────────────────────────────────────────────────
// List all backend instances here. All must share the same JWT_SECRET and DATABASE_URL.
// To scale: deploy another Render service and add its URL to this array.
const PROD_BACKENDS = [
  'https://splitup-qttj.onrender.com',
  // 'https://splitup-b.onrender.com',   // ← add more instances here
]

// BackendPool: round-robin across healthy backends with circuit breaker per instance.
// Circuit opens after FAIL_THRESHOLD consecutive network errors → backend is skipped
// for RECOVERY_MS before being retried.
class BackendPool {
  constructor(urls) {
    // Shuffle at page load so concurrent users spread naturally across backends
    this._urls = [...urls]
    for (let i = this._urls.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this._urls[i], this._urls[j]] = [this._urls[j], this._urls[i]]
    }
    this._failures = new Array(this._urls.length).fill(0)
    this._idx = 0
    this._FAIL_THRESHOLD = 3
    this._RECOVERY_MS = 30_000
  }

  // Returns index of next healthy backend (round-robin, skips open circuits)
  pick() {
    for (let i = 0; i < this._urls.length; i++) {
      const k = (this._idx + i) % this._urls.length
      if (this._failures[k] < this._FAIL_THRESHOLD) {
        this._idx = (k + 1) % this._urls.length
        return k
      }
    }
    // All circuits open — reset and use first (fail-open so app doesn't lock up)
    this._failures.fill(0)
    this._idx = 1
    return 0
  }

  url(k)     { return this._urls[k] }
  size()     { return this._urls.length }

  success(k) { this._failures[k] = 0 }

  failure(k) {
    this._failures[k]++
    if (this._failures[k] >= this._FAIL_THRESHOLD) {
      // Auto-reset circuit breaker after recovery window
      setTimeout(() => { this._failures[k] = 0 }, this._RECOVERY_MS)
    }
  }
}

// Only activate the pool for production web builds; local uses Vite proxy, native uses first URL
const _pool = (!isLocal && !isNative && PROD_BACKENDS.length > 0)
  ? new BackendPool(PROD_BACKENDS)
  : null

// Single URL used by non-pool paths (native, local)
const API_URL = isLocal ? '/api' : PROD_BACKENDS[0]

// ── Token storage ─────────────────────────────────────────────────────────────

export const getToken = () => localStorage.getItem('splitclone_token')
export const setToken = (t) => localStorage.setItem('splitclone_token', t)
export const clearToken = () => localStorage.removeItem('splitclone_token')

// ── Base fetch helpers ────────────────────────────────────────────────────────

// _attempt counts how many backends we've already tried (for retry-on-failure)
async function apiFetch(path, options = {}, _attempt = 0) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const k   = _pool ? _pool.pick() : -1
  const base = _pool ? _pool.url(k) : API_URL

  let res
  try {
    res = await fetch(`${base}${path}`, { ...options, headers })
    if (_pool) _pool.success(k)
  } catch (err) {
    // Network-level failure (server unreachable, timeout, etc.)
    if (_pool) {
      _pool.failure(k)
      // Retry on the next healthy backend if we haven't exhausted the pool
      if (_attempt < _pool.size() - 1) return apiFetch(path, options, _attempt + 1)
    }
    throw err
  }

  if (res.status === 401) {
    clearToken()
    localStorage.removeItem('splitclone_user')
    window.dispatchEvent(new CustomEvent('auth_expired'))
    throw new Error('Session expired. Please log in again.')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const detail = data.detail
    const msg = typeof detail === 'string' ? detail : detail?.message || `Request failed: ${res.status}`
    const err = new Error(msg)
    if (detail?.upgrade_to) {
      err.upgrade_to  = detail.upgrade_to
      err.feature     = detail.feature
      err.current_plan = detail.current_plan
      window.dispatchEvent(new CustomEvent('upgrade_required', { detail }))
    }
    throw err
  }
  return res.json()
}

// No-auth fetch for public endpoints (login / register) — same LB logic
async function publicFetch(path, options = {}, _attempt = 0) {
  const k    = _pool ? _pool.pick() : -1
  const base = _pool ? _pool.url(k) : API_URL

  let res
  try {
    res = await fetch(`${base}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    })
    if (_pool) _pool.success(k)
  } catch (err) {
    if (_pool) {
      _pool.failure(k)
      if (_attempt < _pool.size() - 1) return publicFetch(path, options, _attempt + 1)
    }
    throw err
  }

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `Request failed: ${res.status}`)
  }
  return res.json()
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export const registerUser = (name, email, password) =>
  publicFetch('/register/', { method: 'POST', body: JSON.stringify({ name, email, password }) });

export const loginUser = (email, password) =>
  publicFetch('/login/', { method: 'POST', body: JSON.stringify({ email, password }) });

export const verifyEmail = (email, otp) =>
  publicFetch('/verify-email/', { method: 'POST', body: JSON.stringify({ email, otp }) });

export const resendVerification = (email) =>
  publicFetch('/resend-verification/', { method: 'POST', body: JSON.stringify({ email }) });

export const forgotPassword = (email) =>
  publicFetch('/forgot-password/', { method: 'POST', body: JSON.stringify({ email }) });

export const resetPassword = (email, otp, new_password) =>
  publicFetch('/reset-password/', { method: 'POST', body: JSON.stringify({ email, otp, new_password }) });

export const changePassword = (userId, current_password, new_password) =>
  apiFetch(`/users/${userId}/change-password`, { method: 'PUT', body: JSON.stringify({ current_password, new_password }) });

// ── Users ─────────────────────────────────────────────────────────────────────

export const fetchUsers = () =>
  apiFetch('/users/').catch(() => []);

export const fetchUserGroups = (userId) =>
  apiFetch(`/users/${userId}/groups/`).catch(() => []);

export const fetchUserExpenses = (userId) =>
  apiFetch(`/users/${userId}/expenses/`).catch(() => []);

export const fetchAllUserBalances = (userId) =>
  apiFetch(`/users/${userId}/all_balances`).catch(() => []);

export const updateUser = (userId, name, title) =>
  apiFetch(`/users/${userId}`, { method: 'PUT', body: JSON.stringify({ name, title: title || null }) });

// ── Notifications ─────────────────────────────────────────────────────────────

export const fetchNotifications = (userId) =>
  apiFetch(`/users/${userId}/notifications`).catch(() => []);

export const markNotificationRead = (notifId) =>
  apiFetch(`/notifications/${notifId}/mark_read`, { method: 'POST' });

// ── Groups ────────────────────────────────────────────────────────────────────

export const createGroup = (name, creator_id) =>
  apiFetch('/groups/', { method: 'POST', body: JSON.stringify({ name, creator_id }) });

export const addGroupMember = (groupId, email) =>
  apiFetch(`/groups/${groupId}/members/`, { method: 'POST', body: JSON.stringify({ email }) });

export const fetchGroupMemberships = (groupId) =>
  apiFetch(`/groups/${groupId}/memberships`).catch(() => []);

export const addGroupMemberById = (groupId, userId, adminUserId) =>
  apiFetch(`/groups/${groupId}/members/by_id`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, admin_user_id: adminUserId }),
  });

export const setGroupMemberRole = (groupId, userId, role, adminUserId) =>
  apiFetch(`/groups/${groupId}/members/${userId}/role`, {
    method: 'PUT',
    body: JSON.stringify({ role, admin_user_id: adminUserId }),
  });

export const removeGroupMember = (groupId, userId, adminUserId) =>
  apiFetch(`/groups/${groupId}/members/${userId}?admin_user_id=${adminUserId}`, { method: 'DELETE' });

export const toggleGroupMemberActive = (groupId, userId, adminUserId) =>
  apiFetch(`/groups/${groupId}/members/${userId}/deactivate?admin_user_id=${adminUserId}`, { method: 'PUT' });

export const renameGroup = (groupId, name, requesterId) =>
  apiFetch(`/groups/${groupId}/name`, {
    method: 'PUT',
    body: JSON.stringify({ name, requester_id: requesterId }),
  });

// ── Expenses ──────────────────────────────────────────────────────────────────

export const fetchGroupExpenses = (groupId) =>
  apiFetch(`/groups/${groupId}/expenses/`).catch(() => []);

export const fetchGroupBalances = (groupId) =>
  apiFetch(`/groups/${groupId}/balances/`).catch(() => []);

export const createExpense = (expenseData) =>
  apiFetch('/expenses/', { method: 'POST', body: JSON.stringify(expenseData) });

export const updateExpense = (expenseId, expenseData) =>
  apiFetch(`/expenses/${expenseId}`, { method: 'PUT', body: JSON.stringify(expenseData) });

export const deleteExpense = (expenseId, requesterId) =>
  apiFetch(`/expenses/${expenseId}?requester_id=${requesterId}`, { method: 'DELETE' });

export const approveExpenseDeletion = (expenseId, userId) =>
  apiFetch(`/expenses/${expenseId}/approve_deletion?user_id=${userId}`, { method: 'POST' });

export const rejectExpenseDeletion = (expenseId, userId) =>
  apiFetch(`/expenses/${expenseId}/reject_deletion?user_id=${userId}`, { method: 'POST' });

export const cancelExpenseDeletion = (expenseId, userId) =>
  apiFetch(`/expenses/${expenseId}/cancel_deletion?user_id=${userId}`, { method: 'POST' });

// ── Chat ──────────────────────────────────────────────────────────────────────

export const fetchExpenseChat = (expenseId) =>
  apiFetch(`/expenses/${expenseId}/chat`).catch(() => []);

export const postExpenseMessage = (expenseId, userId, text, mentions = []) =>
  apiFetch(`/expenses/${expenseId}/chat`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, text, mentions }),
  });

// ── Settlements ───────────────────────────────────────────────────────────────

export const createSettlement = (data) =>
  apiFetch('/settlements/', { method: 'POST', body: JSON.stringify(data) });

export const quickSettle = (data) =>
  apiFetch('/settlements/quick_settle', { method: 'POST', body: JSON.stringify(data) });

export const approveSettlement = (id) =>
  apiFetch(`/settlements/${id}/approve`, { method: 'POST' });

export const rejectSettlement = (id) =>
  apiFetch(`/settlements/${id}/reject`, { method: 'POST' });

export const fetchPendingSettlements = (userId) =>
  apiFetch(`/users/${userId}/pending_settlements`).catch(() => []);

export const fetchAllSettlements = (userId) =>
  apiFetch(`/users/${userId}/all_settlements`).catch(() => []);

export const fetchSettlementBreakdown = (settlementId) =>
  apiFetch(`/settlements/${settlementId}/breakdown`).catch(() => []);

export const fetchInitiatedSettlements = (userId) =>
  apiFetch(`/users/${userId}/initiated_settlements`).catch(() => []);

// ── Invites ───────────────────────────────────────────────────────────────────

export const sendInvite = (email, phone, groupId, invitedById) =>
  apiFetch('/invite/', {
    method: 'POST',
    body: JSON.stringify({ email, phone: phone || null, group_id: groupId, invited_by_id: invitedById }),
  });

// ── Admin (token carries identity — no adminId param needed) ──────────────────

export const fetchAdminUsers = () =>
  apiFetch('/admin/users').catch(() => []);

export const deleteAdminUser = (userId) =>
  apiFetch(`/admin/users/${userId}`, { method: 'DELETE' });

export const deleteAdminGroup = (groupId) =>
  apiFetch(`/admin/groups/${groupId}`, { method: 'DELETE' });

export const toggleAdminStatus = (userId) =>
  apiFetch(`/admin/users/${userId}/toggle_admin`, { method: 'PUT' });

export const adminCreateUser = (name, email, password, isAdminFlag) =>
  apiFetch(`/admin/users?is_admin_flag=${isAdminFlag}`, {
    method: 'POST',
    body: JSON.stringify({ name, email, password }),
  });

export const fetchAdminStats = () =>
  apiFetch('/admin/stats').catch(() => null);

export const fetchAdminGroups = () =>
  apiFetch('/admin/groups').catch(() => []);

export const fetchAdminExpenses = (status = null) =>
  apiFetch(`/admin/expenses${status ? `?status=${status}` : ''}`).catch(() => []);

export const fetchAdminSettlements = () =>
  apiFetch('/admin/settlements').catch(() => []);

export const fetchAdminNotifications = (userId = null) =>
  apiFetch(`/admin/notifications${userId ? `?user_id=${userId}` : ''}`).catch(() => []);

export const adminWipeTransactions = (confirmPhrase) =>
  apiFetch('/admin/wipe_transactions', { method: 'POST', body: JSON.stringify({ confirm: confirmPhrase }) });

// ── Misc ──────────────────────────────────────────────────────────────────────

export const searchUsers = (q, excludeGroupId = null) =>
  apiFetch(`/users/search?q=${encodeURIComponent(q)}${excludeGroupId ? `&exclude_group_id=${excludeGroupId}` : ''}`).catch(() => []);

// ── Subscriptions & Plans ─────────────────────────────────────────────────────

export const fetchSubscription   = () => apiFetch('/subscription').catch(() => null)
export const fetchPlans          = () => apiFetch('/plans').catch(() => ({}))

// ── Group Budget ──────────────────────────────────────────────────────────────

export const fetchGroupBudget    = (groupId) => apiFetch(`/groups/${groupId}/budget`).catch(() => null)
export const setGroupBudget      = (groupId, data) => apiFetch(`/groups/${groupId}/budget`, { method: 'POST', body: JSON.stringify(data) })
export const deleteGroupBudget   = (groupId) => apiFetch(`/groups/${groupId}/budget`, { method: 'DELETE' })

// ── Admin: Subscriptions ──────────────────────────────────────────────────────

export const adminGetSubscriptions   = () => apiFetch('/admin/subscriptions').catch(() => [])
export const adminSetUserPlan        = (userId, plan) => apiFetch(`/admin/users/${userId}/plan`, { method: 'PUT', body: JSON.stringify({ plan }) })
export const adminGetFeatureFlags    = () => apiFetch('/admin/feature-flags').catch(() => ({}))
export const adminUpdateFeatureFlag  = (plan, featureKey, enabled, limitValue = null) =>
  apiFetch(`/admin/feature-flags/${plan}/${featureKey}`, { method: 'PUT', body: JSON.stringify({ enabled, limit_value: limitValue }) })

// ── Corporate: Admin ──────────────────────────────────────────────────────────

export const adminListOrgs        = () => apiFetch('/admin/organisations').catch(() => [])
export const adminCreateOrg       = (name, domain) => apiFetch('/admin/organisations', { method: 'POST', body: JSON.stringify({ name, domain }) })
export const adminDeleteOrg       = (orgId) => apiFetch(`/admin/organisations/${orgId}`, { method: 'DELETE' })
export const adminCreateDept      = (orgId, name) => apiFetch(`/admin/organisations/${orgId}/departments`, { method: 'POST', body: JSON.stringify({ name }) })
export const adminDeleteDept      = (orgId, deptId) => apiFetch(`/admin/organisations/${orgId}/departments/${deptId}`, { method: 'DELETE' })
export const adminAssignCorporate = (userId, data) => apiFetch(`/admin/users/${userId}/corporate`, { method: 'PUT', body: JSON.stringify(data) })

// ── Corporate: Org Admin ──────────────────────────────────────────────────────

export const orgListMembers    = () => apiFetch('/my/org/members').catch(() => [])
export const orgStats          = () => apiFetch('/my/org/stats').catch(() => null)
export const orgAllReports     = () => apiFetch('/my/org/all-reports').catch(() => [])
export const orgAddMember      = (data) => apiFetch('/my/org/members/add', { method: 'POST', body: JSON.stringify(data) })
export const orgCreateMember   = (data) => apiFetch('/my/org/members/create', { method: 'POST', body: JSON.stringify(data) })
export const orgUpdateMember   = (userId, data) => apiFetch(`/my/org/members/${userId}`, { method: 'PUT', body: JSON.stringify(data) })
export const orgRemoveMember   = (userId) => apiFetch(`/my/org/members/${userId}`, { method: 'DELETE' })
export const orgCreateDept     = (name) => apiFetch('/my/org/departments', { method: 'POST', body: JSON.stringify({ name }) })
export const orgDeleteDept     = (deptId) => apiFetch(`/my/org/departments/${deptId}`, { method: 'DELETE' })
export const orgApproveReport  = (reportId, notes) => apiFetch(`/my/org/reports/${reportId}/approve`, { method: 'POST', body: JSON.stringify({ notes: notes || null }) })
export const orgRejectReport   = (reportId, notes) => apiFetch(`/my/org/reports/${reportId}/reject`, { method: 'POST', body: JSON.stringify({ notes: notes || null }) })
export const orgReimburseReport = (reportId) => apiFetch(`/my/org/reports/${reportId}/reimburse`, { method: 'POST', body: JSON.stringify({}) })

// ── Corporate: My Org ─────────────────────────────────────────────────────────

export const fetchMyOrg       = () => apiFetch('/my/org').catch(() => null)
export const fetchMyReports   = () => apiFetch('/my/reports').catch(() => [])
export const createReport     = (data) => apiFetch('/my/reports', { method: 'POST', body: JSON.stringify(data) })
export const getReport        = (id) => apiFetch(`/my/reports/${id}`)
export const updateReport     = (id, data) => apiFetch(`/my/reports/${id}`, { method: 'PUT', body: JSON.stringify(data) })
export const deleteReport     = (id) => apiFetch(`/my/reports/${id}`, { method: 'DELETE' })
export const submitReport     = (id) => apiFetch(`/my/reports/${id}/submit`, { method: 'POST' })
export const addExpenseToReport      = (reportId, expenseId) => apiFetch(`/my/reports/${reportId}/expenses/${expenseId}`, { method: 'POST' })
export const removeExpenseFromReport = (reportId, expenseId) => apiFetch(`/my/reports/${reportId}/expenses/${expenseId}`, { method: 'DELETE' })
export const addReportItem    = (reportId, data) => apiFetch(`/my/reports/${reportId}/items`, { method: 'POST', body: JSON.stringify(data) })
export const deleteReportItem = (reportId, expenseId) => apiFetch(`/my/reports/${reportId}/items/${expenseId}`, { method: 'DELETE' })

// ── Corporate: Approvals ──────────────────────────────────────────────────────

export const fetchMyApprovals  = () => apiFetch('/my/approvals').catch(() => [])
export const approveReport     = (id, notes) => apiFetch(`/my/approvals/${id}/approve`, { method: 'POST', body: JSON.stringify({ notes }) })
export const rejectReport      = (id, notes) => apiFetch(`/my/approvals/${id}/reject`,  { method: 'POST', body: JSON.stringify({ notes }) })
export const reimburseReport   = (id) => apiFetch(`/my/approvals/${id}/reimburse`, { method: 'POST' })

export const fetchHealth = () => {
  const k    = _pool ? _pool.pick() : -1
  const base = _pool ? _pool.url(k) : API_URL
  return fetch(`${base}/health`)
    .then(r => { if (_pool && r.ok) _pool.success(k); return r.ok ? r.json() : Promise.reject() })
    .catch(() => { if (_pool && k >= 0) _pool.failure(k) })
}

// WebSocket URL — round-robin picks the same backend the HTTP requests use
export const getWsUrl = (userId) => {
  const token = getToken()
  const qs = token ? `?token=${token}` : ''
  if (isLocal) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/ws/${userId}${qs}`
  }
  // Pick from the pool so WebSocket lands on the same backend distribution
  const k    = _pool ? _pool.pick() : -1
  const base = _pool ? _pool.url(k) : PROD_BACKENDS[0]
  return `${base.replace(/^https/, 'wss').replace(/^http/, 'ws')}/ws/${userId}${qs}`
}
