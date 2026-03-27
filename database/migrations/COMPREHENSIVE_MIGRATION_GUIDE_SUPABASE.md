╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║  COMPREHENSIVE MIGRATION GUIDE - SUPABASE                                 ║
║  OEM Intervals & Vector Embedding Update                                  ║
║                                                                            ║
║  Platform: Supabase (PostgreSQL + pgvector)                               ║
║  Table: oem_schedules                                                     ║
║  Scope: Fix Toyota oil change intervals and regenerate embeddings         ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
SUPABASE PREREQUISITES
═══════════════════════════════════════════════════════════════════════════════

WHAT YOU NEED:
  ✅ Supabase project with PostgreSQL database
  ✅ pgvector extension enabled (for vector embeddings)
  ✅ Supabase URL and API keys
  ✅ Access to SQL Editor in Supabase dashboard

VERIFY SUPABASE SETUP:
  1. Go to: https://app.supabase.com
  2. Select your project
  3. Go to: Settings > Database > Extensions
  4. Verify: ✅ pgvector is installed

  If NOT installed:
    1. Click "Install" next to pgvector
    2. Wait for installation to complete (~30 seconds)

SUPABASE CONNECTION INFO:
  1. Go to: Settings > Database
  2. Note down:
     ├─ Host: (something like: db.xxxxx.supabase.co)
     ├─ Database: postgres
     ├─ User: postgres
     ├─ Password: (your Supabase database password)
     └─ Port: 5432

☐ Supabase project verified
☐ pgvector extension enabled
☐ Connection info noted


═══════════════════════════════════════════════════════════════════════════════
PHASE 0: SUPABASE-SPECIFIC PREPARATION
═══════════════════════════════════════════════════════════════════════════════

STEP 1: Access Supabase SQL Editor
───────────────────────────────────

Option A: Using Supabase Dashboard (Easiest)
  1. Go to: https://app.supabase.com
  2. Select your project
  3. Click: SQL Editor (left sidebar)
  4. Click: "New query"
  5. You now have a SQL editor

Option B: Using psql (Command Line)
  Connect from terminal:
  
  psql -h db.xxxxx.supabase.co \
       -U postgres \
       -d postgres \
       -p 5432

  When prompted, enter your Supabase database password

Option C: Using DBeaver or TablePlus
  Create new PostgreSQL connection:
    Host: db.xxxxx.supabase.co
    Port: 5432
    Database: postgres
    User: postgres
    Password: [your Supabase password]

☐ Supabase SQL Editor accessible
☐ Can run queries successfully


STEP 2: Verify pgvector Extension
──────────────────────────────────

# Run this query in Supabase SQL Editor
SELECT * FROM pg_extension WHERE extname = 'vector';

# Expected output:
#   extname | extversion | extnamespace | extowner | extrelocatable
#   ────────┼────────────┼──────────────┼──────────┼───────────────
#   vector  | 0.x.x      | ...          | ...      | t

☐ pgvector extension confirmed


STEP 3: Test Vector Column Type
───────────────────────────────

# Verify vector column exists and is correct type
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'oem_schedules'
  AND column_name = 'content_embedding';

# Expected output:
#   column_name       | data_type
#   ─────────────────┼───────────
#   content_embedding | vector

# If it shows "USER-DEFINED" with type "vector", that's also correct

☐ Vector column type verified


═══════════════════════════════════════════════════════════════════════════════
PHASE 1: BACKUP AND AUDIT (SUPABASE-SPECIFIC)
═══════════════════════════════════════════════════════════════════════════════

STEP 4: Export Backup via Supabase Dashboard
──────────────────────────────────────────────

Method 1: Using Supabase Backups (Automatic)
  1. Go to: Settings > Backups
  2. Verify: Daily backups enabled
  3. Click: "Request a backup" (before migration)
  4. Note: Backups are retained for 7 days
  
  This creates an automatic restore point!

Method 2: Manual SQL Backup (via SQL Editor)
  # Create backup table in Supabase
  CREATE TABLE oem_schedules_backup_20240321 AS
  SELECT * FROM oem_schedules;

  # Verify backup created
  SELECT COUNT(*) FROM oem_schedules_backup_20240321;

  # Create specific Toyota oil backup
  CREATE TABLE oem_schedules_toyota_oil_backup AS
  SELECT * FROM oem_schedules
  WHERE make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%';

  SELECT COUNT(*) FROM oem_schedules_toyota_oil_backup;

