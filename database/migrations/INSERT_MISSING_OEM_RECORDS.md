╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║  INSERT COMMANDS FOR MISSING OEM RECORDS                                  ║
║                                                                            ║
║  Missing Categories:                                                       ║
║  1. Toyota Synthetic + Severe driving                                     ║
║  2. Honda Regular oil                                                     ║
║                                                                            ║
║  Current Status:                                                          ║
║  - Toyota Synthetic + Normal: 8 records (HAVE)                           ║
║  - Toyota Synthetic + Severe: 0 records (MISSING)                        ║
║  - Toyota Regular: 8 records (HAVE)                                      ║
║  - Honda Synthetic + Normal: 10 records (HAVE)                           ║
║  - Honda Synthetic + Severe: 0 records (MISSING)                         ║
║  - Honda Regular: 10 records (MISSING)                                   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
BEFORE INSERTING: UNDERSTAND YOUR DATA
═══════════════════════════════════════════════════════════════════════════════

First, let's see what Toyota Synthetic Normal records look like:

SELECT id, year, make, model, service_type, interval_miles, interval_months, 
       driving_condition, notes, citation
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal'
LIMIT 3;

-- This will show you the exact structure of existing records
-- We'll use this as a template for INSERT commands

And for Honda Synthetic Normal:

SELECT id, year, make, model, service_type, interval_miles, interval_months, 
       driving_condition, notes, citation
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal'
LIMIT 3;

☐ Review the structure of existing records before proceeding


═══════════════════════════════════════════════════════════════════════════════
APPROACH 1: DUPLICATE EXISTING RECORDS WITH MODIFIED DRIVING_CONDITION
═══════════════════════════════════════════════════════════════════════════════

This approach:
1. Takes existing Toyota Synthetic Normal records
2. Duplicates them
3. Changes driving_condition to 'severe'
4. Updates interval_miles to 5000
5. Updates interval_months to 6
6. Updates notes to reflect severe driving
7. Resets content_embedding to NULL

STEP 1: CREATE TOYOTA SYNTHETIC + SEVERE RECORDS
─────────────────────────────────────────────────

-- First, see which Toyota Synthetic models exist
SELECT DISTINCT model FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal';

-- Expected models: Prius, Camry, Corolla, RAV4, Tacoma, Highlander, Tundra, 4Runner

-- Now, INSERT severe versions for each model
-- (Copy this for each model from the list above)

INSERT INTO oem_schedules (
    year, make, model, trim,
    service_type,
    interval_miles, interval_months,
    driving_condition,
    notes, citation,
    content_embedding,
    created_at
)
SELECT 
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

-- Verify insert
SELECT COUNT(*) as toyota_severe_created FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe';

-- Expected: 8 records (one for each Toyota model)

☐ Toyota Synthetic Severe records created


STEP 2: CREATE HONDA SYNTHETIC + SEVERE RECORDS
────────────────────────────────────────────────

-- First, verify Honda Synthetic models
SELECT DISTINCT model FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal';

-- Expected models: Accord, Civic, etc.

-- INSERT severe versions
INSERT INTO oem_schedules (
    year, make, model, trim,
    service_type,
    interval_miles, interval_months,
    driving_condition,
    notes, citation,
    content_embedding,
    created_at
)
SELECT 
    year, make, model, trim,
    service_type,
    5000, 6,
    'severe' as driving_condition,
    CONCAT(
        notes,
        ' | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions'
    ) as notes,
    CONCAT(citation, ' - Severe Driving Conditions') as citation,
    NULL as content_embedding,
    CURRENT_TIMESTAMP as created_at
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition = 'normal';

-- Verify insert
SELECT COUNT(*) as honda_severe_created FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe';

-- Expected: 10 records (one for each Honda model)

☐ Honda Synthetic Severe records created


STEP 3: CREATE HONDA REGULAR OIL RECORDS
────────────────────────────────────────

-- First, check what Honda models need regular oil records
-- Look at existing records to understand your data

SELECT DISTINCT model FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%';

-- Depending on your data, you may need to:
-- Option A: Copy existing Honda Synthetic records and modify
-- Option B: Manually insert records for specific models

