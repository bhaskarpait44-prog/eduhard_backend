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
6. `20240101000006-create-students.js`
7. `20240101000007-create-classes.js`
8. `20240101000008-create-student-biometrics.js`
9. `20240101000009-create-audit-logs.js`
10. `20240101000010-create-sections.js`
11. `20240101000011-create-student-audit-trigger.js`
12. `20240101000012-create-subjects.js`
13. `20240101000013-create-student-profiles.js`
14. `20240101000014-create-enrollments.js`
15. `20240101000015-create-attendance.js`
16. `20240101000016-create-exams.js`
17. `20240101000017-create-exam-results.js`
18. `20240101000018-create-student-results.js`
19. `20240101000019-create-permissions.js`
20. `20240101000020-create-user-permissions.js`
21. `20240101000021-create-permission-templates.js`
22. `20240101000022-create-bulk-import-logs.js`
23. `20240101000023-create-student-remarks.js`
24. `20240101000024-create-homework.js`
25. `20240101000025-create-homework-submissions.js`
26. `20240101000026-create-teacher-leaves.js`
27. `20240101000027-create-leave-balances.js`
28. `20240101000028-create-timetable-slots.js`
29. `20240101000029-create-teacher-assignments.js`
30. `20240101000030-create-notices.js`
31. `20240101000031-create-notice-interactions.js`
32. `20240101000032-create-correction-requests.js`
33. `20240101000033-create-student-achievements.js`
34. `20240101000034-create-study-materials.js`
35. `20240101000035-create-student-subjects.js`
36. `20240101000036-create-exam-subjects.js`
37. `20240101000037-create-chat.js`
38. `20240101000038-create-fee-foundation.js`
39. `20240101000039-create-cheque-payments.js`
40. `20240101000040-create-fee-refunds.js`
41. `20240101000041-create-fee-carry-forwards.js`
42. `20240101000042-create-collection-targets.js`
43. `20240101000043-create-notifications.js`
44. `20240101000044-create-student-documents.js`
45. `20240101000045-sync-exam-publishing-columns.js`
46. `20240101000046-add-exam-subject-timetable.js`
47. `20240101000047-fix-exam-results-foreign-keys.js`
48. `20240101000048-fix-exam-subjects-foreign-keys.js`
49. `20240101000049-fix-homework-teacher-foreign-key.js`

## Canonical seed flow

These are the main demo seeders for a fresh DB (Sequelize CLI will run them in lexical order):

1. `10-school-session.js` - Creates School, Admin User, and Session.
2. `15-session-config.js` - Sets up Sundays as holidays for May 2026.
3. `20-classes-sections.js` - Sets up Classes 9-12 and Section A for each.
4. `30-subjects.js` - Adds subjects for all classes (Common for 9-10, Science for 11-12).
5. `40-teachers.js` - Creates 7 specialized teachers (one per subject) and assigns them roles.
6. `50-students.js` - Populates 20 students (5 per class) with detailed profiles.
7. `55-families.js` - Creates family records and links them to students.
8. `60-academic-ops.js` - Generates Timetables (using specialist teachers), Exams, and Notices.
9. `65-attendance.js` - Generates daily student attendance for May 2026.
10. `70-fees.js` - Sets up Fee Structures and initial Fee Invoices.
11. `75-inventory-transport.js` - Sets up Transport routes/stops and Inventory items/stock.
12. `80-staff-ops.js` - Generates Staff Attendance and User Feedback.