Method 3: Export via Supabase CLI (Advanced)
  # Install Supabase CLI
  npm install -g supabase

  # Export database
  supabase db dump -f backup_20240321.sql \
    --db-url "postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres"

  # This creates a SQL file you can restore later

☐ Backup method selected and tested


STEP 5: View Current OEM Data in Supabase
──────────────────────────────────────────

# In SQL Editor, run audit queries

# See all Toyota oil changes
SELECT 
    id, year, make, model,
    service_type,
    interval_miles,
    interval_months,
    driving_condition,
    content_embedding IS NOT NULL as has_embedding
FROM oem_schedules
WHERE make = 'TOYOTA' 
  AND service_type LIKE '%OIL%CHANGE%'
ORDER BY year, model, driving_condition;

# Count by interval
SELECT 
    interval_miles,
    COUNT(*) as record_count
FROM oem_schedules
WHERE make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%'
GROUP BY interval_miles
ORDER BY interval_miles DESC;

# Expected: Shows 30000 as current (wrong) value

☐ Current data reviewed
☐ Wrong intervals confirmed


STEP 6: Check Data Before Migration (Optional Dashboard View)
─────────────────────────────────────────────────────────────

# In Supabase Dashboard:
  1. Go to: Table Editor (left sidebar)
  2. Click: oem_schedules table
  3. Filter: make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%'
  4. Review current data visually
  5. Take screenshot for reference

☐ Data reviewed in Table Editor


═══════════════════════════════════════════════════════════════════════════════
PHASE 2: DATA MIGRATION (4 UPDATE STATEMENTS)
═══════════════════════════════════════════════════════════════════════════════

IMPORTANT: Run each UPDATE in a separate SQL query in Supabase SQL Editor

STEP 7: Update SYNTHETIC OIL - NORMAL DRIVING
───────────────────────────────────────────────

# Copy-paste this entire query into Supabase SQL Editor
# Click "RUN" button

UPDATE oem_schedules
SET 
    interval_miles = 10000,
    interval_months = 12,
    notes = CONCAT(
        COALESCE(notes, ''),
        CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END,
        'CORRECTED (2024-03-21): Synthetic oil interval per Toyota owner manual - Normal driving: 10,000 mi / 12 months'
    ),
    citation = 'Toyota Official Maintenance Schedule - Synthetic Oil (Normal Driving)',
    content_embedding = NULL
WHERE 
    make = 'TOYOTA'
    AND service_type LIKE '%OIL%CHANGE%'
    AND driving_condition = 'normal'
    AND (
        service_type LIKE '%SYNTHETIC%'
        OR service_type LIKE '%0W-%'
        OR service_type LIKE '%0W20%'
        OR service_type LIKE '%0W16%'
        OR service_type LIKE '%5W30%'
        OR notes LIKE '%SYNTHETIC%'
        OR notes LIKE '%0W-%'
        OR notes LIKE '%FULL SYNTHETIC%'
    )
    AND interval_miles != 10000;

# Expected output in Supabase:
# "Update 1 row" or similar (1-3 rows depending on your data)

# Verify with this query in next SQL Editor query:
SELECT COUNT(*) as rows_updated FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND driving_condition = 'normal'
  AND interval_miles = 10000
  AND content_embedding IS NULL;

Expected: 1-3 rows

☐ Synthetic normal driving updated


STEP 8: Update SYNTHETIC OIL - SEVERE DRIVING
───────────────────────────────────────────────

UPDATE oem_schedules
SET 
    interval_miles = 5000,
    interval_months = 6,
    notes = CONCAT(
        COALESCE(notes, ''),
        CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END,
        'CORRECTED (2024-03-21): Synthetic oil interval per Toyota owner manual - Severe driving: 5,000 mi / 6 months'
    ),
    citation = 'Toyota Official Maintenance Schedule - Synthetic Oil (Severe Driving)',
    content_embedding = NULL
