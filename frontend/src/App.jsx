import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Wallet, Users, LayoutGrid, LogOut, Loader2, CheckCircle2,
  Plus, ArrowLeft, UserPlus, ChevronRight, Receipt, TrendingDown,
  TrendingUp, X, Calendar, Home, Activity, Send, Mail, Phone, Search,
  Edit2, Trash2, Settings, MessageSquare, Bell
} from 'lucide-react'
import {
  fetchUsers, fetchUserGroups, fetchGroupExpenses, fetchGroupBalances,
  registerUser, loginUser, createGroup, addGroupMember, createExpense, sendInvite,
  updateUser, updateExpense, deleteExpense, approveExpenseDeletion, rejectExpenseDeletion,
  markExpenseViewed, deleteExpenseMessage, fetchNotifications, markNotificationRead,
  fetchAdminUsers, deleteAdminUser, deleteAdminGroup, getWsUrl, toggleAdminStatus, adminCreateUser
} from './api'

// ── Utilities ────────────────────────────────────────────────────────────────

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function formatDate(isoString) {
  if (!isoString) return { month: '—', day: '—' }
  const d = new Date(isoString)
  return { month: MONTH_SHORT[d.getMonth()], day: String(d.getDate()) }
}

function todayISO() {
  return new Date().toISOString().split('T')[0]
}

const categoryIcons = {
  food: '🍽️', drink: '🍺', grocery: '🛒', transport: '🚗',
  entertainment: '🎮', bill: '💡', hotel: '🏨', flight: '✈️',
  default: '💳'
}

function guessCategory(description) {
  const d = description.toLowerCase()
  if (/smoke|pepper|mutton|biryani|restaurant|dinner|lunch|breakfast|food|curry/.test(d)) return 'food'
  if (/bar|pub|beer|drink|alcohol|wine/.test(d)) return 'drink'
  if (/lidl|tesco|sainsbury|aldi|grocery|supermarket/.test(d)) return 'grocery'
  if (/uber|taxi|bus|train|tube|transport|car|scooter/.test(d)) return 'transport'
  if (/netflix|game|bowling|cinema|movie|game/.test(d)) return 'entertainment'
  if (/electric|gas|water|broadband|wifi|bill|rent|key/.test(d)) return 'bill'
  if (/hotel|airbnb|hostel/.test(d)) return 'hotel'
  if (/flight|airport|plane/.test(d)) return 'flight'
  return 'default'
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

// ── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null)

  useEffect(() => {
    const saved = localStorage.getItem('splitclone_user')
    if (!saved) return
    const parsed = JSON.parse(saved)
    // Always re-fetch from server so is_admin and other fields are fresh
    fetch(`http://${window.location.hostname}:8000/users/?current_user_id=${parsed.id}`)
      .then(r => r.json())
      .then(users => {
        const freshUser = Array.isArray(users) && users.find(u => u.id === parsed.id && u.email === parsed.email)
        if (freshUser) {
          localStorage.setItem('splitclone_user', JSON.stringify(freshUser))
          setUser(freshUser)
        } else {
          localStorage.removeItem('splitclone_user')
        }
      })
      .catch(() => setUser(parsed))
  }, [])

  const handleLogin  = (u) => { setUser(u); localStorage.setItem('splitclone_user', JSON.stringify(u)) }
  const handleLogout = ()  => { setUser(null); localStorage.removeItem('splitclone_user') }

  return (
    <div className="min-h-screen bg-[#1a1a2e] text-slate-100 font-sans overflow-hidden relative">
      {/* gradient blobs */}
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-700/15 blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-purple-700/15 blur-[140px] pointer-events-none" />
      <AnimatePresence mode="wait">
        {!user
          ? <LoginScreen key="login" onLogin={handleLogin} />
          : <Dashboard   key="dash"  user={user} onLogout={handleLogout} />
        }
      </AnimatePresence>
    </div>
  )
}

