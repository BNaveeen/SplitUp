import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  guessCategory,
  formatDate,
  formatTimestamp,
  todayISO,
  buildCSVRows,
  EXPENSE_CATEGORIES,
  categoryIcons,
  categoryMeta,
} from '../utils'

describe('guessCategory', () => {
  it('returns food for restaurant keywords', () => {
    expect(guessCategory('Dinner at restaurant')).toBe('food')
    expect(guessCategory('Pizza hut')).toBe('food')
    expect(guessCategory('Morning coffee')).toBe('food')
    expect(guessCategory('Biryani')).toBe('food')
  })

  it('returns drink for bar/pub keywords', () => {
    expect(guessCategory('Beer at the pub')).toBe('drink')
    expect(guessCategory('Wine bar')).toBe('drink')
    expect(guessCategory('Cocktails tonight')).toBe('drink')
  })

  it('returns grocery for supermarket keywords', () => {
    expect(guessCategory('Tesco shopping')).toBe('grocery')
    expect(guessCategory('Lidl run')).toBe('grocery')
    expect(guessCategory('Morrisons weekly')).toBe('grocery')
    expect(guessCategory('Sainsbury\'s')).toBe('grocery')
  })

  it('returns transport for travel keywords', () => {
    expect(guessCategory('Uber to airport')).toBe('transport')
    expect(guessCategory('Bus pass')).toBe('transport')
    expect(guessCategory('Petrol')).toBe('transport')
    expect(guessCategory('Parking fine')).toBe('transport')
  })

  it('returns entertainment for media keywords', () => {
    expect(guessCategory('Netflix subscription')).toBe('entertainment')
    expect(guessCategory('Cinema tickets')).toBe('entertainment')
    expect(guessCategory('Bowling night')).toBe('entertainment')
    expect(guessCategory('Spotify monthly')).toBe('entertainment')
  })

  it('returns bill for utility keywords', () => {
    expect(guessCategory('Electric bill')).toBe('bill')
    expect(guessCategory('Monthly rent')).toBe('bill')
    expect(guessCategory('Broadband wifi')).toBe('bill')
    expect(guessCategory('Council tax')).toBe('bill')
  })

  it('returns accommodation for hotel keywords', () => {
    expect(guessCategory('Hotel booking')).toBe('accommodation')
    expect(guessCategory('Airbnb stay')).toBe('accommodation')
    expect(guessCategory('Hostel night')).toBe('accommodation')
  })

  it('returns flight for aviation keywords', () => {
    expect(guessCategory('Ryanair flight')).toBe('flight')
    expect(guessCategory('Airport transfer')).toBe('flight')
    expect(guessCategory('EasyJet ticket')).toBe('flight')
  })

  it('returns healthcare for medical keywords', () => {
    expect(guessCategory('Pharmacy prescription')).toBe('healthcare')
    expect(guessCategory('Doctor visit')).toBe('healthcare')
    expect(guessCategory('Hospital visit')).toBe('healthcare')
  })

  it('returns shopping for retail keywords', () => {
    expect(guessCategory('Amazon order')).toBe('shopping')
    expect(guessCategory('New shoes')).toBe('shopping')
    expect(guessCategory('eBay purchase')).toBe('shopping')
  })

  it('returns other for unrecognised descriptions', () => {
    expect(guessCategory('Miscellaneous')).toBe('other')
    expect(guessCategory('')).toBe('other')
    expect(guessCategory(null)).toBe('other')
    expect(guessCategory(undefined)).toBe('other')
  })

  it('is case-insensitive', () => {
    expect(guessCategory('NETFLIX')).toBe('entertainment')
    expect(guessCategory('TESCO')).toBe('grocery')
    expect(guessCategory('PIZZA')).toBe('food')
  })
})

describe('formatDate', () => {
  it('returns dashes for null/undefined', () => {
    expect(formatDate(null)).toEqual({ month: '—', day: '—', year: '—' })
    expect(formatDate(undefined)).toEqual({ month: '—', day: '—', year: '—' })
    expect(formatDate('')).toEqual({ month: '—', day: '—', year: '—' })
  })

  it('formats a known date correctly', () => {
    const result = formatDate('2024-06-15')
    expect(result.month).toBe('Jun')
    expect(result.day).toBe('15')
    expect(result.year).toBe('2024')
  })

  it('formats January correctly', () => {
    const result = formatDate('2023-01-01')
    expect(result.month).toBe('Jan')
    expect(result.day).toBe('1')
    expect(result.year).toBe('2023')
  })

  it('formats December correctly', () => {
    const result = formatDate('2023-12-31')
    expect(result.month).toBe('Dec')
  })
})

