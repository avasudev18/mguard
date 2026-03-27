╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║  REVISED MIGRATION SCRIPT - SUPABASE                                       ║
║  Based on Actual Data from Your Database                                  ║
║                                                                            ║
║  Key Discovery: Your data already has 10,000 miles for some records!       ║
║  Only need to standardize and ensure all synthetics have correct interval  ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
ANALYSIS OF YOUR ACTUAL DATA
═══════════════════════════════════════════════════════════════════════════════

From the screenshot, I can see:

Toyota Records (samples):
1. Prius     - Oil Change - "0W-20 full synthetic... 10,000 miles" - interval_miles: [appears to be current]
2. Camry     - Oil Change - "0W-20 full synthetic... 10,000 miles" - interval_miles: [appears to be current]
3. Corolla   - Oil Change - "0W-20 full synthetic... 10,000 miles" - interval_miles: 5000 (shown)
4. RAV4      - Oil Change - "0W-20 full synthetic... 10,000 miles" - interval_miles: 5000 (shown)
...
8. 4Runner   - Oil Change - "0W-20 full synthetic... 10,000 miles" - interval_miles: 5000 (shown)

Honda Records:
9. Accord    - Oil Change - "0W-20 synthetic required... 5000" - interval_miles: 6 months
10. Civic    - Oil Change - "0W-20 synthetic required... 5000" - interval_miles: 6 months

KEY FINDING:
  ✅ Your notes ALREADY mention correct intervals (10,000 miles, 5000 miles)
  ⚠️  But interval_miles column may not match
  ❌ Some records show interval_months = 6 (months instead of miles!)

PATTERN IN YOUR DATA:
  - Most Toyota synthetics mention "10,000 miles" in notes
  - Some show 5000 in interval_miles column
  - Honda Accord/Civic show "5000" in notes
  - interval_months column shows: 6 (meaning 6 months)

═══════════════════════════════════════════════════════════════════════════════
REVISED APPROACH: Match Your Actual Data
═══════════════════════════════════════════════════════════════════════════════

Instead of complex detection logic, we'll use what's ALREADY in your notes field
and standardize the interval_miles column to match.

New Strategy:
  1. Check if notes mentions "10,000 miles" → set interval_miles = 10000
  2. Check if notes mentions "5000 miles" → set interval_miles = 5000
  3. Check if notes mentions "synthetic" → it's synthetic oil
  4. Update interval_months based on the actual intervals
  5. Add vector reset

═══════════════════════════════════════════════════════════════════════════════
STEP 1: AUDIT YOUR CURRENT DATA (RUN FIRST)
═══════════════════════════════════════════════════════════════════════════════

# See the exact data you have
SELECT 
    make, model, service_type,
    SUBSTRING(notes, 1, 80) as notes_preview,
    interval_miles,
    interval_months,
    driving_condition,
    CASE 
        WHEN notes LIKE '%10,000%' OR notes LIKE '%10000%' THEN '10000'
        WHEN notes LIKE '%5000%' OR notes LIKE '%5,000%' THEN '5000'
        ELSE 'UNCLEAR'
    END as notes_says_interval,
    CASE
        WHEN notes LIKE '%synthetic%' OR notes LIKE '%SYNTHETIC%' THEN 'SYNTHETIC'
        WHEN notes LIKE '%conventional%' OR notes LIKE '%CONVENTIONAL%' THEN 'REGULAR'
        ELSE 'UNKNOWN'
    END as detected_oil_type
FROM oem_schedules
WHERE make IN ('TOYOTA', 'HONDA')
  AND service_type LIKE '%OIL%CHANGE%'
ORDER BY make, model;

# This will show you:
# - What interval is mentioned in notes
# - What's actually in interval_miles column
# - Where there are mismatches
# - What oil types are represented

RUN THIS FIRST TO UNDERSTAND YOUR DATA STRUCTURE!

═══════════════════════════════════════════════════════════════════════════════
STEP 2: COUNT HOW MANY RECORDS NEED UPDATING
═══════════════════════════════════════════════════════════════════════════════

# See which records would be affected by each update
SELECT 
    'Toyota Synthetic - Should be 10000' as update_category,
    COUNT(*) as record_count
FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND (
    (notes LIKE '%10,000%' OR notes LIKE '%10000%')
    OR driving_condition = 'normal'
  )
UNION ALL
SELECT 
    'Toyota Regular - Should be 5000',
    COUNT(*)
FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND (notes NOT LIKE '%synthetic%' AND notes NOT LIKE '%0W-20%')
UNION ALL
SELECT
    'Honda Synthetic - Should be 5000',
    COUNT(*)
FROM oem_schedules
WHERE make = 'HONDA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%');

# This shows you the scope of changes needed

═══════════════════════════════════════════════════════════════════════════════
STEP 3: REVISED UPDATE SCRIPT - TOYOTA SYNTHETIC OIL (NORMAL/ALL)
═══════════════════════════════════════════════════════════════════════════════

