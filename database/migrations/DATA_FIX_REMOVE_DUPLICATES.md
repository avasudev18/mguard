╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║  DATA FIX SCRIPT - REMOVE DUPLICATES                                       ║
║                                                                            ║
║  Issue: INSERT statement created 56 rows instead of 8 rows                 ║
║  Root Cause: Likely inserted for each existing driving_condition          ║
║              or included non-matching records                              ║
║                                                                            ║
║  Solution: Identify and remove duplicates                                 ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
STEP 1: ANALYZE THE DUPLICATE PROBLEM
═══════════════════════════════════════════════════════════════════════════════

First, let's understand what was inserted:

-- Show newly inserted records (those with SEVERE DRIVING VERSION in notes)
SELECT 
    id, make, model, year, trim, driving_condition,
    interval_miles, interval_months,
    SUBSTRING(notes, 1, 100) as notes_preview,
    created_at
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND notes LIKE '%SEVERE DRIVING VERSION%'
ORDER BY model, created_at DESC;

-- Count by model to see duplicates
SELECT 
    model,
    COUNT(*) as count,
    COUNT(DISTINCT year) as distinct_years,
    COUNT(DISTINCT trim) as distinct_trims
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND notes LIKE '%SEVERE DRIVING VERSION%'
GROUP BY model
ORDER BY model;

-- Expected: Should show 8 records (one per Toyota model)
-- If showing more, we have duplicates

-- Check for exact duplicates (same model, year, trim, interval, driving_condition)
SELECT 
    make, model, year, trim, interval_miles, interval_months, driving_condition,
    COUNT(*) as duplicate_count,
    STRING_AGG(id::text, ', ') as duplicate_ids
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND notes LIKE '%SEVERE DRIVING VERSION%'
GROUP BY make, model, year, trim, interval_miles, interval_months, driving_condition
HAVING COUNT(*) > 1
ORDER BY duplicate_count DESC;

-- This shows which records are exact duplicates

☐ Duplicates analyzed
☐ IDs of duplicates identified


═══════════════════════════════════════════════════════════════════════════════
STEP 2: IDENTIFY ROOT CAUSE OF DUPLICATES
═══════════════════════════════════════════════════════════════════════════════

Check the original query that created the duplicates:

-- See what was matched by the original WHERE clause
SELECT 
    COUNT(*) as total_matched,
    COUNT(DISTINCT model, year, trim) as distinct_model_year_trim_combos
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal';

-- If this shows 8, but we inserted 56, then:
-- Each original record was duplicated 7 times (56/8 = 7)

-- Check if there are multiple records per model-year-trim
SELECT 
    model, year, trim, COUNT(*) as record_count
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal'
GROUP BY model, year, trim
ORDER BY model, record_count DESC;

-- If showing count > 1, that's why we got duplicates!
-- Likely due to multiple trims or variations per model

☐ Root cause identified


═══════════════════════════════════════════════════════════════════════════════
STEP 3: BACKUP CURRENT STATE
═══════════════════════════════════════════════════════════════════════════════

Before deleting anything, create backups:

-- Backup all severe driving records created
CREATE TABLE oem_schedules_severe_backup_all AS
SELECT * FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- Verify backup
SELECT COUNT(*) as severe_records_backed_up
FROM oem_schedules_severe_backup_all;

-- Expected: 56 records

☐ Full backup created


═══════════════════════════════════════════════════════════════════════════════
STEP 4: DELETE DUPLICATE RECORDS - APPROACH A (KEEP FIRST OCCURRENCE)
═══════════════════════════════════════════════════════════════════════════════

This approach keeps the FIRST inserted record and deletes subsequent duplicates:

-- Identify duplicates to keep (keep oldest created_at per combination)
WITH duplicate_groups AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY make, model, year, trim, interval_miles, interval_months, driving_condition
            ORDER BY created_at ASC
        ) as row_num
    FROM oem_schedules
    WHERE make = 'Toyota'
      AND service_type LIKE '%Oil Change%'
      AND notes LIKE '%SEVERE DRIVING VERSION%'
)
-- Show records that will be deleted (row_num > 1)
SELECT 
    id, model, year, trim, created_at,
    row_num
FROM duplicate_groups
WHERE row_num > 1
ORDER BY model, row_num;

-- Note the IDs of records to delete

