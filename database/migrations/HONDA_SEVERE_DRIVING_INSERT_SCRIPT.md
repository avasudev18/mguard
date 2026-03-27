╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║  HONDA SEVERE DRIVING INSERT SCRIPT                                        ║
║  Based on Actual CSV Data                                                  ║
║                                                                            ║
║  Creates: Honda Oil Change records with driving_condition='severe'         ║
║  Interval: 5,000 miles / 6 months                                         ║
║                                                                            ║
║  Models from CSV: Accord, Civic, CR-V, HR-V, Pilot                       ║
║  Total records to create: 10 (one per existing model-year combination)    ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
OPTION 1: DYNAMIC INSERT FROM EXISTING RECORDS (RECOMMENDED)
═══════════════════════════════════════════════════════════════════════════════

This approach copies existing Honda normal records and creates severe versions.
Most reliable and maintainable.

-- STEP 1: Verify Honda records to be duplicated
SELECT 
    id, year, make, model, trim,
    interval_miles, interval_months, driving_condition,
    SUBSTRING(notes, 1, 80) as notes_preview
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'normal'
ORDER BY model, year;

-- Expected: Shows all Honda normal driving records
-- Models: Accord, Civic, CR-V, HR-V, Pilot (and others)

☐ STEP 1: Verified Honda normal records


-- STEP 2: Create severe versions from existing normal records
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
    5000,  -- Severe: 5,000 miles (reduced from normal)
    6,     -- Severe: 6 months
    'severe' as driving_condition,
    CONCAT(
        notes, 
        ' | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions (stop-and-go traffic, extreme temperatures, dusty environments, frequent towing)'
    ) as notes,
    CONCAT(citation, ' - Severe Driving Conditions') as citation,
    NULL as content_embedding,
    CURRENT_TIMESTAMP as created_at
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'normal';

-- Verify insert
SELECT 
    model, driving_condition, 
    COUNT(*) as record_count,
    MIN(interval_miles) as min_interval,
    MAX(interval_miles) as max_interval
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
GROUP BY model, driving_condition
ORDER BY model, driving_condition;

-- Expected output shows:
-- - Each Honda model with 'normal' driving_condition records (existing)
-- - Each Honda model with 'severe' driving_condition records (newly created)
-- - Severe records should show: interval_miles = 5000, interval_months = 6

☐ STEP 2: Severe versions created


-- STEP 3: Verify specific counts
SELECT 
    COUNT(*) as total_honda_records,
    COUNT(CASE WHEN driving_condition = 'normal' THEN 1 END) as normal_records,
    COUNT(CASE WHEN driving_condition = 'severe' THEN 1 END) as severe_records
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%';

-- Expected:
-- total_honda_records: ~20 (10 normal + 10 severe)
-- normal_records: ~10 (original)
-- severe_records: ~10 (newly created)

☐ STEP 3: Count verified


═══════════════════════════════════════════════════════════════════════════════
OPTION 2: MANUAL INSERT USING CSV DATA (EXPLICIT)
═══════════════════════════════════════════════════════════════════════════════

If you prefer explicit control, insert each record manually from CSV data:

-- Based on the CSV file data, create severe versions:

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
    -- 2013 Accord Severe
    (2013, 'Honda', 'Accord', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. Maintenance Minder Code A. Can extend to 7,500 miles with full synthetic. | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     'Complete Auto Maintenance Master Guide, Feb 2026 - Honda Section - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2013 Civic Severe
    (2013, 'Honda', 'Civic', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. Maintenance Minder Code A. Can extend to 7,500 miles with full synthetic. | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     'Complete Auto Maintenance Master Guide, Feb 2026 - Honda Section - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2013 CR-V Severe
    (2013, 'Honda', 'CR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. Maintenance Minder Code A. Can extend to 7,500 miles with full synthetic. | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     'Complete Auto Maintenance Master Guide, Feb 2026 - Honda Section - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2016 HR-V Severe
    (2016, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner\'s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2017 HR-V Severe
    (2017, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner\'s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2018 HR-V Severe
    (2018, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner\'s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2019 HR-V Severe
    (2019, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner\'s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2020 HR-V Severe
    (2020, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner\'s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2021 HR-V Severe
    (2021, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner\'s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2013 Pilot Severe
    (2013, 'Honda', 'Pilot', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. Maintenance Minder Code A. Can extend to 7,500 miles with full synthetic. | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     'Complete Auto Maintenance Master Guide, Feb 2026 - Honda Section - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP);

-- Verify insert
SELECT COUNT(*) as honda_severe_created
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe'
  AND notes LIKE '%SEVERE DRIVING VERSION%';

-- Expected: 10 records (one for each year-model combination)

☐ Manual inserts completed


═══════════════════════════════════════════════════════════════════════════════
VERIFICATION: Check all Honda records
═══════════════════════════════════════════════════════════════════════════════

SELECT 
    model, year,
    driving_condition,
    interval_miles, interval_months,
    SUBSTRING(notes, 1, 60) as notes_preview
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
ORDER BY model, year, driving_condition;

-- Expected output structure:
-- model     | year | driving_condition | interval_miles | interval_months | notes_preview
-- ──────────┼──────┼──────────────────┼────────────────┼─────────────────┼─────────────
-- Accord    | 2013 | normal            | 8000           | 10              | 0W-20 full...
-- Accord    | 2013 | severe            | 5000           | 6               | 0W-20 full... | [SEVERE...
-- Civic     | 2013 | normal            | 8000           | 10              | 0W-20 full...
-- Civic     | 2013 | severe            | 5000           | 6               | 0W-20 full... | [SEVERE...
-- ... (continues for all models and years)

☐ All records verified


═══════════════════════════════════════════════════════════════════════════════
SUMMARY TABLE: Count of Honda Records by Condition
═══════════════════════════════════════════════════════════════════════════════

SELECT 
    model,
    COUNT(CASE WHEN driving_condition = 'normal' THEN 1 END) as normal_count,
    COUNT(CASE WHEN driving_condition = 'severe' THEN 1 END) as severe_count,
    COUNT(*) as total_per_model
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
GROUP BY model
ORDER BY model;

-- Expected:
-- model  | normal_count | severe_count | total_per_model
-- ───────┼──────────────┼──────────────┼────────────────
-- Accord | 1            | 1            | 2
-- Civic  | 1            | 1            | 2
-- CR-V   | 1            | 1            | 2
-- HR-V   | 5            | 5            | 10
-- Pilot  | 1            | 1            | 2
-- ──────┼──────────────┼──────────────┼────────────────
-- Total  | 9            | 9            | 18

☐ Summary verified


═══════════════════════════════════════════════════════════════════════════════
FINAL VERIFICATION: Run count query
═══════════════════════════════════════════════════════════════════════════════

-- Verify Honda records match requirements
SELECT 
    'Honda Synthetic and D-condition is normal- Should be 10000' as category,
    COUNT(*) as count
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'normal'
  AND (notes LIKE '%synthetic%' OR notes LIKE '%0W-20%')

UNION ALL

SELECT 
    'Honda Synthetic and D-condition is severe- Should be 5000' as category,
    COUNT(*) as count
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND driving_condition = 'severe'
  AND interval_miles = 5000
  AND notes LIKE '%SEVERE DRIVING VERSION%'

UNION ALL

SELECT 
    'Honda Regular - Should be 5000' as category,
    COUNT(*) as count
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
  AND (notes NOT LIKE '%synthetic%' AND notes NOT LIKE '%0W-20%');

-- Expected:
-- Honda Synthetic and D-condition is normal- Should be 10000       | 9-10
-- Honda Synthetic and D-condition is severe- Should be 5000        | 9-10
-- Honda Regular - Should be 5000                                   | 0 (or X if regular records exist)

☐ Final count verified


═══════════════════════════════════════════════════════════════════════════════
EXECUTION CHECKLIST
═══════════════════════════════════════════════════════════════════════════════

OPTION 1 (Recommended - Dynamic):
  ☐ STEP 1: Verified Honda normal records
  ☐ STEP 2: Created severe versions
  ☐ STEP 3: Count verified
  ☐ Verification: All Honda records checked
  ☐ Summary: Count by model reviewed
  ☐ Final: Count query passed

OPTION 2 (Manual - Explicit):
  ☐ Manual inserts of 10 severe records
  ☐ Verification: All records checked
  ☐ Summary: Count by model reviewed
  ☐ Final: Count query passed

CHOOSE ONE OPTION AND EXECUTE ALL STEPS

═══════════════════════════════════════════════════════════════════════════════
DATA SUMMARY FROM CSV
═══════════════════════════════════════════════════════════════════════════════

Honda models in CSV:
  1. Accord (2013) - 1 record
  2. Civic (2013) - 1 record
  3. CR-V (2013) - 1 record
  4. HR-V (2016-2021) - 5 records (2016, 2017, 2018, 2019, 2020, 2021)
  5. Pilot (2013) - 1 record

Total: 9 records in CSV

After INSERT for severe:
  - Each normal record gets a severe counterpart
  - Total: 18 records (9 normal + 9 severe)

All use:
  - interval_miles = 5000 (for severe)
  - interval_months = 6
  - driving_condition = 'severe'
  - content_embedding = NULL (will be regenerated)

═══════════════════════════════════════════════════════════════════════════════
AFTER COMPLETION
═══════════════════════════════════════════════════════════════════════════════

Next steps:

1. ✅ Honda severe records created
2. ✅ All verification queries passed
3. ✅ Ready for UPDATE statements

Proceed to: FINAL_PRODUCTION_MIGRATION_SCRIPT.md
  - 6 UPDATE statements
  - Vector embedding reset
  - Embedding regeneration
  - Application testing

═══════════════════════════════════════════════════════════════════════════════