-- OPTION A: Create from existing Honda models
INSERT INTO oem_schedules (
    year, make, model, trim,
    service_type,
    interval_miles, interval_months,
    driving_condition,
    notes, citation,
    content_embedding,
    created_at
)
SELECT 
    year, make, model, trim,
    service_type,
    5000, 6,
    driving_condition,
    CONCAT(
        'Honda Oil Change - Regular (non-synthetic) oil. Maintenance required every 5,000 miles or 6 months. ',
        'Model: ', model,
        CASE WHEN driving_condition = 'severe' THEN '. Severe driving: check oil more frequently.' ELSE '' END
    ) as notes,
    'Honda Official Maintenance Schedule - Regular Oil' as citation,
    NULL as content_embedding,
    CURRENT_TIMESTAMP as created_at
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes NOT LIKE '%synthetic%' AND notes NOT LIKE '%0W-20%');

-- If this returns 0 (no existing Honda regular records), insert manually:
-- See OPTION B below

☐ Honda Regular oil records created or checked


-- OPTION B: Manually insert Honda Regular records for each model
-- Run this if Honda Regular records don't exist

-- First, get list of Honda models
SELECT DISTINCT model FROM oem_schedules WHERE make = 'Honda';

-- Then insert for each model (example for Accord):
INSERT INTO oem_schedules (
    year, make, model, trim,
    service_type,
    interval_miles, interval_months,
    driving_condition,
    notes, citation,
    content_embedding,
    created_at
)
VALUES
    (2024, 'Honda', 'Accord', NULL, 'Oil Change', 5000, 6, 'normal', 
     'Honda Oil Change - Regular (non-synthetic) oil. Maintenance required every 5,000 miles or 6 months for normal driving conditions.',
     'Honda Official Maintenance Schedule - Regular Oil',
     NULL, CURRENT_TIMESTAMP),
    (2024, 'Honda', 'Civic', NULL, 'Oil Change', 5000, 6, 'normal',
     'Honda Oil Change - Regular (non-synthetic) oil. Maintenance required every 5,000 miles or 6 months for normal driving conditions.',
     'Honda Official Maintenance Schedule - Regular Oil',
     NULL, CURRENT_TIMESTAMP);

-- Add more models as needed (Fit, Odyssey, Pilot, etc.)

☐ Honda Regular records inserted


VERIFICATION: Check all inserts

SELECT 
    make,
    driving_condition,
    CASE 
        WHEN notes LIKE '%synthetic%' OR notes LIKE '%0W-20%' THEN 'SYNTHETIC'
        ELSE 'REGULAR'
    END as oil_type,
    COUNT(*) as record_count
FROM oem_schedules
WHERE make IN ('Toyota', 'Honda')
  AND service_type LIKE '%Oil Change%'
GROUP BY make, driving_condition, oil_type
ORDER BY make, oil_type, driving_condition;

-- Expected output now:
-- make   | driving_condition | oil_type  | record_count
-- ───────┼──────────────────┼───────────┼──────────────
-- Honda  | normal            | REGULAR   | 10
-- Honda  | normal            | SYNTHETIC | 10
-- Honda  | severe            | SYNTHETIC | 10
-- Toyota | normal            | REGULAR   | 8
-- Toyota | normal            | SYNTHETIC | 8
-- Toyota | severe            | SYNTHETIC | 8


═══════════════════════════════════════════════════════════════════════════════
ALTERNATIVE APPROACH 2: DIRECT INSERT STATEMENTS (More Control)
═══════════════════════════════════════════════════════════════════════════════

If you prefer explicit INSERT statements, here's the template:

-- Get the exact structure from existing records first:
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'oem_schedules'
ORDER BY ordinal_position;

-- Then use this template for each missing combination:

-- TEMPLATE: Toyota Synthetic Severe
INSERT INTO oem_schedules (
    year, make, model, trim, service_type,
    interval_miles, interval_months, driving_condition,
    notes, citation,
    content_embedding, created_at
) VALUES (
    2024,                              -- year (adjust as needed)
    'Toyota',                          -- make
    '[MODEL]',                         -- model (Prius, Camry, etc.)
    NULL,                              -- trim
    'Oil Change',                      -- service_type
    5000,                              -- interval_miles (severe)
    6,                                 -- interval_months (severe)
    'severe',                          -- driving_condition
    '[COPY FROM NORMAL VERSION] | [SEVERE DRIVING] Reduce to 5,000 miles',  -- notes
    'Toyota Official - Severe Driving',  -- citation
    NULL,                              -- content_embedding (will be generated)
    CURRENT_TIMESTAMP                  -- created_at
);

-- Repeat for each model with different [MODEL] and [COPY FROM NORMAL VERSION]


═══════════════════════════════════════════════════════════════════════════════
STEP 4: RE-RUN COUNT QUERY TO VERIFY
═══════════════════════════════════════════════════════════════════════════════

