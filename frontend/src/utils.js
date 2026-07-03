export const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export const EXPENSE_CATEGORIES = [
  { id: 'food',          label: 'Food & Drink',     icon: '🍽️', color: 'bg-orange-500/20 border-orange-500/40 text-orange-300' },
  { id: 'grocery',       label: 'Groceries',        icon: '🛒', color: 'bg-green-500/20 border-green-500/40 text-green-300' },
  { id: 'transport',     label: 'Transport',        icon: '🚗', color: 'bg-blue-500/20 border-blue-500/40 text-blue-300' },
  { id: 'accommodation', label: 'Accommodation',    icon: '🏨', color: 'bg-purple-500/20 border-purple-500/40 text-purple-300' },
  { id: 'entertainment', label: 'Entertainment',    icon: '🎮', color: 'bg-pink-500/20 border-pink-500/40 text-pink-300' },
  { id: 'bill',          label: 'Bills & Utilities', icon: '💡', color: 'bg-yellow-500/20 border-yellow-500/40 text-yellow-300' },
  { id: 'flight',        label: 'Travel',           icon: '✈️', color: 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' },
  { id: 'healthcare',    label: 'Healthcare',       icon: '🏥', color: 'bg-red-500/20 border-red-500/40 text-red-300' },
  { id: 'shopping',      label: 'Shopping',         icon: '🛍️', color: 'bg-violet-500/20 border-violet-500/40 text-violet-300' },
  { id: 'drink',         label: 'Drinks',           icon: '🍺', color: 'bg-amber-500/20 border-amber-500/40 text-amber-300' },
  { id: 'other',         label: 'Other',            icon: '📦', color: 'bg-slate-500/20 border-slate-500/40 text-slate-300' },
]

export const categoryIcons = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, c.icon]))
categoryIcons.default = '💳'

export const categoryMeta = Object.fromEntries(EXPENSE_CATEGORIES.map(c => [c.id, c]))

export function formatDate(isoString) {
  if (!isoString) return { month: '—', day: '—', year: '—', time: '' }
  const d = new Date(isoString)
  const h = d.getHours(), m = d.getMinutes()
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  const time = (h === 0 && m === 0) ? '' : `${h12}:${String(m).padStart(2,'0')}${ampm}`
  return { month: MONTH_SHORT[d.getMonth()], day: String(d.getDate()), year: String(d.getFullYear()), time }
}

export function formatTimestamp(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const now = new Date()
  const diffMs = now - d
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })
}

export function chatDateLabel(isoString) {
  if (!isoString) return ''
  const d = new Date(isoString)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today - 86400000)
  const msgDay = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  if (msgDay.getTime() === today.getTime()) return 'Today'
  if (msgDay.getTime() === yesterday.getTime()) return 'Yesterday'
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' })
}

export function todayISO() {
  return new Date().toISOString().split('T')[0]
}

export function guessCategory(description) {
  const d = (description || '').toLowerCase()
  if (/smoke|pepper|mutton|biryani|restaurant|dinner|lunch|breakfast|food|curry|pizza|cafe|coffee|snack|meal/.test(d)) return 'food'
  if (/bar|pub|beer|drink|alcohol|wine|cocktail/.test(d)) return 'drink'
  if (/lidl|tesco|sainsbury|aldi|grocery|supermarket|market|asda|morrisons/.test(d)) return 'grocery'
  if (/uber|taxi|bus|train|tube|transport|car|scooter|petrol|fuel|parking|metro/.test(d)) return 'transport'
  if (/netflix|spotify|game|bowling|cinema|movie|theatre|concert|amazon prime/.test(d)) return 'entertainment'
  if (/electric|gas|water|broadband|wifi|bill|rent|utilities|council|insurance/.test(d)) return 'bill'
  if (/hotel|airbnb|hostel|accommodation|motel|stay/.test(d)) return 'accommodation'
  if (/flight|airport|plane|easyjet|ryanair|british airways/.test(d)) return 'flight'
  if (/pharmacy|doctor|hospital|medicine|prescription|healthcare/.test(d)) return 'healthcare'
  if (/shopping|amazon|ebay|clothes|shoes/.test(d)) return 'shopping'
  return 'other'
}

export function buildCSVRows(expenses, members = []) {
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]))
  const rows = [['Date', 'Description', 'Category', 'Amount (£)', 'Paid By', 'Split Between', 'Status']]
  expenses
    .filter(e => e.status !== 'deleted')
    .forEach(e => {
      const cat = e.category || guessCategory(e.description)
      const catLabel = categoryMeta[cat]?.label ?? cat
      const splitNames = e.splits.map(s => memberMap[s.user_id] || s.user_name || `User ${s.user_id}`).join('; ')
      rows.push([
        e.date ? (() => { const d = new Date(e.date); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}` })() : '',
        e.description,
        catLabel,
        parseFloat(e.amount).toFixed(2),
        e.payer_name,
        splitNames,
        e.status,
      ])
    })
  return rows
}