WHERE 
    make = 'TOYOTA'
    AND service_type LIKE '%OIL%CHANGE%'
    AND driving_condition = 'severe'
    AND (
        service_type LIKE '%SYNTHETIC%'
        OR service_type LIKE '%0W-%'
        OR service_type LIKE '%0W20%'
        OR service_type LIKE '%0W16%'
        OR service_type LIKE '%5W30%'
        OR notes LIKE '%SYNTHETIC%'
        OR notes LIKE '%0W-%'
        OR notes LIKE '%FULL SYNTHETIC%'
    )
    AND interval_miles != 5000;

# Verify:
SELECT COUNT(*) as rows_updated FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND driving_condition = 'severe'
  AND interval_miles = 5000
  AND content_embedding IS NULL;

Expected: 1-3 rows

☐ Synthetic severe driving updated


STEP 9: Update REGULAR OIL - NORMAL DRIVING
─────────────────────────────────────────────

UPDATE oem_schedules
SET 
    interval_miles = 5000,
    interval_months = 6,
    notes = CONCAT(
        COALESCE(notes, ''),
        CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END,
        'CORRECTED (2024-03-21): Regular oil interval per Toyota owner manual - Normal driving: 5,000 mi / 6 months'
    ),
    citation = 'Toyota Official Maintenance Schedule - Regular Oil (Normal Driving)',
    content_embedding = NULL
WHERE 
    make = 'TOYOTA'
    AND service_type LIKE '%OIL%CHANGE%'
    AND driving_condition = 'normal'
    AND (
        service_type NOT LIKE '%SYNTHETIC%'
        AND service_type NOT LIKE '%0W-%'
        AND service_type NOT LIKE '%5W30 SYN%'
        AND COALESCE(notes, '') NOT LIKE '%SYNTHETIC%'
        AND COALESCE(notes, '') NOT LIKE '%0W-%'
    )
    AND interval_miles != 5000;

# Verify:
SELECT COUNT(*) as rows_updated FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND driving_condition = 'normal'
  AND NOT (service_type LIKE '%SYNTHETIC%' OR notes LIKE '%SYNTHETIC%')
  AND content_embedding IS NULL;

Expected: 1-3 rows

☐ Regular normal driving updated


STEP 10: Update REGULAR OIL - SEVERE DRIVING
──────────────────────────────────────────────

UPDATE oem_schedules
SET 
    interval_miles = 5000,
    interval_months = 3,
    notes = CONCAT(
        COALESCE(notes, ''),
        CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END,
        'CORRECTED (2024-03-21): Regular oil interval per Toyota owner manual - Severe driving: 5,000 mi / 3 months'
    ),
    citation = 'Toyota Official Maintenance Schedule - Regular Oil (Severe Driving)',
    content_embedding = NULL
WHERE 
    make = 'TOYOTA'
    AND service_type LIKE '%OIL%CHANGE%'
    AND driving_condition = 'severe'
    AND (
        service_type NOT LIKE '%SYNTHETIC%'
        AND service_type NOT LIKE '%0W-%'
        AND service_type NOT LIKE '%5W30 SYN%'
        AND COALESCE(notes, '') NOT LIKE '%SYNTHETIC%'
        AND COALESCE(notes, '') NOT LIKE '%0W-%'
    )
    AND interval_miles != 5000;

# Verify:
SELECT COUNT(*) as rows_updated FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND driving_condition = 'severe'
  AND NOT (service_type LIKE '%SYNTHETIC%' OR notes LIKE '%SYNTHETIC%')
  AND content_embedding IS NULL;

Expected: 1-3 rows

☐ Regular severe driving updated
☐ All 4 UPDATE statements completed


═══════════════════════════════════════════════════════════════════════════════
PHASE 3: VERIFY DATA UPDATES
═══════════════════════════════════════════════════════════════════════════════

STEP 11: Verify All Intervals Updated
──────────────────────────────────────

# Run this verification query
SELECT 
    driving_condition,
    CASE 
        WHEN service_type LIKE '%SYNTHETIC%' OR notes LIKE '%SYNTHETIC%'
        THEN 'SYNTHETIC'
        ELSE 'REGULAR'
    END as oil_type,
    interval_miles,
    interval_months,
    COUNT(*) as count
