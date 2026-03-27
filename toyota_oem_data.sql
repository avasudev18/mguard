-- Toyota OEM Schedule Data
-- Based on Minor Service and Value Package information provided
-- Applies to: Camry, Prius, RAV4, Corolla, and most Toyota models 2018-2024

-- Delete existing Toyota schedules (optional - only if reloading)
-- DELETE FROM oem_schedules WHERE make = 'Toyota';

-- TOYOTA CAMRY 2020 - Normal Maintenance Schedule
INSERT INTO oem_schedules (year, make, model, trim, service_type, interval_miles, interval_months, driving_condition, citation, notes) VALUES
(2020, 'Toyota', 'Camry', NULL, 'Oil Change', 10000, 12, 'normal', '2020 Toyota Camry Owner''s Manual', 'Synthetic oil required. Part of Minor Service package'),
(2020, 'Toyota', 'Camry', NULL, 'Tire Rotation', 10000, 12, 'normal', '2020 Toyota Camry Owner''s Manual', 'Inspect brakes during rotation. Part of Minor Service'),
(2020, 'Toyota', 'Camry', NULL, 'Brake Inspection', 10000, 12, 'normal', '2020 Toyota Camry Owner''s Manual', 'Visual inspection of pads, rotors, calipers'),
(2020, 'Toyota', 'Camry', NULL, 'Battery Test', 10000, 12, 'normal', '2020 Toyota Camry Owner''s Manual', 'Check battery health and charging system'),
(2020, 'Toyota', 'Camry', NULL, 'Multi-Point Inspection', 10000, 12, 'normal', '2020 Toyota Camry Owner''s Manual', 'Comprehensive vehicle inspection'),
(2020, 'Toyota', 'Camry', NULL, 'Fluid Top-Off', 10000, 12, 'normal', '2020 Toyota Camry Owner''s Manual', 'Check and top off all fluid levels'),
(2020, 'Toyota', 'Camry', NULL, 'Air Filter Replacement', 30000, 36, 'normal', '2020 Toyota Camry Owner''s Manual', 'Replace engine air filter'),
(2020, 'Toyota', 'Camry', NULL, 'Cabin Air Filter Replacement', 20000, 24, 'normal', '2020 Toyota Camry Owner''s Manual', 'Replace cabin air filter'),
(2020, 'Toyota', 'Camry', NULL, 'Transmission Fluid Change', 60000, NULL, 'severe', '2020 Toyota Camry Owner''s Manual', 'Severe driving conditions only - NOT required for normal driving'),
(2020, 'Toyota', 'Camry', NULL, 'Brake Fluid Change', NULL, 24, 'normal', '2020 Toyota Camry Owner''s Manual', 'Replace brake fluid every 2 years'),
(2020, 'Toyota', 'Camry', NULL, 'Spark Plugs Replacement', 60000, NULL, 'normal', '2020 Toyota Camry Owner''s Manual', 'Iridium spark plugs');

-- TOYOTA PRIUS 2018 - Hybrid Specific Schedule
INSERT INTO oem_schedules (year, make, model, trim, service_type, interval_miles, interval_months, driving_condition, citation, notes) VALUES
(2018, 'Toyota', 'Prius', NULL, 'Oil Change', 10000, 12, 'normal', '2018 Toyota Prius Owner''s Manual', 'Synthetic oil required'),
(2018, 'Toyota', 'Prius', NULL, 'Tire Rotation', 10000, 12, 'normal', '2018 Toyota Prius Owner''s Manual', 'Inspect brakes during rotation'),
(2018, 'Toyota', 'Prius', NULL, 'HV Battery Cooling Filter Cleaning', 20000, 24, 'normal', '2018 Toyota Prius Owner''s Manual', 'Hybrid-specific: Clean high-voltage battery cooling intake filter'),
(2018, 'Toyota', 'Prius', NULL, 'Brake Inspection', 10000, 12, 'normal', '2018 Toyota Prius Owner''s Manual', 'Visual inspection'),
(2018, 'Toyota', 'Prius', NULL, 'Battery Test', 10000, 12, 'normal', '2018 Toyota Prius Owner''s Manual', '12V auxiliary battery test'),
(2018, 'Toyota', 'Prius', NULL, 'Multi-Point Inspection', 10000, 12, 'normal', '2018 Toyota Prius Owner''s Manual', 'Comprehensive vehicle inspection'),
(2018, 'Toyota', 'Prius', NULL, 'Air Filter Replacement', 30000, 36, 'normal', '2018 Toyota Prius Owner''s Manual', 'Replace engine air filter'),
(2018, 'Toyota', 'Prius', NULL, 'Cabin Air Filter Replacement', 20000, 24, 'normal', '2018 Toyota Prius Owner''s Manual', 'Replace cabin air filter'),
(2018, 'Toyota', 'Prius', NULL, 'Transmission Fluid Change', 60000, NULL, 'severe', '2018 Toyota Prius Owner''s Manual', 'Severe driving conditions only'),
(2018, 'Toyota', 'Prius', NULL, 'Hybrid System Inspection', 30000, 36, 'normal', '2018 Toyota Prius Owner''s Manual', 'Inspect hybrid system components');

-- SERVICES NOT IN OEM SCHEDULE (Potential Upsells)
INSERT INTO oem_schedules (year, make, model, trim, service_type, interval_miles, interval_months, driving_condition, citation, notes) VALUES
(2020, 'Toyota', 'Camry', NULL, 'Engine Treatment', NULL, NULL, 'normal', 'NOT IN OEM SCHEDULE', 'Optional service - not required by manufacturer. Common upsell.'),
(2020, 'Toyota', 'Camry', NULL, 'Engine Flush', NULL, NULL, 'normal', 'NOT IN OEM SCHEDULE', 'Not recommended by Toyota. Potential upsell.'),
(2020, 'Toyota', 'Camry', NULL, 'Fuel System Cleaning', NULL, NULL, 'normal', 'NOT IN OEM SCHEDULE', 'Not required for normal maintenance. Use quality fuel instead.'),
(2020, 'Toyota', 'Camry', NULL, 'Battery Protection Pads', NULL, NULL, 'normal', 'NOT IN OEM SCHEDULE', 'Optional accessory - not part of maintenance schedule'),
(2020, 'Toyota', 'Camry', NULL, 'Tire Balance', NULL, NULL, 'normal', 'AS NEEDED', 'Only required if vibration or uneven wear detected, not scheduled maintenance');

-- Generic Toyota schedules (applies to most models if specific model not found)
INSERT INTO oem_schedules (year, make, model, trim, service_type, interval_miles, interval_months, driving_condition, citation, notes) VALUES
(2019, 'Toyota', 'RAV4', NULL, 'Oil Change', 10000, 12, 'normal', 'Toyota Standard Maintenance Schedule', 'Synthetic oil'),
(2019, 'Toyota', 'RAV4', NULL, 'Tire Rotation', 10000, 12, 'normal', 'Toyota Standard Maintenance Schedule', NULL),
(2021, 'Toyota', 'Corolla', NULL, 'Oil Change', 10000, 12, 'normal', 'Toyota Standard Maintenance Schedule', 'Synthetic oil'),
(2021, 'Toyota', 'Corolla', NULL, 'Tire Rotation', 10000, 12, 'normal', 'Toyota Standard Maintenance Schedule', NULL);