describe('formatTimestamp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns empty string for falsy input', () => {
    expect(formatTimestamp(null)).toBe('')
    expect(formatTimestamp('')).toBe('')
  })

  it('returns "just now" for very recent timestamps', () => {
    vi.setSystemTime(new Date('2024-06-15T12:00:00Z'))
    expect(formatTimestamp('2024-06-15T11:59:30Z')).toBe('just now')
  })

  it('returns minutes ago for recent timestamps', () => {
    vi.setSystemTime(new Date('2024-06-15T12:30:00Z'))
    expect(formatTimestamp('2024-06-15T12:00:00Z')).toBe('30m ago')
  })

  it('returns hours ago for same-day timestamps', () => {
    vi.setSystemTime(new Date('2024-06-15T15:00:00Z'))
    expect(formatTimestamp('2024-06-15T12:00:00Z')).toBe('3h ago')
  })

  it('returns days ago for this-week timestamps', () => {
    vi.setSystemTime(new Date('2024-06-18T12:00:00Z'))
    expect(formatTimestamp('2024-06-15T12:00:00Z')).toBe('3d ago')
  })
})

describe('todayISO', () => {
  it('returns a valid ISO date string', () => {
    const result = todayISO()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('EXPENSE_CATEGORIES', () => {
  it('has 11 categories', () => {
    expect(EXPENSE_CATEGORIES).toHaveLength(11)
  })

  it('every category has id, label, icon, color', () => {
    EXPENSE_CATEGORIES.forEach(c => {
      expect(c).toHaveProperty('id')
      expect(c).toHaveProperty('label')
      expect(c).toHaveProperty('icon')
      expect(c).toHaveProperty('color')
    })
  })

  it('categoryIcons maps all category ids', () => {
    EXPENSE_CATEGORIES.forEach(c => {
      expect(categoryIcons[c.id]).toBeDefined()
    })
    expect(categoryIcons.default).toBe('💳')
  })

  it('categoryMeta maps all category ids', () => {
    EXPENSE_CATEGORIES.forEach(c => {
      expect(categoryMeta[c.id]).toEqual(c)
    })
  })
})

describe('buildCSVRows', () => {
  const members = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
  ]

  const expenses = [
    {
      id: 1,
      description: 'Pizza',
      category: 'food',
      amount: 30,
      payer_name: 'Alice',
      date: '2024-06-15',
      status: 'active',
      splits: [{ user_id: 1, user_name: 'Alice', amount: 15 }, { user_id: 2, user_name: 'Bob', amount: 15 }],
    },
    {
      id: 2,
      description: 'Deleted expense',
      category: null,
      amount: 10,
      payer_name: 'Bob',
      date: '2024-06-14',
      status: 'deleted',
      splits: [],
    },
  ]

  it('includes a header row', () => {
    const rows = buildCSVRows(expenses, members)
    expect(rows[0]).toEqual(['Date', 'Description', 'Category', 'Amount (£)', 'Paid By', 'Split Between', 'Status'])
  })

  it('excludes deleted expenses', () => {
    const rows = buildCSVRows(expenses, members)
    expect(rows).toHaveLength(2) // header + 1 non-deleted
  })

  it('uses stored category label when available', () => {
    const rows = buildCSVRows(expenses, members)
    expect(rows[1][2]).toBe('Food & Drink')
  })

  it('falls back to guessCategory when category is null', () => {
    const exps = [{ ...expenses[0], category: null, description: 'Netflix' }]
    const rows = buildCSVRows(exps, members)
    expect(rows[1][2]).toBe('Entertainment')
  })

  it('formats amount to 2 decimal places', () => {
    const rows = buildCSVRows(expenses, members)
    expect(rows[1][3]).toBe('30.00')
  })

  it('resolves split names via member map', () => {
    const rows = buildCSVRows(expenses, members)
    expect(rows[1][5]).toBe('Alice; Bob')
  })

  it('falls back to user_name when member not in map', () => {
    const exps = [{
      ...expenses[0],
      splits: [{ user_id: 99, user_name: 'Charlie', amount: 30 }],
    }]
    const rows = buildCSVRows(exps, members)
    expect(rows[1][5]).toBe('Charlie')
  })
})
