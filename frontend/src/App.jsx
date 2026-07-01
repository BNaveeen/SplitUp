import { useState, useEffect, useCallback, useRef } from 'react'
// CACHE BUST FOR VITE FAST REFRESH
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet, Users, LayoutGrid, LogOut, Loader2, CheckCircle, CheckCircle2,
  Plus, ArrowLeft, UserPlus, ChevronRight, Receipt, TrendingDown,
  TrendingUp, X, Calendar, Home, Activity, Send, Mail, Phone, Search,
  Edit2, Trash2, Settings, MessageSquare, Bell, Crown, Shield, UserMinus, UserX,
  KeyRound, ShieldCheck, BarChart2, Download, Tag, Zap, CreditCard
} from 'lucide-react'
import {
  fetchUsers, fetchUserGroups, fetchGroupExpenses, fetchGroupBalances,
  registerUser, loginUser, createGroup, addGroupMember, createExpense, sendInvite,
  updateUser, updateExpense, deleteExpense, approveExpenseDeletion, rejectExpenseDeletion,
  fetchExpenseChat, postExpenseMessage, fetchNotifications, markNotificationRead, cancelExpenseDeletion,
  fetchAdminUsers, deleteAdminUser, deleteAdminGroup, getWsUrl, toggleAdminStatus, adminCreateUser,
  fetchAllUserBalances, createSettlement, quickSettle, approveSettlement, rejectSettlement, fetchPendingSettlements,
  fetchInitiatedSettlements, fetchAllSettlements, fetchSettlementBreakdown,
  fetchAdminStats, fetchAdminGroups, fetchAdminExpenses, fetchAdminSettlements, fetchAdminNotifications, adminWipeTransactions,
  searchUsers, fetchGroupMemberships, addGroupMemberById, setGroupMemberRole, removeGroupMember, toggleGroupMemberActive,
  renameGroup, fetchHealth, setToken, clearToken, getToken,
  verifyEmail, resendVerification, forgotPassword, resetPassword, changePassword
} from './api'

// ── Utilities ────────────────────────────────────────────────────────────────
import {
  MONTH_SHORT, EXPENSE_CATEGORIES, categoryIcons, categoryMeta,
  formatDate, formatTimestamp, chatDateLabel, todayISO, guessCategory, buildCSVRows,
} from './utils'

// ── CSV Export ────────────────────────────────────────────────────────────────
function exportGroupToCSV(expenses, groupName, members = []) {
  const rows = buildCSVRows(expenses, members)
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url
  a.download = `${groupName.replace(/\s+/g, '_')}_expenses_${new Date().toISOString().split('T')[0]}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── Colour helpers ────────────────────────────────────────────────────────────
const avatarColors = [
  'from-indigo-500 to-purple-600',
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-sky-500 to-cyan-600',
]
function avatarColor(id) { return avatarColors[(id - 1) % avatarColors.length] }

// ── Error Boundary ───────────────────────────────────────────────────────────
import React from 'react'
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 32, color: '#f87171', background: '#0f172a', minHeight: '100vh' }}>
          <h2 style={{ marginBottom: 12 }}>Something went wrong</h2>
          <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error?.message || 'Unknown error'}
          </pre>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            style={{ marginTop: 16, padding: '8px 20px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// ── Notification Sound ────────────────────────────────────────────────────────
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const gain = ctx.createGain()
    gain.connect(ctx.destination)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5)

    [[880, 0], [1108, 0.12], [1320, 0.24]].forEach(([freq, when]) => {
      const osc = ctx.createOscillator()
      osc.type = 'sine'
      osc.frequency.value = freq
      osc.connect(gain)
      osc.start(ctx.currentTime + when)
      osc.stop(ctx.currentTime + when + 0.25)
    })
  } catch (_) {}
}

// ── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  // Initialize immediately from localStorage so refresh never flashes the login page
  const [user, setUser] = useState(() => {
    try {
      // Only rehydrate if we also have a valid token
      const saved = localStorage.getItem('splitclone_user')
      const token = localStorage.getItem('splitclone_token')
      return (saved && token) ? JSON.parse(saved) : null
    } catch { return null }
  })

  useEffect(() => {
    if (!user) return
    // Background refresh to pick up is_admin changes — drop session if token is invalid (401 fires auth_expired)
    fetchUsers()
      .then(users => {
        const freshUser = Array.isArray(users) && users.find(u => u.id === user.id)
        if (freshUser) {
          localStorage.setItem('splitclone_user', JSON.stringify(freshUser))
          setUser(freshUser)
        }
      })
      .catch(() => {})
  }, [])

  const handleLogin  = ({ access_token, user: u }) => {
    setToken(access_token)
    setUser(u)
    localStorage.setItem('splitclone_user', JSON.stringify(u))
  }
  const handleLogout = () => {
    clearToken()
    setUser(null)
    localStorage.removeItem('splitclone_user')
  }

  // Force logout when any API call receives a 401
  useEffect(() => {
    const onExpired = () => handleLogout()
    window.addEventListener('auth_expired', onExpired)
    return () => window.removeEventListener('auth_expired', onExpired)
  }, [])

  const [authView, setAuthView] = useState('login') // 'login' | 'verify' | 'forgot' | 'reset'
  const [pendingEmail, setPendingEmail] = useState('')

  if (!user) return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <AnimatePresence mode="wait">
        {authView === 'login' && (
          <LoginScreen key="login" onLogin={handleLogin}
            onForgotPassword={() => setAuthView('forgot')}
            onVerifyEmail={email => { setPendingEmail(email); setAuthView('verify') }} />
        )}
        {authView === 'verify' && (
          <VerifyEmailView key="verify" email={pendingEmail}
            onVerified={resp => { handleLogin(resp); setAuthView('login') }}
            onBack={() => setAuthView('login')} />
        )}
        {authView === 'forgot' && (
          <ForgotPasswordView key="forgot"
            onOtpSent={email => { setPendingEmail(email); setAuthView('reset') }}
            onBack={() => setAuthView('login')} />
        )}
        {authView === 'reset' && (
          <ResetPasswordView key="reset" email={pendingEmail}
            onReset={() => setAuthView('login')}
            onBack={() => setAuthView('login')} />
        )}
      </AnimatePresence>
    </div>
  )

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-slate-100 font-sans overflow-hidden relative">
      {/* gradient blobs — hidden on mobile to avoid GPU strain */}
      <div className="hidden sm:block fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-700/15 blur-[80px] pointer-events-none" />
      <div className="hidden sm:block fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-700/15 blur-[80px] pointer-events-none" />
      <AnimatePresence mode="wait">
        <Dashboard key="dash" user={user} onLogout={handleLogout} />
      </AnimatePresence>
    </div>
  )
}

// ── Login / Register ──────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onForgotPassword, onVerifyEmail }) {
  const [isLogin, setIsLogin] = useState(true)
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const normalizedEmail = email.trim().toLowerCase()
      // Server now returns { access_token, user } for both login and register
      const resp = isLogin
        ? await loginUser(normalizedEmail, password)
        : await registerUser(name.trim(), normalizedEmail, password)
      if (resp.message === 'verification_required') {
        onVerifyEmail(resp.email)
      } else {
        onLogin(resp)
      }
    } catch (err) {
      const msg = err.message || ''
      setError(
        msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror')
          ? 'Cannot reach the server. It may be waking up — please wait 30 seconds and try again.'
          : msg
      )
    }
    finally { setLoading(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md bg-slate-800/60 backdrop-blur-2xl border border-slate-700/40 rounded-3xl shadow-2xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="h-16 w-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Wallet className="h-8 w-8 text-white" />
            </div>
          </div>
          <h2 className="text-3xl font-bold text-center bg-gradient-to-r from-indigo-400 to-purple-400 bg-clip-text text-transparent mb-1">SplitWise</h2>
          <p className="text-slate-400 text-center text-sm mb-8">Split expenses. Stay friends.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <AnimatePresence>
              {!isLogin && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <input type="text" required={!isLogin} value={name} onChange={e => setName(e.target.value)}
                    className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-500"
                    placeholder="Your name" />
                </motion.div>
              )}
            </AnimatePresence>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-500"
              placeholder="Email" />
            <input type="password" required value={password} onChange={e => setPass(e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-500"
              placeholder="Password" />

            {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</motion.p>}

            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-indigo-500/25 flex justify-center items-center h-12">
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : (isLogin ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          {isLogin && (
            <p className="mt-3 text-center">
              <button onClick={() => onForgotPassword()} className="text-sm text-slate-400 hover:text-indigo-400 transition-colors">
                Forgot password?
              </button>
            </p>
          )}

          <p className="mt-4 text-center text-sm text-slate-400">
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setIsLogin(!isLogin); setError('') }} className="text-indigo-400 hover:text-indigo-300 font-medium">
              {isLogin ? 'Register' : 'Sign In'}
            </button>
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ── Email Verification ────────────────────────────────────────────────────────
function VerifyEmailView({ email, onVerified, onBack }) {
  const [otp, setOtp] = useState('')
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleVerify = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const resp = await verifyEmail(email, otp.trim())
      onVerified(resp)
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  const handleResend = async () => {
    setResending(true); setError(''); setSuccess('')
    try {
      await resendVerification(email)
      setSuccess('OTP resent — check your inbox')
    } catch (err) { setError(err.message) }
    finally { setResending(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md bg-slate-800/60 backdrop-blur-2xl border border-slate-700/40 rounded-3xl shadow-2xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="h-16 w-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Mail className="h-8 w-8 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-slate-100 mb-1">Verify your email</h2>
          <p className="text-slate-400 text-center text-sm mb-6">We sent a 6-digit code to<br /><span className="text-indigo-400 font-medium">{email}</span></p>
          <form onSubmit={handleVerify} className="space-y-4">
            <input type="text" inputMode="numeric" maxLength={6} required value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,''))}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-600"
              placeholder="······" />
            {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</motion.p>}
            {success && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-green-400 text-sm text-center bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">{success}</motion.p>}
            <button type="submit" disabled={loading || otp.length < 6}
              className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-all flex justify-center items-center h-12">
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Verify Email'}
            </button>
          </form>
          <div className="mt-4 flex flex-col items-center gap-2">
            <button onClick={handleResend} disabled={resending} className="text-sm text-slate-400 hover:text-indigo-400 transition-colors">
              {resending ? 'Sending…' : "Didn't get it? Resend code"}
            </button>
            <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-300 transition-colors">← Back to sign in</button>
          </div>
        </div>
      </div>
    </motion.div>
  )
}

// ── Forgot Password ───────────────────────────────────────────────────────────
function ForgotPasswordView({ onOtpSent, onBack }) {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await forgotPassword(email.trim().toLowerCase())
      onOtpSent(email.trim().toLowerCase())
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md bg-slate-800/60 backdrop-blur-2xl border border-slate-700/40 rounded-3xl shadow-2xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="h-16 w-16 bg-gradient-to-br from-amber-500 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg shadow-amber-500/30">
              <KeyRound className="h-8 w-8 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-slate-100 mb-1">Forgot password?</h2>
          <p className="text-slate-400 text-center text-sm mb-6">Enter your email and we'll send a reset code</p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 text-slate-100 placeholder-slate-500"
              placeholder="your@email.com" />
            {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</motion.p>}
            <button type="submit" disabled={loading}
              className="w-full bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white font-semibold py-3 rounded-xl transition-all flex justify-center items-center h-12">
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Send Reset Code'}
            </button>
          </form>
          <p className="mt-4 text-center">
            <button onClick={onBack} className="text-sm text-slate-400 hover:text-indigo-400 transition-colors">← Back to sign in</button>
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ── Reset Password ────────────────────────────────────────────────────────────
function ResetPasswordView({ email, onReset, onBack }) {
  const [otp, setOtp] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError('')
    try {
      await resetPassword(email, otp.trim(), password)
      onReset()
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
      className="min-h-screen flex items-center justify-center p-4 relative z-10">
      <div className="w-full max-w-md bg-slate-800/60 backdrop-blur-2xl border border-slate-700/40 rounded-3xl shadow-2xl overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500" />
        <div className="p-8">
          <div className="flex justify-center mb-6">
            <div className="h-16 w-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg shadow-green-500/30">
              <ShieldCheck className="h-8 w-8 text-white" />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-center text-slate-100 mb-1">Reset password</h2>
          <p className="text-slate-400 text-center text-sm mb-6">Enter the code sent to <span className="text-indigo-400 font-medium">{email}</span></p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input type="text" inputMode="numeric" maxLength={6} required value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g,''))}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 text-center text-2xl tracking-[0.5em] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-600"
              placeholder="······" />
            <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-500"
              placeholder="New password" />
            <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-500"
              placeholder="Confirm new password" />
            {error && <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</motion.p>}
            <button type="submit" disabled={loading || otp.length < 6}
              className="w-full bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-all flex justify-center items-center h-12">
              {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Set New Password'}
            </button>
          </form>
          <p className="mt-4 text-center">
            <button onClick={onBack} className="text-sm text-slate-400 hover:text-indigo-400 transition-colors">← Back to sign in</button>
          </p>
        </div>
      </div>
    </motion.div>
  )
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard({ user, onLogout }) {
  const [activeTab, setActiveTab]   = useState('groups')
  const [groups, setGroups]         = useState([])
  const [users, setUsers]           = useState([])
  const [selectedGroup, setGroup]   = useState(null)  // GroupDetailView
  const [focusExpenseId, setFocusExpenseId] = useState(null)
  const [showAddExpense, setAddExp] = useState(false)
  const [loading, setLoading]       = useState(true)
  const [showProfile, setShowProfile] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [showNotifs, setShowNotifs] = useState(false)
  const [toastNotif, setToastNotif] = useState(null)
  const [showAdmin, setShowAdmin] = useState(false)
  const [globalBalances, setGlobalBalances] = useState([])
  const [pendingSettlements, setPendingSettlements] = useState([])
  const [initiatedSettlements, setInitiatedSettlements] = useState([])
  const [allSettlements, setAllSettlements] = useState([])
  const [showPendingSettlements, setShowPendingSettlements] = useState(false)
  const [slowLoad, setSlowLoad] = useState(false)
  const wsRef = useRef(null)

  // WebSocket: real-time push for notifications and new chat messages
  useEffect(() => {
    let stopped = false
    let retryTimer = null

    const connect = () => {
      if (stopped || !getToken()) return
      let ws;
      try {
        ws = new WebSocket(getWsUrl(user.id))
      } catch (err) {
        console.error("WebSocket connection failed (likely GitHub Pages mixed content):", err)
        return
      }
      wsRef.current = ws
      ws.onmessage = (evt) => {
        try {
          const data = JSON.parse(evt.data)
          if (data.type === 'notification') {
            setNotifications(prev => [data, ...prev])
            setToastNotif(data)
            setTimeout(() => setToastNotif(null), 5000)
            playNotificationSound()
          } else if (data.type === 'new_message') {
            window.dispatchEvent(new CustomEvent('ws_new_message', { detail: data }))
          } else if (data.type === 'group_refresh') {
            // Silently refresh global balances and settlements
            Promise.all([
              fetchAllUserBalances(user.id),
              fetchPendingSettlements(user.id),
              fetchInitiatedSettlements(user.id),
              fetchAllSettlements(user.id),
            ]).then(([b, ps, is, as_]) => {
              setGlobalBalances(b)
              setPendingSettlements(ps)
              setInitiatedSettlements(is)
              setAllSettlements(as_)
            }).catch(() => {})
            window.dispatchEvent(new CustomEvent('ws_group_refresh', { detail: { group_id: data.group_id } }))
          }
        } catch (_) {}
      }
      ws.onclose = () => {
        if (stopped || !getToken()) return
        retryTimer = setTimeout(connect, 3000)
      }
    }

    const onAuthExpired = () => { stopped = true; clearTimeout(retryTimer) }
    window.addEventListener('auth_expired', onAuthExpired)
    connect()
    return () => {
      stopped = true
      clearTimeout(retryTimer)
      window.removeEventListener('auth_expired', onAuthExpired)
      wsRef.current?.close()
    }
  }, [user.id])

  const loadData = useCallback(async () => {
    setLoading(true)
    // Show "waking up" message if server takes >5s (Render cold start)
    const slowTimer = setTimeout(() => setSlowLoad(true), 5000)
    try {
      const [g, u, n, b, ps, is, as_] = await Promise.all([
        fetchUserGroups(user.id),
        fetchUsers(),
        fetchNotifications(user.id),
        fetchAllUserBalances(user.id),
        fetchPendingSettlements(user.id),
        fetchInitiatedSettlements(user.id),
        fetchAllSettlements(user.id),
      ])
      setGroups(g)
      setUsers(u)
      setNotifications(n)
      setGlobalBalances(b)
      setPendingSettlements(ps)
      setInitiatedSettlements(is)
      setAllSettlements(as_)
    } finally {
      clearTimeout(slowTimer)
      setSlowLoad(false)
      setLoading(false)
    }
  }, [user.id])

  useEffect(() => {
    loadData()
    const interval = setInterval(() => {
      fetchNotifications(user.id).then(setNotifications)
    }, 15000)
    return () => clearInterval(interval)
  }, [loadData, user.id])

  // Auto-logout after 10 minutes of inactivity (mouse/key/touch resets timer)
  useEffect(() => {
    const INACTIVITY_MS = 10 * 60 * 1000
    let timer
    const reset = () => { clearTimeout(timer); timer = setTimeout(onLogout, INACTIVITY_MS) }
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach(e => document.addEventListener(e, reset, { passive: true }))
    reset()
    return () => { clearTimeout(timer); events.forEach(e => document.removeEventListener(e, reset)) }
  }, [onLogout])

  const handleMarkRead = async (notifId, notif) => {
    setShowNotifs(false)
    try {
      await markNotificationRead(notifId)
      setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, is_read: 1 } : n))
      if (notif?.group_id) {
        const matchedGroup = groups.find(g => g.id === notif.group_id)
        if (matchedGroup) {
          setGroup(matchedGroup)
          if (notif.expense_id) setFocusExpenseId(notif.expense_id)
        }
      } else if (notif?.message) {
        const msg = notif.message.toLowerCase()
        const matchedGroup = groups.find(g => msg.includes(g.name.toLowerCase()))
        if (matchedGroup) { setGroup(matchedGroup); setFocusExpenseId(null) }
      }
    } catch(err) { console.error(err) }
  }

  // Reopen group after add-expense to refresh
  const handleExpenseAdded = async () => {
    setAddExp(false)
    await loadData()
    if (selectedGroup) {
      setGroup(g => groups.find(gr => gr.id === g?.id) || g)
    }
  }

  const totalOwed = 0

  const tabs = [
    { id: 'groups',   label: 'Groups',   icon: Home },
    { id: 'activity', label: 'Activity', icon: Activity },
    { id: 'people',   label: 'People',   icon: Users },
  ]

  if (showAdmin) {
    return <AdminDashboard currentUser={user} onBack={() => setShowAdmin(false)} onWipe={loadData} />
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col z-10 relative">

      {/* Top nav — always visible */}
      <nav className="bg-slate-900/70 backdrop-blur-xl border-b border-slate-700/40 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {selectedGroup ? (
              <button onClick={() => { setGroup(null); setFocusExpenseId(null); }} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                <ArrowLeft className="h-5 w-5" />
              </button>
            ) : (
              <div className="h-8 w-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
                <Wallet className="h-4 w-4 text-white" />
              </div>
            )}
            <span className="font-bold text-white text-lg">{selectedGroup ? selectedGroup.name : 'SplitWise'}</span>
          </div>
          <div className="flex items-center gap-2">
            {pendingSettlements.length > 0 && (
              <button onClick={() => setShowPendingSettlements(true)} className="flex items-center gap-1.5 px-2 py-1 text-xs font-bold text-emerald-400 bg-emerald-500/10 hover:bg-emerald-500/20 rounded-lg transition-colors border border-emerald-500/20">
                <CheckCircle className="h-3.5 w-3.5" />
                {pendingSettlements.length} Pending
              </button>
            )}
            <div className="relative">
              <button onClick={() => setShowNotifs(!showNotifs)} className="relative p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                <Bell className="h-4 w-4" />
                {notifications.filter(n => !n.is_read).length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 flex items-center justify-center rounded-full bg-rose-500 ring-2 ring-slate-900 text-[9px] font-bold text-white leading-none">
                    {notifications.filter(n => !n.is_read).length > 9 ? '9+' : notifications.filter(n => !n.is_read).length}
                  </span>
                )}
              </button>
              {showNotifs && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowNotifs(false)} />
                  <motion.div initial={{ opacity: 0, y: -6, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.97 }}
                    className="absolute top-12 right-0 w-80 bg-slate-900 border border-slate-700/60 rounded-2xl shadow-2xl overflow-hidden z-50">
                    {/* Header */}
                    <div className="px-4 py-3 border-b border-slate-700/50 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Bell className="h-4 w-4 text-indigo-400" />
                        <span className="font-semibold text-sm text-slate-100">Notifications</span>
                        {notifications.filter(n => !n.is_read).length > 0 && (
                          <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.5 rounded-full">
                            {notifications.filter(n => !n.is_read).length} new
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        {notifications.some(n => !n.is_read) && (
                          <button
                            onClick={async () => {
                              const unread = notifications.filter(n => !n.is_read)
                              await Promise.all(unread.map(n => markNotificationRead(n.id).catch(() => {})))
                              setNotifications(prev => prev.map(n => ({ ...n, is_read: 1 })))
                            }}
                            className="text-[10px] font-medium text-indigo-400 hover:text-indigo-300 px-2 py-1 rounded-lg hover:bg-indigo-500/10 transition-colors">
                            Mark all read
                          </button>
                        )}
                        <button onClick={() => setShowNotifs(false)} className="p-1 text-slate-500 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    {/* List */}
                    <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-800">
                      {notifications.length === 0 ? (
                        <div className="py-12 text-center">
                          <Bell className="h-8 w-8 mx-auto mb-2 text-slate-700" />
                          <p className="text-xs font-medium text-slate-500">All caught up!</p>
                          <p className="text-[10px] text-slate-600 mt-0.5">No notifications yet</p>
                        </div>
                      ) : (
                        notifications.map(n => {
                          const msg = n.message.toLowerCase()
                          const Icon = msg.includes('paid') || msg.includes('payment') || msg.includes('settle') ? CreditCard
                            : msg.includes('expense') || msg.includes('added') ? Receipt
                            : msg.includes('approved') || msg.includes('confirmed') ? Check
                            : msg.includes('rejected') ? X
                            : Bell
                          const now = Date.now()
                          const created = new Date(n.created_at).getTime()
                          const diffMin = Math.floor((now - created) / 60000)
                          const relTime = diffMin < 1 ? 'just now'
                            : diffMin < 60 ? `${diffMin}m ago`
                            : diffMin < 1440 ? `${Math.floor(diffMin / 60)}h ago`
                            : diffMin < 10080 ? `${Math.floor(diffMin / 1440)}d ago`
                            : new Date(n.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
                          return (
                            <div key={n.id} onClick={() => handleMarkRead(n.id, n)}
                              className={`flex gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-slate-800/60 ${!n.is_read ? 'bg-indigo-500/5' : ''}`}>
                              <div className={`shrink-0 h-8 w-8 rounded-full flex items-center justify-center mt-0.5 ${!n.is_read ? 'bg-indigo-500/15 text-indigo-400' : 'bg-slate-800 text-slate-500'}`}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-xs leading-relaxed ${!n.is_read ? 'text-slate-100 font-medium' : 'text-slate-400'}`}>{n.message}</p>
                                <p className="text-[10px] text-slate-600 mt-1">{relTime}</p>
                              </div>
                              {!n.is_read && <div className="shrink-0 mt-2 h-1.5 w-1.5 rounded-full bg-indigo-500"></div>}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </motion.div>
                </>
              )}
            </div>
            <button onClick={() => { setShowProfile(true); setShowNotifs(false) }} className={`h-8 w-8 rounded-full bg-gradient-to-br ${avatarColor(user.id)} flex items-center justify-center text-xs font-bold text-white hover:ring-2 hover:ring-indigo-400 transition-all focus:outline-none`}>
              {user.name.charAt(0).toUpperCase()}
            </button>
            {user.is_admin && (
              <button onClick={() => { setShowAdmin(true); setShowNotifs(false) }}
                title="Admin Portal"
                className="p-2 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors">
                <Settings className="h-4 w-4" />
              </button>
            )}
            <button onClick={onLogout} className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors" title="Log out">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      <AnimatePresence>
        {showProfile && (
          <ProfileModal
            user={user}
            onClose={() => setShowProfile(false)}
            onSave={(newUser) => {
              const saved = JSON.parse(localStorage.getItem('splitclone_user') || '{}');
              const updated = { ...saved, ...newUser };
              localStorage.setItem('splitclone_user', JSON.stringify(updated));
              window.location.reload();
            }}
          />
        )}
      </AnimatePresence>

      {/* Floating Toast Notification */}
      <AnimatePresence>
        {toastNotif && (
          <motion.div initial={{ opacity: 0, y: -50 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -50 }}
            className="fixed top-20 left-1/2 -translate-x-1/2 z-[100] bg-indigo-600/90 backdrop-blur-md border border-indigo-500/50 text-white px-4 py-3 rounded-2xl shadow-xl shadow-indigo-500/30 flex items-center gap-3 cursor-pointer max-w-[90vw] w-max"
            onClick={() => { handleMarkRead(toastNotif.id, toastNotif); setToastNotif(null); }}>
            <Bell className="h-5 w-5 shrink-0" />
            <div className="text-sm font-medium pr-2 truncate">{toastNotif.message}</div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPendingSettlements && (
          <PendingSettlementsModal
            settlements={pendingSettlements}
            onClose={() => setShowPendingSettlements(false)}
            onUpdate={loadData}
          />
        )}
      </AnimatePresence>

      {/* Main content: group view or dashboard tabs */}
      {selectedGroup ? (
        <ErrorBoundary>
          <GroupDetailView
            key={selectedGroup.id}
            group={selectedGroup}
            currentUser={user}
            allUsers={users}
            allGroups={groups}
            onBack={() => { setGroup(null); setFocusExpenseId(null); }}
            onGroupUpdated={loadData}
            focusExpenseId={focusExpenseId}
            initiatedSettlements={initiatedSettlements}
          />
        </ErrorBoundary>
      ) : (
        <>
          <main className="flex-1 max-w-2xl w-full mx-auto px-4 pb-28">
            {loading ? (
              <div className="flex flex-col justify-center items-center h-64 gap-4">
                <Loader2 className="animate-spin h-8 w-8 text-indigo-500" />
                {slowLoad && (
                  <div className="text-center px-6">
                    <p className="text-slate-300 text-sm font-medium">Server is waking up…</p>
                    <p className="text-slate-500 text-xs mt-1">This takes ~30s on first load. Hang tight!</p>
                  </div>
                )}
              </div>
            ) : (
              <AnimatePresence mode="wait">
                <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
                  {activeTab === 'groups' && (
                    <GroupsTab groups={groups} currentUser={user} onSelectGroup={setGroup} onGroupCreated={loadData} />
                  )}
                  {activeTab === 'activity' && (
                    <ActivityTab currentUser={user} groups={groups} />
                  )}
                  {activeTab === 'people' && (
                    <PeopleTab users={users} currentUser={user} groups={groups} globalBalances={globalBalances} initiatedSettlements={initiatedSettlements} pendingSettlements={pendingSettlements} allSettlements={allSettlements} onSettle={loadData} />
                  )}
                </motion.div>
              </AnimatePresence>
            )}
          </main>

          {/* Bottom nav */}
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-slate-900/90 backdrop-blur-xl border-t border-slate-700/40">
            <div className="max-w-2xl mx-auto flex items-center justify-around h-16 px-4 relative">
              {tabs.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`flex flex-col items-center gap-0.5 px-4 py-2 rounded-xl transition-all ${activeTab === tab.id ? 'text-indigo-400' : 'text-slate-500 hover:text-slate-300'}`}>
                  <tab.icon className={`h-5 w-5 ${activeTab === tab.id ? 'stroke-2' : ''}`} />
                  <span className="text-[10px] font-medium">{tab.label}</span>
                </button>
              ))}
              <button
                onClick={() => setAddExp(true)}
                className="absolute -top-7 left-1/2 -translate-x-1/2 h-14 w-14 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center shadow-lg shadow-indigo-500/40 hover:scale-110 transition-transform active:scale-95">
                <Plus className="h-7 w-7 text-white" />
              </button>
            </div>
          </div>

          {/* Add Expense Modal */}
          <AnimatePresence>
            {showAddExpense && (
              <AddExpenseModal
                currentUser={user}
                users={users}
                groups={groups}
                onClose={() => setAddExp(false)}
                onSuccess={handleExpenseAdded}
              />
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  )
}

