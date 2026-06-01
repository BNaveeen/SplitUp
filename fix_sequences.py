import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
db_url = os.getenv("DATABASE_URL")

try:
    conn = psycopg2.connect(db_url)
    conn.autocommit = True
    cursor = conn.cursor()

    tables = ['users', 'groups', 'group_members', 'expenses', 'expense_splits', 'expense_messages', 'expense_approvals', 'pending_invites']

    for table_name in tables:
        print(f"Syncing sequence for {table_name}...")
        cursor.execute(f"SELECT MAX(id) FROM {table_name}")
        max_id = cursor.fetchone()[0]
        if max_id is not None:
            # SQLAlchemy often creates sequences named table_id_seq
            seq_name = f"{table_name}_id_seq"
            try:
                cursor.execute(f"SELECT setval('{seq_name}', {max_id})")
                print(f"  -> Set {seq_name} to {max_id}")
            except Exception as e:
                print(f"  -> Failed for {table_name}: {e}")
        else:
            print(f"  -> Table empty, skipping.")

    print("Sequence sync complete!")

except Exception as e:
    print(f"Error: {e}")
finally:
    if 'conn' in locals():
        conn.close()