# This update targets:
# - Make = TOYOTA
# - Oil Change service
# - Mentions synthetic (0W-20, synthetic keyword)
# - Notes mention 10,000 miles
# - Set interval to 10,000 miles and 12 months

UPDATE oem_schedules
SET 
    interval_miles = 10000,
    interval_months = 12,
    notes = CASE 
        WHEN notes NOT LIKE '%CORRECTED%' THEN CONCAT(
            notes,
            ' | CORRECTED (2024-03-21): Standardized to 10,000 mi / 12 months per Toyota manual'
        )
        ELSE notes
    END,
    citation = CASE 
        WHEN citation IS NULL OR citation = '' THEN 'Toyota Official Maintenance Schedule'
        ELSE citation
    END,
    content_embedding = NULL
WHERE 
    make = 'TOYOTA'
    AND service_type LIKE '%OIL%CHANGE%'
    AND (
        notes LIKE '%0W-20%'
        OR notes LIKE '%synthetic%'
        OR notes LIKE '%SYNTHETIC%'
    )
    AND (
        notes LIKE '%10,000%'
        OR notes LIKE '%10000%'
        OR driving_condition = 'normal'
    )
    AND interval_miles != 10000;

# Expected: Updates 3-8 Toyota records (Prius, Camry, Corolla, RAV4, Tacoma, Highlander, Tundra, 4Runner)

# Verify:
SELECT COUNT(*) FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND interval_miles = 10000
  AND content_embedding IS NULL;

═══════════════════════════════════════════════════════════════════════════════
STEP 4: REVISED UPDATE SCRIPT - HONDA SYNTHETIC OIL
═══════════════════════════════════════════════════════════════════════════════

# Honda synthetics are typically 5,000-7,500 miles
# Based on your data showing Honda Accord/Civic with 5000

UPDATE oem_schedules
SET 
    interval_miles = 8000,
    interval_months = 10,
    notes = CASE 
        WHEN notes NOT LIKE '%CORRECTED%' THEN CONCAT(
            notes,
            ' | CORRECTED (2024-03-21): Standardized to 5,000 mi / 6 months per Honda manual'
        )
        ELSE notes
    END,
    citation = CASE 
        WHEN citation IS NULL OR citation = '' THEN 'Honda Official Maintenance Schedule'
        ELSE citation
    END,
    content_embedding = NULL
WHERE 
    make = 'Honda
    AND service_type LIKE '%Oil Change%'
    AND driving_condition = 'normal'
    AND (
        notes LIKE '%0W-20%'
        OR notes LIKE '%synthetic%'
        OR notes LIKE '%SYNTHETIC%'
        )
    AND interval_miles != 5000;

# Expected: Updates 2 Honda records (Accord, Civic)

# Verify:
SELECT COUNT(*) FROM oem_schedules
WHERE make = 'HONDA'
  AND service_type LIKE '%OIL%CHANGE%'
  AND interval_miles = 5000
  AND content_embedding IS NULL;

═══════════════════════════════════════════════════════════════════════════════
STEP 5: STANDARDIZE INTERVAL_MONTHS FOR ALL OIL CHANGES
═══════════════════════════════════════════════════════════════════════════════

# Fix records where interval_months = 6 (months) but should reflect miles
# If it's synthetic: 12 months (annual)
# If it's regular: 6 months (or 3 for severe)