// ── Groups Tab ────────────────────────────────────────────────────────────────
function GroupsTab({ groups, currentUser, onSelectGroup, onGroupCreated }) {
  const [newName, setNewName] = useState('')
  const [loading, setLoading] = useState(false)
  const [showForm, setShowForm] = useState(false)

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    setLoading(true)
    try {
      await createGroup(newName.trim(), currentUser.id)
      setNewName(''); setShowForm(false)
      onGroupCreated()
    } catch (err) { alert(err.message) }
    finally { setLoading(false) }
  }

  return (
    <div className="space-y-4 pt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-white">My Groups</h2>
        <button onClick={() => setShowForm(s => !s)}
          className="flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 bg-indigo-500/10 hover:bg-indigo-500/20 px-3 py-1.5 rounded-lg transition-all">
          <Plus className="h-4 w-4" /> New Group
        </button>
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.form initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden" onSubmit={handleCreate}>
            <div className="flex gap-2 pb-1">
              <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                placeholder="Group name e.g. Flat share, Holiday..."
                className="flex-1 bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500 text-sm" />
              <button type="submit" disabled={loading}
                className="bg-indigo-500 hover:bg-indigo-600 text-white font-medium px-4 py-2.5 rounded-xl transition-colors text-sm flex items-center gap-1">
                {loading ? <Loader2 className="animate-spin h-4 w-4" /> : 'Create'}
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {groups.length === 0 ? (
        <div className="text-center py-16 text-slate-500 border border-dashed border-slate-700 rounded-2xl mt-4">
          <LayoutGrid className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No groups yet</p>
          <p className="text-sm mt-1">Create a group to start splitting expenses</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((g, i) => (
            <motion.button key={g.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              onClick={() => onSelectGroup(g)}
              className="w-full bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 hover:border-slate-600 rounded-2xl p-4 flex items-center gap-4 transition-all text-left group">
              <div className={`h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br ${avatarColor(g.id)} flex items-center justify-center text-xl font-bold text-white`}>
                {g.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-slate-100 truncate">{g.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">{g.members?.length ?? 0} member{g.members?.length !== 1 ? 's' : ''}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-slate-600 group-hover:text-slate-400 transition-colors shrink-0" />
            </motion.button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Group Detail View ─────────────────────────────────────────────────────────
function GroupDetailView({ group, currentUser, allUsers, allGroups, onBack, onGroupUpdated, focusExpenseId, initiatedSettlements = [] }) {
  const [expenses, setExpenses] = useState([])
  const [balances, setBalances] = useState([])
  const [members, setMembers]   = useState(group.members || [])
  const [memberships, setMemberships] = useState([])  // [{user_id, user_name, role, is_active}]
  const [loading, setLoading]   = useState(true)
  const [activeSection, setSection] = useState('expenses') // expenses | balances
  const [expSearch, setExpSearch] = useState('')
  const [expCatFilter, setExpCatFilter] = useState(null) // null = all
  const [showAddExp, setAddExp]  = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [memberSearch, setMemberSearch] = useState('')
  const [memberPhone, setMemberPhone] = useState('')
  const [memberLoading, setMemberLoading] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [inviteMode, setInviteMode] = useState(false)
  const [inviteSent, setInviteSent] = useState(false)
  const [inviteMsg, setInviteMsg] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [searchResults, setSearchResults] = useState([])
  const [editingExpense, setEditingExpense] = useState(null)
  const [showValidOnly, setShowValidOnly] = useState(false)
  const [memberActionsId, setMemberActionsId] = useState(null)  // which member's action menu is open
  const [editingGroupName, setEditingGroupName] = useState(false)
  const [groupNameDraft, setGroupNameDraft] = useState(group.name)
  const [viewedChats, setViewedChats] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`split_chat_viewed_${currentUser.id}`) || '{}') } catch { return {} }
  })

  // Build contact set — users that share any group with the current user (highest priority)
  const contactIds = new Set()
  ;(allGroups || []).forEach(g => {
    const isMember = (g.members || []).some(m => m.id === currentUser.id)
    if (isMember) (g.members || []).forEach(m => { if (m.id !== currentUser.id) contactIds.add(m.id) })
  })

  const memberIds = new Set(members.map(m => m.id))
  // Derive current user's role in this group
  const myMembership = memberships.find(m => m.user_id === currentUser.id)
  const myRole = myMembership?.role || 'member'
  // If memberships hasn't loaded yet (API not deployed / slow), fall back to
  // allowing all members to add people — the backend enforces real permissions.
  const membershipsLoaded = memberships.length > 0
  // For Add button: fall back to true while memberships is loading so creators don't get locked out
  const isGroupAdmin = myRole === 'admin' || myRole === 'super_admin' || !membershipsLoaded
  // For gear/role controls: only true once we have confirmed role data
  const isSuperAdmin = myRole === 'super_admin'

  const markChatViewed = useCallback((expId) => {
    setViewedChats(prev => {
      const updated = { ...prev, [expId]: new Date().toISOString() }
      localStorage.setItem(`split_chat_viewed_${currentUser.id}`, JSON.stringify(updated))
      return updated
    })
  }, [currentUser.id])

  const [chatRefreshKey, setChatRefreshKey] = useState(0)

  const [disabledInGroup, setDisabledInGroup] = useState(false)

  const loadGroupData = useCallback(async () => {
    setLoading(true)
    setDisabledInGroup(false)
    const [expResult, b, ms] = await Promise.allSettled([
      fetchGroupExpenses(group.id, currentUser.id),
      fetchGroupBalances(group.id),
      fetchGroupMemberships(group.id)
    ])
    if (expResult.status === 'rejected') {
      setDisabledInGroup(true)
      setExpenses([])
    } else {
      setExpenses(expResult.value)
    }
    if (b.status === 'fulfilled') setBalances(b.value)
    if (ms.status === 'fulfilled') setMemberships(ms.value)
    setLoading(false)
    setChatRefreshKey(k => k + 1)
  }, [group.id, currentUser.id])

  useEffect(() => { 
    loadGroupData()
    // mark all group chats as viewed when entering group (optimistic)
    const viewUpdates = { ...viewedChats }
    let changed = false
    expenses.forEach(e => {
      if (e.last_message_at) {
        if (!viewUpdates[e.id] || new Date(e.last_message_at) > new Date(viewUpdates[e.id])) {
          viewUpdates[e.id] = new Date().toISOString()
          changed = true
        }
      }
    })
    if (changed) {
      setViewedChats(viewUpdates)
      localStorage.setItem(`split_chat_viewed_${currentUser.id}`, JSON.stringify(viewUpdates))
    }
  }, [group.id])

  useEffect(() => {
    if (focusExpenseId && expenses.some(e => e.id === focusExpenseId)) {
      setTimeout(() => {
        const el = document.getElementById(`expense-${focusExpenseId}`)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 300)
      markChatViewed(focusExpenseId)
    }
  }, [focusExpenseId, expenses, markChatViewed])

  // Update last_message_at instantly when a new message arrives over WS
  useEffect(() => {
    const handleWsMsg = (e) => {
      const data = e.detail
      setExpenses(prev => prev.map(exp =>
        exp.id === data.expense_id
          ? { ...exp, last_message_at: data.created_at || new Date().toISOString() }
          : exp
      ))
    }
    window.addEventListener('ws_new_message', handleWsMsg)
    return () => window.removeEventListener('ws_new_message', handleWsMsg)
  }, [])

  // Re-fetch group data when any member triggers a balance-affecting action
  useEffect(() => {
    const handleGroupRefresh = (e) => {
      if (e.detail?.group_id === group.id) loadGroupData()
    }
    window.addEventListener('ws_group_refresh', handleGroupRefresh)
    return () => window.removeEventListener('ws_group_refresh', handleGroupRefresh)
  }, [group.id, loadGroupData])

  const handleDeleteExpense = async (expenseId) => {
    if (confirm("Are you sure you want to delete this expense? This will require approval from everyone involved.")) {
      try {
        await deleteExpense(expenseId, currentUser.id);
        loadGroupData();
      } catch (err) { alert(err.message); }
    }
  }

  const handleApproveDelete = async (expenseId) => {
    try {
      await approveExpenseDeletion(expenseId, currentUser.id);
      loadGroupData();
    } catch (err) { alert(err.message); }
  }

  const handleRejectDelete = async (expenseId) => {
    try {
      await rejectExpenseDeletion(expenseId, currentUser.id);
      loadGroupData();
    } catch (err) { alert(err.message); }
  }

  const resetMemberForm = () => {
    setMemberSearch(''); setMemberPhone(''); setMemberError('')
    setInviteMode(false); setInviteSent(false); setInviteMsg(''); setSearchResults([])
  }

  // 2-4 chars: local contacts only. 5+ chars: local first, then debounced DB search.
  useEffect(() => {
    const q = memberSearch.trim().toLowerCase()
    if (q.length < 2) { setSearchResults([]); return }

    const existingIds = new Set(members.map(m => m.user_id ?? m.id))
    existingIds.add(currentUser.id)

    const local = allUsers.filter(u =>
      !existingIds.has(u.id) &&
      (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    )

    if (q.length < 5) {
      setSearchResults(local.slice(0, 10))
      return
    }

    // Show local hits immediately, then fire DB search after 350ms debounce
    setSearchResults(local.slice(0, 10))
    const localIds = new Set(local.map(u => u.id))
    let cancelled = false

    const timer = setTimeout(() => {
      searchUsers(memberSearch.trim(), group.id)
        .then(remote => {
          if (cancelled) return
          const extra = remote.filter(u => !existingIds.has(u.id) && !localIds.has(u.id))
          setSearchResults(prev => {
            const prevIds = new Set(prev.map(u => u.id))
            return [...prev, ...extra.filter(u => !prevIds.has(u.id))].slice(0, 15)
          })
        })
        .catch(() => {})
    }, 350)

    return () => { cancelled = true; clearTimeout(timer) }
  }, [memberSearch, members, allUsers, currentUser.id, group.id])

  const handleAddMemberById = async (userId) => {
    setMemberLoading(true); setMemberError('')
    try {
      // Try new endpoint first; fall back to old email-based add if backend not yet updated
      let updated
      try {
        updated = await addGroupMemberById(group.id, userId, currentUser.id)
      } catch {
        // fallback: find user email from searchResults and use old endpoint
        const found = searchResults.find(u => u.id === userId)
        if (found?.email) updated = await addGroupMember(group.id, found.email)
        else throw new Error('Could not add member — please try by email')
      }
      setMembers(updated.members)
      const ms = await fetchGroupMemberships(group.id)
      setMemberships(ms)
      resetMemberForm(); setShowAddMember(false)
      onGroupUpdated()
    } catch (err) { setMemberError(err.message) }
    finally { setMemberLoading(false) }
  }

  const handleAddMemberByEmail = async (e) => {
    e.preventDefault()
    if (!memberSearch.trim()) return
    setMemberLoading(true); setMemberError('')
    try {
      const updated = await addGroupMember(group.id, memberSearch.trim())
      setMembers(updated.members)
      const ms = await fetchGroupMemberships(group.id)
      setMemberships(ms)
      resetMemberForm(); setShowAddMember(false)
      onGroupUpdated()
    } catch (err) {
      if (err.message && err.message.toLowerCase().includes('no user found')) {
        setInviteMode(true); setMemberError('')
      } else { setMemberError(err.message) }
    } finally { setMemberLoading(false) }
  }

  const handleSendInvite = async (e) => {
    e.preventDefault()
    if (!memberSearch.trim()) return
    setMemberLoading(true); setMemberError('')
    try {
      const result = await sendInvite(memberSearch.trim(), memberPhone.trim(), group.id, currentUser.id)
      setInviteSent(true)
      setInviteMsg(result.message || `Invite sent to ${memberSearch}`)
      setTimeout(() => { resetMemberForm(); setShowAddMember(false) }, 3000)
    } catch (err) { setMemberError(err.message) }
    finally { setMemberLoading(false) }
  }

  const handleSetRole = async (userId, role) => {
    try {
      await setGroupMemberRole(group.id, userId, role, currentUser.id)
      setMemberships(prev => prev.map(m => m.user_id === userId ? { ...m, role } : m))
    } catch (err) { alert(err.message) }
    setMemberActionsId(null)
  }

  const handleRemoveMember = async (userId, userName) => {
    if (!confirm(`Remove ${userName} from the group?`)) return
    try {
      const result = await removeGroupMember(group.id, userId, currentUser.id)
      setMembers(prev => prev.filter(m => m.id !== userId))
      setMemberships(prev => prev.filter(m => m.user_id !== userId))
      if (result.warning) alert(result.warning)
    } catch (err) { alert(err.message) }
    setMemberActionsId(null)
  }

  const handleToggleActive = async (userId) => {
    try {
      const result = await toggleGroupMemberActive(group.id, userId, currentUser.id)
      setMemberships(prev => prev.map(m => m.user_id === userId ? { ...m, is_active: result.is_active } : m))
    } catch (err) { alert(err.message) }
    setMemberActionsId(null)
  }

  // Compute this user's balance in this group
  const myBalance = balances.reduce((acc, b) => {
    if (b.from_user_id === currentUser.id) return acc - b.amount
    if (b.to_user_id   === currentUser.id) return acc + b.amount
    return acc
  }, 0)

  return (
    <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} className="min-h-screen flex flex-col z-10 relative">

      <div className="flex-1 max-w-2xl w-full mx-auto px-4 pb-28">

        {/* Balance summary banner */}
        <div className={`mt-4 rounded-2xl px-5 py-4 border ${myBalance > 0.01 ? 'bg-emerald-500/10 border-emerald-500/30' : myBalance < -0.01 ? 'bg-rose-500/10 border-rose-500/30' : 'bg-slate-800/50 border-slate-700/40'}`}>
          {myBalance > 0.01 ? (
            <div className="flex items-center gap-3">
              <TrendingUp className="h-5 w-5 text-emerald-400 shrink-0" />
              <div>
                <p className="text-xs text-emerald-400/70 font-medium">You are owed</p>
                <p className="text-2xl font-bold text-emerald-400">£{myBalance.toFixed(2)}</p>
              </div>
            </div>
          ) : myBalance < -0.01 ? (
            <div className="flex items-center gap-3">
              <TrendingDown className="h-5 w-5 text-rose-400 shrink-0" />
              <div>
                <p className="text-xs text-rose-400/70 font-medium">You owe overall</p>
                <p className="text-2xl font-bold text-rose-400">£{Math.abs(myBalance).toFixed(2)}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-slate-400" />
              <p className="text-slate-400 font-medium">All settled up!</p>
            </div>
          )}
        </div>

        {/* Members row */}
        <div className="mt-4 bg-slate-800/40 border border-slate-700/40 rounded-2xl px-4 py-3" onClick={() => memberActionsId && setMemberActionsId(null)}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider shrink-0">Members</p>
              {myRole === 'super_admin' && <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">Super Admin</span>}
              {myRole === 'admin' && <span className="text-[10px] font-bold text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">Admin</span>}
              {isSuperAdmin && (
                editingGroupName ? (
                  <form className="flex items-center gap-1 flex-1 min-w-0" onSubmit={async (ev) => {
                    ev.preventDefault()
                    const trimmed = groupNameDraft.trim()
                    if (!trimmed || trimmed === group.name) { setEditingGroupName(false); return }
                    try {
                      await renameGroup(group.id, trimmed, currentUser.id)
                      await onGroupUpdated()
                      setEditingGroupName(false)
                    } catch (err) { alert(err.message) }
                  }}>
                    <input autoFocus value={groupNameDraft} onChange={e => setGroupNameDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Escape') { setGroupNameDraft(group.name); setEditingGroupName(false) } }}
                      className="flex-1 bg-slate-700 border border-indigo-500 text-white text-xs rounded-lg px-2 py-0.5 outline-none min-w-0" />
                    <button type="submit" className="text-[10px] px-1.5 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded shrink-0">Save</button>
                    <button type="button" onClick={() => { setGroupNameDraft(group.name); setEditingGroupName(false) }} className="text-[10px] px-1.5 py-0.5 bg-slate-600 text-slate-300 rounded shrink-0">✕</button>
                  </form>
                ) : (
                  <button onClick={() => { setGroupNameDraft(group.name); setEditingGroupName(true) }} className="shrink-0 p-0.5 text-slate-600 hover:text-indigo-400 transition-colors" title="Rename group">
                    <Edit2 className="h-3 w-3" />
                  </button>
                )
              )}
            </div>
            {isGroupAdmin && (
              <button onClick={() => { setShowAddMember(s => { if (s) resetMemberForm(); return !s }) }}
                className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                <UserPlus className="h-3.5 w-3.5" /> Add
              </button>
            )}
          </div>

          {/* Member list with roles + admin controls */}
          <div className="space-y-1.5">
            {memberships.length > 0 ? memberships.map(ms => {
              const isMe = ms.user_id === currentUser.id
              const isOpen = memberActionsId === ms.user_id
              return (
                <div key={ms.user_id} className={`flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors ${!ms.is_active ? 'opacity-50' : ''}`}>
                  <div className={`relative h-7 w-7 rounded-full bg-gradient-to-br ${avatarColor(ms.user_id)} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                    {ms.user_name.charAt(0).toUpperCase()}
                    {ms.role === 'super_admin' && <Crown className="absolute -top-1 -right-1 h-3 w-3 text-amber-400" />}
                    {ms.role === 'admin' && <Shield className="absolute -top-1 -right-1 h-3 w-3 text-indigo-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-200 truncate">
                      {isMe ? 'You' : ms.user_name}
                      {!ms.is_active && <span className="ml-1 text-[10px] text-slate-500">(Inactive)</span>}
                    </p>
                  </div>
                  {/* Admin action menu */}
                  {isGroupAdmin && !isMe && ms.role !== 'super_admin' && (
                    <div className="relative shrink-0">
                      <button onClick={e => { e.stopPropagation(); setMemberActionsId(isOpen ? null : ms.user_id) }}
                        className="p-1 text-slate-500 hover:text-slate-300 rounded-lg transition-colors">
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                      <AnimatePresence>
                        {isOpen && (
                          <motion.div initial={{ opacity: 0, scale: 0.9, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.9, y: -4 }} transition={{ duration: 0.12 }}
                            className="absolute right-0 top-7 w-48 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-50 overflow-hidden"
                            onClick={e => e.stopPropagation()}>
                            {/* Role promotion — super_admin only */}
                            {isSuperAdmin && ms.role === 'member' && (
                              <button onClick={() => handleSetRole(ms.user_id, 'admin')}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-indigo-300 hover:bg-slate-700/60 transition-colors border-b border-slate-700/50">
                                <Shield className="h-3.5 w-3.5" /> Make Admin
                              </button>
                            )}
                            {isSuperAdmin && ms.role === 'admin' && (
                              <button onClick={() => handleSetRole(ms.user_id, 'member')}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-300 hover:bg-slate-700/60 transition-colors border-b border-slate-700/50">
                                <UserMinus className="h-3.5 w-3.5" /> Remove Admin
                              </button>
                            )}
                            {/* Deactivate / Reactivate */}
                            <button onClick={() => handleToggleActive(ms.user_id)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-xs text-amber-300 hover:bg-slate-700/60 transition-colors border-b border-slate-700/50">
                              <UserX className="h-3.5 w-3.5" /> {ms.is_active ? 'Deactivate' : 'Reactivate'}
                            </button>
                            {/* Remove from group */}
                            <button onClick={() => !ms.has_transactions && handleRemoveMember(ms.user_id, ms.user_name)}
                              disabled={ms.has_transactions}
                              title={ms.has_transactions ? 'Cannot remove — member has existing transactions in this group' : undefined}
                              className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${ms.has_transactions ? 'text-slate-600 cursor-not-allowed' : 'text-rose-400 hover:bg-rose-500/10'}`}>
                              <Trash2 className="h-3.5 w-3.5" /> Remove from group
                              {ms.has_transactions && <span className="ml-auto text-[9px] text-slate-600 font-normal">has transactions</span>}
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  )}
                </div>
              )
            }) : members.map(m => {
              const isMe = m.id === currentUser.id
              return (
                <div key={m.id} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
                  <div className={`h-7 w-7 rounded-full bg-gradient-to-br ${avatarColor(m.id)} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs text-slate-300 flex-1">{isMe ? 'You' : m.name}</span>
                  <span className="text-[10px] text-slate-600 italic">loading…</span>
                </div>
              )
            })}
          </div>

          <AnimatePresence>
            {showAddMember && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }} className="mt-3">

                {/* ── Invite Sent Confirmation ── */}
                {inviteSent ? (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 text-center">
                    <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
                    <p className="text-emerald-300 font-semibold text-sm">Invite Sent!</p>
                    <p className="text-emerald-400/70 text-xs mt-1">{inviteMsg}</p>
                  </div>

                /* ── Invite Mode (user not found) ── */
                ) : inviteMode ? (
                  <form onSubmit={handleSendInvite} className="space-y-2">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 flex items-start gap-2">
                      <Mail className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-300">
                        <span className="font-semibold">{memberSearch}</span> isn't on SplitWise yet. Send them an invite!
                      </p>
                    </div>
                    <div className="flex-1 relative">
                      <Phone className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input type="tel" value={memberPhone} onChange={e => setMemberPhone(e.target.value)}
                        placeholder="Phone number (optional)"
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500 text-sm" />
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setInviteMode(false); setMemberError('') }}
                        className="flex-1 bg-slate-700/60 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                        Back
                      </button>
                      <button type="submit" disabled={memberLoading}
                        className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-4 py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5">
                        {memberLoading ? <Loader2 className="animate-spin h-4 w-4" /> : <><Send className="h-3.5 w-3.5" /> Send Invite</>}
                      </button>
                    </div>
                    {memberError && <p className="text-red-400 text-xs mt-1">{memberError}</p>}
                  </form>

                /* ── Default: search with 5-char threshold ── */
                ) : (
                  <form onSubmit={handleAddMemberByEmail}>
                    <div className="relative">
                      <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
                      <input autoFocus type="text" value={memberSearch}
                        onChange={e => setMemberSearch(e.target.value)}
                        placeholder="Search by name or email…"
                        className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500 text-sm" />

                      {/* Search results dropdown */}
                      <AnimatePresence>
                        {memberSearch.trim().length >= 2 && searchResults.length > 0 && (
                          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                            transition={{ duration: 0.15 }}
                            className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700/60 rounded-xl shadow-2xl z-50 overflow-hidden max-h-52 overflow-y-auto">
                            {searchResults.map((u, i) => (
                              <button key={u.id} type="button"
                                onMouseDown={e => e.preventDefault()}
                                onClick={() => handleAddMemberById(u.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-700/60 transition-colors ${i < searchResults.length - 1 ? 'border-b border-slate-700/30' : ''}`}>
                                <div className={`h-8 w-8 shrink-0 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-xs font-bold text-white`}>
                                  {u.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-slate-200 truncate">{u.name}</p>
                                  <p className="text-xs text-slate-500 truncate">{u.email}</p>
                                </div>
                                <span className="text-[10px] text-emerald-400 shrink-0">+ Add</span>
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* No results — offer email invite */}
                      <AnimatePresence>
                        {memberSearch.trim().length >= 2 && searchResults.length === 0 && (
                          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                            className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700/60 rounded-xl shadow-2xl z-50 px-3 py-3 text-center">
                            <p className="text-xs text-slate-400">
                              {memberSearch.trim().length < 5 ? 'Not in your contacts — type 5+ chars to search all users' : 'No users found'}
                            </p>
                            <button type="submit" className="text-[11px] text-indigo-400 mt-1 hover:underline">
                              Invite "{memberSearch}" by email →
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                    {memberError && <p className="text-red-400 text-xs mt-2">{memberError}</p>}
                  </form>
                )}

              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Section tabs */}
        <div className="flex gap-1 mt-4 bg-slate-800/50 rounded-xl p-1">
          {[['expenses', 'Expenses', Receipt], ['balances', 'Balances', TrendingDown], ['insights', 'Insights', BarChart2]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${activeSection === id ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin h-7 w-7 text-indigo-500" /></div>
        ) : disabledInGroup && activeSection === 'expenses' ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-4">
            <div className="h-14 w-14 bg-amber-500/10 rounded-full flex items-center justify-center">
              <UserX className="h-7 w-7 text-amber-400" />
            </div>
            <p className="text-amber-300 font-semibold text-sm">Your access to this group is disabled</p>
            <p className="text-slate-500 text-xs max-w-xs">An admin has temporarily restricted your access. You won't see any expenses until you're re-enabled.</p>
          </div>
        ) : activeSection === 'expenses' ? (
          <>
            {/* Search + filter bar */}
            <div className="mt-3 mb-2 space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500 pointer-events-none" />
                <input value={expSearch} onChange={e => setExpSearch(e.target.value)}
                  placeholder="Search expenses…"
                  className="w-full bg-slate-800/60 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" />
                {expSearch && (
                  <button onClick={() => setExpSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
                {(() => {
                  const usedCats = new Set(expenses.map(e => e.category || guessCategory(e.description)).filter(Boolean))
                  const visibleCats = [null, ...EXPENSE_CATEGORIES.map(c => c.id).filter(id => usedCats.has(id))]
                  return visibleCats.map(cid => {
                    const meta = cid ? categoryMeta[cid] : null
                    const active = expCatFilter === cid
                    return (
                      <button key={cid ?? 'all'} onClick={() => setExpCatFilter(cid)}
                        className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${active ? (meta ? meta.color : 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300') : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                        {meta ? `${meta.icon} ${meta.label}` : 'All'}
                      </button>
                    )
                  })
                })()}
              </div>
            </div>
            {expenses.some(e => e.status === 'deleted') && (
              <div className="flex justify-end mb-1">
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer hover:text-slate-200 transition-colors">
                  <input type="checkbox" checked={showValidOnly} onChange={e => setShowValidOnly(e.target.checked)} className="accent-indigo-500" />
                  Hide deleted expenses
                </label>
              </div>
            )}
            <ExpenseList
              expenses={expenses.filter(e => {
                const term = expSearch.toLowerCase()
                const matchSearch = !term || e.description.toLowerCase().includes(term)
                const matchCat = !expCatFilter || (e.category || guessCategory(e.description)) === expCatFilter
                return matchSearch && matchCat
              })}
              chatRefreshKey={chatRefreshKey}
              currentUser={currentUser}
              allUsers={allUsers}
              showValidOnly={showValidOnly}
              onEditExpense={setEditingExpense}
              onDeleteExpense={handleDeleteExpense}
              onApproveDelete={handleApproveDelete}
              onRejectDelete={handleRejectDelete}
              viewedChats={viewedChats}
              focusExpenseId={focusExpenseId}
              markChatViewed={markChatViewed}
              initiatedSettlements={initiatedSettlements}
              onReload={loadGroupData}
              myRole={myRole}
            />
          </>
        ) : activeSection === 'balances' ? (
          <BalanceList balances={balances} currentUser={currentUser} members={members} />
        ) : (
          <InsightsTab expenses={expenses} members={members} group={group} />
        )}
      </div>

      {/* Floating Add Expense */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
        <button onClick={() => setAddExp(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold px-6 py-3.5 rounded-full shadow-lg shadow-indigo-500/30 transition-all hover:scale-105 active:scale-95">
          <Plus className="h-5 w-5" /> Add expense
        </button>
      </div>

      <AnimatePresence>
        {(showAddExp || editingExpense) && (
          <AddExpenseModal
            currentUser={currentUser}
            users={group.members}
            groups={[group]}
            defaultGroupId={group.id}
            initialExpense={editingExpense}
            onClose={() => { setAddExp(false); setEditingExpense(null); }}
            onSuccess={async () => { setAddExp(false); setEditingExpense(null); await loadGroupData() }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Admin Dashboard ───────────────────────────────────────────────────────────
function AdminDashboard({ currentUser, onBack, onWipe }) {
  const [activeTab, setActiveTab]           = useState('overview')
  const [loading, setLoading]               = useState(true)
  const [stats, setStats]                   = useState(null)
  const [users, setUsers]                   = useState([])
  const [adminGroups, setAdminGroups]       = useState([])
  const [adminExpenses, setAdminExpenses]   = useState([])
  const [adminSettlements, setAdminSettlements] = useState([])
  const [adminNotifs, setAdminNotifs]       = useState([])
  const [searchQuery, setSearchQuery]       = useState('')
  const [expenseFilter, setExpenseFilter]   = useState('active')
  const [settlementFilter, setSettlementFilter] = useState('')
  const [notifUser, setNotifUser]           = useState(null)
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [newName, setNewName]               = useState('')
  const [newEmail, setNewEmail]             = useState('')
  const [newPassword, setNewPassword]       = useState('')
  const [newIsAdmin, setNewIsAdmin]         = useState(false)
  const [createLoading, setCreateLoading]   = useState(false)
  const [createError, setCreateError]       = useState('')
  const [showWipeDialog, setShowWipeDialog] = useState(false)
  const [wipeInput, setWipeInput]           = useState('')
  const [wipeLoading, setWipeLoading]       = useState(false)
  const [wipeError, setWipeError]           = useState('')

  const TABS = [
    { id: 'overview',      label: 'Overview',      icon: LayoutGrid },
    { id: 'users',         label: 'Users',          icon: Users },
    { id: 'groups',        label: 'Groups',         icon: Home },
    { id: 'expenses',      label: 'Expenses',       icon: Receipt },
    { id: 'settlements',   label: 'Settlements',    icon: CheckCircle2 },
    { id: 'notifications', label: 'Notifications',  icon: Bell },
  ]

  const loadTab = useCallback(async (tab) => {
    setLoading(true)
    try {
      if (tab === 'overview') {
        const [s, u] = await Promise.all([fetchAdminStats(), fetchAdminUsers()])
        setStats(s); setUsers(u)
      } else if (tab === 'users') {
        setUsers(await fetchAdminUsers())
      } else if (tab === 'groups') {
        setAdminGroups(await fetchAdminGroups())
      } else if (tab === 'expenses') {
        setAdminExpenses(await fetchAdminExpenses(expenseFilter || null))
      } else if (tab === 'settlements') {
        setAdminSettlements(await fetchAdminSettlements())
      } else if (tab === 'notifications') {
        setAdminNotifs(await fetchAdminNotifications(notifUser?.id || null))
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [currentUser.id, expenseFilter, notifUser])

  useEffect(() => { loadTab(activeTab) }, [activeTab, expenseFilter, notifUser])

  const handleDeleteUser = async (id) => {
    if (!confirm('Delete this user? This cannot be undone.')) return
    try { await deleteAdminUser(id); setUsers(p => p.filter(u => u.id !== id)) }
    catch (e) { alert(e.message) }
  }
  const handleToggleAdmin = async (id) => {
    try { const u = await toggleAdminStatus(id); setUsers(p => p.map(x => x.id === id ? u : x)) }
    catch (e) { alert(e.message) }
  }
  const handleDeleteGroup = async (id) => {
    if (!confirm('Delete this group?')) return
    try { await deleteAdminGroup(id); setAdminGroups(p => p.filter(g => g.id !== id)) }
    catch (e) { alert(e.message) }
  }
  const handleCreateUser = async (e) => {
    e.preventDefault(); setCreateLoading(true); setCreateError('')
    try {
      const u = await adminCreateUser(newName, newEmail, newPassword, newIsAdmin)
      setUsers(p => [...p, u])
      setNewName(''); setNewEmail(''); setNewPassword(''); setNewIsAdmin(false); setShowCreateUser(false)
    } catch (e) { setCreateError(e.message) }
    finally { setCreateLoading(false) }
  }

  const handleWipeTransactions = async () => {
    setWipeLoading(true); setWipeError('')
    try {
      await adminWipeTransactions(wipeInput)
      setShowWipeDialog(false); setWipeInput('')
      alert('All transactions wiped successfully. Users and groups are intact.')
      loadTab('overview')
      if (onWipe) onWipe()  // refresh globalBalances, groups, etc. in the parent
    } catch (e) {
      setWipeError(e.message || 'Failed to wipe transactions.')
    } finally { setWipeLoading(false) }
  }

  const filteredUsers = users.filter(u =>
    !searchQuery || u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.email.toLowerCase().includes(searchQuery.toLowerCase())
  )
  const filteredSettlements = adminSettlements.filter(s => !settlementFilter || s.status === settlementFilter)
  const unreadCount = adminNotifs.filter(n => !n.is_read).length

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="min-h-screen flex flex-col bg-[#1a1a2e]">
      {/* Fixed header */}
      <div className="bg-slate-900/90 backdrop-blur-xl border-b border-slate-700/40 sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4">
          <div className="h-14 flex items-center gap-3">
            <button onClick={onBack} className="p-2 -ml-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="h-8 w-8 bg-gradient-to-br from-amber-500 to-orange-600 rounded-lg flex items-center justify-center shrink-0">
              <Settings className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-white text-sm leading-tight">Admin Portal</h1>
              <p className="text-[10px] text-slate-500 leading-tight">Platform management · {currentUser.name}</p>
            </div>
            <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full uppercase tracking-wider">Admin</span>
          </div>
          {/* Tab bar */}
          <div className="flex overflow-x-auto scrollbar-hide pb-0">
            {TABS.map(t => (
              <button key={t.id} onClick={() => { setActiveTab(t.id); setSearchQuery('') }}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all shrink-0 ${activeTab === t.id ? 'border-amber-500 text-amber-400' : 'border-transparent text-slate-500 hover:text-slate-300'}`}>
                <t.icon className="h-3.5 w-3.5" />{t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 gap-3">
            <Loader2 className="animate-spin h-8 w-8 text-amber-500" />
            <p className="text-xs text-slate-500">Loading {activeTab}…</p>
          </div>
        ) : (

          /* ── Overview ── */
          activeTab === 'overview' ? (
            <div className="space-y-6">
              {stats && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: 'Total Users',          value: stats.total_users,          icon: Users,       grad: 'from-indigo-500 to-purple-600',  bg: 'bg-indigo-500/10 border-indigo-500/20' },
                    { label: 'Total Groups',         value: stats.total_groups,         icon: Home,        grad: 'from-emerald-500 to-teal-600',   bg: 'bg-emerald-500/10 border-emerald-500/20' },
                    { label: 'Active Expenses',      value: stats.active_expenses,      icon: Receipt,     grad: 'from-sky-500 to-cyan-600',       bg: 'bg-sky-500/10 border-sky-500/20' },
                    { label: 'Total Tracked (£)',    value: `£${stats.total_expense_amount.toFixed(0)}`, icon: TrendingUp, grad: 'from-amber-500 to-orange-600', bg: 'bg-amber-500/10 border-amber-500/20' },
                    { label: 'Pending Settlements',  value: stats.pending_settlements,  icon: CheckCircle2, grad: 'from-rose-500 to-pink-600',     bg: 'bg-rose-500/10 border-rose-500/20' },
                    { label: 'Unread Notifications', value: stats.unread_notifications, icon: Bell,        grad: 'from-violet-500 to-purple-600',  bg: 'bg-violet-500/10 border-violet-500/20' },
                  ].map(c => (
                    <div key={c.label} className={`${c.bg} border rounded-2xl p-4`}>
                      <div className={`h-9 w-9 rounded-xl bg-gradient-to-br ${c.grad} flex items-center justify-center mb-3 shadow-lg`}>
                        <c.icon className="h-4 w-4 text-white" />
                      </div>
                      <p className="text-2xl font-bold text-white">{c.value}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{c.label}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-3 gap-3 text-center">
                {[
                  { label: 'Deleted', value: stats?.deleted_expenses ?? 0, color: 'text-slate-400' },
                  { label: 'Pending deletion', value: stats?.pending_deletions ?? 0, color: 'text-amber-400' },
                  { label: 'Approved settlements', value: stats?.approved_settlements ?? 0, color: 'text-emerald-400' },
                ].map(s => (
                  <div key={s.label} className="bg-slate-800/40 border border-slate-700/40 rounded-xl py-3 px-2">
                    <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>

              <div className="bg-slate-800/40 border border-slate-700/40 rounded-2xl overflow-hidden">
                <div className="px-5 py-3 border-b border-slate-700/40 flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">All Users</p>
                  <span className="text-xs text-slate-500">{users.length} registered</span>
                </div>
                <div className="divide-y divide-slate-700/30 max-h-60 overflow-y-auto custom-scrollbar">
                  {users.map(u => (
                    <div key={u.id} className="px-5 py-3 flex items-center gap-3">
                      <div className={`h-8 w-8 shrink-0 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-xs font-bold text-white`}>
                        {u.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate">{u.name}</p>
                        <p className="text-xs text-slate-500 truncate">{u.email}</p>
                      </div>
                      {u.is_admin && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-bold uppercase tracking-wider shrink-0">Admin</span>}
                    </div>
                  ))}
                </div>
              </div>

              {/* Danger Zone */}
              <div className="bg-rose-950/30 border border-rose-500/30 rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-lg bg-rose-500/20 flex items-center justify-center">
                    <Trash2 className="h-4 w-4 text-rose-400" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-rose-400">Danger Zone</p>
                    <p className="text-xs text-slate-500">Irreversible actions — proceed with extreme caution</p>
                  </div>
                </div>
                <div className="flex items-start justify-between gap-4 p-4 bg-slate-900/50 rounded-xl border border-rose-500/20">
                  <div>
                    <p className="text-sm font-semibold text-slate-200">Wipe All Transactions</p>
                    <p className="text-xs text-slate-400 mt-0.5">Delete all expenses, splits, settlements, and notifications. Users and groups remain intact.</p>
                  </div>
                  <button onClick={() => { setShowWipeDialog(true); setWipeInput(''); setWipeError('') }}
                    className="shrink-0 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-bold transition-colors">
                    Wipe DB
                  </button>
                </div>
              </div>

              {/* Wipe confirmation dialog */}
              <AnimatePresence>
                {showWipeDialog && (
                  <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowWipeDialog(false)} />
                    <motion.div initial={{ opacity: 0, scale: 0.9, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9, y: 20 }}
                      className="relative w-full max-w-sm bg-slate-900 border border-rose-500/40 rounded-3xl shadow-2xl p-6 space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-xl bg-rose-500/20 flex items-center justify-center">
                          <Trash2 className="h-5 w-5 text-rose-400" />
                        </div>
                        <div>
                          <h2 className="text-base font-bold text-white">Confirm Wipe</h2>
                          <p className="text-xs text-slate-400">This cannot be undone</p>
                        </div>
                      </div>
                      <p className="text-sm text-slate-300">This will permanently delete all <span className="text-rose-400 font-semibold">expenses, splits, settlements, messages, and notifications</span>. Users and groups will NOT be affected.</p>
                      <div>
                        <p className="text-xs text-slate-400 mb-1.5">Type <span className="font-mono text-rose-400 font-bold">DELETE ALL TRANSACTIONS</span> to confirm:</p>
                        <input autoFocus value={wipeInput} onChange={e => setWipeInput(e.target.value)}
                          placeholder="DELETE ALL TRANSACTIONS"
                          className="w-full bg-slate-800 border border-rose-500/30 focus:border-rose-500 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-rose-500" />
                        {wipeError && <p className="text-xs text-rose-400 mt-1.5">{wipeError}</p>}
                      </div>
                      <div className="flex gap-3">
                        <button onClick={() => setShowWipeDialog(false)} className="flex-1 py-2.5 rounded-xl border border-slate-700 text-sm text-slate-400 hover:text-white hover:border-slate-500 transition-colors">Cancel</button>
                        <button
                          onClick={handleWipeTransactions}
                          disabled={wipeInput !== 'DELETE ALL TRANSACTIONS' || wipeLoading}
                          className="flex-1 py-2.5 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-bold transition-colors flex items-center justify-center gap-2">
                          {wipeLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          Wipe Now
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </div>

          /* ── Users ── */
          ) : activeTab === 'users' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex-1 relative">
                  <Search className="h-4 w-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search by name or email…"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl pl-9 pr-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500 placeholder-slate-500" />
                </div>
                <button onClick={() => { setShowCreateUser(s => !s); setCreateError('') }}
                  className="flex items-center gap-1.5 px-4 py-2.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 rounded-xl text-sm font-medium transition-colors shrink-0">
                  <Plus className="h-4 w-4" /> Add User
                </button>
              </div>

              <AnimatePresence>
                {showCreateUser && (
                  <motion.form initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                    onSubmit={handleCreateUser}
                    className="bg-slate-800/60 border border-amber-500/20 rounded-2xl p-5 space-y-3">
                    <p className="text-sm font-semibold text-white">New User</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <input type="text" placeholder="Full name" required value={newName} onChange={e => setNewName(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500 placeholder-slate-500" />
                      <input type="email" placeholder="Email address" required value={newEmail} onChange={e => setNewEmail(e.target.value)}
                        className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500 placeholder-slate-500" />
                    </div>
                    <input type="password" placeholder="Password" required value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500 placeholder-slate-500" />
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
                        <input type="checkbox" checked={newIsAdmin} onChange={e => setNewIsAdmin(e.target.checked)} className="accent-amber-500 w-4 h-4" />
                        Grant Admin Privileges
                      </label>
                      <div className="flex gap-2">
                        <button type="button" onClick={() => { setShowCreateUser(false); setCreateError('') }}
                          className="px-3 py-1.5 text-sm text-slate-400 hover:text-white bg-slate-700/50 rounded-lg transition-colors">Cancel</button>
                        <button type="submit" disabled={createLoading}
                          className="px-4 py-1.5 text-sm font-semibold bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors flex items-center gap-1.5">
                          {createLoading ? <Loader2 className="animate-spin h-4 w-4" /> : 'Create'}
                        </button>
                      </div>
                    </div>
                    {createError && <p className="text-red-400 text-xs">{createError}</p>}
                  </motion.form>
                )}
              </AnimatePresence>

              <p className="text-xs text-slate-500">{filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}</p>
              <div className="space-y-2">
                {filteredUsers.map(u => (
                  <motion.div key={u.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
                    className="bg-slate-800/40 border border-slate-700/40 rounded-2xl px-4 py-3 flex items-center gap-3">
                    <div className={`h-10 w-10 shrink-0 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-sm font-bold text-white`}>
                      {u.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-slate-200">{u.name}</p>
                        {u.id === currentUser.id && <span className="text-[10px] text-indigo-400">(You)</span>}
                        {u.is_admin && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded font-bold uppercase tracking-wider">Admin</span>}
                      </div>
                      <p className="text-xs text-slate-500">{u.email} · ID: {u.id}</p>
                    </div>
                    {u.id !== currentUser.id && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => handleToggleAdmin(u.id)}
                          className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-colors ${u.is_admin ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-400'}`}>
                          {u.is_admin ? 'Revoke' : 'Make Admin'}
                        </button>
                        <button onClick={() => handleDeleteUser(u.id)} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            </div>

          /* ── Groups ── */
          ) : activeTab === 'groups' ? (
            <div className="space-y-3">
              <p className="text-xs text-slate-500">{adminGroups.length} group{adminGroups.length !== 1 ? 's' : ''}</p>
              {adminGroups.map(g => (
                <div key={g.id} className="bg-slate-800/40 border border-slate-700/40 rounded-2xl px-4 py-4">
                  <div className="flex items-start gap-3">
                    <div className={`h-10 w-10 shrink-0 rounded-xl bg-gradient-to-br ${avatarColor(g.id)} flex items-center justify-center text-sm font-bold text-white`}>
                      {g.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-semibold text-slate-100">{g.name}</p>
                        <button onClick={() => handleDeleteGroup(g.id)} className="p-1.5 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors shrink-0">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="flex gap-4 text-xs text-slate-400 mt-1">
                        <span>{g.member_count} member{g.member_count !== 1 ? 's' : ''}</span>
                        <span>{g.expense_count} active expense{g.expense_count !== 1 ? 's' : ''}</span>
                        <span className="text-slate-600">ID: {g.id}</span>
                      </div>
                      {g.members?.length > 0 && (
                        <div className="flex gap-1.5 mt-2.5 flex-wrap">
                          {g.members.map(m => (
                            <span key={m.id} className="text-[10px] bg-slate-700/70 text-slate-300 px-2 py-0.5 rounded-full">{m.name}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

          /* ── Expenses ── */
          ) : activeTab === 'expenses' ? (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {[['active', 'Active'], ['pending_deletion', 'Pending Deletion'], ['deleted', 'Deleted'], ['', 'All']].map(([val, label]) => (
                  <button key={val} onClick={() => setExpenseFilter(val)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${expenseFilter === val ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">{adminExpenses.length} result{adminExpenses.length !== 1 ? 's' : ''}</p>
              {adminExpenses.length === 0 ? (
                <div className="text-center py-14 border border-dashed border-slate-700 rounded-2xl">
                  <Receipt className="h-10 w-10 mx-auto mb-3 text-slate-600" />
                  <p className="text-slate-500 font-medium">No expenses found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {adminExpenses.map(e => (
                    <div key={e.id} className={`bg-slate-800/40 border rounded-xl px-4 py-3 flex items-center gap-3 ${e.status === 'deleted' ? 'border-slate-700/20 opacity-50' : e.status !== 'active' ? 'border-amber-500/30' : 'border-slate-700/40'}`}>
                      <div className="text-xl shrink-0">{categoryIcons[guessCategory(e.description)]}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-200 truncate">{e.description}</p>
                        <p className="text-xs text-slate-500 truncate">
                          Paid by {e.payer_name} · {e.splits.length} split{e.splits.length !== 1 ? 's' : ''}{e.group_id ? ` · group #${e.group_id}` : ''} · {e.date ? new Date(e.date).toLocaleDateString() : '—'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-white">£{e.amount.toFixed(2)}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${e.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : e.status === 'deleted' ? 'bg-slate-700 text-slate-400' : 'bg-amber-500/20 text-amber-400'}`}>
                          {e.status.replace(/_/g, ' ')}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          /* ── Settlements ── */
          ) : activeTab === 'settlements' ? (
            <div className="space-y-4">
              <div className="flex gap-2 flex-wrap">
                {[['', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([val, label]) => (
                  <button key={val} onClick={() => setSettlementFilter(val)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${settlementFilter === val ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/20' : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">{filteredSettlements.length} result{filteredSettlements.length !== 1 ? 's' : ''}</p>
              {filteredSettlements.length === 0 ? (
                <div className="text-center py-14 border border-dashed border-slate-700 rounded-2xl">
                  <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-slate-600" />
                  <p className="text-slate-500 font-medium">No settlements found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filteredSettlements.map(s => (
                    <div key={s.id} className="bg-slate-800/40 border border-slate-700/40 rounded-xl px-4 py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-slate-200">
                          <span className="font-semibold">{s.payer_name}</span>
                          <span className="text-slate-500 mx-1.5">→</span>
                          <span className="font-semibold">{s.payee_name}</span>
                        </p>
                        <p className="text-xs text-slate-500 mt-0.5">{new Date(s.created_at).toLocaleString()}{s.group_id ? ` · group #${s.group_id}` : ''}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold text-white">£{s.amount.toFixed(2)}</p>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${s.status === 'approved' ? 'bg-emerald-500/20 text-emerald-400' : s.status === 'rejected' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'}`}>
                          {s.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          /* ── Notifications ── */
          ) : activeTab === 'notifications' ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-[180px]">
                  <select value={notifUser?.id || ''}
                    onChange={e => setNotifUser(parseInt(e.target.value) ? users.find(u => u.id === parseInt(e.target.value)) || null : null)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-amber-500 appearance-none">
                    <option value="">All users</option>
                    {users.map(u => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                  </select>
                </div>
                <button onClick={() => loadTab('notifications')}
                  className="flex items-center gap-1.5 px-3 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-sm text-slate-300 hover:text-white transition-colors shrink-0">
                  <Activity className="h-3.5 w-3.5" /> Refresh
                </button>
              </div>

              <div className="flex items-center gap-3 text-xs text-slate-500 flex-wrap">
                <span>{adminNotifs.length} notification{adminNotifs.length !== 1 ? 's' : ''}</span>
                {notifUser && <span>for <span className="text-amber-400 font-medium">{notifUser.name}</span></span>}
                {unreadCount > 0 && <span className="text-rose-400 font-medium">{unreadCount} unread</span>}
              </div>

              {adminNotifs.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-slate-700 rounded-2xl">
                  <Bell className="h-10 w-10 mx-auto mb-3 text-slate-600" />
                  <p className="text-slate-500 font-medium">No notifications found</p>
                  <p className="text-xs text-slate-600 mt-1">
                    {notifUser ? `${notifUser.name} has no notifications yet — they haven't been involved in any transactions` : 'No notifications in the system yet'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {adminNotifs.map(n => (
                    <div key={n.id} className={`rounded-xl px-4 py-3 border flex gap-3 items-start ${!n.is_read ? 'bg-indigo-500/5 border-indigo-500/20' : 'bg-slate-800/30 border-slate-700/30'}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                          <span className="text-xs font-semibold text-amber-400">{n.user_name}</span>
                          <span className="text-[10px] text-slate-600">ID: {n.user_id}</span>
                          {!n.is_read && <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shrink-0"></span>}
                        </div>
                        <p className="text-xs text-slate-300">{n.message}</p>
                        <p className="text-[10px] text-slate-500 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full h-fit mt-0.5 ${!n.is_read ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : 'bg-slate-700 text-slate-400'}`}>
                        {n.is_read ? 'READ' : 'UNREAD'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          ) : null
        )}
      </div>
    </motion.div>
  )
}

// ── Expense Chat ──────────────────────────────────────────────────────────────
function ExpenseChat({ expenseId, currentUser, expenseUsers = [], lastViewedAt, refreshKey = 0 }) {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [showMentions, setShowMentions] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const scrollRef = useRef(null)
  const initialScrollDone = useRef(false)

  useEffect(() => {
    fetchExpenseChat(expenseId).then(setMessages).finally(() => setLoading(false))
  }, [expenseId])

  useEffect(() => {
    if (refreshKey > 0) fetchExpenseChat(expenseId).then(setMessages)
  }, [refreshKey])

  useEffect(() => {
    const handleWsMsg = (e) => {
      const data = e.detail
      if (data.expense_id === expenseId) {
        setMessages(prev => {
          if (prev.some(m => m.id === data.id)) return prev
          return [...prev, data]
        })
      }
    }
    window.addEventListener('ws_new_message', handleWsMsg)
    return () => window.removeEventListener('ws_new_message', handleWsMsg)
  }, [expenseId])

  useEffect(() => {
    const interval = setInterval(() => {
      fetchExpenseChat(expenseId).then(setMessages)
    }, 5000)
    return () => clearInterval(interval)
  }, [expenseId])

  useEffect(() => {
    if (messages.length > 0 && scrollRef.current) {
      if (!initialScrollDone.current) {
        initialScrollDone.current = true
        if (lastViewedAt) {
          const firstUnread = messages.find(m => new Date(m.created_at) > new Date(lastViewedAt))
          if (firstUnread) {
            const el = document.getElementById(`msg-${firstUnread.id}`)
            if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
          }
        }
      }
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, lastViewedAt])

  const handleTextChange = (e) => {
    const val = e.target.value
    setText(val)
    
    // Check for @ trigger
    const cursor = e.target.selectionStart
    const upToCursor = val.slice(0, cursor)
    const match = upToCursor.match(/@([a-zA-Z0-9_]*)$/)
    
    if (match) {
      setShowMentions(true)
      setMentionFilter(match[1].toLowerCase())
    } else {
      setShowMentions(false)
    }
  }

  const insertMention = (userName) => {
    const cursor = text.lastIndexOf('@') // rudimentary, assumes last @ is the active one
    const newText = text.slice(0, cursor) + `@${userName} ` + text.slice(cursor + mentionFilter.length + 1)
    setText(newText)
    setShowMentions(false)
  }

  const handleSend = async (e) => {
    e.preventDefault()
    if (!text.trim()) return
    const msgText = text.trim()
    setText('')
    
    // Find mentions
    const mentions = []
    expenseUsers.forEach(u => {
      if (msgText.includes(`@${u.name}`)) mentions.push(u.id)
    })
    
    try {
      const newMsg = await postExpenseMessage(expenseId, currentUser.id, msgText, mentions)
      setMessages(prev => [...prev, newMsg])
    } catch (err) {
      console.error(err)
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-700/50 bg-slate-900/30 rounded-xl px-2 py-2">
      <div ref={scrollRef} className="h-48 overflow-y-auto mb-3 pr-2 custom-scrollbar flex flex-col gap-1">
        {loading && messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin h-5 w-5 text-indigo-500" /></div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-500">No messages yet. Start the discussion!</div>
        ) : (() => {
          // Group messages by calendar date
          const groups = []
          let currentDate = null
          messages.forEach((m, i) => {
            const msgDate = m.created_at ? new Date(m.created_at).toDateString() : 'unknown'
            if (msgDate !== currentDate) {
              currentDate = msgDate
              groups.push({ type: 'separator', label: chatDateLabel(m.created_at), key: `sep-${i}` })
            }
            groups.push({ type: 'message', msg: m, key: m.id || i })
          })
          return groups.map(item => {
            if (item.type === 'separator') {
              return (
                <div key={item.key} className="flex items-center gap-2 my-2">
                  <div className="flex-1 h-px bg-slate-700/50" />
                  <span className="text-[10px] text-slate-500 font-medium shrink-0">{item.label}</span>
                  <div className="flex-1 h-px bg-slate-700/50" />
                </div>
              )
            }
            const m = item.msg
            if (m.is_system) {
              return (
                <div key={item.key} id={`msg-${m.id}`} className="w-full flex justify-center my-1">
                  <div className="bg-slate-800/60 text-slate-400 text-[10px] px-3 py-1 rounded-full border border-slate-700/50">
                    {m.text}
                  </div>
                </div>
              )
            }
            const isMe = m.user_id === currentUser.id
            const timeStr = m.created_at ? new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''
            return (
              <div key={item.key} id={`msg-${m.id}`} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && <span className="text-[10px] text-slate-500 ml-1 mb-0.5">{m.user_name}</span>}
                <div className={`flex items-end gap-1.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`max-w-[80%] px-3 py-1.5 rounded-2xl text-sm ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-700 text-slate-200 rounded-bl-none'}`}>
                    {m.text}
                  </div>
                  <span className="text-[9px] text-slate-500 shrink-0 pb-0.5">{timeStr}</span>
                </div>
              </div>
            )
          })
        })()}
      </div>
      <div className="relative">
        {showMentions && expenseUsers.length > 0 && (
          <div className="absolute bottom-full left-0 w-48 mb-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50">
            {expenseUsers.filter(u => u.name.toLowerCase().includes(mentionFilter) && u.id !== currentUser.id).map(u => (
              <button key={u.id} type="button" onClick={() => insertMention(u.name)}
                className="w-full text-left px-3 py-2 text-xs text-slate-200 hover:bg-slate-700 transition-colors">
                {u.name}
              </button>
            ))}
          </div>
        )}
        <form onSubmit={handleSend} className="flex gap-2">
          <input type="text" value={text} onChange={handleTextChange}
            placeholder="Type a message... (use @ to mention)"
            className="flex-1 bg-slate-800 border border-slate-700 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-indigo-500 text-slate-100" />
          <button type="submit" disabled={!text.trim()}
            className="h-9 w-9 rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 flex items-center justify-center text-white transition-colors shrink-0">
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Expense List (Splitwise-style) ────────────────────────────────────────────
function ExpenseList({ expenses, currentUser, allUsers = [], showValidOnly = false, onEditExpense, onDeleteExpense, onApproveDelete, onRejectDelete, viewedChats, focusExpenseId, markChatViewed, initiatedSettlements = [], onReload, chatRefreshKey = 0, myRole = 'member' }) {
  const [expandedChatId, setExpandedChatId] = useState(focusExpenseId || null)
  const [receiptViewUrl, setReceiptViewUrl] = useState(null)

  useEffect(() => {
    if (focusExpenseId) {
      setExpandedChatId(focusExpenseId)
    }
  }, [focusExpenseId])

  const handleToggleChat = (expId) => {
    if (expandedChatId === expId) {
      setExpandedChatId(null)
    } else {
      setExpandedChatId(expId)
      if (markChatViewed) markChatViewed(expId)
    }
  }

  // Clear red dot instantly if receiving message while chat is open
  useEffect(() => {
    const handleWsMsg = (e) => {
      const data = e.detail
      if (data.expense_id === expandedChatId && markChatViewed) {
        markChatViewed(expandedChatId)
      }
    }
    window.addEventListener('ws_new_message', handleWsMsg)
    return () => window.removeEventListener('ws_new_message', handleWsMsg)
  }, [expandedChatId, markChatViewed])

  const handleCancelDeletion = async (expId) => {
    if (!window.confirm("Are you sure you want to cancel the deletion?")) return;
    try {
      await cancelExpenseDeletion(expId, currentUser.id)
      if (onRejectDelete) onRejectDelete(expId) // We can reuse onRejectDelete to refresh the list easily
    } catch (err) { console.error(err) }
  }

  const displayExpenses = showValidOnly ? expenses.filter(e => e.status !== 'deleted') : expenses;

  if (displayExpenses.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 mt-2">
        <Receipt className="h-10 w-10 mx-auto mb-3 opacity-40" />
        <p className="font-medium">No expenses yet</p>
        <p className="text-sm mt-1">Tap "Add expense" to record the first one</p>
      </div>
    )
  }

  // Group by month-year
  const grouped = {}
  displayExpenses.forEach(e => {
    const d = e.date ? new Date(e.date) : new Date()
    const key = `${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(e)
  })

  return (
    <>
    <div className="mt-2 space-y-4">
      {Object.entries(grouped).map(([monthYear, exps]) => (
        <div key={monthYear}>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1 py-2">{monthYear}</p>
          <div className="space-y-1">
            {exps.map((e, i) => {
              const { month, day, year } = formatDate(e.date)
              const mySplit = e.splits.find(s => s.user_id === currentUser.id)
              const iPaid  = e.payer_id === currentUser.id
              const cat    = e.category || guessCategory(e.description)
              const icon   = categoryIcons[cat]

              let balLabel = '', balColor = ''
              if (iPaid && mySplit) {
                const lent = e.amount - mySplit.amount
                if (lent > 0.005) {
                  balLabel = `you lent £${lent.toFixed(2)}`
                  balColor = 'text-emerald-400'
                } else {
                  balLabel = 'not involved'
                  balColor = 'text-slate-500'
                }
              } else if (!iPaid && mySplit) {
                balLabel = `you borrowed £${mySplit.amount.toFixed(2)}`
                balColor = 'text-rose-400'
              } else {
                balLabel = 'not involved'
                balColor = 'text-slate-500'
              }

              const isDeleted = e.status === 'deleted'

              return (
                <motion.div key={e.id} id={`expense-${e.id}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                  className={`flex flex-col gap-2 ${isDeleted ? 'bg-slate-900/30 opacity-60 grayscale' : 'bg-slate-800/40 hover:bg-slate-800/70'} border ${(e.status === 'pending_deletion' || e.status === 'approved_for_deletion') ? 'border-amber-500/50' : 'border-slate-700/30'} hover:border-slate-600/50 rounded-xl px-3 py-3 transition-all relative overflow-hidden`}>
                  
                  {isDeleted && (
                    <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                      <span className="text-4xl font-black text-slate-500/10 -rotate-12 uppercase">Deleted</span>
                    </div>
                  )}

                  {(e.status === 'pending_deletion' || e.status === 'approved_for_deletion') && (
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2 text-xs flex flex-col gap-2 text-amber-200">
                      <div className="flex justify-between items-center">
                        <span>{e.status === 'approved_for_deletion' ? 'Deletion approved! Will delete in 10 mins.' : 'Deletion pending approval...'}</span>
                        <div className="flex gap-2">
                          {(() => {
                            const canCancel = myRole === 'super_admin' || myRole === 'admin' || currentUser.id === e.created_by_id
                            const cancelBtn = canCancel
                              ? <button onClick={() => handleCancelDeletion(e.id)} className="bg-slate-700/60 text-slate-300 hover:bg-rose-500/20 hover:text-rose-400 px-2 py-1 rounded transition-colors font-medium">Cancel</button>
                              : null
                            if (e.status === 'pending_deletion') {
                              const myApproval = e.approvals && e.approvals.find(a => a.user_id === currentUser.id)
                              if (!myApproval) return null
                              const myVote = myApproval.approved
                              if (myVote === 1) return <><span className="text-emerald-400 font-semibold border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 rounded">You approved</span>{cancelBtn}</>
                              if (myVote === -1) return <><span className="text-rose-400 font-semibold border border-rose-500/30 bg-rose-500/10 px-2 py-1 rounded">You rejected</span>{cancelBtn}</>
                              return (
                                <>
                                  <button onClick={() => onApproveDelete && onApproveDelete(e.id)} className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 px-2 py-1 rounded transition-colors">Approve</button>
                                  <button onClick={() => onRejectDelete && onRejectDelete(e.id)} className="bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 px-2 py-1 rounded transition-colors">Reject</button>
                                  {cancelBtn}
                                </>
                              )
                            }
                            // approved_for_deletion
                            return canCancel
                              ? <button onClick={() => handleCancelDeletion(e.id)} className="bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 px-2 py-1 rounded transition-colors font-medium">Cancel Deletion</button>
                              : null
                          })()}
                        </div>
                      </div>
                      {e.status === 'pending_deletion' && e.approvals && (
                        <div className="text-[10px] text-amber-200/60 mt-1 flex gap-2 flex-wrap">
                          {e.approvals.map(a => (
                            <span key={a.user_id} className="flex items-center gap-1">
                              <span className={`w-2 h-2 rounded-full ${a.approved === 1 ? 'bg-emerald-400' : a.approved === -1 ? 'bg-rose-400' : 'bg-slate-500'}`}></span>
                              {a.user_name || `User #${a.user_id}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-3">
                    {/* Date column */}
                    <div className="w-9 shrink-0 text-center">
                      <p className="text-[10px] text-slate-500 uppercase leading-tight">{month}</p>
                      <p className="text-base font-bold text-slate-300 leading-tight">{day}</p>
                      <p className="text-[9px] text-slate-600 leading-tight">{year}</p>
                    </div>
                    {/* Icon */}
                    <div className="h-10 w-10 shrink-0 bg-slate-700/60 rounded-xl flex items-center justify-center text-lg">
                      {icon}
                    </div>
                    {/* Description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="text-sm font-semibold text-slate-100 truncate">{e.description}</p>
                        {e.recurrence && (
                          <span className="flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 shrink-0">
                            <Zap className="h-2.5 w-2.5" />{e.recurrence}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Added by {e.created_by_name} • {iPaid ? 'You paid' : `${e.payer_name} paid`} £{e.amount.toFixed(2)}
                      </p>
                      {e.created_at && (
                        <p className="text-[9px] text-slate-600 mt-0.5">{formatTimestamp(e.created_at)}</p>
                      )}
                    </div>
                    {/* Balance */}
                    <div className="text-right shrink-0 flex flex-col items-end justify-center gap-1">
                      <p className={`text-xs font-semibold ${balColor}`}>{balLabel}</p>
                      {!iPaid && mySplit && e.status !== 'deleted' && (() => {
                        const mySettlement = initiatedSettlements.find(s => s.expense_id === e.id)
                        if (mySettlement?.status === 'approved') {
                          return (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                              ✓ Paid
                            </span>
                          )
                        }
                        if (mySettlement?.status === 'pending') {
                          return (
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-700/50 text-slate-400 border border-slate-600/50">
                              Waiting…
                            </span>
                          )
                        }
                        return (
                          <button
                            onClick={(ev) => {
                              ev.stopPropagation()
                              if (window.confirm(`Mark your share (£${mySplit.amount.toFixed(2)}) as paid?`)) {
                                createSettlement({
                                  payer_id: currentUser.id,
                                  payee_id: e.payer_id,
                                  amount: mySplit.amount,
                                  group_id: e.group_id,
                                  expense_id: e.id
                                }).then(() => {
                                  if (onReload) onReload()
                                }).catch(err => alert(err.message || "Failed to send payment request."))
                              }
                            }}
                            className="cursor-pointer px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500 hover:text-white active:scale-95 transition-all border border-emerald-500/30"
                          >
                            Mark as Paid
                          </button>
                        )
                      })()}
                    </div>
                  </div>

                  {/* Settlement status chips — who has paid / is waiting / still owes */}
                  {e.settlement_statuses?.length > 0 && e.status === 'active' && (
                    <div className="flex flex-wrap gap-1.5 pt-2">
                      {e.settlement_statuses.map(ss => (
                        <span key={ss.user_id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          ss.status === 'cleared'
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25'
                            : ss.status === 'pending'
                            ? 'bg-amber-500/10 text-amber-400 border-amber-500/25'
                            : 'bg-slate-700/40 text-slate-500 border-slate-600/30'
                        }`}>
                          {ss.status === 'cleared' ? '✓' : ss.status === 'pending' ? '⏳' : '·'}
                          {ss.user_id === currentUser.id ? 'You' : ss.user_name}
                          {ss.status === 'cleared' ? ' paid' : ss.status === 'pending' ? ' waiting' : ` owes £${ss.amount.toFixed(2)}`}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Actions Row */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-700/30 mt-1 relative z-10">
                    <div className="flex items-center gap-3">
                      <button onClick={() => handleToggleChat(e.id)} className="relative shrink-0 text-xs text-slate-400 hover:text-indigo-400 flex items-center gap-1.5 transition-colors font-medium">
                        <MessageSquare className="h-3.5 w-3.5" /> Chat
                        {e.last_message_at && (!viewedChats[e.id] || new Date(e.last_message_at) > new Date(viewedChats[e.id])) && (
                          <span className="absolute -top-1 -right-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-800"></span>
                        )}
                      </button>
                      {e.receipt_image && (
                        <button onClick={() => setReceiptViewUrl(e.receipt_image)}
                          className="text-xs text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition-colors font-medium">
                          📷 Receipt
                        </button>
                      )}
                    </div>
                    {e.last_message_text && (!viewedChats[e.id] || new Date(e.last_message_at) > new Date(viewedChats[e.id])) && (
                      <div className="flex-1 text-right truncate pl-4">
                        <span className="text-[11px] text-indigo-300/80 italic pr-2">"{e.last_message_text}"</span>
                      </div>
                    )}
                    {e.created_by_id === currentUser.id && !isDeleted && e.status !== 'pending_deletion' && e.status !== 'approved_for_deletion' && (
                      <div className="flex items-center gap-4">
                        <button onClick={() => onEditExpense && onEditExpense(e)} className="text-xs text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition-colors font-medium"><Edit2 className="h-3.5 w-3.5" /> Edit</button>
                        <button onClick={() => onDeleteExpense && onDeleteExpense(e.id)} className="text-xs text-slate-400 hover:text-rose-400 flex items-center gap-1 transition-colors font-medium"><Trash2 className="h-3.5 w-3.5" /> Delete</button>
                      </div>
                    )}
                  </div>

                  {expandedChatId === e.id && (
                    <ExpenseChat
                      expenseId={e.id}
                      currentUser={currentUser}
                      expenseUsers={allUsers}
                      refreshKey={chatRefreshKey}
                    />
                  )}
                </motion.div>
              )
            })}
          </div>
        </div>
      ))}
    </div>

    {/* Receipt lightbox */}
    {receiptViewUrl && (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
        onClick={() => setReceiptViewUrl(null)}>
        <div className="relative max-w-lg w-full max-h-[90vh] flex flex-col items-center" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between w-full mb-2 px-1">
            <span className="text-xs text-slate-400">Receipt</span>
            <div className="flex items-center gap-3">
              <a href={receiptViewUrl} download="receipt.jpg"
                className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                Download
              </a>
              <button onClick={() => setReceiptViewUrl(null)} className="text-slate-400 hover:text-white transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <img src={receiptViewUrl} alt="Receipt" className="w-full max-h-[80vh] object-contain rounded-xl shadow-2xl" />
        </div>
      </div>
    )}
    </>
  )
}

// ── Insights Tab ─────────────────────────────────────────────────────────────
function InsightsTab({ expenses, members, group }) {
  const active = expenses.filter(e => e.status === 'active' || e.status === 'pending_deletion' || e.status === 'approved_for_deletion')

  // Category breakdown
  const catTotals = {}
  active.forEach(e => {
    const cat = e.category || guessCategory(e.description)
    catTotals[cat] = (catTotals[cat] || 0) + parseFloat(e.amount)
  })
  const catEntries = Object.entries(catTotals).sort((a, b) => b[1] - a[1])
  const maxCat = catEntries[0]?.[1] || 1
  const totalSpent = active.reduce((s, e) => s + parseFloat(e.amount), 0)

  // Monthly spending (last 6 months)
  const now = new Date()
  const monthlyData = Array.from({ length: 6 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const label = d.toLocaleDateString([], { month: 'short' })
    const total = active.filter(e => {
      if (!e.date) return false
      const ed = new Date(e.date)
      return ed.getMonth() === d.getMonth() && ed.getFullYear() === d.getFullYear()
    }).reduce((s, e) => s + parseFloat(e.amount), 0)
    return { label, total }
  })
  const maxMonth = Math.max(...monthlyData.map(m => m.total), 1)

  // Per-person spending
  const memberSpend = {}
  members.forEach(m => { memberSpend[m.id] = { name: m.name, paid: 0, share: 0 } })
  active.forEach(e => {
    if (memberSpend[e.payer_id]) memberSpend[e.payer_id].paid += parseFloat(e.amount)
    e.splits.forEach(s => { if (memberSpend[s.user_id]) memberSpend[s.user_id].share += parseFloat(s.amount) })
  })

  if (active.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <BarChart2 className="h-10 w-10 text-slate-600 mb-3" />
        <p className="text-slate-400 font-medium">No data yet</p>
        <p className="text-slate-500 text-sm mt-1">Add some expenses to see spending insights</p>
      </div>
    )
  }

  return (
    <div className="space-y-5 pb-20">
      {/* Total + CSV export */}
      <div className="flex items-center justify-between mt-2">
        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wider">Total Group Spend</p>
          <p className="text-2xl font-bold text-white">£{totalSpent.toFixed(2)}</p>
          <p className="text-xs text-slate-500">{active.length} expense{active.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => exportGroupToCSV(expenses, group.name, members)}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl text-sm text-slate-300 transition-colors">
          <Download className="h-4 w-4" /> Export CSV
        </button>
      </div>

      {/* Monthly spending chart */}
      <div className="bg-slate-800/50 border border-slate-700/40 rounded-2xl p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Monthly Spending</p>
        <div className="flex items-end gap-1.5 h-24">
          {monthlyData.map(({ label, total }) => (
            <div key={label} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-t-md bg-indigo-500/30 border border-indigo-500/40 transition-all"
                style={{ height: `${Math.max((total / maxMonth) * 80, total > 0 ? 6 : 0)}px` }} />
              <span className="text-[10px] text-slate-500">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Category breakdown */}
      <div className="bg-slate-800/50 border border-slate-700/40 rounded-2xl p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">By Category</p>
        <div className="space-y-2.5">
          {catEntries.map(([cat, total]) => {
            const meta = categoryMeta[cat] || { icon: '📦', label: cat, color: 'bg-slate-500/20 border-slate-500/40 text-slate-300' }
            const pct = (total / totalSpent) * 100
            return (
              <div key={cat}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-slate-300 flex items-center gap-1.5">
                    <span>{meta.icon}</span>{meta.label}
                  </span>
                  <span className="text-sm font-semibold text-slate-200">£{total.toFixed(2)}
                    <span className="text-xs text-slate-500 font-normal ml-1">({pct.toFixed(0)}%)</span>
                  </span>
                </div>
                <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${(total / maxCat) * 100}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Per-person spending */}
      <div className="bg-slate-800/50 border border-slate-700/40 rounded-2xl p-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Who Spent What</p>
        <div className="space-y-2">
          {Object.values(memberSpend).filter(m => m.paid > 0 || m.share > 0).sort((a, b) => b.paid - a.paid).map((m, i) => (
            <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-700/30 last:border-0">
              <span className="text-sm text-slate-300">{m.name}</span>
              <div className="text-right">
                <p className="text-sm font-semibold text-emerald-400">paid £{m.paid.toFixed(2)}</p>
                <p className="text-xs text-slate-500">owes £{m.share.toFixed(2)}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Balance List ──────────────────────────────────────────────────────────────
function simplifyDebts(balances) {
  const net = {}
  const names = {}
  balances.forEach(b => {
    net[b.from_user_id] = (net[b.from_user_id] || 0) - b.amount
    net[b.to_user_id]   = (net[b.to_user_id]   || 0) + b.amount
    names[b.from_user_id] = b.from_user_name
    names[b.to_user_id]   = b.to_user_name
  })
  const creditors = Object.entries(net).filter(([,v]) => v >  0.005).map(([id,v]) => [+id, v]).sort((a,b) => b[1]-a[1])
  const debtors   = Object.entries(net).filter(([,v]) => v < -0.005).map(([id,v]) => [+id,-v]).sort((a,b) => b[1]-a[1])
  const result = []
  let i = 0, j = 0
  while (i < creditors.length && j < debtors.length) {
    const settle = Math.min(creditors[i][1], debtors[j][1])
    result.push({ from_user_id: debtors[j][0], from_user_name: names[debtors[j][0]], to_user_id: creditors[i][0], to_user_name: names[creditors[i][0]], amount: Math.round(settle * 100) / 100 })
    creditors[i][1] -= settle
    debtors[j][1]   -= settle
    if (creditors[i][1] < 0.005) i++
    if (debtors[j][1]   < 0.005) j++
  }
  return result
}

function BalanceRow({ b, currentUser, index }) {
  const isMe = b.from_user_id === currentUser.id || b.to_user_id === currentUser.id
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.05 }}
      className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all ${isMe ? 'bg-slate-800 border-slate-600' : 'bg-slate-800/40 border-slate-700/30'}`}>
      <div className={`h-9 w-9 rounded-full bg-gradient-to-br ${avatarColor(b.from_user_id)} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
        {b.from_user_name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-200">
          <span className="font-semibold">{b.from_user_id === currentUser.id ? 'You' : b.from_user_name}</span>
          <span className="text-slate-400"> owe </span>
          <span className="font-semibold">{b.to_user_id === currentUser.id ? 'you' : b.to_user_name}</span>
        </p>
      </div>
      <span className={`text-sm font-bold shrink-0 ${b.from_user_id === currentUser.id ? 'text-rose-400' : b.to_user_id === currentUser.id ? 'text-emerald-400' : 'text-slate-300'}`}>
        £{b.amount.toFixed(2)}
      </span>
    </motion.div>
  )
}

function BalanceList({ balances, currentUser, members }) {
  const [simplified, setSimplified] = useState(false)

  if (balances.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 mt-2">
        <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-40 text-emerald-500" />
        <p className="font-medium text-emerald-400">All settled up!</p>
        <p className="text-sm mt-1 text-slate-500">No outstanding balances in this group</p>
      </div>
    )
  }

  const displayed = simplified ? simplifyDebts(balances) : balances

  return (
    <div className="mt-2">
      {/* Simplify toggle */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-slate-500">{displayed.length} transaction{displayed.length !== 1 ? 's' : ''} {simplified ? '(simplified)' : ''}</p>
        <button onClick={() => setSimplified(s => !s)}
          className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border transition-all ${simplified ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200'}`}>
          <Zap className="h-3 w-3" />
          {simplified ? 'Simplified' : 'Simplify Debts'}
        </button>
      </div>
      {simplified && balances.length > displayed.length && (
        <p className="text-xs text-indigo-400/70 mb-2 text-center">
          Reduced from {balances.length} to {displayed.length} transaction{displayed.length !== 1 ? 's' : ''} — saving {balances.length - displayed.length} payment{balances.length - displayed.length !== 1 ? 's' : ''}
        </p>
      )}
      <div className="space-y-2">
        {displayed.map((b, i) => <BalanceRow key={i} b={b} currentUser={currentUser} index={i} />)}
      </div>
    </div>
  )
}

// ── Activity Tab ──────────────────────────────────────────────────────────────
function ActivityTab({ currentUser, groups }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    Promise.all(groups.map(g => fetchGroupExpenses(g.id)))
      .then(results => {
        const all = results.flat().sort((a, b) => new Date(b.date) - new Date(a.date))
        setExpenses(all)
        setLoading(false)
      })
  }, [groups])

  return (
    <div className="pt-6 space-y-2">
      <h2 className="text-xl font-bold text-white mb-4">Recent Activity</h2>
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="animate-spin h-7 w-7 text-indigo-500" /></div>
      ) : (
        <ExpenseList expenses={expenses} currentUser={currentUser} />
      )}
    </div>
  )
}

// ── People Tab ────────────────────────────────────────────────────────────────
// ── Settlement history section for a person ───────────────────────────────────
function SettleHistory({ txns, currentUser, otherName }) {
  const [showAll, setShowAll] = useState(false)
  const PREVIEW = 3
  const visible = showAll ? txns : txns.slice(0, PREVIEW)

  return (
    <div className="border-t border-slate-700/40 px-4 py-2 space-y-1.5">
      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Settle-up history</p>
      {visible.map(s => {
        const iSent = s.payer_id === currentUser.id
        const statusColor = s.status === 'approved' ? 'text-emerald-400' : s.status === 'pending' ? 'text-amber-400' : 'text-rose-400'
        const statusLabel = s.status === 'approved' ? 'Paid' : s.status === 'pending' ? 'Pending' : 'Rejected'
        const now = Date.now()
        const diffMin = Math.floor((now - new Date(s.created_at).getTime()) / 60000)
        const rel = diffMin < 1 ? 'just now' : diffMin < 60 ? `${diffMin}m ago` : diffMin < 1440 ? `${Math.floor(diffMin/60)}h ago` : new Date(s.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'2-digit' })
        return (
          <div key={s.id} className="flex items-center gap-2">
            <span className={`shrink-0 text-[10px] font-bold w-12 ${statusColor}`}>{statusLabel}</span>
            <span className="text-slate-400 text-xs flex-1 truncate">
              {iSent ? `You → ${otherName}` : `${otherName} → You`}
            </span>
            <span className="text-xs font-semibold text-slate-200 shrink-0">£{s.amount.toFixed(2)}</span>
            <span className="text-slate-600 text-[10px] shrink-0 w-14 text-right">{rel}</span>
          </div>
        )
      })}
      {txns.length > PREVIEW && (
        <button onClick={() => setShowAll(v => !v)} className="text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors mt-0.5">
          {showAll ? 'Show less' : `Show ${txns.length - PREVIEW} more…`}
        </button>
      )}
    </div>
  )
}

// ── Settlement approval card with lazy-loaded expense breakdown ───────────────
function SettlementApprovalCard({ s, onApprove, onReject }) {
  const [breakdown, setBreakdown] = useState(null)
  const [expanded, setExpanded] = useState(false)

  const load = () => {
    if (breakdown) { setExpanded(v => !v); return }
    fetchSettlementBreakdown(s.id).then(d => { setBreakdown(d); setExpanded(true) })
  }

  return (
    <div className="mx-3 mb-2 bg-emerald-500/10 border border-emerald-500/20 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-bold text-emerald-400">{s.payer_name} wants to pay you £{s.amount.toFixed(2)}</p>
          <button onClick={load} className="text-[10px] text-slate-400 hover:text-indigo-400 transition-colors flex items-center gap-1 mt-0.5">
            {new Date(s.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}
            {s.group_id && ' · '}
            <span className="underline underline-offset-2">{expanded ? 'Hide breakdown' : 'View expenses →'}</span>
          </button>
        </div>
        <button onClick={() => onApprove(s.id, s.payer_name, s.amount)}
          className="shrink-0 px-2.5 py-1 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1">
          <Check className="h-3 w-3" /> Accept
        </button>
        <button onClick={() => onReject(s.id, s.payer_name, s.amount)}
          className="shrink-0 px-2.5 py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold rounded-lg transition-colors flex items-center gap-1">
          <X className="h-3 w-3" /> Reject
        </button>
      </div>

      <AnimatePresence>
        {expanded && breakdown && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-emerald-500/20 bg-slate-900/40">
            {breakdown.length === 0 ? (
              <p className="text-[10px] text-slate-500 px-3 py-2">No active expenses found for this settlement.</p>
            ) : (
              <div className="px-3 py-2 space-y-1.5">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Expenses covered</p>
                {breakdown.map(b => (
                  <div key={b.expense_id} className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-slate-200 truncate">{b.description}</p>
                      <p className="text-[10px] text-slate-500">{new Date(b.date).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })} · Total £{b.total_amount.toFixed(2)}</p>
                    </div>
                    <span className="shrink-0 text-xs font-bold text-emerald-400">Your share £{b.your_share.toFixed(2)}</span>
                  </div>
                ))}
                <div className="border-t border-slate-700/50 pt-1.5 flex justify-between">
                  <span className="text-[10px] font-bold text-slate-400">Total settling</span>
                  <span className="text-xs font-bold text-emerald-400">£{breakdown.reduce((s,b) => s+b.your_share,0).toFixed(2)}</span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function PeopleTab({ users, currentUser, groups = [], globalBalances = [], initiatedSettlements = [], pendingSettlements = [], allSettlements = [], onSettle }) {
  const [selectedBalance, setSelectedBalance] = useState(null)
  const [actionMsg, setActionMsg] = useState(null)
  const [search, setSearch] = useState('')
  const [showCleared, setShowCleared] = useState(false)

  const showMsg = (text, type = 'success') => {
    setActionMsg({ text, type })
    setTimeout(() => setActionMsg(null), 3000)
  }

  const baseUsers = (currentUser?.is_admin ? users : users.filter(u => {
    if (u.id === currentUser.id) return false
    return groups.some(g => g.members?.some(m => m.id === u.id))
  })).filter(u => u.id !== currentUser.id)

  // Enrich each user with balance + pending info so we can sort
  const enriched = baseUsers.map(u => {
    const balObj = globalBalances.find(b => b.other_user_id === u.id)
    const netBalance = balObj ? balObj.net_balance : 0
    const myPending = initiatedSettlements.filter(s => s.payee_id === u.id && s.status === 'pending')
    const myPendingTotal = myPending.reduce((sum, s) => sum + s.amount, 0)
    const hasPending = myPending.length > 0
    const theirPending = pendingSettlements.filter(s => s.payer_id === u.id)
    const txns = allSettlements
      .filter(s => (s.payer_id === u.id || s.payee_id === u.id) && s.expense_id == null)
    const sharedGroups = groups.filter(g => g.members?.some(m => m.id === u.id))
    const isCleared = netBalance === 0 && !theirPending.length && !hasPending
    return { u, balObj, netBalance, myPending, myPendingTotal, hasPending, theirPending, txns, sharedGroups, isCleared }
  })

  // Sort: incoming pending first → outgoing pending → owes you → you owe → cleared
  const priority = ({ theirPending, hasPending, isCleared, netBalance }) => {
    if (theirPending.length) return 0
    if (hasPending) return 1
    if (!isCleared && netBalance > 0) return 2
    if (!isCleared && netBalance < 0) return 3
    return 4
  }
  const filtered = enriched
    .filter(e => !search || e.u.name.toLowerCase().includes(search.toLowerCase()) || e.u.email.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      const pd = priority(a) - priority(b)
      if (pd !== 0) return pd
      return Math.abs(b.netBalance) - Math.abs(a.netBalance)
    })

  const activeItems = filtered.filter(e => !e.isCleared)
  const clearedItems = filtered.filter(e => e.isCleared)

  // Summary totals
  const totalOwedToMe = globalBalances.filter(b => b.net_balance > 0).reduce((s, b) => s + b.net_balance, 0)
  const totalIOwe = globalBalances.filter(b => b.net_balance < 0).reduce((s, b) => s + Math.abs(b.net_balance), 0)
  const incomingCount = pendingSettlements.length

  const handleSettleGlobal = async (balanceObj) => {
    try {
      for (const gb of balanceObj.group_balances) {
        if (gb.amount < 0) {
          await createSettlement({
            payer_id: currentUser.id,
            payee_id: balanceObj.other_user_id,
            amount: Math.abs(gb.amount),
            group_id: gb.group_id,
          })
        }
      }
      setSelectedBalance(null)
      showMsg('Settlement request sent. Waiting for approval.')
      if (onSettle) onSettle()
    } catch (e) {
      showMsg(e.message || "Failed to send settlement request.", 'error')
    }
  }

  const handleApprove = async (id, payerName, amount) => {
    try {
      await approveSettlement(id)
      showMsg(`Payment of £${amount.toFixed(2)} from ${payerName} approved!`)
      if (onSettle) onSettle()
    } catch (e) {
      showMsg(e.message || "Failed to approve.", 'error')
    }
  }
  const handleReject = async (id, payerName, amount) => {
    try {
      await rejectSettlement(id)
      showMsg(`Payment of £${amount.toFixed(2)} from ${payerName} rejected.`, 'error')
      if (onSettle) onSettle()
    } catch (e) {
      showMsg(e.message || "Failed to reject.", 'error')
    }
  }

  const renderCard = ({ u, balObj, netBalance, myPendingTotal, hasPending, theirPending, txns, sharedGroups, isCleared }, i) => (
    <motion.div key={u.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.035 }}
      className="bg-slate-800/40 border border-slate-700/30 rounded-2xl overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
          {u.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-100 truncate">{u.name}</p>
          {sharedGroups.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5">
              {sharedGroups.slice(0, 3).map(g => (
                <span key={g.id} className="text-[10px] bg-slate-700/50 text-slate-400 px-1.5 py-0.5 rounded-full">{g.name}</span>
              ))}
              {sharedGroups.length > 3 && <span className="text-[10px] text-slate-500">+{sharedGroups.length - 3}</span>}
            </div>
          )}
        </div>
        <button
          onClick={() => !isCleared && !hasPending && setSelectedBalance(balObj)}
          className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold tracking-wide transition-colors ${
            isCleared ? 'bg-slate-700/40 text-slate-500 cursor-default' :
            hasPending ? 'bg-amber-500/10 text-amber-400 cursor-default border border-amber-500/20' :
            theirPending.length ? 'bg-indigo-500/10 text-indigo-400 cursor-default border border-indigo-500/20' :
            netBalance > 0 ? 'bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 cursor-pointer' :
            'bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 cursor-pointer'
          }`}
        >
          {isCleared ? 'Settled' :
            hasPending ? `Pending £${myPendingTotal.toFixed(2)}` :
            theirPending.length ? `Needs approval` :
            netBalance > 0 ? `Owes you £${netBalance.toFixed(2)}` :
            `You owe £${Math.abs(netBalance).toFixed(2)}`}
        </button>
      </div>

      {/* Incoming pending: expandable approval cards with expense breakdown */}
      {theirPending.map(s => (
        <SettlementApprovalCard key={s.id} s={s} onApprove={handleApprove} onReject={handleReject} />
      ))}

      {/* Settlement transaction history — all records, collapsed if > 3 */}
      {txns.length > 0 && <SettleHistory txns={txns} currentUser={currentUser} otherName={u.name} />}
    </motion.div>
  )

  return (
    <div className="pt-6 space-y-3">
      {/* Header + summary */}
      <div className="flex items-center justify-between mb-1">
        <h2 className="text-xl font-bold text-white">People</h2>
        {incomingCount > 0 && (
          <span className="text-xs font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full">
            {incomingCount} awaiting approval
          </span>
        )}
      </div>

      {/* Summary cards */}
      {(totalOwedToMe > 0 || totalIOwe > 0) && (
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-bold text-emerald-500/70 uppercase tracking-wider">You're owed</p>
            <p className="text-lg font-bold text-emerald-400">£{totalOwedToMe.toFixed(2)}</p>
          </div>
          <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl px-3 py-2.5">
            <p className="text-[10px] font-bold text-orange-500/70 uppercase tracking-wider">You owe</p>
            <p className="text-lg font-bold text-orange-400">£{totalIOwe.toFixed(2)}</p>
          </div>
        </div>
      )}

      {/* Search */}
      {baseUsers.length > 3 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search people…"
            className="w-full bg-slate-800/60 border border-slate-700/40 rounded-xl pl-8 pr-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500" />
        </div>
      )}

      {/* Action feedback toast */}
      <AnimatePresence>
        {actionMsg && (
          <motion.div key="action-toast" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium ${
              actionMsg.type === 'error'
                ? 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            }`}>
            {actionMsg.type === 'error' ? <X className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
            {actionMsg.text}
          </motion.div>
        )}
      </AnimatePresence>

      {baseUsers.length === 0 && (
        <div className="text-center py-12 border border-dashed border-slate-700 rounded-2xl">
          <Users className="h-8 w-8 mx-auto mb-2 text-slate-600" />
          <p className="text-slate-500 text-sm font-medium">No people yet</p>
          <p className="text-xs text-slate-600 mt-0.5">Join a group to see people here</p>
        </div>
      )}

      {/* Active balances */}
      {activeItems.map((e, i) => renderCard(e, i))}

      {/* Cleared / settled section */}
      {clearedItems.length > 0 && (
        <div className="pt-1">
          <button onClick={() => setShowCleared(v => !v)}
            className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300 transition-colors w-full py-1">
            <div className="flex-1 h-px bg-slate-700/50" />
            <span>{showCleared ? 'Hide' : 'Show'} {clearedItems.length} settled</span>
            <ChevronRight className={`h-3 w-3 transition-transform ${showCleared ? 'rotate-90' : ''}`} />
            <div className="flex-1 h-px bg-slate-700/50" />
          </button>
          <AnimatePresence>
            {showCleared && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                className="space-y-2 mt-2 overflow-hidden">
                {clearedItems.map((e, i) => renderCard(e, i))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {selectedBalance && (
          <BalanceBreakdownModal
            balanceObj={selectedBalance}
            onClose={() => setSelectedBalance(null)}
            onSettleGlobal={handleSettleGlobal}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ── Balance Breakdown Modal ───────────────────────────────────────────────────
function BalanceBreakdownModal({ balanceObj, onClose, onSettleGlobal }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-sm bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-800/30">
          <h2 className="text-lg font-bold text-white">Balance with {balanceObj.other_user_name}</h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto custom-scrollbar">
          <div className="flex flex-col items-center justify-center p-4 mb-6 bg-slate-800/50 rounded-2xl border border-slate-700/50">
            <p className="text-sm text-slate-400 mb-1">Total Net Balance</p>
            <p className={`text-2xl font-bold ${balanceObj.net_balance > 0 ? 'text-emerald-400' : 'text-orange-400'}`}>
              {balanceObj.net_balance > 0 ? 'Owes you' : 'You owe'} £{Math.abs(balanceObj.net_balance).toFixed(2)}
            </p>
          </div>
          
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-wider mb-3 px-1">Group Breakdown</h3>
          <div className="space-y-2">
            {balanceObj.group_balances.map(gb => (
              <div key={gb.group_id} className="flex items-center justify-between p-3 bg-slate-800 rounded-xl border border-slate-700/50">
                <span className="text-sm font-medium text-slate-200">{gb.group_name}</span>
                <span className={`text-sm font-bold ${gb.amount > 0 ? 'text-emerald-400' : gb.amount < 0 ? 'text-orange-400' : 'text-slate-400'}`}>
                  {gb.amount > 0 ? '+' : ''}{gb.amount.toFixed(2)}
                </span>
              </div>
            ))}
          </div>

          {balanceObj.net_balance < 0 && (
            <button 
              onClick={() => onSettleGlobal(balanceObj)}
              className="w-full mt-6 py-3 bg-gradient-to-r from-orange-500 to-rose-500 text-white font-bold rounded-xl shadow-lg shadow-orange-500/20 hover:shadow-orange-500/40 transition-all hover:-translate-y-0.5 active:translate-y-0"
            >
              Settle All
            </button>
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Pending Settlements Modal ────────────────────────────────────────────────
function PendingSettlementsModal({ settlements, onClose, onUpdate }) {
  const handleApprove = async (id) => {
    try {
      await approveSettlement(id)
      onUpdate()
    } catch (e) { alert("Failed to approve.") }
  }
  const handleReject = async (id) => {
    try {
      await rejectSettlement(id)
      onUpdate()
    } catch (e) { alert("Failed to reject.") }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-md bg-slate-900 border border-slate-700 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        <div className="p-5 border-b border-slate-800 flex justify-between items-center bg-slate-800/30">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" /> Pending Approvals
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-full transition-colors">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5 overflow-y-auto custom-scrollbar space-y-3">
          {settlements.length === 0 ? (
            <p className="text-center text-slate-500 py-8">No pending approvals.</p>
          ) : (
            settlements.map(s => (
              <div key={s.id} className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700">
                <p className="text-sm text-slate-300">
                  <strong className="text-white">{s.payer_name}</strong> marked their share as paid
                </p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">£{s.amount.toFixed(2)}</p>
                <p className="text-xs text-slate-500 mt-0.5">Approve to confirm you received this payment</p>
                <div className="flex gap-2 mt-4">
                  <button onClick={() => handleApprove(s.id)} className="cursor-pointer flex-1 py-2.5 bg-emerald-500 text-white text-sm font-bold rounded-xl hover:bg-emerald-400 active:scale-95 transition-all shadow-lg shadow-emerald-500/20">
                    ✓ Approve
                  </button>
                  <button onClick={() => handleReject(s.id)} className="cursor-pointer flex-1 py-2.5 bg-slate-700 text-rose-400 text-sm font-bold rounded-xl hover:bg-rose-500/20 hover:text-rose-300 active:scale-95 transition-all border border-slate-600">
                    Reject
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </motion.div>
    </div>
  )
}

// ── Receipt OCR helpers ────────────────────────────────────────────────────────
function parseReceiptText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // ── Amount ──────────────────────────────────────────────────────────────────
  let amount = null
  const totalRx = /(?:grand\s+)?total[:\s£$]*[\s]*([\d,]+\.?\d*)|amount\s+(?:due|paid|to\s+pay)[:\s£$]*([\d,]+\.?\d*)/i
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(totalRx)
    if (m) { const v = parseFloat((m[1] || m[2]).replace(',', '')); if (v > 0 && v < 10000) { amount = v.toFixed(2); break } }
  }
  if (!amount) {
    let max = 0
    text.match(/[£$]([\d,]+\.\d{2})/g)?.forEach(m => { const v = parseFloat(m.replace(/[£$,]/g, '')); if (v > max && v < 10000) max = v })
    if (max > 0) amount = max.toFixed(2)
  }

  // ── Store name — score-based so the merchant name beats addresses/phone lines ─
  function storeScore(l) {
    if (!l || l.length < 3 || l.length > 55) return -1
    if (/^\d+$/.test(l)) return -1                                         // pure numbers
    if (/\d{1,2}[\/\-:]\d{1,2}[\/\-:]\d{2,4}/.test(l)) return -1        // date/time
    if (/^(www\.|http)/i.test(l) || /\.(com|co\.uk|org|net)/i.test(l)) return -1  // URL
    if (/^(tel|fax|phone)[\s:]/i.test(l)) return -1                       // phone label
    if (/^(vat|reg|no\.?|#|receipt|invoice|order|staff|till|sale\s|card|auth|change|payment|expiry)/i.test(l)) return -1
    const letters = (l.match(/[a-zA-Z]/g) || []).length
    const digits  = (l.match(/\d/g) || []).length
    if (letters < 3) return -1
    if (digits > letters) return -1  // more digits than letters = not a name
    // Address: has digits AND a road-type word
    if (digits > 0 && /\b(road|street|ave|avenue|close|way|lane|rd|blvd|drive|gardens?|court)\b/i.test(l)) return -1
    // UK postcode anywhere in line
    if (/\b[A-Z]{1,2}\d{1,2}\s*\d[A-Z]{2}\b/i.test(l)) return -1
    let score = letters
    if (/^[A-Z][A-Z\s&'.,\-]+$/.test(l)) score += 20  // ALL CAPS = classic store header
    if (digits === 0) score += 8
    if (/&/.test(l)) score += 5                        // ampersands common in store names
    if (l.length >= 4 && l.length <= 35) score += 4
    return score
  }

  // Score all lines in the first 8; pick the highest-scoring (store name at top wins)
  let bestLine = '', bestScore = -1
  lines.slice(0, 8).forEach(l => {
    const s = storeScore(l)
    if (s > bestScore) { bestScore = s; bestLine = l }
  })

  const desc = bestScore > 0
    ? (/^[^a-z]+$/.test(bestLine)
        ? bestLine.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
        : bestLine)
    : ''

  // ── Date ────────────────────────────────────────────────────────────────────
  let date = new Date().toISOString().split('T')[0]
  const dateRx = /(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/
  for (const l of lines) {
    const m = l.match(dateRx)
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3]
      const d = new Date(`${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`)
      if (!isNaN(d)) { date = d.toISOString().split('T')[0]; break }
    }
  }

  return { amount, description: desc, date }
}

async function runReceiptOCR(file) {
  const { createWorker } = await import('tesseract.js')
  const worker = await createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7/dist/worker.min.js',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@6/tesseract-core-simd-lstm.wasm.js',
  })
  try {
    const { data: { text } } = await worker.recognize(file)
    return parseReceiptText(text)
  } finally {
    await worker.terminate()
  }
}

function compressImageToBase64(file, maxDim = 1400, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
      const canvas = document.createElement('canvas')
      canvas.width  = Math.round(img.width  * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      // WebP is ~35% smaller than JPEG at the same quality; fall back to JPEG if unsupported
      const webp = canvas.toDataURL('image/webp', quality)
      resolve(webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = url
  })
}

// ── Add Expense Modal ─────────────────────────────────────────────────────────
function AddExpenseModal({ currentUser, users, groups, defaultGroupId, initialExpense, onClose, onSuccess }) {
  const [description, setDescription] = useState(initialExpense?.description || '')
  const [amount, setAmount]           = useState(initialExpense ? initialExpense.amount.toString() : '')
  const [payerId, setPayerId]         = useState(initialExpense ? initialExpense.payer_id : currentUser.id)
  const [date, setDate]               = useState(initialExpense ? initialExpense.date.split('T')[0] : new Date().toISOString().split('T')[0])
  const [groupId, setGroupId]         = useState(initialExpense?.group_id ? String(initialExpense.group_id) : (defaultGroupId ? String(defaultGroupId) : ''))
  const [selectedUsers, setSelected]  = useState(initialExpense?.splits ? initialExpense.splits.map(s => s.user_id) : [currentUser.id])
  const [splitMode, setSplitMode]     = useState(initialExpense ? 'exact' : 'equal')
  const [splitValues, setSplitValues] = useState(() => {
    const vals = {}
    if (initialExpense?.splits) {
      initialExpense.splits.forEach(s => vals[s.user_id] = s.amount)
    }
    return vals
  })
  const [category, setCategory]       = useState(initialExpense?.category || null)
  const [categoryLocked, setCategoryLocked] = useState(!!initialExpense?.category)
  const [recurrence, setRecurrence]   = useState(initialExpense?.recurrence || null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState('')
  const [success, setSuccess]         = useState(false)
  const [scanning, setScanning]       = useState(false)
  const [scanError, setScanError]     = useState('')
  const [showScanMenu, setShowScanMenu] = useState(false)
  const [receiptImage, setReceiptImage] = useState(initialExpense?.receipt_image || null)
  const scanInputRef                  = useRef(null)
  const scanCameraRef                 = useRef(null)
  const submittingRef                 = useRef(false)
  const formRef                       = useRef(null)

  // Track visual viewport so the modal stays above the on-screen keyboard
  const [vpHeight, setVpHeight]       = useState(() => window.visualViewport?.height ?? window.innerHeight)
  const [vpTop, setVpTop]             = useState(() => window.visualViewport?.offsetTop ?? 0)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const update = () => { setVpHeight(vv.height); setVpTop(vv.offsetTop) }
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])

  // When a field is focused and the keyboard slides up, scroll it near the top of the form
  const handleFocusCapture = (e) => {
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
    setTimeout(() => {
      const form = formRef.current
      if (!form) return
      const elTop  = e.target.getBoundingClientRect().top
      const frmTop = form.getBoundingClientRect().top
      form.scrollTo({ top: form.scrollTop + (elTop - frmTop) - 16, behavior: 'smooth' })
    }, 320) // after keyboard animation
  }

  const handleScanReceipt = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setScanning(true); setScanError('')
    try {
      // Show preview immediately — don't wait for slow OCR
      const compressed = await compressImageToBase64(file)
      setReceiptImage(compressed)
      // Run OCR in background after preview is already visible
      try {
        const result = await runReceiptOCR(file)
        if (result.amount) setAmount(result.amount)
        if (result.description) setDescription(prev => prev || result.description)
        if (result.date) setDate(result.date)
        if (!result.amount) setScanError('Could not detect a total — please enter the amount manually.')
      } catch {
        setScanError('OCR failed — but your receipt photo is attached.')
      }
    } catch (err) {
      setScanError('Could not load image. Try a different photo.')
    } finally {
      setScanning(false)
      e.target.value = ''
    }
  }

  const scanMenuRef = useRef(null)

  // Close scan menu only when clicking outside the dropdown
  useEffect(() => {
    if (!showScanMenu) return
    const close = (e) => {
      if (scanMenuRef.current?.contains(e.target)) return
      setShowScanMenu(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [showScanMenu])

  // Users visible in Paid By + Split — always scoped to the selected group's members
  const displayUsers = (() => {
    if (groupId) {
      const g = groups.find(gr => gr.id === parseInt(groupId))
      if (g?.members?.length) return g.members
    }
    return users
  })()

  // When group changes, default to all group members (only if not editing)
  useEffect(() => {
    if (initialExpense && !groupId) return; // keep initial splits if no group changed explicitly
    if (groupId) {
      const g = groups.find(gr => gr.id === parseInt(groupId))
      if (g?.members && !initialExpense) setSelected(g.members.map(m => m.id))
    } else if (!initialExpense) {
      setSelected([currentUser.id])
    }
  }, [groupId])

  const toggleUser = (id) => {
    setSelected(prev => prev.includes(id) ? (prev.length > 1 ? prev.filter(u => u !== id) : prev) : [...prev, id])
  }

  const handleSplitValueChange = (uid, val) => {
    setSplitValues(prev => ({ ...prev, [uid]: val }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (submittingRef.current) return
    submittingRef.current = true
    setError('')
    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) { submittingRef.current = false; return setError('Please enter a valid amount') }
    if (!groupId) { submittingRef.current = false; return setError('Please select a group') }

    let finalSplits = []

    if (splitMode === 'equal') {
      if (selectedUsers.length === 0) return setError('Select at least one person to split with')
      const perPerson = numAmount / selectedUsers.length
      let allocated = 0
      finalSplits = selectedUsers.map((uid, idx) => {
        let a = idx === selectedUsers.length - 1 ? parseFloat((numAmount - allocated).toFixed(2)) : parseFloat(perPerson.toFixed(2))
        allocated += a
        return { user_id: uid, amount: a }
      })
    } else if (splitMode === 'exact') {
      if (selectedUsers.length === 0) return setError('Select at least one person to split with')
      let total = 0
      selectedUsers.forEach(uid => {
        const amt = parseFloat(splitValues[uid])
        if (!isNaN(amt) && amt > 0) {
          total += amt
          finalSplits.push({ user_id: uid, amount: amt })
        }
      })
      if (Math.abs(total - numAmount) > 0.01) return setError(`Amounts sum to £${total.toFixed(2)}, but expense total is £${numAmount.toFixed(2)}`)
      if (finalSplits.length === 0) return setError('Enter at least one amount')
    } else if (splitMode === 'percentage') {
      if (selectedUsers.length === 0) return setError('Select at least one person to split with')
      let totalPct = 0
      selectedUsers.forEach(uid => {
        const pct = parseFloat(splitValues[uid])
        if (!isNaN(pct) && pct > 0) {
          totalPct += pct
          finalSplits.push({ user_id: uid, amount: parseFloat(((pct / 100) * numAmount).toFixed(2)) })
        }
      })
      if (Math.abs(totalPct - 100) > 0.01) return setError(`Percentages sum to ${totalPct.toFixed(1)}% — must total 100%`)
      if (finalSplits.length === 0) return setError('Enter at least one percentage')
      // fix rounding on last item
      const allocated = finalSplits.reduce((acc, s) => acc + s.amount, 0)
      if (Math.abs(allocated - numAmount) > 0.005) {
        finalSplits[finalSplits.length - 1].amount = parseFloat((finalSplits[finalSplits.length - 1].amount + numAmount - allocated).toFixed(2))
      }
    } else if (splitMode === 'adjusted') {
      let fixedTotal = 0
      const activeIds = selectedUsers.length > 0 ? selectedUsers : displayUsers.map(u => u.id)
      
      activeIds.forEach(uid => {
        const amt = parseFloat(splitValues[uid])
        if (!isNaN(amt)) fixedTotal += amt
      })
      
      const remaining = numAmount - fixedTotal
      const remainderCount = activeIds.filter(uid => !splitValues[uid] || isNaN(parseFloat(splitValues[uid]))).length
      
      if (remainderCount === 0 && Math.abs(remaining) > 0.01) {
        return setError(`Adjustments sum to £${fixedTotal.toFixed(2)}, but total is £${numAmount.toFixed(2)} with no remainder pool.`)
      }
      
      const perPersonRemainder = remainderCount > 0 ? remaining / remainderCount : 0
      
      let allocated = 0
      finalSplits = activeIds.map((uid, idx) => {
        let a = 0
        if (splitValues[uid] && !isNaN(parseFloat(splitValues[uid]))) {
           a = parseFloat(splitValues[uid])
        } else {
           a = parseFloat(perPersonRemainder.toFixed(2))
        }
        
        // fix rounding
        if (idx === activeIds.length - 1) {
           a = parseFloat((numAmount - allocated).toFixed(2))
        }
        allocated += a
        return { user_id: uid, amount: a }
      })
      if (finalSplits.length === 0) return setError('Select at least one person')
    }

    setLoading(true)
    try {
      const payload = {
        description: description.trim(),
        amount: numAmount,
        payer_id: payerId,
        created_by_id: initialExpense ? initialExpense.created_by_id : currentUser.id,
        group_id: groupId ? parseInt(groupId) : null,
        date,
        splits: finalSplits,
        receipt_image: receiptImage || null,
        category: category || guessCategory(description.trim()) || null,
        recurrence: recurrence || null,
      }
      if (initialExpense) {
        await updateExpense(initialExpense.id, payload)
      } else {
        await createExpense(payload)
      }
      setSuccess(true)
      setTimeout(onSuccess, 900)
    } catch (err) { setError(err.message); setLoading(false); submittingRef.current = false }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      style={{ top: vpTop, height: vpHeight }}
      className="fixed inset-x-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        style={{ maxHeight: Math.min(vpHeight * 0.94, 720) }}
        className="w-full max-w-lg bg-slate-900 border border-slate-700/60 rounded-3xl shadow-2xl flex flex-col overflow-hidden">

        {success ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="h-16 w-16 bg-emerald-500/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-9 w-9 text-emerald-400" />
            </div>
            <p className="text-xl font-bold text-emerald-400">Expense {initialExpense ? 'Updated' : 'Added'}!</p>
            <p className="text-slate-400 text-sm">Successfully recorded and split.</p>
          </div>
        ) : (
          <>
            {/* Modal header */}
            <div className="shrink-0 bg-slate-900 flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
              <h3 className="font-bold text-white text-lg">{initialExpense ? 'Edit Expense' : 'Add Expense'}</h3>
              <div className="flex items-center gap-2">
                {!initialExpense && (
                  <div ref={scanMenuRef} className="relative">
                    {/* hidden inputs — one for camera, one for file picker */}
                    <input ref={scanCameraRef} type="file" accept="image/*" capture="environment"
                      className="hidden" onChange={handleScanReceipt} />
                    <input ref={scanInputRef} type="file" accept="image/*"
                      className="hidden" onChange={handleScanReceipt} />

                    <button type="button"
                      disabled={scanning}
                      onClick={() => setShowScanMenu(v => !v)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-wait">
                      {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span>📷</span>}
                      {scanning ? 'Scanning…' : 'Scan Receipt'}
                    </button>

                    {showScanMenu && !scanning && (
                      <div className="absolute right-0 top-full mt-1.5 w-44 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 overflow-hidden">
                        <button type="button"
                          onClick={() => { setShowScanMenu(false); scanCameraRef.current?.click() }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-slate-200 hover:bg-slate-700 transition-colors">
                          <span>📷</span> Open Camera
                        </button>
                        <div className="border-t border-slate-700" />
                        <button type="button"
                          onClick={() => { setShowScanMenu(false); scanInputRef.current?.click() }}
                          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-xs text-slate-200 hover:bg-slate-700 transition-colors">
                          <span>📁</span> Upload from Device
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <form ref={formRef} onFocusCapture={handleFocusCapture} onSubmit={handleSubmit}
              className="flex-1 overflow-y-auto overscroll-contain px-6 py-5 space-y-4 custom-scrollbar">

              {scanError && (
                <div className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">{scanError}</div>
              )}

              {/* Description */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">What was it for?</label>
                <input autoFocus type="text" required value={description}
                  onChange={e => {
                    setDescription(e.target.value)
                    if (!categoryLocked) setCategory(guessCategory(e.target.value))
                  }}
                  placeholder="e.g. Dinner, Netflix, Uber..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-500 text-base" />
              </div>

              {/* Category picker */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                  <Tag className="h-3 w-3" /> Category
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {EXPENSE_CATEGORIES.map(c => (
                    <button key={c.id} type="button" onClick={() => { setCategory(c.id); setCategoryLocked(true) }}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${category === c.id ? c.color : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                      {c.icon} {c.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Recurrence */}
              {!initialExpense && (
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
                    <Zap className="h-3 w-3" /> Repeat
                  </label>
                  <div className="flex gap-2">
                    {[null, 'weekly', 'monthly', 'yearly'].map(r => (
                      <button key={r ?? 'none'} type="button" onClick={() => setRecurrence(r)}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-medium transition-all ${recurrence === r ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' : 'bg-slate-800/60 border-slate-700 text-slate-400 hover:border-slate-500'}`}>
                        {r ? r.charAt(0).toUpperCase() + r.slice(1) : 'Once'}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Amount + Date */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Amount (£)</label>
                  <input type="number" step="0.01" min="0.01" required value={amount} onChange={e => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-500 text-base" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Date
                  </label>
                  <input type="date" required value={date} onChange={e => setDate(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 text-base [color-scheme:dark]" />
                </div>
              </div>

              {/* Paid By */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block flex items-center gap-1">
                  Paid By
                </label>
                <select value={payerId} onChange={e => setPayerId(parseInt(e.target.value))}
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 text-slate-100 appearance-none">
                  {displayUsers.map(u => (
                    <option key={u.id} value={u.id}>{u.id === currentUser.id ? 'You' : u.name}</option>
                  ))}
                </select>
              </div>

              {/* Group */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Group</label>
                {defaultGroupId ? (
                  /* Locked — already inside a group */
                  <div className="w-full bg-slate-800/50 border border-slate-700/50 rounded-xl px-4 py-3 text-slate-300 flex items-center gap-2">
                    <Users className="h-4 w-4 text-indigo-400 shrink-0" />
                    <span className="font-medium">{groups.find(g => g.id === parseInt(groupId))?.name || 'Group'}</span>
                    <span className="ml-auto text-[10px] text-slate-500 uppercase tracking-wider">locked</span>
                  </div>
                ) : (
                  /* Required picker */
                  <select required value={groupId} onChange={e => setGroupId(e.target.value)}
                    className={`w-full bg-slate-800 border rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 text-slate-100 appearance-none transition-colors ${!groupId ? 'border-slate-600' : 'border-slate-700'}`}>
                    <option value="" disabled>Select a group…</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                )}
              </div>

              {/* Split Options */}
              <div>
                <div className="flex justify-between items-center mb-2 block">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Split Mode</label>
                </div>
                
                <div className="flex bg-slate-900 border border-slate-700/60 rounded-xl p-1 mb-4 overflow-x-auto custom-scrollbar">
                  {['equal', 'exact', 'percentage', 'adjusted'].map(mode => (
                    <button key={mode} type="button" onClick={() => { setSplitMode(mode); setSplitValues({}) }}
                      className={`flex-1 min-w-[80px] text-xs font-semibold py-2 px-2 rounded-lg capitalize transition-all ${splitMode === mode ? 'bg-indigo-500 text-white shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'}`}>
                      {mode}
                    </button>
                  ))}
                </div>

                {/* People selector — shown for all split modes */}
                <>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                    {splitMode === 'equal' ? 'Split equally with' : 'People involved'}
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {displayUsers.map(u => {
                      const sel = selectedUsers.includes(u.id)
                      return (
                        <button key={u.id} type="button" onClick={() => toggleUser(u.id)}
                          className={`flex items-center gap-2 pl-1 pr-3 py-1.5 rounded-full border text-sm font-medium transition-all ${sel ? 'bg-indigo-500/20 border-indigo-500 text-indigo-300' : 'bg-slate-800 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                          <div className={`h-6 w-6 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-[10px] font-bold text-white`}>
                            {u.name.charAt(0)}
                          </div>
                          {u.id === currentUser.id ? 'You' : u.name}
                        </button>
                      )
                    })}
                  </div>
                  {splitMode === 'equal' && amount && selectedUsers.length > 0 && (
                    <p className="text-xs text-slate-500 mt-2">
                      £{(parseFloat(amount) / selectedUsers.length).toFixed(2)} per person across {selectedUsers.length} {selectedUsers.length === 1 ? 'person' : 'people'}
                    </p>
                  )}
                </>

                {/* Amount inputs — exact, percentage, adjusted */}
                {splitMode !== 'equal' && selectedUsers.length > 0 && (
                  <div className="space-y-2 mt-1 max-h-52 overflow-y-auto pr-2 custom-scrollbar">
                    {displayUsers.filter(u => selectedUsers.includes(u.id)).map(u => (
                      <div key={u.id} className="flex items-center justify-between gap-3 bg-slate-800/40 p-2.5 rounded-xl border border-slate-700/50 hover:border-slate-600/50 transition-colors">
                        <div className="flex items-center gap-2">
                          <div className={`h-8 w-8 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                            {u.name.charAt(0)}
                          </div>
                          <p className="text-sm font-medium text-slate-200">{u.id === currentUser.id ? 'You' : u.name}</p>
                        </div>
                        <div className="relative w-24">
                          {splitMode !== 'percentage' && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">£</span>}
                          <input type="number" step="0.01" min={splitMode === 'adjusted' ? undefined : '0'}
                            value={splitValues[u.id] || ''}
                            onChange={e => handleSplitValueChange(u.id, e.target.value)}
                            className={`w-full bg-slate-900/80 border border-slate-600 rounded-lg py-1.5 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 text-slate-100 placeholder-slate-600 text-sm font-medium transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${splitMode === 'percentage' ? 'text-right pr-6 pl-3' : 'text-left pl-7 pr-3'}`}
                            placeholder={splitMode === 'adjusted' ? 'Auto' : '0.00'}
                          />
                          {splitMode === 'percentage' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">%</span>}
                        </div>
                      </div>
                    ))}
                    {/* Running total */}
                    {(() => {
                      const entered = selectedUsers.reduce((s, uid) => s + (parseFloat(splitValues[uid]) || 0), 0)
                      const target = splitMode === 'percentage' ? 100 : parseFloat(amount) || 0
                      const remaining = target - entered
                      const ok = Math.abs(remaining) < 0.015
                      return (
                        <div className="pt-2 text-xs font-medium flex justify-between px-1">
                          <span className="text-slate-500 uppercase tracking-wider">
                            {splitMode === 'adjusted' ? 'Fixed pool:' : splitMode === 'percentage' ? 'Total %:' : 'Total:'}
                          </span>
                          <span className={ok ? 'text-emerald-400 font-semibold' : 'text-amber-400 font-semibold'}>
                            {splitMode === 'percentage'
                              ? `${entered.toFixed(1)}% / 100%`
                              : `£${entered.toFixed(2)} / £${(parseFloat(amount) || 0).toFixed(2)}`}
                            {!ok && splitMode !== 'adjusted' && (
                              <span className="ml-1 text-slate-500">({remaining > 0 ? '+' : ''}£{remaining.toFixed(2)} left)</span>
                            )}
                          </span>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>

              {error && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </motion.p>
              )}

              {/* Receipt image thumbnail */}
              {receiptImage && (
                <div className="relative rounded-xl overflow-hidden border border-slate-700/60">
                  <img src={receiptImage} alt="Receipt" className="w-full max-h-40 object-cover object-top" />
                  <button type="button" onClick={() => setReceiptImage(null)}
                    className="absolute top-2 right-2 p-1 bg-black/60 rounded-full text-white hover:bg-black/80 transition-colors">
                    <X className="h-3.5 w-3.5" />
                  </button>
                  <span className="absolute bottom-2 left-2 text-[10px] bg-black/60 text-slate-300 px-2 py-0.5 rounded-full">Receipt attached</span>
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white font-semibold py-3.5 rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex justify-center items-center text-base h-[52px]">
                {loading ? <Loader2 className="animate-spin h-5 w-5" /> : (initialExpense ? 'Save Changes' : 'Record Expense')}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

// ── Change Password Form ──────────────────────────────────────────────────────
function ChangePasswordForm({ userId }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (next !== confirm) { setError('Passwords do not match'); return }
    if (next.length < 6) { setError('New password must be at least 6 characters'); return }
    setLoading(true); setError(''); setSuccess('')
    try {
      await changePassword(userId, current, next)
      setSuccess('Password changed successfully')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <input type="password" value={current} onChange={e => setCurrent(e.target.value)} required
        className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500"
        placeholder="Current password" />
      <input type="password" value={next} onChange={e => setNext(e.target.value)} required
        className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500"
        placeholder="New password" />
      <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} required
        className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500"
        placeholder="Confirm new password" />
      {error && <p className="text-red-400 text-sm">{error}</p>}
      {success && <p className="text-green-400 text-sm">{success}</p>}
      <button type="submit" disabled={loading}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold py-2.5 rounded-xl transition-all flex justify-center items-center">
        {loading ? <Loader2 className="animate-spin h-4 w-4" /> : 'Update Password'}
      </button>
    </form>
  )
}

// ── Profile Modal ─────────────────────────────────────────────────────────────
function ProfileModal({ user, onClose, onSave }) {
  const [name, setName] = useState(user.name)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const updatedUser = await updateUser(user.id, name)
      onSave(updatedUser)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.95, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }}
        className="w-full max-w-sm bg-slate-800 border border-slate-700/60 rounded-3xl shadow-2xl overflow-hidden relative">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
          <h3 className="text-lg font-bold text-white flex items-center gap-2"><Settings className="h-4 w-4 text-indigo-400" /> Edit Profile</h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex justify-center mb-4">
            <div className={`h-20 w-20 rounded-full bg-gradient-to-br ${avatarColor(user.id)} flex items-center justify-center text-3xl font-bold text-white shadow-lg`}>
              {name.charAt(0).toUpperCase()}
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Display Name</label>
            <input type="text" required value={name} onChange={e => setName(e.target.value)}
              className="w-full bg-slate-900/60 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500" />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Email (Cannot be changed)</label>
            <input type="email" disabled value={user.email}
              className="w-full bg-slate-900/30 border border-slate-700/50 rounded-xl px-4 py-3 text-slate-500 cursor-not-allowed" />
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button type="submit" disabled={loading || !name.trim()}
            className="w-full mt-4 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-indigo-500/20 flex justify-center items-center">
            {loading ? <Loader2 className="animate-spin h-5 w-5" /> : 'Save Changes'}
          </button>
        </form>

        {/* Change Password */}
        <div className="px-6 pb-6 mt-6 pt-6 border-t border-slate-700/50">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3">Change Password</h3>
          <ChangePasswordForm userId={user.id} />
        </div>
      </motion.div>
    </motion.div>
  )
}

