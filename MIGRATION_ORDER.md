# Backend Migration Order

This backend now supports a clean database reset using the normal Sequelize CLI
ordering by filename. The migrations have been squashed and restructured for 
maximum clarity and linear progression.

## Commands

Run from `backend/`:

```powershell
npm run db:migrate
npm run db:seed:all
```

## Canonical migration flow

Sequelize applies migrations in lexical filename order. The squashed schema chain is:

1. `20240101000001-create-schools.js`
2. `20240101000002-create-sessions.js`
3. `20240101000003-create-session-working-days.js`
4. `20240101000004-create-session-holidays.js`
5. `20240101000005-create-users.js`
6. `20240101000005a-create-teachers.js`
7. `20240101000006-create-students.js`
8. `20240101000007-create-classes.js`
9. `20240101000008-create-student-biometrics.js`
10. `20240101000009-create-audit-logs.js`
11. `20240101000010-create-sections.js`
12. `20240101000011-create-student-audit-trigger.js`
13. `20240101000012-create-subjects.js`
14. `20240101000013-create-student-profiles.js`
15. `20240101000014-create-enrollments.js`
16. `20240101000015-create-attendance.js`
17. `20240101000016-create-exams.js`
18. `20240101000017-create-exam-results.js`
19. `20240101000018-create-student-results.js`
20. `20240101000019-create-permissions.js`
21. `20240101000020-create-user-permissions.js`
22. `20240101000020a-create-teacher-permissions.js`
23. `20240101000021-create-permission-templates.js`
24. `20240101000022-create-bulk-import-logs.js`
25. `20240101000023-create-student-remarks.js`
26. `20240101000024-create-homework.js`
27. `20240101000025-create-homework-submissions.js`
28. `20240101000026-create-teacher-leaves.js`
29. `20240101000027-create-leave-balances.js`
30. `20240101000028-create-timetable-slots.js`
31. `20240101000029-create-teacher-assignments.js`
32. `20240101000030-create-notices.js`
33. `20240101000031-create-notice-interactions.js`
34. `20240101000032-create-correction-requests.js`
35. `20240101000033-create-student-achievements.js`
36. `20240101000034-create-study-materials.js`
37. `20240101000035-create-student-subjects.js`
38. `20240101000036-create-exam-subjects.js`
39. `20240101000037-create-chat.js`
40. `20240101000038-create-fee-foundation.js`
41. `20240101000039-create-cheque-payments.js`
42. `20240101000040-create-fee-refunds.js`
43. `20240101000041-create-fee-carry-forwards.js`
44. `20240101000042-create-collection-targets.js`
45. `20240101000043-create-notifications.js`
46. `20240101000044-create-student-documents.js`
47. `20240101000045-sync-exam-publishing-columns.js`
48. `20240101000046-add-exam-subject-timetable.js`
49. `20240101000047-fix-exam-results-foreign-keys.js`
50. `20240101000048-fix-exam-subjects-foreign-keys.js`
51. `20240101000049-add-release-result-to-student-results.js`
52. `20240101000050-update-notices-attribution.js`
53. `20240101000051-fix-notices-teacher-id-nullability.js`
54. `20240101000052-add-student-leaving-fields.js`
55. `20240101000053-add-school-logo-principal.js`
56. `20240101000054-create-staff-attendance.js`
57. `20240101000055-create-expenses.js`
58. `20240101000056-create-salary-and-payroll.js`
59. `20240101000057-create-health-records.js`
60. `20240101000058-create-families.js`
61. `20240101000059-add-user-to-families.js`
62. `20240101000060-create-inventory.js`
63. `20240101000061-create-transport.js`
64. `20240101000062-create-feedback.js`
65. `20240101000063-create-library-books.js`
66. `20240101000064-create-library-issues.js`
67. `20240101000065-create-library-settings.js`
68. `20240101000066-add-optional-remarks-to-fee-structures.js`
69. `20240515000001-add-parent-credentials-to-profiles.js`
70. `20260511000000-create-unified-notices.js`
71. `20260511015110-fix-staff-attendance-fk.js`
72. `20260511020000-add-left-to-enrollment-leaving-type.js`
73. `20260512000000-enhance-notices-targeting.js`
74. `20260515000000-add-teacher-role-to-users-enum.js`
75. `20260515000001-add-attachment-to-notices.js`
76. `20260516000000-drop-notices-poster-user-fk.js`
77. `20260518000000-expand-notices-posted-by-role-enum.js`
78. `20260523000001-create-certificates.js`
79. `20260525000000-fix-payroll-foreign-keys.js`
80. `20260525000001-fix-staff-attendance-polymorphism.js`
81. `20260526000001-add-upi-id-to-schools.js`
82. `20260526000002-create-upi-payment-requests.js`
83. `20260526000003-add-upi-id-to-fee-payments.js`
84. `20260526000004-add-upi-name-to-schools.js`
85. `20260526000005-add-unique-upi-index.js`
86. `20260526000006-add-upi-enabled-to-schools.js`
87. `20260527000001-add-unique-isbn-per-school.js`
88. `20260527000002-create-library-reservations.js`

## Canonical seed flow

These are the main demo seeders for a fresh DB (Sequelize CLI will run them in lexical order):

1. `05school-and-admin.js` - Foundation: School and initial Super Admin.
2. `10-school-session.js` - Core configuration: Primary session.
3. `20-classes-sections-subjects.js` - Academic structure.
4. `30-bulk-students.js` - Student body population.
5. `40-teachers-and-assignments.js` - Faculty and subject assignments.
6. `50-school-timetable.js` - Class schedules.
7. `60-student-attendance.js` - Historical attendance data.
8. `70-staff-attendance.js` - Faculty attendance records.
9. `80-admin-notices.js` - Communication and announcements.
10. `90-school-fees.js` - Financial records and structures.