-- After all inserts, run your original count query again:

SELECT 
    'Toyota Synthetic and D-condition is normal- Should be 10000' as update_category,
    COUNT(*) as record_count
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition ='normal'
  AND (
    (notes LIKE '%10,000%' OR notes LIKE '%10000%')
    OR driving_condition = 'normal'
  )
UNION ALL
SELECT 
    'Toyota Synthetic and D-condition is severe- Should be 5000' as update_category,
    COUNT(*) as record_count
FROM oem_schedules
WHERE make = 'Toyota'
  AND service_type LIKE '%Oil Change%'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')
  AND driving_condition ='severe'
  AND (
    (notes LIKE '%10,000%' OR notes LIKE '%10000%')
    OR driving_condition = 'severe'
  )
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
  AND (
    (notes LIKE '%10,000%' OR notes LIKE '%10000%')
    OR driving_condition = 'severe'
  )
UNION ALL
SELECT 
    'Honda Regular - Should be 5000',
    COUNT(*)
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes NOT LIKE '%synthetic%' AND notes NOT LIKE '%0W-20%');

-- Expected NEW output (after inserts):
-- update_category                                    | record_count
-- ─────────────────────────────────────────────────┼──────────────
-- Honda Regular - Should be 5000                    | 10 (was 0)
-- Honda Synthetic and D-condition is severe...     | 10 (was 0)
-- Honda Synthetic and D condition is normal...     | 10 (unchanged)
-- Toyota Regular - Should be 5000                  | 8 (unchanged)
-- Toyota Synthetic and D-condition is normal...    | 8 (unchanged)
-- Toyota Synthetic and D-condition is severe...    | 8 (was 0)

☐ All categories now have records
☐ Ready to proceed with UPDATE statements


═══════════════════════════════════════════════════════════════════════════════
BACKUP THE NEWLY INSERTED RECORDS
═══════════════════════════════════════════════════════════════════════════════

After successful inserts, create another backup:

CREATE TABLE oem_schedules_after_inserts_20240321 AS
SELECT * FROM oem_schedules
WHERE make IN ('Toyota', 'Honda')
  AND service_type LIKE '%Oil Change%';

SELECT COUNT(*) FROM oem_schedules_after_inserts_20240321;

-- This backup includes the newly inserted records
-- You can use this if you need to rollback just the inserts


═══════════════════════════════════════════════════════════════════════════════
EXECUTION STEPS
═══════════════════════════════════════════════════════════════════════════════

1. ☐ Review existing record structure (SELECT samples)
2. ☐ Run STEP 1: Create Toyota Synthetic Severe records
3. ☐ Run STEP 2: Create Honda Synthetic Severe records  
4. ☐ Run STEP 3: Create Honda Regular records
5. ☐ Run STEP 4: Verify with count query
6. ☐ Backup newly inserted records
7. ☐ Then proceed with UPDATE statements from final migration script

═══════════════════════════════════════════════════════════════════════════════
SUMMARY OF CHANGES
═══════════════════════════════════════════════════════════════════════════════

BEFORE (Your Audit Results):
  Toyota Synthetic Normal:  8 records ✓
  Toyota Synthetic Severe:  0 records ✗
  Toyota Regular:           8 records ✓
  Honda Synthetic Normal:   10 records ✓
  Honda Synthetic Severe:   0 records ✗
  Honda Regular:            10 records ✗ (showing 10 but may be missing)
  ────────────────────────
  TOTAL:                    36 records

AFTER (After INSERT Statements):
  Toyota Synthetic Normal:  8 records ✓
  Toyota Synthetic Severe:  8 records ✓ (ADDED)
  Toyota Regular:           8 records ✓
  Honda Synthetic Normal:   10 records ✓
  Honda Synthetic Severe:   10 records ✓ (ADDED)
  Honda Regular:            10 records ✓ (VERIFIED)
  ────────────────────────
  TOTAL:                    54 records

IMPACT: Adds 18 new records to ensure all driving conditions and oil types are represented.

═══════════════════════════════════════════════════════════════════════════════
NEXT STEPS
═══════════════════════════════════════════════════════════════════════════════

After these INSERTs complete successfully:

1. Run the count query one more time to verify
2. Then execute the FINAL_PRODUCTION_MIGRATION_SCRIPT.md which contains:
   - 6 UPDATE statements (will now work on all records)
   - Vector embedding reset
   - Embedding regeneration
   - Final testing

═══════════════════════════════════════════════════════════════════════════════
