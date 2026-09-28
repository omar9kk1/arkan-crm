# 03 - Recommended Project Structure

## Monorepo

```text
arkan-crm/
  apps/
    frontend/
      app/
      components/
      features/
      lib/
      styles/
      public/
      package.json
    backend/
      src/
        main.ts
        app.module.ts
        config/
        common/
        auth/
        users/
        employees/
        clients/
        owners/
        properties/
        deals/
        commissions/
        payroll/
        finance/
        attendance/
        followups/
        notifications/
        files/
        smart-paste/
        jobs/
      prisma/
        schema.prisma
        migrations/
      test/
      package.json
  packages/
    shared/
      src/
        types/
        enums/
        dto/
      package.json
  docker/
  docker-compose.yml
  package.json
  README.md
```

## Backend Module Rule

تُضاف المجالات الجديدة كوحدات مستقلة بخدمات وعقود معلنة. تبقى تفاصيل كل مجال داخله، وتبقى packages/shared للعقود المشتركة فقط. تطبق [قواعد قابلية التوسع](04_CLEAN_CODE_RULES.md#extensibility-rules) عند إضافة أو تعديل أي feature.

كل domain له:
```text
module.ts
controller.ts
service.ts
dto/
entities أو mappers/
```

## Frontend Feature Rule

كل feature لها:
```text
features/<feature-name>/
  components/
  hooks/
  api/
  types.ts
  page-client.tsx
```

## Important

لا يتم وضع كل الكود داخل صفحة واحدة. البروتوتايب HTML لا يتحول إلى ملف React واحد كبير.
يتم تقسيمه إلى:
- Layout components.
- Page components.
- Cards.
- Drawers.
- Modals.
- Forms.
- Tables/Lists.
- Hooks.
- API clients.
