import sqlite3
conn = sqlite3.connect('splitwise_v2.db')
cursor = conn.cursor()
cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='settlements'")
row = cursor.fetchone()
if row:
    print(row[0])
else:
    print("Table settlements not found")