FROM oem_schedules
WHERE make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%'
GROUP BY driving_condition, oil_type, interval_miles, interval_months
ORDER BY oil_type, driving_condition;

# Expected output:
#   driving_condition | oil_type  | interval_miles | interval_months | count
#   ─────────────────┼───────────┼────────────────┼─────────────────┼──────
#   normal            | SYNTHETIC | 10000          | 12              | 1-3
#   severe            | SYNTHETIC | 5000           | 6               | 1-3
#   normal            | REGULAR   | 5000           | 6               | 1-3
#   severe            | REGULAR   | 5000           | 3               | 1-3

# NO 30000 values should appear!

☐ All intervals correct (no 30000)
☐ All 4 combinations present


STEP 12: Verify Vector Column Reset
────────────────────────────────────

# Check how many embeddings are NULL
SELECT 
    COUNT(*) as total_toyota_oil_records,
    COUNT(CASE WHEN content_embedding IS NULL THEN 1 END) as null_embeddings,
    COUNT(CASE WHEN content_embedding IS NOT NULL THEN 1 END) as embedded_records
FROM oem_schedules
WHERE make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%';

# Expected: null_embeddings should be greater than 0
# (shows that content_embedding = NULL worked)

☐ Vector column reset verified


STEP 13: Verify Data Integrity
───────────────────────────────

# Check notes field updated
SELECT id, model, driving_condition, 
       SUBSTRING(notes, 1, 100) as notes_preview
FROM oem_schedules
WHERE make = 'TOYOTA' 
  AND service_type LIKE '%OIL%CHANGE%'
  AND notes LIKE '%CORRECTED%'
ORDER BY year, model;

# All should show "CORRECTED (2024-03-21)"

☐ Notes field updated
☐ Citation field updated


═══════════════════════════════════════════════════════════════════════════════
PHASE 4: VECTOR EMBEDDING REGENERATION (SUPABASE-SPECIFIC)
═══════════════════════════════════════════════════════════════════════════════

IMPORTANT NOTE: Supabase doesn't have a built-in embedding regeneration service.
You must run the Python embedding job from your backend application.

STEP 14: Prepare Backend for Embedding Job
────────────────────────────────────────────

# In your backend project directory:
cd /home/claude/maintenanceguard-mvp/backend

# Verify you have the embedding service
ls -la app/services/embedding_service.py

# If it doesn't exist, we'll use a direct Python script

# Check Python version
python --version
# Expected: Python 3.10+

# Verify database connection string is correct
# In your .env file, check:
cat .env | grep DATABASE_URL

# It should be something like:
# DATABASE_URL=postgresql://postgres:[password]@db.xxxxx.supabase.co:5432/postgres

# Verify it works:
python << 'EOF'
import os
from sqlalchemy import create_engine, text

db_url = os.getenv('DATABASE_URL')
print(f"Database URL: {db_url[:50]}...")

engine = create_engine(db_url)
with engine.connect() as conn:
    result = conn.execute(text("SELECT 1"))
    print("✅ Database connection successful")
EOF

☐ Backend environment ready
☐ Database connection verified


STEP 15: Create Embedding Regeneration Script
────────────────────────────────────────────────

# Create a Python script to regenerate embeddings
# Save as: backend/scripts/regenerate_embeddings.py

cat > backend/scripts/regenerate_embeddings.py << 'EOF'
#!/usr/bin/env python
"""
Regenerate embeddings for OEM schedules
Compatible with Supabase pgvector
"""

import os
import sys
from sqlalchemy import create_engine, text
from sentence_transformers import SentenceTransformer
import psycopg2
from psycopg2.extras import execute_values

# Configuration
DATABASE_URL = os.getenv('DATABASE_URL')
MODEL_NAME = 'all-MiniLM-L6-v2'  # 384-dimensional embeddings
BATCH_SIZE = 10

