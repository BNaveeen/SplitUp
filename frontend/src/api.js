// Capacitor native apps run with hostname=localhost but have no dev proxy — always use prod
const isNative = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
const isLocal = !isNative && (
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.startsWith('192.') ||
  window.location.hostname.startsWith('172.')
)
const API_URL = isLocal ? '/api' : 'https://splitup-qttj.onrender.com';

// ── Token storage ─────────────────────────────────────────────────────────────

export const getToken = () => localStorage.getItem('splitclone_token')
export const setToken = (t) => localStorage.setItem('splitclone_token', t)
export const clearToken = () => localStorage.removeItem('splitclone_token')

// ── Base fetch helpers ────────────────────────────────────────────────────────

async function apiFetch(path, options = {}) {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_URL}${path}`, { ...options, headers })

  if (res.status === 401) {
    clearToken()
    localStorage.removeItem('splitclone_user')
    window.dispatchEvent(new CustomEvent('auth_expired'))
    throw new Error('Session expired. Please log in again.')
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.detail || `Request failed: ${res.status}`)
  }
  return res.json()
}

// No-auth fetch for public endpoints (login / register)
async function publicFetch(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
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

// ── Users ─────────────────────────────────────────────────────────────────────

export const fetchUsers = () =>
  apiFetch('/users/').catch(() => []);

export const fetchUserGroups = (userId) =>
  apiFetch(`/users/${userId}/groups/`).catch(() => []);

export const fetchUserExpenses = (userId) =>
  apiFetch(`/users/${userId}/expenses/`).catch(() => []);

export const fetchAllUserBalances = (userId) =>
  apiFetch(`/users/${userId}/all_balances`).catch(() => []);

export const updateUser = (userId, name) =>
  apiFetch(`/users/${userId}`, { method: 'PUT', body: JSON.stringify({ name }) });

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

export const approveSettlement = (id) =>
  apiFetch(`/settlements/${id}/approve`, { method: 'POST' });

export const rejectSettlement = (id) =>
  apiFetch(`/settlements/${id}/reject`, { method: 'POST' });

export const fetchPendingSettlements = (userId) =>
  apiFetch(`/users/${userId}/pending_settlements`).catch(() => []);

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

// ── Misc ──────────────────────────────────────────────────────────────────────

export const searchUsers = (q, excludeGroupId = null) =>
  apiFetch(`/users/search?q=${encodeURIComponent(q)}${excludeGroupId ? `&exclude_group_id=${excludeGroupId}` : ''}`).catch(() => []);

export const fetchHealth = () =>
  fetch(`${API_URL}/health`).then(r => r.ok ? r.json() : Promise.reject());

// WebSocket URL — routed through Vite proxy locally so port 8001 never needs direct access
export const getWsUrl = (userId) => {
  const token = getToken()
  const qs = token ? `?token=${token}` : ''
  if (isLocal) {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/ws/${userId}${qs}`
  }
  return `wss://splitup-qttj.onrender.com/ws/${userId}${qs}`
};

