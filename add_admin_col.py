import os
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DB_URL = os.getenv("DATABASE_URL")
if DB_URL and DB_URL.startswith("postgres://"):
    DB_URL = DB_URL.replace("postgres://", "postgresql://", 1)

engine = create_engine(DB_URL)

try:
    with engine.connect() as conn:
        conn.execute(text("ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;"))
        conn.commit()
        print("Successfully added is_admin column.")
        
        # Make the first user an admin by default
        conn.execute(text("UPDATE users SET is_admin = TRUE WHERE id = 1;"))
        conn.commit()
        print("Successfully set user 1 as admin.")
except Exception as e:
    print(f"Error: {e}")
