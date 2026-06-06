from database import engine, Base, Settlement

Base.metadata.create_all(bind=engine)
print("Settlements table created successfully.")