def regenerate_embeddings(make='TOYOTA', service_type_pattern='%OIL%CHANGE%'):
    """Regenerate embeddings for OEM schedules"""
    
    print(f"🔄 Starting embedding regeneration...")
    print(f"   Model: {MODEL_NAME}")
    print(f"   Make: {make}")
    
    # Load embedding model
    print(f"📦 Loading embedding model...")
    model = SentenceTransformer(MODEL_NAME)
    print(f"✅ Model loaded")
    
    # Connect to database
    print(f"🔗 Connecting to Supabase...")
    engine = create_engine(DATABASE_URL)
    
    # Get records with NULL embeddings
    print(f"🔍 Finding records with NULL embeddings...")
    with engine.connect() as conn:
        query = text("""
            SELECT id, service_type, notes, citation
            FROM oem_schedules
            WHERE make = :make
            AND service_type LIKE :service_type
            AND content_embedding IS NULL
            ORDER BY id
        """)
        
        result = conn.execute(query, {
            'make': make,
            'service_type': service_type_pattern
        })
        records = result.fetchall()
    
    if not records:
        print("✅ No records with NULL embeddings found")
        return 0
    
    print(f"📊 Found {len(records)} records to embed")
    
    # Prepare texts for embedding
    texts = []
    record_ids = []
    
    for record in records:
        id_, service_type, notes, citation = record
        # Combine text for embedding
        text = f"{service_type} {notes or ''} {citation or ''}"
        texts.append(text)
        record_ids.append(id_)
    
    # Generate embeddings
    print(f"🧠 Generating embeddings...")
    embeddings = model.encode(texts, show_progress_bar=True)
    print(f"✅ Generated {len(embeddings)} embeddings")
    
    # Update database with embeddings
    print(f"💾 Updating database...")
    
    # Use psycopg2 for pgvector support
    conn = psycopg2.connect(DATABASE_URL)
    cursor = conn.cursor()
    
    try:
        for i, (record_id, embedding) in enumerate(zip(record_ids, embeddings)):
            embedding_list = embedding.tolist()
            
            # Update with vector
            cursor.execute("""
                UPDATE oem_schedules
                SET content_embedding = %s::vector
                WHERE id = %s
            """, (str(embedding_list), record_id))
            
            if (i + 1) % 10 == 0:
                print(f"  ✓ Updated {i + 1}/{len(record_ids)} records")
        
        conn.commit()
        print(f"✅ All embeddings updated successfully")
        
    except Exception as e:
        conn.rollback()
        print(f"❌ Error updating embeddings: {e}")
        raise
    finally:
        cursor.close()
        conn.close()
    
    return len(records)

if __name__ == '__main__':
    try:
        count = regenerate_embeddings()
        print(f"\n✅ COMPLETE: Regenerated {count} embeddings")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        sys.exit(1)
EOF

chmod +x backend/scripts/regenerate_embeddings.py

☐ Embedding script created


STEP 16: Install Required Python Packages
────────────────────────────────────────────

# In backend directory
cd /home/claude/maintenanceguard-mvp/backend

# Install required packages
pip install sentence-transformers torch psycopg2-binary --break-system-packages

# Verify installation
python -c "from sentence_transformers import SentenceTransformer; import psycopg2; print('✅ All packages installed')"

☐ Packages installed


STEP 17: Run Embedding Regeneration Script
────────────────────────────────────────────

# Make sure DATABASE_URL is set
export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres"

# Run the embedding script
cd /home/claude/maintenanceguard-mvp/backend
python scripts/regenerate_embeddings.py

# Expected output:
# 🔄 Starting embedding regeneration...
# 📦 Loading embedding model...
# ✅ Model loaded
# 🔗 Connecting to Supabase...
# 🔍 Finding records with NULL embeddings...
# 📊 Found 4 records to embed
# 🧠 Generating embeddings...
# ✅ Generated 4 embeddings
# 💾 Updating database...
#   ✓ Updated 4/4 records
# ✅ All embeddings updated successfully
# 
# ✅ COMPLETE: Regenerated 4 embeddings

# Timeline:
# - Load model: ~10 seconds
# - Generate embeddings: ~5 seconds (4 records)
# - Update database: ~2 seconds
# Total: ~17 seconds

☐ Embedding regeneration completed successfully


═══════════════════════════════════════════════════════════════════════════════
PHASE 5: VERIFY EMBEDDINGS
═══════════════════════════════════════════════════════════════════════════════

STEP 18: Verify Embeddings Generated
─────────────────────────────────────

