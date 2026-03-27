╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║     OEM INTERVAL CORRECTION SCRIPT - Synthetic vs Regular Oil              ║
║                                                                            ║
║  Purpose: Fix incorrect OEM intervals in database                          ║
║  Criteria: Detects oil type and applies correct interval                   ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
OIL TYPE DETECTION CRITERIA
═══════════════════════════════════════════════════════════════════════════════

SYNTHETIC OIL (detect by keywords in service_type or notes):
  Keywords: "synthetic", "full synthetic", "0w-", "5w-30 syn", etc.
  Normal interval: 10,000 miles / 12 months
  Severe interval: 5,000 miles / 6 months

REGULAR OIL (conventional, mineral):
  Keywords: "regular", "conventional", "mineral", or NO synthetic keywords
  Normal interval: 5,000 miles / 6 months (or 3 months if synthetic not mentioned)
  Severe interval: 5,000 miles / 3 months (tighter for conventional)

═══════════════════════════════════════════════════════════════════════════════
MIGRATION SCRIPT - PART 1: BACKUP & AUDIT
═══════════════════════════════════════════════════════════════════════════════

-- STEP 1: Create backup table
CREATE TABLE oem_schedules_backup AS
SELECT * FROM oem_schedules
WHERE make IN ('TOYOTA', 'HONDA', 'NISSAN', 'SUBARU', 'MAZDA')
  AND service_type LIKE '%OIL%CHANGE%';

-- STEP 2: Audit current data - see what needs fixing
SELECT 
    year, make, model, trim,
    service_type,
    interval_miles,
    interval_months,
    driving_condition,
    notes,
    CASE 
        WHEN service_type LIKE '%SYNTHETIC%' 
          OR service_type LIKE '%0W-%'
          OR notes LIKE '%SYNTHETIC%'
          OR notes LIKE '%0W-%'
        THEN 'SYNTHETIC'
        ELSE 'REGULAR'
    END AS detected_oil_type
FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
ORDER BY year, model, driving_condition, detected_oil_type;

-- STEP 3: Count records that will be updated
SELECT 
    make, model,
    CASE 
        WHEN service_type LIKE '%SYNTHETIC%' 
          OR service_type LIKE '%0W-%'
          OR notes LIKE '%SYNTHETIC%'
          OR notes LIKE '%0W-%'
        THEN 'SYNTHETIC'
        ELSE 'REGULAR'
    END AS oil_type,
    COUNT(*) as record_count,
    COUNT(CASE WHEN interval_miles NOT IN (5000, 10000) THEN 1 END) as needs_fixing
FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
GROUP BY make, model, oil_type
ORDER BY make, model;

═══════════════════════════════════════════════════════════════════════════════
MIGRATION SCRIPT - PART 2: SYNTHETIC OIL UPDATES
═══════════════════════════════════════════════════════════════════════════════

-- Update SYNTHETIC OIL changes - Normal Driving Condition
-- Criteria: Detect synthetic by keywords in service_type or notes
UPDATE oem_schedules
SET 
    interval_miles = 10000,
    interval_months = 12,
    notes = CONCAT(
        COALESCE(notes, ''),
        CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END,
        'CORRECTED: Synthetic oil interval per Toyota owner manual (10,000 mi / 12 mo normal driving)'
    ),
    citation = COALESCE(citation, 'Toyota Official - Synthetic Oil Schedule')
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
    AND interval_miles != 10000;  -- Only update if different

-- Update SYNTHETIC OIL changes - Severe Driving Condition
-- Severe: stop-and-go, towing, extreme temps, dusty conditions
UPDATE oem_schedules
SET 
    interval_miles = 5000,
    interval_months = 6,
    notes = CONCAT(
        COALESCE(notes, ''),
        CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END,
        'CORRECTED: Synthetic oil interval per Toyota owner manual (5,000 mi / 6 mo severe driving)'
    ),
    citation = COALESCE(citation, 'Toyota Official - Synthetic Oil Schedule - Severe Conditions')
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
    AND interval_miles != 5000;  -- Only update if different

═══════════════════════════════════════════════════════════════════════════════
MIGRATION SCRIPT - PART 3: REGULAR OIL UPDATES
═══════════════════════════════════════════════════════════════════════════════

-- Update REGULAR OIL changes - Normal Driving Condition
-- Criteria: Does NOT match synthetic keywords
UPDATE oem_schedules
SET 
    interval_miles = 5000,
    interval_months = 6,
    notes = CONCAT(
        COALESCE(notes, ''),
        CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END,
        'CORRECTED: Regular oil interval per Toyota owner manual (5,000 mi / 6 mo normal driving)'
    ),
    citation = COALESCE(citation, 'Toyota Official - Regular Oil Schedule')
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
    AND interval_miles != 5000;  -- Only update if different

