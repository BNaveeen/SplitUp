import os
from dotenv import load_dotenv
from sqlalchemy import text
from database import engine

load_dotenv()

def migrate():
    with engine.connect() as conn:
        try:
            conn.execute(text("ALTER TABLE notifications ADD COLUMN group_id INTEGER;"))
            conn.commit()
            print("Added group_id")
        except Exception as e:
            print("group_id error:", e)
            
        try:
            conn.execute(text("ALTER TABLE notifications ADD COLUMN expense_id INTEGER;"))
            conn.commit()
            print("Added expense_id")
        except Exception as e:
            print("expense_id error:", e)

if __name__ == "__main__":
    migrate()