-- Now DELETE the duplicates (keep only first occurrence)
WITH duplicate_groups AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY make, model, year, trim, interval_miles, interval_months, driving_condition
            ORDER BY created_at ASC
        ) as row_num
    FROM oem_schedules
    WHERE make = 'Toyota'
      AND service_type LIKE '%Oil Change%'
      AND notes LIKE '%SEVERE DRIVING VERSION%'
)
DELETE FROM oem_schedules
WHERE id IN (
    SELECT id FROM duplicate_groups WHERE row_num > 1
);

-- Verify deletion
SELECT COUNT(*) as remaining_toyota_severe
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- Expected: 8 records (or however many unique model combinations exist)

☐ Duplicates deleted


═══════════════════════════════════════════════════════════════════════════════
STEP 5: DELETE DUPLICATE RECORDS - APPROACH B (DELETE ALL, REINSERT ONCE)
═══════════════════════════════════════════════════════════════════════════════

This approach deletes ALL severe records and reinserting correctly:

-- BACKUP first (already done in STEP 3)

-- Delete ALL severe driving records
DELETE FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- Verify deletion
SELECT COUNT(*) as toyota_severe_after_delete
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe';

-- Expected: 0 records

-- Now REINSERT with a corrected query that ensures no duplicates
-- Use DISTINCT to eliminate duplicates before inserting:

INSERT INTO oem_schedules (
    year, make, model, trim,
    service_type,
    interval_miles, interval_months,
    driving_condition,
    notes, citation,
    content_embedding,
    created_at
)
SELECT DISTINCT
    year, make, model, trim,
    service_type,
    5000, 6,
    'severe' as driving_condition,
    CONCAT(
        notes, 
        ' | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions (stop-and-go, extreme temperatures, towing)'
    ) as notes,
    CONCAT(citation, ' - Severe Driving Conditions') as citation,
    NULL as content_embedding,
    CURRENT_TIMESTAMP as created_at
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal';

-- Verify reinsert
SELECT COUNT(*) as toyota_severe_after_reinsert
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- Expected: 8 records (one per unique model combination)

☐ All severe records deleted
☐ Reinserted with DISTINCT clause
☐ 8 records verified


═══════════════════════════════════════════════════════════════════════════════
STEP 6: VERIFY FIX FOR TOYOTA
═══════════════════════════════════════════════════════════════════════════════

Check that Toyota records are now correct:

SELECT 
    make, model, driving_condition,
    CASE 
        WHEN notes LIKE '%synthetic%' OR notes LIKE '%0W-20%' THEN 'SYNTHETIC'
        ELSE 'REGULAR'
    END as oil_type,
    COUNT(*) as count
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
GROUP BY make, model, driving_condition, oil_type
ORDER BY model, driving_condition;

-- Expected:
-- Each Toyota model should have:
-- - 1 Synthetic + Normal
-- - 1 Synthetic + Severe
-- - (possibly) 1 Regular + Normal
-- - (possibly) 1 Regular + Severe

☐ Toyota data verified


═══════════════════════════════════════════════════════════════════════════════
STEP 7: FIX HONDA SYNTHETIC SEVERE (SAME ISSUE)
═══════════════════════════════════════════════════════════════════════════════

Apply the same fix to Honda:

-- Check if Honda has same duplicate issue
SELECT COUNT(*) as honda_severe_count
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- If > 10, we have duplicates

-- Backup Honda severe records
CREATE TABLE oem_schedules_honda_severe_backup_all AS
SELECT * FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- Delete ALL Honda severe records
DELETE FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- Reinsert with DISTINCT
INSERT INTO oem_schedules (
    year, make, model, trim,
    service_type,
    interval_miles, interval_months,
    driving_condition,
    notes, citation,
    content_embedding,
    created_at
)
SELECT DISTINCT
    year, make, model, trim,
    service_type,
    5000, 6,
    'severe' as driving_condition,
    CONCAT(
        notes, 
        ' | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions (stop-and-go, extreme temperatures, towing)'
    ) as notes,
    CONCAT(citation, ' - Severe Driving Conditions') as citation,
    NULL as content_embedding,
    CURRENT_TIMESTAMP as created_at
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal';

-- Verify
SELECT COUNT(*) as honda_severe_after_fix
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- Expected: 10 records

☐ Honda duplicates fixed


═══════════════════════════════════════════════════════════════════════════════
STEP 8: FINAL VERIFICATION - RUN ORIGINAL COUNT QUERY
═══════════════════════════════════════════════════════════════════════════════