-- Update REGULAR OIL changes - Severe Driving Condition
-- Severe: tighter interval for conventional oil
UPDATE oem_schedules
SET 
    interval_miles = 5000,
    interval_months = 3,
    notes = CONCAT(
        COALESCE(notes, ''),
        CASE WHEN notes IS NOT NULL THEN ' | ' ELSE '' END,
        'CORRECTED: Regular oil interval per Toyota owner manual (5,000 mi / 3 mo severe driving)'
    ),
    citation = COALESCE(citation, 'Toyota Official - Regular Oil Schedule - Severe Conditions')
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
    AND interval_miles != 5000;  -- Only update if different

═══════════════════════════════════════════════════════════════════════════════
MIGRATION SCRIPT - PART 4: VERIFICATION & VALIDATION
═══════════════════════════════════════════════════════════════════════════════

-- VERIFY: Show what was updated
SELECT 
    year, make, model, trim,
    service_type,
    driving_condition,
    interval_miles,
    interval_months,
    CASE 
        WHEN service_type LIKE '%SYNTHETIC%' 
          OR service_type LIKE '%0W-%'
          OR notes LIKE '%SYNTHETIC%'
          OR notes LIKE '%0W-%'
        THEN 'SYNTHETIC'
        ELSE 'REGULAR'
    END AS oil_type,
    CASE
        WHEN interval_miles = 10000 AND interval_months = 12 
          AND (service_type LIKE '%SYNTHETIC%' OR service_type LIKE '%0W-%')
          THEN '✅ CORRECT'
        WHEN interval_miles = 5000 AND interval_months = 6
          AND (service_type LIKE '%SYNTHETIC%' OR service_type LIKE '%0W-%')
          AND driving_condition = 'severe'
          THEN '✅ CORRECT'
        WHEN interval_miles = 5000 AND interval_months = 6
          AND NOT (service_type LIKE '%SYNTHETIC%' OR service_type LIKE '%0W-%')
          AND driving_condition = 'normal'
          THEN '✅ CORRECT'
        WHEN interval_miles = 5000 AND interval_months = 3
          AND NOT (service_type LIKE '%SYNTHETIC%' OR service_type LIKE '%0W-%')
          AND driving_condition = 'severe'
          THEN '✅ CORRECT'
        ELSE '❌ NEEDS REVIEW'
    END AS status
FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
ORDER BY model, oil_type, driving_condition;

-- COUNT: Summary of corrections
SELECT 
    make,
    CASE 
        WHEN service_type LIKE '%SYNTHETIC%' 
          OR service_type LIKE '%0W-%'
          OR notes LIKE '%SYNTHETIC%'
          OR notes LIKE '%0W-%'
        THEN 'SYNTHETIC'
        ELSE 'REGULAR'
    END AS oil_type,
    driving_condition,
    COUNT(*) as total_records,
    SUM(CASE WHEN interval_miles = 10000 AND interval_months = 12 THEN 1 ELSE 0 END) as synthetic_normal_correct,
    SUM(CASE WHEN interval_miles = 5000 AND interval_months = 6 THEN 1 ELSE 0 END) as correct_5k_6m,
    SUM(CASE WHEN interval_miles = 5000 AND interval_months = 3 THEN 1 ELSE 0 END) as regular_severe_correct
FROM oem_schedules
WHERE make = 'TOYOTA'
  AND service_type LIKE '%OIL%CHANGE%'
GROUP BY make, oil_type, driving_condition
ORDER BY oil_type, driving_condition;

═══════════════════════════════════════════════════════════════════════════════
MIGRATION SCRIPT - PART 5: SPECIFIC EXAMPLES FOR 2010 PRIUS
═══════════════════════════════════════════════════════════════════════════════

-- BEFORE: Check what exists for 2010 Prius
SELECT *
FROM oem_schedules
WHERE year = 2010
  AND make = 'TOYOTA'
  AND model = 'PRIUS'
  AND service_type LIKE '%OIL%CHANGE%';

-- EXPECTED AFTER for 2010 Prius:
-- Record 1: Synthetic, Normal → 10,000 mi / 12 mo
-- Record 2: Synthetic, Severe → 5,000 mi / 6 mo
-- Record 3: Regular, Normal → 5,000 mi / 6 mo
-- Record 4: Regular, Severe → 5,000 mi / 3 mo

-- VERIFY 2010 Prius after updates
SELECT 
    year, make, model,
    service_type,
    driving_condition,
    interval_miles,
    interval_months,
    CASE 
        WHEN service_type LIKE '%SYNTHETIC%' OR service_type LIKE '%0W-%'
        THEN 'SYNTHETIC'
        ELSE 'REGULAR'
    END AS oil_type