// ── Login / Register ──────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true)
  const [name, setName]       = useState('')
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const u = isLogin ? await loginUser(email, password) : await registerUser(name, email, password)
      onLogin(u)
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

          <p className="mt-5 text-center text-sm text-slate-400">
            {isLogin ? "Don't have an account? " : "Already have an account? "}
            <button onClick={() => { setIsLogin(!isLogin); setError('') }} className="text-indigo-400 hover:text-indigo-300 font-medium">
              {isLogin ? 'Register' : 'Sign In'}
            </button>
          </p>

          <div className="mt-6 pt-4 border-t border-slate-700/50">
            <p className="text-xs text-slate-500 text-center mb-2">Demo accounts</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {['alice','bob','charlie','diana'].map(n => (
                <button key={n} onClick={() => { setEmail(`${n}@example.com`); setPass('password'); setIsLogin(true) }}
                  className="text-xs px-3 py-1 bg-slate-700/50 hover:bg-slate-700 border border-slate-600/50 rounded-full text-slate-300 transition-colors">
                  {n}@example.com
                </button>
              ))}
            </div>
          </div>
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
  const wsRef = useRef(null)

  // WebSocket: real-time push for notifications and new chat messages
  useEffect(() => {
    const connect = () => {
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
          } else if (data.type === 'new_message') {
            window.dispatchEvent(new CustomEvent('ws_new_message', { detail: data }))
          }
        } catch (_) {}
      }
      ws.onclose = () => setTimeout(connect, 3000)
    }
    connect()
    return () => { wsRef.current?.close() }
  }, [user.id])

  const loadData = useCallback(async () => {
    setLoading(true)
    const [g, u, n] = await Promise.all([fetchUserGroups(user.id), fetchUsers(user.id), fetchNotifications(user.id)])
    setGroups(g)
    setUsers(u)
    setNotifications(n)
    setLoading(false)
  }, [user.id])

  useEffect(() => { 
    loadData()
    const interval = setInterval(() => {
      fetchNotifications(user.id).then(setNotifications)
    }, 15000)
    return () => clearInterval(interval)
  }, [loadData, user.id])

  const handleMarkRead = async (notifId, notif) => {
    try {
      await markNotificationRead(notifId)
      setNotifications(prev => prev.map(n => n.id === notifId ? { ...n, is_read: 1 } : n))
      if (notif?.group_id) {
        const matchedGroup = groups.find(g => g.id === notif.group_id)
        if (matchedGroup) { 
          setShowNotifs(false); 
          setGroup(matchedGroup);
          if (notif.expense_id) setFocusExpenseId(notif.expense_id);
        }
      } else if (notif?.message) {
        const msg = notif.message.toLowerCase()
        const matchedGroup = groups.find(g => msg.includes(g.name.toLowerCase()))
        if (matchedGroup) { setShowNotifs(false); setGroup(matchedGroup); setFocusExpenseId(null); }
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
    return <AdminDashboard currentUser={user} onBack={() => setShowAdmin(false)} />
  }

  if (selectedGroup) {
    return (
      <GroupDetailView
        group={selectedGroup}
        currentUser={user}
        allUsers={users}
        allGroups={groups}
        onBack={() => { setGroup(null); setFocusExpenseId(null); }}
        onGroupUpdated={loadData}
        focusExpenseId={focusExpenseId}
      />
    )
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="min-h-screen flex flex-col z-10 relative">

      {/* Top nav */}
      <nav className="bg-slate-900/70 backdrop-blur-xl border-b border-slate-700/40 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center">
              <Wallet className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-white text-lg">SplitWise</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <button onClick={() => setShowNotifs(!showNotifs)} className="relative p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                <Bell className="h-4 w-4" />
                {notifications.some(n => !n.is_read) && (
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-900"></span>
                )}
              </button>
              {showNotifs && (
                <div className="absolute top-12 right-0 w-72 bg-slate-800 border border-slate-700 rounded-xl shadow-xl overflow-hidden z-50">
                  <div className="p-3 border-b border-slate-700/50 bg-slate-900/50 flex justify-between items-center">
                    <span className="font-semibold text-sm text-slate-200">Notifications</span>
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {notifications.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-6">No notifications</p>
                    ) : (
                      notifications.map(n => (
                        <div key={n.id} onClick={() => handleMarkRead(n.id, n)}
                          className={`p-3 text-xs border-b border-slate-700/50 cursor-pointer hover:bg-slate-700/50 transition-colors ${!n.is_read ? 'bg-indigo-500/10' : ''}`}>
                          <p className={`text-slate-300 ${!n.is_read ? 'font-medium' : ''}`}>{n.message}</p>
                          <p className="text-[9px] text-slate-500 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
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
              // Update user object globally
              const saved = JSON.parse(localStorage.getItem('splitclone_user') || '{}');
              const updated = { ...saved, ...newUser };
              localStorage.setItem('splitclone_user', JSON.stringify(updated));
              // Note: A full page reload or a global context update is usually better here, 
              // but we can trigger a hard reload for simplicity since App.jsx only reads from local storage on mount.
              window.location.reload();
            }}
          />
        )}
      </AnimatePresence>

      <main className="flex-1 max-w-2xl w-full mx-auto px-4 pb-28">
        {loading ? (
          <div className="flex justify-center items-center h-64"><Loader2 className="animate-spin h-8 w-8 text-indigo-500" /></div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>

              {activeTab === 'groups' && (
                <GroupsTab
                  groups={groups}
                  currentUser={user}
                  onSelectGroup={setGroup}
                  onGroupCreated={loadData}
                />
              )}

              {activeTab === 'activity' && (
                <ActivityTab currentUser={user} groups={groups} />
              )}

              {activeTab === 'people' && (
                <PeopleTab users={users} currentUser={user} />
              )}

            </motion.div>
          </AnimatePresence>
        )}
      </main>

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
          {/* Floating Add button */}
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
function GroupDetailView({ group, currentUser, allUsers, allGroups, onBack, onGroupUpdated, focusExpenseId }) {
  const [expenses, setExpenses] = useState([])
  const [balances, setBalances] = useState([])
  const [members, setMembers]   = useState(group.members || [])
  const [loading, setLoading]   = useState(true)
  const [activeSection, setSection] = useState('expenses') // expenses | balances
  const [showAddExp, setAddExp]  = useState(false)
  const [showAddMember, setShowAddMember] = useState(false)
  const [memberEmail, setMemberEmail] = useState('')
  const [memberPhone, setMemberPhone] = useState('')
  const [memberLoading, setMemberLoading] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [inviteMode, setInviteMode] = useState(false)   // true = user not found, show invite form
  const [inviteSent, setInviteSent] = useState(false)    // true = invite confirmation shown
  const [inviteMsg, setInviteMsg] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null)
  const [showValidOnly, setShowValidOnly] = useState(false)
  const [viewedChats, setViewedChats] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`split_chat_viewed_${currentUser.id}`) || '{}') } catch { return {} }
  })

  // Build contact set — users that share any group with the current user (highest priority)
  const contactIds = new Set()
  ;(allGroups || []).forEach(g => {
    const isMember = (g.members || []).some(m => m.id === currentUser.id)
    if (isMember) (g.members || []).forEach(m => { if (m.id !== currentUser.id) contactIds.add(m.id) })
  })

  // Filter + sort suggestions: exclude self & existing members, contacts first, then alphabetical
  const memberIds = new Set(members.map(m => m.id))
  const suggestions = (allUsers || [])
    .filter(u => u.id !== currentUser.id && !memberIds.has(u.id))
    .filter(u => {
      if (!memberEmail.trim()) return true
      const q = memberEmail.toLowerCase()
      return u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    })
    .sort((a, b) => {
      const aContact = contactIds.has(a.id) ? 0 : 1
      const bContact = contactIds.has(b.id) ? 0 : 1
      if (aContact !== bContact) return aContact - bContact
      return a.name.localeCompare(b.name)
    })
    .slice(0, 6) // max 6 suggestions

  const markChatViewed = useCallback((expId) => {
    setViewedChats(prev => {
      const updated = { ...prev, [expId]: new Date().toISOString() }
      localStorage.setItem(`split_chat_viewed_${currentUser.id}`, JSON.stringify(updated))
      return updated
    })
  }, [currentUser.id])

  const loadGroupData = useCallback(async () => {
    setLoading(true)
    const [e, b] = await Promise.all([fetchGroupExpenses(group.id), fetchGroupBalances(group.id)])
    setExpenses(e)
    setBalances(b)
    setLoading(false)
  }, [group.id])

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
    setMemberEmail(''); setMemberPhone(''); setMemberError(''); setInviteMode(false); setInviteSent(false); setInviteMsg('')
  }

  const handleAddMember = async (e) => {
    e.preventDefault()
    if (!memberEmail.trim()) return
    setMemberLoading(true); setMemberError('')
    try {
      const updated = await addGroupMember(group.id, memberEmail.trim())
      setMembers(updated.members)
      resetMemberForm(); setShowAddMember(false)
      onGroupUpdated()
    } catch (err) {
      // If user not found, switch to invite mode instead of showing a dead-end error
      if (err.message && err.message.toLowerCase().includes('no user found')) {
        setInviteMode(true)
        setMemberError('')
      } else {
        setMemberError(err.message)
      }
    } finally { setMemberLoading(false) }
  }

  const handleSendInvite = async (e) => {
    e.preventDefault()
    if (!memberEmail.trim()) return
    setMemberLoading(true); setMemberError('')
    try {
      const result = await sendInvite(memberEmail.trim(), memberPhone.trim(), group.id, currentUser.id)
      setInviteSent(true)
      setInviteMsg(result.message || `Invite sent to ${memberEmail}`)
      // Auto-close after 3 seconds
      setTimeout(() => { resetMemberForm(); setShowAddMember(false) }, 3000)
    } catch (err) { setMemberError(err.message) }
    finally { setMemberLoading(false) }
  }

  // Compute this user's balance in this group
  const myBalance = balances.reduce((acc, b) => {
    if (b.from_user_id === currentUser.id) return acc - b.amount
    if (b.to_user_id   === currentUser.id) return acc + b.amount
    return acc
  }, 0)

  return (
    <motion.div initial={{ opacity: 0, x: 30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 30 }} className="min-h-screen flex flex-col z-10 relative">
      {/* Header */}
      <div className="bg-slate-900/80 backdrop-blur-xl border-b border-slate-700/40 sticky top-0 z-50">
        <div className="max-w-2xl mx-auto px-4">
          <div className="flex items-center gap-3 h-14">
            <button onClick={onBack} className="p-2 -ml-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className={`h-8 w-8 rounded-lg bg-gradient-to-br ${avatarColor(group.id)} flex items-center justify-center text-sm font-bold text-white`}>
              {group.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="font-bold text-white truncate">{group.name}</h1>
              <p className="text-xs text-slate-500">{members.length} member{members.length !== 1 ? 's' : ''}</p>
            </div>
          </div>
        </div>
      </div>

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
        <div className="mt-4 bg-slate-800/40 border border-slate-700/40 rounded-2xl px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Members</p>
            <button onClick={() => { setShowAddMember(s => { if (s) resetMemberForm(); return !s }) }}
              className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              <UserPlus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {members.map(m => (
              <div key={m.id} className="flex items-center gap-2 bg-slate-700/50 rounded-full pl-1 pr-3 py-1">
                <div className={`h-6 w-6 rounded-full bg-gradient-to-br ${avatarColor(m.id)} flex items-center justify-center text-[10px] font-bold text-white`}>
                  {m.name.charAt(0)}
                </div>
                <span className="text-xs text-slate-300 font-medium">{m.id === currentUser.id ? 'You' : m.name}</span>
              </div>
            ))}
          </div>

          <AnimatePresence>
            {showAddMember && (
              <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}>

                {/* ── Invite Sent Confirmation ── */}
                {inviteSent ? (
                  <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                    className="mt-3 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl p-4 text-center">
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
                      <CheckCircle2 className="h-10 w-10 text-emerald-400 mx-auto mb-2" />
                    </motion.div>
                    <p className="text-emerald-300 font-semibold text-sm">Invite Sent!</p>
                    <p className="text-emerald-400/70 text-xs mt-1">{inviteMsg}</p>
                  </motion.div>

                /* ── Invite Mode (user not found) ── */
                ) : inviteMode ? (
                  <form onSubmit={handleSendInvite} className="mt-3 space-y-2">
                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-3 py-2 flex items-start gap-2">
                      <Mail className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
                      <p className="text-xs text-amber-300">
                        <span className="font-semibold">{memberEmail}</span> isn't on SplitWise yet. Send them an invite to join!
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <Phone className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input type="tel" value={memberPhone} onChange={e => setMemberPhone(e.target.value)}
                          placeholder="Phone number (optional)"
                          className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500 text-sm" />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={() => { setInviteMode(false); setMemberError('') }}
                        className="flex-1 bg-slate-700/60 hover:bg-slate-700 text-slate-300 px-4 py-2 rounded-xl text-sm font-medium transition-colors">
                        Back
                      </button>
                      <button type="submit" disabled={memberLoading}
                        className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-500/20">
                        {memberLoading ? <Loader2 className="animate-spin h-4 w-4" /> : <><Send className="h-3.5 w-3.5" /> Send Invite</>}
                      </button>
                    </div>
                    {memberError && <p className="text-red-400 text-xs mt-1">{memberError}</p>}
                  </form>

                /* ── Default: Add by email with autocomplete ── */
                ) : (
                  <form onSubmit={handleAddMember} className="mt-3">
                    <div className="flex gap-2">
                      <div className="flex-1 relative">
                        <Search className="h-3.5 w-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 z-10" />
                        <input autoFocus type="text" value={memberEmail}
                          onChange={e => { setMemberEmail(e.target.value); setShowSuggestions(true) }}
                          onFocus={() => setShowSuggestions(true)}
                          onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                          placeholder="Search name or email..."
                          className="w-full bg-slate-900/60 border border-slate-700 rounded-xl pl-9 pr-3 py-2 focus:outline-none focus:border-indigo-500 text-slate-100 placeholder-slate-500 text-sm" />

                        {/* Autocomplete dropdown */}
                        <AnimatePresence>
                          {showSuggestions && suggestions.length > 0 && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.15 }}
                              className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/40 z-50 overflow-hidden max-h-60 overflow-y-auto"
                            >
                              {suggestions.map((u, i) => (
                                <button
                                  key={u.id}
                                  type="button"
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => {
                                    setMemberEmail(u.email)
                                    setShowSuggestions(false)
                                  }}
                                  className={`w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-slate-700/60 transition-colors ${
                                    i < suggestions.length - 1 ? 'border-b border-slate-700/30' : ''
                                  }`}
                                >
                                  <div className={`h-8 w-8 shrink-0 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-xs font-bold text-white`}>
                                    {u.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-200 truncate">{u.name}</p>
                                    <p className="text-xs text-slate-500 truncate">{u.email}</p>
                                  </div>
                                  {contactIds.has(u.id) && (
                                    <span className="shrink-0 text-[10px] font-semibold bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded-full">Contact</span>
                                  )}
                                </button>
                              ))}
                            </motion.div>
                          )}
                        </AnimatePresence>

                        {/* No matches hint */}
                        <AnimatePresence>
                          {showSuggestions && memberEmail.trim().length > 0 && suggestions.length === 0 && (
                            <motion.div
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              className="absolute left-0 right-0 top-full mt-1 bg-slate-800 border border-slate-700/60 rounded-xl shadow-2xl shadow-black/40 z-50 px-3 py-3 text-center"
                            >
                              <p className="text-xs text-slate-400">No matching users found</p>
                              <p className="text-[10px] text-slate-500 mt-0.5">Type a full email and click Add to invite</p>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                      <button type="submit" disabled={memberLoading || !memberEmail.trim()}
                        className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5">
                        {memberLoading ? <Loader2 className="animate-spin h-4 w-4" /> : <><UserPlus className="h-3.5 w-3.5" /> Add</>}
                      </button>
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
          {[['expenses', 'Expenses', Receipt], ['balances', 'Balances', TrendingDown]].map(([id, label, Icon]) => (
            <button key={id} onClick={() => setSection(id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-all ${activeSection === id ? 'bg-slate-700 text-white shadow' : 'text-slate-400 hover:text-slate-200'}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin h-7 w-7 text-indigo-500" /></div>
        ) : activeSection === 'expenses' ? (
          <>
            {expenses.some(e => e.status === 'deleted') && (
              <div className="flex justify-end mt-2 mb-1">
                <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer hover:text-slate-200 transition-colors">
                  <input type="checkbox" checked={showValidOnly} onChange={e => setShowValidOnly(e.target.checked)} className="accent-indigo-500" />
                  Hide deleted expenses
                </label>
              </div>
            )}
            <ExpenseList 
              expenses={expenses} 
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
            />
          </>
        ) : (
          <BalanceList balances={balances} currentUser={currentUser} members={members} />
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
            users={allUsers}
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
function AdminDashboard({ currentUser, onBack }) {
  const [activeTab, setActiveTab] = useState('users')
  const [users, setAdminUsers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetchAdminUsers(currentUser.id).then(res => {
      setAdminUsers(res)
      setLoading(false)
    })
  }, [currentUser.id])

  const handleDeleteUser = async (id) => {
    if (!confirm('Are you sure you want to delete this user? This cannot be undone.')) return
    try {
      await deleteAdminUser(id, currentUser.id)
      setAdminUsers(prev => prev.filter(u => u.id !== id))
    } catch (e) {
      alert('Error deleting user: ' + e.message)
    }
  }
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newIsAdmin, setNewIsAdmin] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)

  const handleToggleAdmin = async (id) => {
    try {
      const updatedUser = await toggleAdminStatus(id, currentUser.id)
      setAdminUsers(prev => prev.map(u => u.id === id ? updatedUser : u))
    } catch (e) {
      alert('Error toggling admin: ' + e.message)
    }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    if (!newName || !newEmail || !newPassword) return
    setCreateLoading(true)
    try {
      const newUser = await adminCreateUser(currentUser.id, newName, newEmail, newPassword, newIsAdmin)
      setAdminUsers(prev => [...prev, newUser])
      setNewName(''); setNewEmail(''); setNewPassword(''); setNewIsAdmin(false);
      setActiveTab('users')
    } catch (e) {
      alert('Error creating user: ' + e.message)
    } finally {
      setCreateLoading(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 pt-4">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="h-5 w-5 mr-2" /> Back to Dashboard
        </button>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-6 border-b border-slate-800">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Settings className="h-6 w-6 text-amber-400" /> Admin Portal
          </h2>
          <p className="text-sm text-slate-400 mt-1">Manage platform users and resources</p>
        </div>

        <div className="p-6">
          <div className="flex gap-4 mb-6 border-b border-slate-800">
            <button className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'users' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`} onClick={() => setActiveTab('users')}>
              Users
            </button>
            <button className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${activeTab === 'create' ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-slate-400 hover:text-slate-300'}`} onClick={() => setActiveTab('create')}>
              Create User
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-indigo-500" /></div>
          ) : activeTab === 'users' ? (
            <div className="space-y-3">
              {users.map(u => (
                <div key={u.id} className="flex items-center justify-between p-4 bg-slate-800/50 rounded-xl border border-slate-700/50">
                  <div>
                    <p className="text-sm font-medium text-slate-200">
                      {u.name} {u.id === currentUser.id && <span className="text-xs text-indigo-400 ml-2">(You)</span>}
                      {u.is_admin && <span className="text-[10px] bg-amber-500/20 text-amber-400 px-2 py-0.5 rounded ml-2 font-bold uppercase tracking-wider">Admin</span>}
                    </p>
                    <p className="text-xs text-slate-500">{u.email} • ID: {u.id}</p>
                  </div>
                  {u.id !== currentUser.id && (
                    <div className="flex gap-2">
                      <button onClick={() => handleToggleAdmin(u.id)} className={`p-2 rounded-lg transition-colors text-xs font-semibold ${u.is_admin ? 'bg-slate-700 hover:bg-slate-600 text-slate-300' : 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500'}`}>
                        {u.is_admin ? 'Remove Admin' : 'Make Admin'}
                      </button>
                      <button onClick={() => handleDeleteUser(u.id)} className="p-2 text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : activeTab === 'create' ? (
            <form onSubmit={handleCreateUser} className="space-y-4 max-w-sm">
              <input type="text" placeholder="Name" value={newName} onChange={e => setNewName(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 focus:border-indigo-500 outline-none" required />
              <input type="email" placeholder="Email" value={newEmail} onChange={e => setNewEmail(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 focus:border-indigo-500 outline-none" required />
              <input type="password" placeholder="Password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-slate-100 focus:border-indigo-500 outline-none" required />
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer text-sm">
                <input type="checkbox" checked={newIsAdmin} onChange={e => setNewIsAdmin(e.target.checked)} className="accent-indigo-500 w-4 h-4" />
                Grant Admin Privileges
              </label>
              <button type="submit" disabled={createLoading} className="w-full bg-indigo-500 hover:bg-indigo-600 text-white font-medium py-2.5 rounded-xl transition-colors">
                {createLoading ? 'Creating...' : 'Create User'}
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </motion.div>
  )
}

// ── Expense Chat ──────────────────────────────────────────────────────────────
function ExpenseChat({ expenseId, currentUser, expenseUsers = [], lastViewedAt }) {
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
      <div ref={scrollRef} className="h-48 overflow-y-auto mb-3 space-y-3 pr-2 custom-scrollbar flex flex-col">
        {loading && messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center"><Loader2 className="animate-spin h-5 w-5 text-indigo-500" /></div>
        ) : messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-xs text-slate-500">No messages yet. Start the discussion!</div>
        ) : (
          messages.map((m, i) => {
            if (m.is_system) {
              return (
                <div key={m.id || i} id={`msg-${m.id}`} className="w-full flex justify-center my-1">
                  <div className="bg-slate-800/60 text-slate-400 text-[10px] px-3 py-1 rounded-full border border-slate-700/50">
                    {m.text}
                  </div>
                </div>
              )
            }
            const isMe = m.user_id === currentUser.id
            return (
              <div key={m.id || i} id={`msg-${m.id}`} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
                {!isMe && <span className="text-[10px] text-slate-500 ml-1 mb-0.5">{m.user_name}</span>}
                <div className={`max-w-[85%] px-3 py-1.5 rounded-2xl text-sm ${isMe ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-700 text-slate-200 rounded-bl-none'}`}>
                  {m.text}
                </div>
                <span className="text-[9px] text-slate-500 mt-0.5 mx-1">
                  {new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            )
          })
        )}
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
function ExpenseList({ expenses, currentUser, allUsers = [], showValidOnly = false, onEditExpense, onDeleteExpense, onApproveDelete, onRejectDelete, viewedChats, focusExpenseId, markChatViewed }) {
  const [expandedChatId, setExpandedChatId] = useState(focusExpenseId || null)

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
    <div className="mt-2 space-y-4">
      {Object.entries(grouped).map(([monthYear, exps]) => (
        <div key={monthYear}>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider px-1 py-2">{monthYear}</p>
          <div className="space-y-1">
            {exps.map((e, i) => {
              const { month, day } = formatDate(e.date)
              const mySplit = e.splits.find(s => s.user_id === currentUser.id)
              const iPaid  = e.payer_id === currentUser.id
              const cat    = guessCategory(e.description)
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
                          {e.status === 'pending_deletion' ? (
                            e.approvals && e.approvals.find(a => a.user_id === currentUser.id) ? (
                              (() => {
                                const myVote = e.approvals.find(a => a.user_id === currentUser.id).approved;
                                if (myVote === 1) return <span className="text-emerald-400 font-semibold border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 rounded">You voted: Approve</span>;
                                if (myVote === -1) return <span className="text-rose-400 font-semibold border border-rose-500/30 bg-rose-500/10 px-2 py-1 rounded">You voted: Reject</span>;
                                return (
                                  <>
                                    <button onClick={() => onApproveDelete && onApproveDelete(e.id)} className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 px-2 py-1 rounded transition-colors">Approve</button>
                                    <button onClick={() => onRejectDelete && onRejectDelete(e.id)} className="bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 px-2 py-1 rounded transition-colors">Reject</button>
                                  </>
                                )
                              })()
                            ) : null
                          ) : (
                            <button onClick={() => handleCancelDeletion(e.id)} className="bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 px-2 py-1 rounded transition-colors font-medium">Cancel Deletion</button>
                          )}
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
                    </div>
                    {/* Icon */}
                    <div className="h-10 w-10 shrink-0 bg-slate-700/60 rounded-xl flex items-center justify-center text-lg">
                      {icon}
                    </div>
                    {/* Description */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-100 truncate">{e.description}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        Added by {e.created_by_name} • {iPaid ? 'You paid' : `${e.payer_name} paid`} £{e.amount.toFixed(2)}
                      </p>
                    </div>
                    {/* Balance */}
                    <div className="text-right shrink-0 flex flex-col items-end justify-center">
                      <p className={`text-xs font-semibold ${balColor}`}>{balLabel}</p>
                    </div>
                  </div>

                  {/* Actions Row */}
                  <div className="flex items-center justify-between pt-2 border-t border-slate-700/30 mt-1 relative z-10">
                    <div className="flex items-center">
                      <button onClick={() => handleToggleChat(e.id)} className="relative shrink-0 text-xs text-slate-400 hover:text-indigo-400 flex items-center gap-1.5 transition-colors font-medium">
                        <MessageSquare className="h-3.5 w-3.5" /> Chat
                        {e.last_message_at && (!viewedChats[e.id] || new Date(e.last_message_at) > new Date(viewedChats[e.id])) && (
                          <span className="absolute -top-1 -right-2 h-2 w-2 rounded-full bg-rose-500 ring-2 ring-slate-800"></span>
                        )}
                      </button>
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
                    />
                  )}
                </motion.div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Balance List ──────────────────────────────────────────────────────────────
function BalanceList({ balances, currentUser, members }) {
  if (balances.length === 0) {
    return (
      <div className="text-center py-12 text-slate-500 mt-2">
        <CheckCircle2 className="h-10 w-10 mx-auto mb-3 opacity-40 text-emerald-500" />
        <p className="font-medium text-emerald-400">All settled up!</p>
        <p className="text-sm mt-1 text-slate-500">No outstanding balances in this group</p>
      </div>
    )
  }

  return (
    <div className="mt-2 space-y-2">
      {balances.map((b, i) => {
        const isMe = b.from_user_id === currentUser.id || b.to_user_id === currentUser.id
        return (
          <motion.div key={i} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-all ${isMe ? 'bg-slate-800 border-slate-600' : 'bg-slate-800/40 border-slate-700/30'}`}>
            <div className={`h-9 w-9 rounded-full bg-gradient-to-br ${avatarColor(b.from_user_id)} flex items-center justify-center text-xs font-bold text-white shrink-0`}>
              {b.from_user_name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-slate-200">
                <span className="font-semibold">{b.from_user_id === currentUser.id ? 'You' : b.from_user_name}</span>
                <span className="text-slate-400"> owe </span>
                <span className="font-semibold">{b.to_user_id === currentUser.id ? 'You' : b.to_user_name}</span>
              </p>
            </div>
            <span className={`text-sm font-bold shrink-0 ${b.from_user_id === currentUser.id ? 'text-rose-400' : b.to_user_id === currentUser.id ? 'text-emerald-400' : 'text-slate-300'}`}>
              £{b.amount.toFixed(2)}
            </span>
          </motion.div>
        )
      })}
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
function PeopleTab({ users, currentUser, groups = [] }) {
  const visibleUsers = currentUser?.is_admin ? users : users.filter(u => {
    if (u.id === currentUser.id) return true
    return groups.some(g => g.members?.some(m => m.id === u.id))
  })

  return (
    <div className="pt-6 space-y-2">
      <h2 className="text-xl font-bold text-white mb-4">People</h2>
      {visibleUsers.length === 0 && <p className="text-slate-500 text-sm">No people to show yet. Join a group!</p>}
      {visibleUsers.map((u, i) => (
        <motion.div key={u.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
          className="flex items-center gap-3 bg-slate-800/40 border border-slate-700/30 rounded-2xl px-4 py-3">
          <div className={`h-10 w-10 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-sm font-bold text-white shrink-0`}>
            {u.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-100">{u.name} {u.id === currentUser.id && <span className="text-indigo-400 text-xs">(You)</span>}</p>
            <p className="text-xs text-slate-500">{u.email}</p>
          </div>
        </motion.div>
      ))}
    </div>
  )
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
  const [loading, setLoading]         = useState(false)
  const [success, setSuccess]         = useState(false)
  const [error, setError]             = useState('')

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
    e.preventDefault(); setError('')
    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) return setError('Please enter a valid amount')

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
      let total = 0
      Object.entries(splitValues).forEach(([uid, val]) => {
        const amt = parseFloat(val)
        if (!isNaN(amt) && amt > 0) {
          total += amt
          finalSplits.push({ user_id: parseInt(uid), amount: amt })
        }
      })
      if (Math.abs(total - numAmount) > 0.01) return setError(`Exact amounts sum to £${total.toFixed(2)}, but total is £${numAmount.toFixed(2)}`)
      if (finalSplits.length === 0) return setError('Enter at least one valid amount')
    } else if (splitMode === 'percentage') {
      let totalPct = 0
      Object.entries(splitValues).forEach(([uid, val]) => {
        const pct = parseFloat(val)
        if (!isNaN(pct) && pct > 0) {
          totalPct += pct
          finalSplits.push({ user_id: parseInt(uid), amount: parseFloat(((pct / 100) * numAmount).toFixed(2)) })
        }
      })
      if (Math.abs(totalPct - 100) > 0.01) return setError(`Percentages sum to ${totalPct.toFixed(2)}%, but must be exactly 100%`)
      if (finalSplits.length === 0) return setError('Enter at least one valid percentage')
      // fix rounding issue for the last item in percentage mode
      const allocated = finalSplits.reduce((acc, s) => acc + s.amount, 0)
      if (Math.abs(allocated - numAmount) > 0.005) {
        finalSplits[finalSplits.length - 1].amount += parseFloat((numAmount - allocated).toFixed(2))
      }
    } else if (splitMode === 'adjusted') {
      let fixedTotal = 0
      const activeIds = selectedUsers.length > 0 ? selectedUsers : users.map(u => u.id)
      
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
      }
      if (initialExpense) {
        await updateExpense(initialExpense.id, payload)
      } else {
        await createExpense(payload)
      }
      setSuccess(true)
      setTimeout(onSuccess, 1200)
    } catch (err) { setError(err.message); setLoading(false) }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={e => e.target === e.currentTarget && onClose()}>
      <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="w-full max-w-lg bg-slate-900 border border-slate-700/60 rounded-3xl shadow-2xl overflow-hidden">

        {success ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.1 }}
              className="h-16 w-16 bg-emerald-500/20 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-9 w-9 text-emerald-400" />
            </motion.div>
            <p className="text-xl font-bold text-emerald-400">Expense {initialExpense ? 'Updated' : 'Added'}!</p>
            <p className="text-slate-400 text-sm">Successfully recorded and split.</p>
          </div>
        ) : (
          <>
            {/* Modal header */}
            <div className="sticky top-0 bg-slate-900/95 backdrop-blur-md z-10 flex items-center justify-between px-6 py-4 border-b border-slate-700/50">
              <h3 className="font-bold text-white text-lg">{initialExpense ? 'Edit Expense' : 'Add Expense'}</h3>
              <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 max-h-[75vh] overflow-y-auto custom-scrollbar">

              {/* Description */}
              <div>
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">What was it for?</label>
                <input autoFocus type="text" required value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="e.g. Dinner, Netflix, Uber..."
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-slate-100 placeholder-slate-500 text-base" />
              </div>

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
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.id === currentUser.id ? 'You' : u.name}</option>
                  ))}
                </select>
              </div>

              {/* Group */}
              {groups.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 block">Group (optional)</label>
                  <select value={groupId} onChange={e => setGroupId(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 text-slate-100 appearance-none">
                    <option value="">No Group</option>
                    {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              )}

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

                {(splitMode === 'equal' || splitMode === 'adjusted') && (
                  <>
                    <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2 block">
                      {splitMode === 'equal' ? 'Split equally with' : 'People involved'}
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {users.map(u => {
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
                    {amount && splitMode === 'equal' && selectedUsers.length > 0 && (
                      <p className="text-xs text-slate-500 mt-2">
                        £{(parseFloat(amount) / selectedUsers.length).toFixed(2)} per person across {selectedUsers.length} {selectedUsers.length === 1 ? 'person' : 'people'}
                      </p>
                    )}
                  </>
                )}

                {splitMode !== 'equal' && (
                  <div className="space-y-2 mt-4 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                    {(splitMode === 'adjusted' && selectedUsers.length > 0 ? users.filter(u => selectedUsers.includes(u.id)) : users).map(u => (
                      <div key={u.id} className="flex items-center justify-between gap-3 bg-slate-800/40 p-2.5 rounded-xl border border-slate-700/50 hover:border-slate-600/50 transition-colors">
                        <div className="flex items-center gap-2">
                          <div className={`h-8 w-8 rounded-full bg-gradient-to-br ${avatarColor(u.id)} flex items-center justify-center text-[10px] font-bold text-white shrink-0`}>
                            {u.name.charAt(0)}
                          </div>
                          <p className="text-sm font-medium text-slate-200">{u.id === currentUser.id ? 'You' : u.name}</p>
                        </div>
                        <div className="relative w-24">
                          {splitMode !== 'percentage' && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">£</span>}
                          <input type="number" step="0.01" min={splitMode==='adjusted'?undefined:"0"}
                            value={splitValues[u.id] || ''}
                            onChange={(e) => handleSplitValueChange(u.id, e.target.value)}
                            className={`w-full bg-slate-900/80 border border-slate-600 rounded-lg py-1.5 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 text-slate-100 placeholder-slate-600 text-sm font-medium transition-all [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${splitMode === 'percentage' ? 'text-right pr-6 pl-3' : 'text-left pl-7 pr-3'}`}
                            placeholder={splitMode === 'adjusted' ? 'Auto' : '0.00'}
                          />
                          {splitMode === 'percentage' && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 font-medium text-sm">%</span>}
                        </div>
                      </div>
                    ))}
                    <div className="pt-3 text-xs font-medium flex justify-between px-1">
                      <span className="text-slate-500 uppercase tracking-wider">{splitMode === 'adjusted' ? 'Fixed Pool:' : 'Total Allocated:'}</span>
                      {splitMode === 'adjusted' ? (
                        <span className="text-indigo-400 font-semibold">
                          £{Object.values(splitValues).reduce((a, b) => a + (parseFloat(b)||0), 0).toFixed(2)} / £{(parseFloat(amount)||0).toFixed(2)}
                        </span>
                      ) : (
                        <span className={
                          (splitMode === 'exact' && Object.values(splitValues).reduce((a, b) => a + (parseFloat(b)||0), 0) !== parseFloat(amount||0)) ||
                          (splitMode === 'percentage' && Object.values(splitValues).reduce((a, b) => a + (parseFloat(b)||0), 0) !== 100)
                            ? 'text-amber-400 font-semibold' : 'text-emerald-400 font-semibold'
                        }>
                          {splitMode === 'exact' 
                            ? `£${Object.values(splitValues).reduce((a, b) => a + (parseFloat(b)||0), 0).toFixed(2)} / £{(parseFloat(amount)||0).toFixed(2)}`
                            : `${Object.values(splitValues).reduce((a, b) => a + (parseFloat(b)||0), 0).toFixed(2)}% / 100%`}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  className="text-red-400 text-sm text-center bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  {error}
                </motion.p>
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
      </motion.div>
    </motion.div>
  )
}

