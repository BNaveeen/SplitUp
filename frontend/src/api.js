const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname.startsWith('192.') || window.location.hostname.startsWith('172.');
const API_URL = isLocal ? '/api' : 'https://splitup-qttj.onrender.com';

async function handleResponse(res) {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const fetchUsers = (userId = null) =>
  fetch(`${API_URL}/users/${userId ? `?current_user_id=${userId}` : ''}`).then(handleResponse).catch(() => []);

export const fetchUserGroups = (userId) =>
  fetch(`${API_URL}/users/${userId}/groups/`).then(handleResponse).catch(() => []);

export const fetchUserExpenses = (userId) =>
  fetch(`${API_URL}/users/${userId}/expenses/`).then(handleResponse).catch(() => []);

export const fetchGroupExpenses = (groupId, requesterId = null) =>
  fetch(`${API_URL}/groups/${groupId}/expenses/${requesterId ? `?requester_id=${requesterId}` : ''}`).then(handleResponse);

export const fetchGroupBalances = (groupId) =>
  fetch(`${API_URL}/groups/${groupId}/balances/`).then(handleResponse).catch(() => []);

export const fetchAllUserBalances = (userId) =>
  fetch(`${API_URL}/users/${userId}/all_balances`).then(handleResponse).catch(() => []);

export const createSettlement = (data) =>
  fetch(`${API_URL}/settlements/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }).then(handleResponse);

export const approveSettlement = (id) =>
  fetch(`${API_URL}/settlements/${id}/approve`, { method: 'POST' }).then(handleResponse);

export const rejectSettlement = (id) =>
  fetch(`${API_URL}/settlements/${id}/reject`, { method: 'POST' }).then(handleResponse);

export const fetchPendingSettlements = (userId) =>
  fetch(`${API_URL}/users/${userId}/pending_settlements`).then(handleResponse).catch(() => []);

export const fetchInitiatedSettlements = (userId) =>
  fetch(`${API_URL}/users/${userId}/initiated_settlements`).then(handleResponse).catch(() => []);

export const registerUser = (name, email, password) =>
  fetch(`${API_URL}/register/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  }).then(handleResponse);

export const loginUser = (email, password) =>
  fetch(`${API_URL}/login/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }).then(handleResponse);

export const createGroup = (name, creator_id) =>
  fetch(`${API_URL}/groups/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, creator_id }),
  }).then(handleResponse);

export const addGroupMember = (groupId, email) =>
  fetch(`${API_URL}/groups/${groupId}/members/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  }).then(handleResponse);

export const createExpense = (expenseData) =>
  fetch(`${API_URL}/expenses/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expenseData),
  }).then(handleResponse);

export const sendInvite = (email, phone, groupId, invitedById) =>
  fetch(`${API_URL}/invite/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, phone: phone || null, group_id: groupId, invited_by_id: invitedById }),
  }).then(handleResponse);

export const updateUser = (userId, name) =>
  fetch(`${API_URL}/users/${userId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  }).then(handleResponse);

export const updateExpense = (expenseId, expenseData) =>
  fetch(`${API_URL}/expenses/${expenseId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(expenseData),
  }).then(handleResponse);

export const deleteExpense = (expenseId, requesterId) =>
  fetch(`${API_URL}/expenses/${expenseId}?requester_id=${requesterId}`, {
    method: 'DELETE',
  }).then(handleResponse);

export const approveExpenseDeletion = (expenseId, userId) =>
  fetch(`${API_URL}/expenses/${expenseId}/approve_deletion?user_id=${userId}`, {
    method: 'POST',
  }).then(handleResponse);

export const rejectExpenseDeletion = (expenseId, userId) =>
  fetch(`${API_URL}/expenses/${expenseId}/reject_deletion?user_id=${userId}`, {
    method: 'POST',
  }).then(handleResponse);

export const fetchExpenseChat = (expenseId) =>
  fetch(`${API_URL}/expenses/${expenseId}/chat`).then(handleResponse).catch(() => []);

export const postExpenseMessage = (expenseId, userId, text, mentions = []) =>
  fetch(`${API_URL}/expenses/${expenseId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, text, mentions }),
  }).then(handleResponse);

export const cancelExpenseDeletion = (expenseId, userId) =>
  fetch(`${API_URL}/expenses/${expenseId}/cancel_deletion?user_id=${userId}`, {
    method: 'POST',
  }).then(handleResponse);