# Run in Supabase SQL Editor
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN content_embedding IS NOT NULL THEN 1 END) as embedded_records,
    COUNT(CASE WHEN content_embedding IS NULL THEN 1 END) as null_embeddings
FROM oem_schedules
WHERE make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%';

# Expected:
# total_records | embedded_records | null_embeddings
# ──────────────┼──────────────────┼────────────────
# 4-12          | 4-12             | 0

☐ All embeddings generated


STEP 19: Check Embedding Dimensions
────────────────────────────────────

# Verify embedding dimensions are 384
SELECT 
    id, model, driving_condition,
    ARRAY_LENGTH(content_embedding, 1) as embedding_dimensions
FROM oem_schedules
WHERE make = 'TOYOTA' 
  AND service_type LIKE '%OIL%CHANGE%'
  AND content_embedding IS NOT NULL
LIMIT 3;

# Expected: embedding_dimensions = 384 for all records

☐ Embedding dimensions correct


═══════════════════════════════════════════════════════════════════════════════
PHASE 6: APPLICATION TESTING
═══════════════════════════════════════════════════════════════════════════════

STEP 20: Restart Backend Application
──────────────────────────────────────

# Option A: Using Docker (if containerized)
docker restart maintenanceguard-backend
sleep 10

# Option B: Using docker-compose
cd /home/claude/maintenanceguard-mvp
docker-compose restart maintenanceguard-backend
sleep 10

# Option C: Local Python development
# Stop current backend (Ctrl+C)
# Then restart:
cd /home/claude/maintenanceguard-mvp/backend
python -m uvicorn app.main:app --reload

# Option D: Check if using Supabase hosting
# If frontend/backend hosted on Supabase:
# - Go to Supabase Dashboard > Functions
# - Redeploy functions (if applicable)

☐ Backend restarted


STEP 21: Test ARIA Chatbot
──────────────────────────

# Open browser: http://localhost:5173
# Navigate to: Fleet Overview
# Open ARIA chat

# Test 1: Oil Change Interval
Ask ARIA: "What's the OEM oil change interval for synthetic oil?"

Expected:
  ✅ "Synthetic oil should be changed every 10,000 miles..."
  ✅ Shows 10,000 (NOT 30,000)
  ✅ References Toyota official schedule

# Test 2: Your Prius Case
Ask ARIA: "My 2010 Prius has 11,093 miles since last oil change. Is that an upsell?"

Expected:
  ✅ "No, this is legitimate. You've exceeded the 10,000-mile interval..."
  ✅ Correctly evaluates service
  ✅ Uses updated OEM data

# Test 3: Severe Driving
Ask ARIA: "What if I do severe driving (lots of stop-and-go)?"

Expected:
  ✅ "Change oil every 5,000 miles under severe conditions..."
  ✅ Reflects correct intervals

☐ ARIA responds correctly
☐ Uses updated OEM data


STEP 22: Test Upsell Detection
───────────────────────────────

# Navigate to Recommendations or Service History
# Look for oil change services

# Expected behavior:
# ✅ Oil at 11,093 miles: NOT flagged as upsell
# ✅ Oil at 4,000 miles: Flagged as upsell (too soon)
# ✅ Shows OEM interval: 10,000 or 5,000 (NOT 30,000)

☐ Upsell detection accurate
☐ Recommendations updated


═══════════════════════════════════════════════════════════════════════════════
PHASE 7: SUPABASE-SPECIFIC CLEANUP
═══════════════════════════════════════════════════════════════════════════════

STEP 23: Enable Row Level Security (Optional but Recommended)
─────────────────────────────────────────────────────────────

# In Supabase Dashboard:
# 1. Go to: Authentication > Users
# 2. Verify you have user accounts
# 3. Go to: SQL Editor
# 4. Create RLS policies for oem_schedules:

-- Allow read access to authenticated users
CREATE POLICY "Enable read access for authenticated users" ON "public"."oem_schedules"
AS PERMISSIVE FOR SELECT
TO authenticated
USING (true);

-- You may want to restrict updates to admin only
-- Create an admin role and assign UPDATE permissions

☐ RLS policies reviewed