Run the original count query to verify all categories are correct:

SELECT 
    'Toyota Synthetic and D-condition is normal- Should be 10000' as update_category,
    COUNT(*) as record_count
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition ='normal'
UNION ALL
SELECT 
    'Toyota Synthetic and D-condition is severe- Should be 5000' as update_category,
    COUNT(*) as record_count
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition ='severe'
UNION ALL
SELECT 
    'Toyota Regular - Should be 5000',
    COUNT(*)
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes NOT LIKE '%synthetic%' AND notes NOT LIKE '%0W-20%')
UNION ALL
SELECT
    'Honda Synthetic and D condition is normal- Should be 10000',
    COUNT(*)
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'normal'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
UNION ALL
SELECT 
    'Honda Synthetic and D-condition is severe- Should be 5000' as update_category,
    COUNT(*) as record_count
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition ='severe'
UNION ALL
SELECT 
    'Honda Regular - Should be 5000',
    COUNT(*)
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes NOT LIKE '%synthetic%' AND notes NOT LIKE '%0W-20%');

-- Expected output (FIXED):
-- update_category                                      | record_count
-- ───────────────────────────────────────────────────┼──────────────
-- Honda Regular - Should be 5000                      | X
-- Honda Synthetic and D-condition is severe...       | 10
-- Honda Synthetic and D condition is normal...       | 10
-- Toyota Regular - Should be 5000                    | 8
-- Toyota Synthetic and D-condition is normal...      | 8
-- Toyota Synthetic and D-condition is severe...      | 8

☐ All counts correct
☐ No duplicate counts


═══════════════════════════════════════════════════════════════════════════════
STEP 9: DELETE BACKUP TABLES (AFTER VERIFICATION)
═══════════════════════════════════════════════════════════════════════════════

After confirming the fix is correct, clean up the backup tables:

-- Drop backup tables (only after verifying fix is correct!)
DROP TABLE oem_schedules_severe_backup_all;
DROP TABLE oem_schedules_honda_severe_backup_all;

-- Verify cleanup
SELECT table_name 
FROM information_schema.tables
WHERE table_name LIKE '%backup%'
  AND table_schema = 'public';

-- Should show no results

☐ Backup tables cleaned up


═══════════════════════════════════════════════════════════════════════════════
DATA FIX EXECUTION CHECKLIST
═══════════════════════════════════════════════════════════════════════════════

☐ STEP 1: Analyzed duplicate problem
☐ STEP 2: Identified root cause
☐ STEP 3: Created backups (56 + Honda records)
☐ STEP 4: Option A - Kept first, deleted others OR
☐ STEP 5: Option B - Deleted all, reinserted with DISTINCT
☐ STEP 6: Verified Toyota fix (8 records per category)
☐ STEP 7: Fixed Honda (10 records per category)
☐ STEP 8: Ran original count query - all counts correct
☐ STEP 9: Cleaned up backup tables

DATA FIX COMPLETE ✅

═══════════════════════════════════════════════════════════════════════════════
ROOT CAUSE ANALYSIS & PREVENTION
═══════════════════════════════════════════════════════════════════════════════

WHY THIS HAPPENED:

The original INSERT query:
```sql
INSERT INTO oem_schedules (...)
SELECT year, make, model, trim, service_type, ...
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal'
```

The problem:
- If there are MULTIPLE records per model (different years, trims, or variations)
- The SELECT matches ALL of them
- Then INSERT creates a "severe" version for each

Example:
- Toyota Prius: 7 different records (different years: 2018, 2019, 2020, 2021, 2022, 2023, 2024)
- Query matches all 7
- Inserts 7 severe versions → 7 duplicates instead of 1

SOLUTION USED:
```sql
SELECT DISTINCT year, make, model, trim, ...
FROM oem_schedules
WHERE ...
```

The DISTINCT clause eliminates duplicate rows before inserting.

═══════════════════════════════════════════════════════════════════════════════
NEXT STEPS
═══════════════════════════════════════════════════════════════════════════════

After data fix is complete:

1. ✅ Verify count query shows correct numbers
2. ✅ All duplicate records removed
3. ✅ Ready to proceed with FINAL_PRODUCTION_MIGRATION_SCRIPT.md

Proceed with:
→ 6 UPDATE statements
→ Vector embedding reset
→ Embedding regeneration
→ Application testing

═══════════════════════════════════════════════════════════════════════════════