export const fetchNotifications = (userId) =>
  fetch(`${API_URL}/users/${userId}/notifications`).then(handleResponse).catch(() => []);

export const markNotificationRead = (notifId) =>
  fetch(`${API_URL}/notifications/${notifId}/mark_read`, {
    method: 'POST',
  }).then(handleResponse);

// Admin API
export const fetchAdminUsers = (adminId) =>
  fetch(`${API_URL}/admin/users?admin_id=${adminId}`).then(handleResponse).catch(() => []);

export const deleteAdminUser = (userId, adminId) =>
  fetch(`${API_URL}/admin/users/${userId}?admin_id=${adminId}`, { method: 'DELETE' }).then(handleResponse);

export const deleteAdminGroup = (groupId, adminId) =>
  fetch(`${API_URL}/admin/groups/${groupId}?admin_id=${adminId}`, { method: 'DELETE' }).then(handleResponse);

export const toggleAdminStatus = (userId, adminId) =>
  fetch(`${API_URL}/admin/users/${userId}/toggle_admin?admin_id=${adminId}`, { method: 'PUT' }).then(handleResponse);

export const adminCreateUser = (adminId, name, email, password, isAdminFlag) =>
  fetch(`${API_URL}/admin/users?admin_id=${adminId}&is_admin_flag=${isAdminFlag}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  }).then(handleResponse);

// Admin extended endpoints
export const fetchAdminStats = (adminId) =>
  fetch(`${API_URL}/admin/stats?admin_id=${adminId}`).then(handleResponse).catch(() => null);

export const fetchAdminGroups = (adminId) =>
  fetch(`${API_URL}/admin/groups?admin_id=${adminId}`).then(handleResponse).catch(() => []);

export const fetchAdminExpenses = (adminId, status = null) =>
  fetch(`${API_URL}/admin/expenses?admin_id=${adminId}${status ? `&status=${status}` : ''}`).then(handleResponse).catch(() => []);

export const fetchAdminSettlements = (adminId) =>
  fetch(`${API_URL}/admin/settlements?admin_id=${adminId}`).then(handleResponse).catch(() => []);

export const fetchAdminNotifications = (adminId, userId = null) =>
  fetch(`${API_URL}/admin/notifications?admin_id=${adminId}${userId ? `&user_id=${userId}` : ''}`).then(handleResponse).catch(() => []);

// Group membership management
export const searchUsers = (q, excludeGroupId = null) =>
  fetch(`${API_URL}/users/search?q=${encodeURIComponent(q)}${excludeGroupId ? `&exclude_group_id=${excludeGroupId}` : ''}`).then(handleResponse).catch(() => []);

export const fetchGroupMemberships = (groupId) =>
  fetch(`${API_URL}/groups/${groupId}/memberships`).then(handleResponse).catch(() => []);

export const addGroupMemberById = (groupId, userId, adminUserId) =>
  fetch(`${API_URL}/groups/${groupId}/members/by_id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: userId, admin_user_id: adminUserId }),
  }).then(handleResponse);

export const setGroupMemberRole = (groupId, userId, role, adminUserId) =>
  fetch(`${API_URL}/groups/${groupId}/members/${userId}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, admin_user_id: adminUserId }),
  }).then(handleResponse);

export const removeGroupMember = (groupId, userId, adminUserId) =>
  fetch(`${API_URL}/groups/${groupId}/members/${userId}?admin_user_id=${adminUserId}`, {
    method: 'DELETE',
  }).then(handleResponse);

export const toggleGroupMemberActive = (groupId, userId, adminUserId) =>
  fetch(`${API_URL}/groups/${groupId}/members/${userId}/deactivate?admin_user_id=${adminUserId}`, {
    method: 'PUT',
  }).then(handleResponse);

export const renameGroup = (groupId, name, requesterId) =>
  fetch(`${API_URL}/groups/${groupId}/name`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, requester_id: requesterId }),
  }).then(handleResponse);

export const fetchHealth = () =>
  fetch(`${API_URL}/health`).then(r => r.ok ? r.json() : Promise.reject());

// WebSocket URL helper
export const getWsUrl = (userId) => {
  const wsProtocol = isLocal ? 'ws' : 'wss';
  const wsHost = isLocal ? `${window.location.hostname}:8001` : 'splitup-qttj.onrender.com';
  return `${wsProtocol}://${wsHost}/ws/${userId}`;
};