STEP 24: Document Migration in Supabase
────────────────────────────────────────

# Create a migration log table in Supabase
CREATE TABLE migration_log (
    id SERIAL PRIMARY KEY,
    migration_name VARCHAR(255) NOT NULL,
    migration_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    description TEXT,
    status VARCHAR(50),
    records_affected INT,
    notes TEXT
);

# Log this migration
INSERT INTO migration_log (
    migration_name,
    description,
    status,
    records_affected,
    notes
) VALUES (
    'OEM_INTERVALS_AND_VECTORS_20240321',
    'Update Toyota oil change intervals from 30000 to 10000/5000 and regenerate embeddings',
    'COMPLETED',
    4,
    'Synthetic: 10k/5k (normal/severe), Regular: 5k/3k (normal/severe). All pgvector embeddings regenerated.'
);

☐ Migration logged


STEP 25: Export Updated Data (Optional Backup)
───────────────────────────────────────────────

# Export updated OEM schedules for records
# Option A: Via SQL (copy paste results)
SELECT * FROM oem_schedules
WHERE make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%'
ORDER BY year, model, driving_condition;

# Copy results to file/notes for reference

# Option B: Via Supabase CLI
supabase db dump -f backup_after_migration_20240321.sql \
  --db-url "postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres"

☐ Updated data documented


═══════════════════════════════════════════════════════════════════════════════
PHASE 8: POST-MIGRATION MONITORING (SUPABASE)
═══════════════════════════════════════════════════════════════════════════════

STEP 26: Monitor Supabase Database Health
────────────────────────────────────────────

# In Supabase Dashboard:
# 1. Go to: Settings > Database
# 2. Check: Database Size (should not increase significantly)
# 3. Check: Connection Count (should be normal)
# 4. Go to: Logs > Postgres Logs (check for errors)

Expected:
  ✅ No error logs
  ✅ Database size unchanged (only metadata updated)
  ✅ Normal connection count

☐ Database health verified


STEP 27: Monitor Application Performance
─────────────────────────────────────────

# Check for any performance issues
# In your application:
  ✅ ARIA chatbot response time normal
  ✅ Recommendations load quickly
  ✅ No timeout errors
  ✅ No embedding-related errors in logs

# If using Supabase with Vercel:
  1. Go to: Vercel Dashboard
  2. Check: Function duration, Edge Function logs
  3. Verify: No new errors related to database queries

☐ Application performance normal


STEP 28: Final Validation Query (Run Daily for 1 Week)
──────────────────────────────────────────────────────

# Create a saved query in Supabase for ongoing monitoring
# SQL Editor > New query > Save as "OEM_Intervals_Health_Check"

SELECT 
    COUNT(*) as total_toyota_oil,
    COUNT(CASE WHEN interval_miles IN (5000, 10000) THEN 1 END) as correct_intervals,
    COUNT(CASE WHEN interval_miles NOT IN (5000, 10000, 3000) THEN 1 END) as anomalies,
    COUNT(CASE WHEN content_embedding IS NULL THEN 1 END) as null_embeddings,
    COUNT(CASE WHEN content_embedding IS NOT NULL THEN 1 END) as valid_embeddings
FROM oem_schedules
WHERE make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%';

# Expected:
# total_toyota_oil | correct_intervals | anomalies | null_embeddings | valid_embeddings
# ────────────────┼───────────────────┼───────────┼─────────────────┼──────────────────
# 4-12            | 4-12              | 0         | 0               | 4-12

# Run this query:
# - Today
# - Tomorrow
# - Throughout week 1

☐ Ongoing monitoring established


═══════════════════════════════════════════════════════════════════════════════
SUPABASE-SPECIFIC NOTES & TROUBLESHOOTING
═══════════════════════════════════════════════════════════════════════════════

COMMON ISSUES WITH SUPABASE:

Issue 1: "pgvector not installed" error
  Solution:
    1. Go to: Settings > Extensions
    2. Search for: vector
    3. Click: Install
    4. Wait 30 seconds
    5. Retry migration

Issue 2: Connection timeout during embedding job
  Solution:
    1. Check Supabase dashboard for any maintenance windows
    2. Verify DATABASE_URL is correct
    3. Try running embedding script again
    4. If persistent, contact Supabase support

