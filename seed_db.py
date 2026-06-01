"""
Seed script — safely drops all data and re-seeds the database.
Run: python seed_db.py
NOTE: Does NOT delete the .db file (so it works even while uvicorn is running).
"""
from datetime import datetime, timedelta
from sqlalchemy import text
from database import SessionLocal, Base, engine, User, Group, Expense, ExpenseSplit, group_members

# ── Drop all data safely (FK safe order) ─────────────────────────────────────
Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)
print("Tables dropped and recreated.")

db = SessionLocal()

# ── Users ─────────────────────────────────────────────────────────────────────
alice   = User(name="Alice",   email="alice@example.com",   password="password")
bob     = User(name="Bob",     email="bob@example.com",     password="password")
charlie = User(name="Charlie", email="charlie@example.com", password="password")
diana   = User(name="Diana",   email="diana@example.com",   password="password")

db.add_all([alice, bob, charlie, diana])
db.commit()

# ── Groups ────────────────────────────────────────────────────────────────────
flat    = Group(name="156 Headly Drive")
flat.members = [alice, bob, charlie, diana]

holiday = Group(name="Goa Holiday")
holiday.members = [alice, bob, diana]

db.add_all([flat, holiday])
db.commit()

# ── Helper ────────────────────────────────────────────────────────────────────
def ago(days: int) -> datetime:
    return datetime(2026, 5, 31) - timedelta(days=days)

def add_expense(desc, amount, payer, group, split_users, date_obj):
    split_amount = round(amount / len(split_users), 2)
    splits_data  = []
    total_alloc  = 0.0
    for i, u in enumerate(split_users):
        if i == len(split_users) - 1:
            s_amt = round(amount - total_alloc, 2)
        else:
            s_amt = split_amount
        splits_data.append((u, s_amt))
        total_alloc += s_amt

    e = Expense(description=desc, amount=amount, payer_id=payer.id, created_by_id=payer.id, group_id=group.id, date=date_obj)
    db.add(e); db.commit(); db.refresh(e)

    for u, amt in splits_data:
        db.add(ExpenseSplit(expense_id=e.id, user_id=u.id, amount=amt))
    db.commit()
    return e

# ── Flat share expenses ────────────────────────────────────────────────────────
all4 = [alice, bob, charlie, diana]
add_expense("Smoke & Pepper",    42.00, bob,     flat, all4, ago(0))
add_expense("Mutton",            12.37, charlie, flat, all4, ago(7))
add_expense("Netflix",           17.99, alice,   flat, all4, ago(12))
add_expense("Garvity Games",     20.00, diana,   flat, all4, ago(13))
add_expense("Shakti",            30.00, alice,   flat, all4, ago(13))
add_expense("Bowling",           45.00, diana,   flat, all4, ago(13))
add_expense("Lidl 17th May",     11.15, charlie, flat, all4, ago(14))
add_expense("Keys cut",           7.50, alice,   flat, all4, ago(15))
add_expense("Shakthi",           24.00, bob,     flat, all4, ago(21))
add_expense("Biryani night",     32.00, alice,   flat, all4, ago(21))
add_expense("B&M Naveen paid",   18.40, alice,   flat, all4, ago(22))
add_expense("Broadband Bill",    35.00, bob,     flat, all4, ago(30))

# ── Holiday expenses ──────────────────────────────────────────────────────────
hol3 = [alice, bob, diana]
add_expense("Flights (split)",   360.00, alice, holiday, hol3, ago(45))
add_expense("Hotel — 3 nights",  240.00, bob,   holiday, hol3, ago(44))
add_expense("Beach dinner",       88.50, diana, holiday, hol3, ago(43))
add_expense("Scooter rental",     45.00, alice, holiday, hol3, ago(43))
add_expense("Groceries",          22.30, bob,   holiday, hol3, ago(42))

db.close()
print("[OK] Database seeded successfully!")
print("\nSample accounts (all password: 'password'):")
for name in ["alice", "bob", "charlie", "diana"]:
    print(f"  {name}@example.com")
