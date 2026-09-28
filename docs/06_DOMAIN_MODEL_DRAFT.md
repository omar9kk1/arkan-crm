# 06 - Domain Model Draft

## Core Entities

```text
User
EmployeeProfile
Client
Owner
Property
PropertyAssignment
PropertyApprovalRequest
FollowUp
Deal
Commission
PayrollEntry
FinanceMovement
AttendanceRecord
Notification
AuditLog
FileAsset
```

## Important Relationships

```text
User 1--1 EmployeeProfile
EmployeeProfile 1--many Client as createdBy/responsibleEmployee
EmployeeProfile 1--many Owner as createdBy/responsibleEmployee
Owner 1--many Property
Property many--many EmployeeProfile through PropertyAssignment
Client 1--many Deal
Property 1--many Deal
Deal 1--many Commission
PayrollEntry creates FinanceMovement
Deal creates FinanceMovement for company income
Commission creates FinanceMovement for employee outgoing commission
AttendanceRecord may affect PayrollEntry deduction later
FollowUp belongs to Client or Owner or Property
Notification can link to Property/Client/Owner/Deal/FollowUp/Payroll
AuditLog links to actor User
```

## Deal Rule

في MVP المدير فقط يسجل الصفقة:
1. يختار العقار.
2. النظام يقترح موظف العقار من بيانات العقار أو التخصيص.
3. المدير يعتمد أو يختار موظف آخر.
4. يختار العميل.
5. النظام يقترح موظف العميل من بيانات العميل.
6. المدير يدخل سعر الصفقة.
7. المدير يدخل عمولة الشركة.
8. المدير يدخل عمولة كل موظف.
9. النظام ينشئ:
   - Deal.
   - Commission records.
   - FinanceMovement للعمولة الداخلة.
   - FinanceMovement لكل عمولة خارجة.
   - AuditLog.
10. حالة العقار تتحول إلى SOLD أو RENTED ولا يتم حذف العقار.

## Finance Rule

صفحة المالية لا تدخل البيانات من نفسها فقط، بل تجمعها من:
- Deal.
- Commission.
- PayrollEntry.
- ManualExpense.
كل FinanceMovement يجب أن يحتوي sourceType و sourceId.