Issue 3: "Vector dimension mismatch" error
  Solution:
    1. Verify model: all-MiniLM-L6-v2 (384 dimensions)
    2. Check existing embeddings have same dimensions
    3. May need to clear old embeddings and regenerate

Issue 4: Rate limiting on embedding generation
  Solution:
    1. Reduce BATCH_SIZE in embedding script
    2. Add delays between batch updates
    3. Run during off-peak hours

SUPABASE LIMITS TO KNOW:
  ├─ Database size: Depends on plan (free: 500 MB)
  ├─ Connections: 100 concurrent (free plan)
  ├─ Vector columns: No explicit limit per pgvector
  ├─ Query timeout: 30 seconds
  └─ Backup retention: 7 days

ROLLBACK PROCEDURE (If Something Goes Wrong):

Method 1: Use Supabase Backups
  1. Go to: Settings > Backups
  2. Click: Restore from [date before migration]
  3. Confirm rollback
  4. System restores entire database to that point
  
  Time to restore: 5-15 minutes

Method 2: Using Backup Table
  TRUNCATE TABLE oem_schedules;
  INSERT INTO oem_schedules SELECT * FROM oem_schedules_backup_20240321;

Method 3: Using SQL Backup File (if exported with supabase cli)
  supabase db reset  # Reset to fresh state
  psql < backup_before_migration.sql  # Restore from file

═══════════════════════════════════════════════════════════════════════════════
MIGRATION CHECKLIST - SUPABASE
═══════════════════════════════════════════════════════════════════════════════

PHASE 0: PREPARATION
  ☐ Supabase SQL Editor accessible
  ☐ pgvector extension enabled
  ☐ Can run queries successfully

PHASE 1: BACKUP & AUDIT
  ☐ Supabase backup requested
  ☐ Backup tables created
  ☐ Current data reviewed
  ☐ Counts documented

PHASE 2: DATA MIGRATION
  ☐ Synthetic normal UPDATE executed
  ☐ Synthetic severe UPDATE executed
  ☐ Regular normal UPDATE executed
  ☐ Regular severe UPDATE executed
  ☐ content_embedding = NULL verified for all

PHASE 3: VERIFY UPDATES
  ☐ All intervals correct (no 30000)
  ☐ All 4 combinations present (synthetic/regular, normal/severe)
  ☐ Vector column reset verified
  ☐ Data integrity confirmed

PHASE 4: VECTOR EMBEDDING REGENERATION
  ☐ Backend environment ready
  ☐ Embedding script created
  ☐ Required packages installed
  ☐ Embedding job completed successfully
  ☐ No errors in output

PHASE 5: VERIFY EMBEDDINGS
  ☐ All embeddings generated (count = total_records)
  ☐ Embedding dimensions = 384
  ☐ No NULL embeddings remain

PHASE 6: APPLICATION TESTING
  ☐ Backend restarted successfully
  ☐ ARIA chatbot tested - correct intervals shown
  ☐ Your Prius case tested correctly
  ☐ Upsell detection verified

PHASE 7: CLEANUP
  ☐ RLS policies reviewed
  ☐ Migration logged
  ☐ Updated data documented

PHASE 8: MONITORING
  ☐ Database health verified
  ☐ Application performance normal
  ☐ Health check query created

ALL COMPLETE ✅ - MIGRATION SUCCESSFUL

═══════════════════════════════════════════════════════════════════════════════
NEXT STEPS
═══════════════════════════════════════════════════════════════════════════════

1. APPLY TO OTHER MANUFACTURERS
   - Same process for Honda, Nissan, etc.
   - Identify correct OEM intervals first
   - Use same 4-UPDATE pattern

2. AUDIT OTHER SERVICES
   - Check intervals for: Spark plugs, filters, transmission fluid
   - Many may have wrong data

3. IMPLEMENT AUTOMATED EMBEDDING REGENERATION
   - Add embedding job to your deployment pipeline
   - Run after any OEM schedule updates

4. CREATE OEM DATA VALIDATION
   - Implement checks to prevent wrong intervals
   - Compare against official manufacturer specs

═══════════════════════════════════════════════════════════════════════════════