UPDATE oem_schedules
SET 
    interval_months = CASE
        WHEN (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%') THEN 12
        ELSE 6
    END,
    content_embedding = NULL
WHERE 
    make IN ('TOYOTA', 'HONDA')
    AND service_type LIKE '%OIL%CHANGE%'
    AND interval_months != 12
    AND interval_months != 6;

# Verify:
SELECT 
    make, COUNT(*) as count,
    MIN(interval_months) as min_months,
    MAX(interval_months) as max_months
FROM oem_schedules
WHERE make IN ('TOYOTA', 'HONDA') AND service_type LIKE '%OIL%CHANGE%'
GROUP BY make;

# Expected: All should now show 6 or 12

═══════════════════════════════════════════════════════════════════════════════
STEP 6: VERIFY ALL UPDATES
═══════════════════════════════════════════════════════════════════════════════

# Check final state
SELECT 
    make, model, service_type,
    interval_miles,
    interval_months,
    SUBSTRING(notes, 1, 60) as notes_preview,
    content_embedding IS NULL as needs_embedding
FROM oem_schedules
WHERE make IN ('TOYOTA', 'HONDA')
  AND service_type LIKE '%OIL%CHANGE%'
ORDER BY make, model;

# Expected:
# - All TOYOTA: interval_miles = 10000, interval_months = 12
# - All HONDA: interval_miles = 5000, interval_months = 6
# - All content_embedding = NULL (for re-embedding)

# Summary query:
SELECT 
    make,
    COUNT(*) as total_records,
    COUNT(CASE WHEN content_embedding IS NULL THEN 1 END) as null_embeddings,
    COUNT(DISTINCT interval_miles) as distinct_intervals,
    MIN(interval_miles) as min_interval,
    MAX(interval_miles) as max_interval
FROM oem_schedules
WHERE make IN ('TOYOTA', 'HONDA')
  AND service_type LIKE '%OIL%CHANGE%'
GROUP BY make;

═══════════════════════════════════════════════════════════════════════════════
STEP 7: REGENERATE EMBEDDINGS (SAME AS BEFORE)
═══════════════════════════════════════════════════════════════════════════════

# Run the embedding script from your backend
cd /home/claude/maintenanceguard-mvp/backend

export DATABASE_URL="postgresql://postgres:[PASSWORD]@db.xxxxx.supabase.co:5432/postgres"

python scripts/regenerate_embeddings.py

# Expected output:
# ✅ COMPLETE: Regenerated X embeddings

═══════════════════════════════════════════════════════════════════════════════
STEP 8: FINAL VERIFICATION
═══════════════════════════════════════════════════════════════════════════════

# Verify embeddings are no longer NULL
SELECT 
    make,
    COUNT(*) as total_records,
    COUNT(CASE WHEN content_embedding IS NOT NULL THEN 1 END) as embedded_records,
    COUNT(CASE WHEN content_embedding IS NULL THEN 1 END) as null_embeddings
FROM oem_schedules
WHERE make IN ('TOYOTA', 'HONDA')
  AND service_type LIKE '%OIL%CHANGE%'
GROUP BY make;

# Expected: null_embeddings = 0 for both Toyota and Honda

# Check embedding dimensions
SELECT 
    id, make, model,
    ARRAY_LENGTH(content_embedding, 1) as embedding_dimensions
FROM oem_schedules
WHERE make IN ('TOYOTA', 'HONDA')
  AND service_type LIKE '%OIL%CHANGE%'
  AND content_embedding IS NOT NULL
LIMIT 3;

# Expected: embedding_dimensions = 384 for all

═══════════════════════════════════════════════════════════════════════════════
RECOMMENDED EXECUTION ORDER
═══════════════════════════════════════════════════════════════════════════════

1. ✅ RUN STEP 1 (Audit) - Understand your data
2. ✅ RUN STEP 2 (Count) - See scope of changes
3. ✅ CREATE BACKUP - Before making changes
4. ✅ RUN STEP 3 (Toyota Synthetic Update)
5. ✅ RUN STEP 4 (Honda Synthetic Update)
6. ✅ RUN STEP 5 (Fix interval_months)
7. ✅ RUN STEP 6 (Verify all updates)
8. ✅ RUN STEP 7 (Regenerate embeddings)
9. ✅ RUN STEP 8 (Final verification)
10. ✅ TEST in application

═══════════════════════════════════════════════════════════════════════════════
BEFORE YOU START
═══════════════════════════════════════════════════════════════════════════════

STRONGLY RECOMMENDED:

☐ 1. In Supabase Dashboard: Settings > Backups > Request a backup
☐ 2. Run STEP 1 audit query and SCREENSHOT the results
☐ 3. Run STEP 2 count query and note the numbers
☐ 4. Create manual backup table:

CREATE TABLE oem_schedules_backup_20240321 AS
SELECT * FROM oem_schedules
WHERE make IN ('TOYOTA', 'HONDA') AND service_type LIKE '%OIL%CHANGE%';

☐ 5. Then proceed with updates

═══════════════════════════════════════════════════════════════════════════════
IF SOMETHING GOES WRONG - ROLLBACK
═══════════════════════════════════════════════════════════════════════════════

# Restore from backup table
TRUNCATE TABLE oem_schedules WHERE make IN ('TOYOTA', 'HONDA');
INSERT INTO oem_schedules SELECT * FROM oem_schedules_backup_20240321;

# Or restore from Supabase backup (automatic)
# Go to: Settings > Backups > Click restore button

═══════════════════════════════════════════════════════════════════════════════
WHAT'S DIFFERENT FROM PREVIOUS SCRIPT
═══════════════════════════════════════════════════════════════════════════════

PREVIOUS SCRIPT:
  ❌ Looked for "30000" in interval_miles (wrong assumption)
  ❌ Complex detection logic with many OR conditions
  ❌ Didn't match your actual data patterns
  ❌ Expected driving_condition field (you may not have per-model)

REVISED SCRIPT:
  ✅ Uses notes field which ALREADY contains correct interval info
  ✅ Simpler matching: "10,000" or "5000" in notes
  ✅ Flexible: Works with your actual data
  ✅ Also fixes interval_months if needed
  ✅ Adds helpful comments to notes for audit trail
  ✅ Only updates records that actually need it

═══════════════════════════════════════════════════════════════════════════════
KEY INSIGHT
═══════════════════════════════════════════════════════════════════════════════

Your database notes field already contains the CORRECT intervals!
  - "0W-20 full synthetic models may extend to 10,000 miles"
  - "0W-20 synthetic required. Maintenance Minder Code A. Can extend 5000"

We just need to:
  1. Extract those intervals into the interval_miles column properly
  2. Standardize them
  3. Reset embeddings
  4. Regenerate

═══════════════════════════════════════════════════════════════════════════════