FROM oem_schedules
WHERE year = 2010
  AND make = 'TOYOTA'
  AND model = 'PRIUS'
  AND service_type LIKE '%OIL%CHANGE%'
ORDER BY service_type, driving_condition;

═══════════════════════════════════════════════════════════════════════════════
MIGRATION SCRIPT - PART 6: ROLLBACK (if needed)
═══════════════════════════════════════════════════════════════════════════════

-- If something goes wrong, restore from backup
TRUNCATE TABLE oem_schedules WHERE make = 'TOYOTA' AND service_type LIKE '%OIL%CHANGE%';

INSERT INTO oem_schedules
SELECT * FROM oem_schedules_backup;

-- Clean up backup
DROP TABLE oem_schedules_backup;

═══════════════════════════════════════════════════════════════════════════════
EXECUTION CHECKLIST
═══════════════════════════════════════════════════════════════════════════════

Before running this script:

☐ 1. Take full database backup (not just the table)
☐ 2. Run PART 1 (Backup & Audit) to see what will change
☐ 3. Review the audit results - understand the scope
☐ 4. Verify the detection logic for synthetic oil (keywords correct?)
☐ 5. Test on staging database first
☐ 6. Get approval for the changes
☐ 7. Run PART 2 (Synthetic Oil Updates)
☐ 8. Run PART 3 (Regular Oil Updates)
☐ 9. Run PART 4 (Verification) to confirm changes
☐ 10. Verify in UI that recommendations are correct
☐ 11. Update ARIA chatbot prompts if needed
☐ 12. Update citations in database records
☐ 13. Document the migration in change log
☐ 14. Monitor user feedback for any issues

═══════════════════════════════════════════════════════════════════════════════
CRITERIA USED FOR OIL TYPE DETECTION
═══════════════════════════════════════════════════════════════════════════════

SYNTHETIC OIL (detected in service_type or notes fields):
  ✓ "SYNTHETIC"
  ✓ "FULL SYNTHETIC"
  ✓ "0W-" (matches 0W-20, 0W-16, 0W-30, etc.)
  ✓ "0W20"
  ✓ "0W16"
  ✓ "5W30 SYN"
  ✓ "5W-30 SYNTHETIC"

REGULAR OIL (if NOT matching synthetic keywords):
  ✓ "CONVENTIONAL"
  ✓ "MINERAL"
  ✓ "REGULAR"
  ✓ Generic "OIL CHANGE" with no oil type specified

INTERVALS APPLIED:

┌──────────────┬────────────────────┬────────────────┬─────────────────┐
│ Oil Type     │ Driving Condition  │ Interval Miles │ Interval Months │
├──────────────┼────────────────────┼────────────────┼─────────────────┤
│ SYNTHETIC    │ Normal             │ 10,000         │ 12              │
│ SYNTHETIC    │ Severe             │ 5,000          │ 6               │
│ REGULAR      │ Normal             │ 5,000          │ 6               │
│ REGULAR      │ Severe             │ 5,000          │ 3               │
└──────────────┴────────────────────┴────────────────┴─────────────────┘

═══════════════════════════════════════════════════════════════════════════════
TESTING SCENARIOS (after migration)
═══════════════════════════════════════════════════════════════════════════════

Scenario 1: Synthetic 0W-20, Normal Driving, 11,093 miles, 365 days
  Expected: ✅ GENUINE (exceeds 10,000 interval)
  
Scenario 2: Synthetic 0W-20, Normal Driving, 8,000 miles, 100 days
  Expected: ❌ UPSELL (below 10,000 interval)
  
Scenario 3: Regular oil, Normal Driving, 5,500 miles, 100 days
  Expected: ❌ UPSELL (exceeds 5,000 interval)
  
Scenario 4: Regular oil, Severe, 5,500 miles, 100 days
  Expected: ❌ UPSELL (exceeds 3-month interval)
  
Scenario 5: Synthetic 0W-20, Normal, 6,000 miles, 365 days
  Expected: ✅ GENUINE (annual floor protects, once we fix that bug)

═══════════════════════════════════════════════════════════════════════════════
NOTES
═══════════════════════════════════════════════════════════════════════════════

1. This script updates Toyota only. Similar fixes needed for Honda, Nissan, etc.
2. The detection logic looks for keywords - verify these are consistent in your DB
3. The notes field is UPDATED to document the correction
4. Citations are standardized (can customize per your needs)
5. The WHERE clauses prevent re-running the same update multiple times
6. Review the BEFORE state carefully before committing

═══════════════════════════════════════════════════════════════════════════════
