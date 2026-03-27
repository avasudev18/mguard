import psycopg2

conn = psycopg2.connect('postgresql://postgres.xblrldqprkjbgecxjqdi:MaintenanceGuard2024@aws-1-us-east-1.pooler.supabase.com:6543/postgres')
cur = conn.cursor()

cur.execute('ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_vin_key;')
cur.execute('DROP INDEX IF EXISTS idx_vehicles_vin;')
cur.execute('CREATE INDEX IF NOT EXISTS idx_vehicles_vin ON vehicles(vin) WHERE vin IS NOT NULL;')
conn.commit()

cur.execute("SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'vehicles'")
rows = cur.fetchall()
for row in rows:
    print(row)

conn.close()
print("Done.")
