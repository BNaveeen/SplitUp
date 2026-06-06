"""Fix the notifications table in Supabase to have proper auto-increment and column types."""
from database import engine
from sqlalchemy import text

with engine.connect() as conn:
    # 1. Fix is_read column type (bigint -> integer)
    try:
        conn.execute(text("ALTER TABLE notifications ALTER COLUMN is_read TYPE integer USING is_read::integer"))
        print("1. Fixed is_read column type")
    except Exception as e:
        print(f"1. is_read already correct or error: {e}")
        conn.rollback()

    # 2. Create auto-increment sequence for id column
    try:
        conn.execute(text("CREATE SEQUENCE IF NOT EXISTS notifications_id_seq OWNED BY notifications.id"))
        conn.execute(text("ALTER TABLE notifications ALTER COLUMN id SET DEFAULT nextval('notifications_id_seq')"))
        # Set the sequence to the current max id
        result = conn.execute(text("SELECT COALESCE(MAX(id), 0) FROM notifications"))
        max_id = result.scalar()
        conn.execute(text(f"SELECT setval('notifications_id_seq', {max_id + 1})"))
        print(f"2. Created auto-increment sequence (starting at {max_id + 1})")
    except Exception as e:
        print(f"2. Sequence error: {e}")
        conn.rollback()

    conn.commit()
    print("Done! Notifications table is now fully fixed.")
