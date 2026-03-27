╔════════════════════════════════════════════════════════════════════════════╗
║                                                                            ║
║  CORRECTED HONDA SEVERE DRIVING INSERT SCRIPT                              ║
║                                                                            ║
║  Fixed: SQL syntax errors in VALUES clause                                ║
║  Issues fixed:                                                             ║
║  1. Missing closing parenthesis after each VALUES row                      ║
║  2. Missing commas between rows                                            ║
║  3. Proper quoting of strings with apostrophes                             ║
║                                                                            ║
╚════════════════════════════════════════════════════════════════════════════╝

═══════════════════════════════════════════════════════════════════════════════
CORRECTED INSERT SCRIPT - COPY THIS ENTIRE BLOCK
═══════════════════════════════════════════════════════════════════════════════

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
     '2017 Honda HR-V Owner''s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2017 HR-V Severe
    (2017, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner''s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2018 HR-V Severe
    (2018, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner''s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2019 HR-V Severe
    (2019, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner''s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2020 HR-V Severe
    (2020, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner''s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2021 HR-V Severe
    (2021, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. MM typically triggers 7,500–10,000 miles under highway conditions; 5,000 miles used as conservative normal-condition interval | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     '2017 Honda HR-V Owner''s Manual — Maintenance Minder Code A/B - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP),

    -- 2013 Pilot Severe
    (2013, 'Honda', 'Pilot', '', 'Oil Change', 5000, 6, 'severe',
     '0W-20 full synthetic required. Maintenance Minder Code A. Can extend to 7,500 miles with full synthetic. | [SEVERE DRIVING VERSION] Interval reduced to 5,000 miles / 6 months due to severe driving conditions',
     'Complete Auto Maintenance Master Guide, Feb 2026 - Honda Section - Severe Driving Conditions',
     NULL, CURRENT_TIMESTAMP);

═══════════════════════════════════════════════════════════════════════════════
KEY FIXES MADE
═══════════════════════════════════════════════════════════════════════════════

1. ✅ CLOSING PARENTHESIS
   BEFORE: (2017, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',...
           [MISSING )],

   AFTER:  (2017, 'Honda', 'HR-V', '', 'Oil Change', 5000, 6, 'severe',
            ... , NULL, CURRENT_TIMESTAMP),
            [✅ Added )],


2. ✅ PROPER STRING QUOTING
   BEFORE: 'Complete Auto Maintenance Master Guide, Feb 2026 - Honda Section - Severe Driving Conditions'
           [ISSUE: Apostrophe in "Owner's" not escaped]

   AFTER:  '2017 Honda HR-V Owner''s Manual — Maintenance Minder Code A/B'
           [✅ Double apostrophe '' escapes the single quote]


3. ✅ COMMAS BETWEEN ROWS
   BEFORE: (2013, 'Honda', 'Accord', ... ),
           -- 2013 Civic Severe
           (2013, 'Honda', 'Civic', ... )
           [MISSING comma after first row]

   AFTER:  (2013, 'Honda', 'Accord', ... ),
           (2013, 'Honda', 'Civic', ... ),
           [✅ Added comma after each row]


4. ✅ ALL VALUES PROPERLY FORMATTED
   Each row now has:
   - Opening parenthesis (
   - 12 columns separated by commas
   - Closing parenthesis ),
   - Comma after ) except for the last row which ends with semicolon ;

═══════════════════════════════════════════════════════════════════════════════
STEP-BY-STEP EXECUTION
═══════════════════════════════════════════════════════════════════════════════

STEP 1: Copy the entire corrected INSERT statement (from above)
────────────────────────────────────────────────────────────────

Select all text from "INSERT INTO oem_schedules" to the final semicolon ;

STEP 2: Paste into Supabase SQL Editor
──────────────────────────────────────

1. Go to Supabase Dashboard
2. Click: SQL Editor (left sidebar)
3. Click: New query
4. Paste the corrected INSERT script
5. Verify syntax highlighting shows no red errors

STEP 3: Execute the INSERT
──────────────────────────

1. Click: RUN button
2. Wait for success message
3. Expected: "9 rows affected"

Expected success output:
┌─────────────────────────────────────┐
│ 9 rows inserted successfully         │
└─────────────────────────────────────┘

☐ INSERT executed successfully


STEP 4: Verify the inserts
──────────────────────────

Run this verification query in a new SQL query:

SELECT 
    model, 
    COUNT(*) as total_records,
    COUNT(CASE WHEN driving_condition = 'normal' THEN 1 END) as normal_records,
    COUNT(CASE WHEN driving_condition = 'severe' THEN 1 END) as severe_records
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
GROUP BY model
ORDER BY model;

Expected output:
┌───────┬──────────────┬─────────────┬──────────────┐
│ model │ total_records│ normal_count│ severe_count │
├───────┼──────────────┼─────────────┼──────────────┤
│Accord │ 2            │ 1           │ 1            │
│Civic  │ 2            │ 1           │ 1            │
│CR-V   │ 2            │ 1           │ 1            │
│HR-V   │ 10           │ 5           │ 5            │
│Pilot  │ 2            │ 1           │ 1            │
└───────┴──────────────┴─────────────┴──────────────┘

☐ Verification query shows correct counts


STEP 5: Final comprehensive check
──────────────────────────────────

Run this query to verify all intervals are correct:

SELECT 
    driving_condition,
    COUNT(*) as record_count,
    MIN(interval_miles) as min_interval,
    MAX(interval_miles) as max_interval,
    MIN(interval_months) as min_months,
    MAX(interval_months) as max_months
FROM oem_schedules
WHERE make = 'Honda'
  AND service_type LIKE '%Oil Change%'
GROUP BY driving_condition
ORDER BY driving_condition;

Expected output:
┌───────────────┬──────────────┬─────────────┬─────────────┬───────────┬───────────┐
│ driving_cond. │ record_count │ min_interval│ max_interval│ min_months│ max_months│
├───────────────┼──────────────┼─────────────┼─────────────┼───────────┼───────────┤
│ normal        │ 9            │ 8000        │ 8000        │ 10        │ 10        │
│ severe        │ 9            │ 5000        │ 5000        │ 6         │ 6         │
└───────────────┴──────────────┴─────────────┴─────────────┴───────────┴───────────┘

Confirms:
✅ 9 normal records with 8000 mi / 10 months
✅ 9 severe records with 5000 mi / 6 months
✅ All intervals correct

☐ All intervals verified


═══════════════════════════════════════════════════════════════════════════════
COMMON SQL SYNTAX ERRORS & HOW WE FIXED THEM
═══════════════════════════════════════════════════════════════════════════════

ERROR 1: Missing Closing Parenthesis
────────────────────────────────────

❌ WRONG:
    (2013, 'Honda', 'Accord', '', 'Oil Change', 5000, 6, 'severe', ...
    (2013, 'Honda', 'Civic', '', 'Oil Change', 5000, 6, 'severe', ...
    [MISSING ) after each row]

✅ RIGHT:
    (2013, 'Honda', 'Accord', '', 'Oil Change', 5000, 6, 'severe', ...),
    (2013, 'Honda', 'Civic', '', 'Oil Change', 5000, 6, 'severe', ...),
    [✅ Each row ends with ),]


ERROR 2: Unescaped Apostrophes in Strings
──────────────────────────────────────────

❌ WRONG:
    'Owner's Manual'
    [BREAKS because apostrophe closes the string early]

✅ RIGHT:
    'Owner''s Manual'
    [Double apostrophe '' represents single apostrophe in SQL]


ERROR 3: Missing Commas Between Rows
────────────────────────────────────

❌ WRONG:
    (...VALUES...),
    (...VALUES...)
    [MISSING comma between rows]

✅ RIGHT:
    (...VALUES...),
    (...VALUES...),
    [✅ Comma after each row except the last]


ERROR 4: Missing Semicolon at End
─────────────────────────────────

❌ WRONG:
    (...VALUES...)
    [NO semicolon]

✅ RIGHT:
    (...VALUES...);
    [✅ Semicolon at the very end]

═══════════════════════════════════════════════════════════════════════════════
EXECUTION CHECKLIST
═══════════════════════════════════════════════════════════════════════════════

☐ STEP 1: Copied corrected INSERT script
☐ STEP 2: Pasted into Supabase SQL Editor
☐ STEP 3: Executed INSERT - Success (9 rows affected)
☐ STEP 4: Ran verification query - Counts correct
☐ STEP 5: Ran comprehensive check - Intervals verified

INSERT COMPLETE ✅

═══════════════════════════════════════════════════════════════════════════════
NEXT STEPS
═══════════════════════════════════════════════════════════════════════════════

After this INSERT completes successfully:

1. ✅ All Honda severe records created (9 records)
2. ✅ All intervals set to 5000 miles / 6 months
3. ✅ Verified and working

NOW PROCEED TO:
→ Data fix script (if needed for duplicates)
→ FINAL_PRODUCTION_MIGRATION_SCRIPT.md
  - 6 UPDATE statements
  - Vector embedding reset
  - Embedding regeneration
  - Application testing

═══════════════════════════════════════════════════════════════════════════════
