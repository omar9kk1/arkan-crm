# Diagnosis: Pending Property Edit & Missing Manager Notification

**Date:** 2026-11-05  
**Project:** D:\Projects\arkan-crm  
**Type:** Read-only diagnosis  
**Status:** Findings recorded — no code changes made during this diagnosis

---

## 0. Important scope note

The current working tree **already contains an uncommitted fix** for this exact scenario from the immediately preceding task. This diagnosis did **not** add, change or revert any code or data.

- Against the **pre-fix code**, the reported scenario reproduces.
- Against the **current working tree**, the edit is persisted and the Manager notification is created (verified on the isolated test database).
- If you want to implement the fix from a clean baseline, Section 6 lists the minimal patch. If you want to review the current fix instead, the relevant locations are in Section 5.

---

## 1. Reproduction of the pre-fix behavior

Reported sequence:

1. Employee opens an own property with `status = PENDING`.
2. Employee changes `plotNumber` and saves.
3. Manager's Pending Review / duplicate comparison still shows old data.
4. Manager receives no notification.

This matches the pre-fix `PATCH /properties/:id` path:
- The new non-empty `plotNumber` **was written to `Property.plotNumber`**.
- No Manager notification was created at all.
- The Manager client did not necessarily re-read the property.
- `PropertyApprovalRequest.duplicateCandidateIds` was not recalculated, so the candidate list could remain the one captured at submission time.

---

## 2. Frontend findings

### 2.1 Is editing PENDING properties supported?

**Yes.**

- `apps/frontend/lib/property-adapter.ts` → `editableByViewer()`:
  - returns `true` for an own `PENDING` row (`mine === true` + `apiStatus === 'PENDING'`).
- `apps/frontend/features/employee-properties/components/employee-property-details-drawer.tsx` renders the edit button when `editableByViewer(p)` is true.
- `apps/frontend/features/employee-properties/components/new-property-modal-v2.tsx` calls `updateProperty(property.id, toUpdatePropertyPayload(...), image?.file ?? null)`.
- Backend accepts `PENDING`, `REJECTED` and `AVAILABLE` in `PropertiesService.update()` and keeps `PENDING` as `PENDING` (it does not go through the AVAILABLE-only return-to-review branch).

### 2.2 Does the save send the changed plot number?

**Yes, for a new non-empty value.**

- `toUpdatePropertyPayload()` builds the body from `sharedPayload()`, which includes:
  ```ts
  const plotNumber = form.plotNumber.trim();
  if (plotNumber) payload.plotNumber = plotNumber;
  ```
- The request is `PATCH /properties/:id` with the mandatory `version`.
- Backend `UpdatePropertyPayloadDto` accepts `plotNumber` and `version`; `PropertiesService.update()` writes `data.plotNumber = trimOrNull(payload.plotNumber)`.

**Pre-fix exception — clearing a field:**
`sharedPayload()` omits empty values. So if the employee **erased** the plot number, the key was absent from the PATCH, and the server kept the old value. Changing `22` → `23` was sent and saved; changing `22` → empty was silently ignored. This was fixed in the current tree by `toUpdatePropertyPayload()` sending explicit `null` for clearable fields (`apps/frontend/lib/property-adapter.ts:570-592`).

### 2.3 Endpoint, validation, response

- Endpoint: `PATCH /properties/:id` (`apps/backend/src/properties/properties.controller.ts`, `update()`).
- Request body: JSON (or multipart when a replacement image is attached). `version` is mandatory.
- Validation:
  - `UpdatePropertyPayloadDto` (`version`, optional `plotNumber`, etc.).
  - `PropertiesService.validateUpdateShape()` does not restrict PENDING.
  - `existing.version !== payload.version` → `409`.
  - non-creator → `403`.
- Response: `PropertyViewDto` from `getAuthorizedDetail()`, which reads the row again after commit.

### 2.4 Does the UI show false success after a failed save?

**Not for a normal PENDING PATCH failure.**

`new-property-modal-v2.tsx` wraps the call in `try/catch`; on failure it keeps the modal open, preserves entered values and shows the server message. The parent page's success toast (`onSave()`) runs only after the `updateProperty` promise resolves.

One adjacent edge case exists for `REJECTED` / `CHANGES_REQUESTED` rows: after a successful PATCH, the modal calls `resubmitProperty()`. If that second call fails, the PATCH **was** saved, but the parent may still show a “saved” notice while the resubmit error is displayed. This is not the reported plain-PENDING path.

### 2.5 Why the employee page could open stale data

Pre-fix, the page passed the `selected` snapshot directly to the details drawer and edit modal. After a background list refetch, `selected` could still be the older object (old values / old `version`). The current tree derives `selectedLive` from the latest rows:

`apps/frontend/features/employee-properties/components/employee-properties-page.tsx:119-122`

```ts
const selectedLive = selected
  ? ((selected.id
      ? rows.find((property) => property.id === selected.id)
      : undefined) ?? selected)
  : null;
```

and uses it for both the drawer and the edit modal.

---

## 3. Backend & database findings

### 3.1 Trace of the update

`apps/backend/src/properties/properties.service.ts` → `update()` (line 1133):

1. `requireExisting(id)` — `deletedAt: null` only.
2. Ownership check: `existing.createdByUserId !== viewer.id` → `403`.
3. Allowed statuses: `PENDING`, `REJECTED`, `AVAILABLE`.
4. Version check: stale → `409`.
5. `validateUpdateShape()`.
6. For PENDING: `returnsToReview = false`; status is not changed.
7. Transaction:
   - `tx.property.updateMany({ where: { id, createdByUserId, status: existing.status, version }, data })`
   - `data.plotNumber = trimOrNull(payload.plotNumber)`
   - floors replaced when present
   - requested-property upsert/delete
   - audit row `PROPERTY_UPDATE`
8. Returns `getAuthorizedDetail(viewer, id)`.

**Where the edit lives:**
- The new plot number goes **directly to `Property.plotNumber`**.
- It is **not** stored only in a revision/approval snapshot.
- For PENDING edits, no new `PropertyRevision` row is created; the existing approval request stays the open round.
- For AVAILABLE edits (`returnsToReview = true`), the row becomes PENDING and a new review round/revision is created.

### 3.2 Does the edit reach the database?

**Yes, for non-empty values.** Confirmed by the existing integration test and a read-only inspection after running it on the isolated test database:

```
Property: reference P-000001, status PENDING, block 12, plotNumber 970102,
          version 2, sizeSqm 320.00
```

The original version was `1`; the save incremented it to `2`, and the P code did not change.

### 3.3 Why the Manager sees old data

There were two independent reasons:

**A. No refresh of the Manager client**
- The Manager property page keeps the loaded rows/drawer in client state.
- Pre-fix it had no `autoSyncMs` polling and no edit notification to trigger the existing notification refresh signal.
- Therefore an already-open Manager page/drawer kept the old snapshot until a manual reload.
- Current tree: `apps/frontend/features/manager-properties/components/manager-properties.tsx:97` adds `autoSyncMs: 20_000`; `:166` derives `selectedLive` from the newest rows.
- The bell branch (`notification-bell.tsx:185-186`) publishes `notifyPropertyDataChanged()` for any property-linked notification, which `usePropertyList` turns into a silent refetch.

**B. Stale duplicate candidates even after a reload**
- `PropertyApprovalRequest.duplicateCandidateIds` was written only at submission creation.
- `serializeProperty()` exposes it to the Manager from `approvals[0]`:
  `apps/backend/src/properties/property-serializer.ts:257-259`.
- The drawer fetches those candidate ids (`property-details-drawer.tsx:120-144`).
- Pre-fix, editing the PENDING property did not recalculate this array, so a new plot number could:
  - keep an obsolete candidate, or
  - fail to add a newly matching candidate.
- The field-by-field comparison itself uses the current `property.details`, so if the drawer received fresh property data the values would update; the candidate set and fetched candidate objects were the stale part.

**Important:** the Manager review reads live `Property` columns via `GET /properties` / `GET /properties/:id` → `serializeProperty()` → `toPublicPropertyDto()`. There is no “approval snapshot” serving the property fields. A fresh read therefore returns the saved plot number; the stale behavior came from client caching and the stale candidate array, not from the property being saved into a hidden revision only.

---

## 4. Notification findings

### 4.1 Did a successful PENDING edit create a Manager notification?

**Pre-fix: no.** There was no event at all.

- `PropertiesService.update()` had no call to any notification writer for a PENDING edit.
- `NotificationsService` had no `notifyPropertyEdited` method.
- `notification-events.ts` had no `EDITED` title/key.
- The existing bell poll was healthy, but there was nothing new to return, so no refresh signal and no inbox row.

This is a **missing event/handler**, not a recipient, transaction, deduplication or delivery failure.

### 4.2 What the current tree does

- `NotificationsService.notifyPropertyEdited()` (`notifications.service.ts:336-367`) sends to every active Manager the title:
  **«تم تعديل عقار تحت المراجعة»**
  and the exact body line:
  **«قام الموظف بتحديث بيانات عقار بانتظار المراجعة. يُرجى الاطلاع على التعديلات.»**
  plus:
  - `رقم العقار: <current code>` (`approvedReference ?? reference`)
  - `الموظف: <database name>`
  - `التعديلات: <labels from formatPropertyChanges>`
  - `التاريخ: <edit date>`
- It is called inside the same transaction in `update()` (`properties.service.ts:1500-1527`).
- Guard: only `existing.status === PENDING`, `viewer.role === EMPLOYEE`, and `editChanges.length > 0`.
- `eventKey = PROPERTY_EDITED:<propertyId>:v<versionAfter>` (`notification-events.ts:120-121`):
  - retried request after success → `409`, no second notification;
  - every new successful save has a new version and therefore a distinct event.
- Notification type is `SYSTEM` with `propertyId`, so no migration/enum change is needed.
- `notificationRoute()` for a Manager opens `/manager/properties?property=<id>`, i.e. the Pending Review page.

### 4.3 Does the bell / drawer refresh automatically?

Yes, in the current tree:
- The bell polls the notifications API and, for any notification linked to a property, calls `notifyPropertyDataChanged()` (`notification-bell.tsx:182-186`).
- `usePropertyRefreshSignal()` causes `usePropertyList` to silently refetch.
- Manager page also has `autoSyncMs = 20_000` and focus/visibility refetch.
- The open drawer uses `selectedLive` and refetches candidates when `property.duplicateCandidateIds` changes.

In the pre-fix state, the bell mechanism existed but received no edit event; and the Manager page had no interval fallback. Both are required for cross-session refresh.

---

## 5. Duplicate comparison findings

### 5.1 Staleness

- Candidate ids are stored on the latest `PropertyApprovalRequest` and exposed only to Managers (`property-serializer.ts:257-259`).
- Pre-fix, `update()` never recomputed them.
- The Manager drawer fetches candidates by those ids and keeps them in state (`property-details-drawer.tsx:120-144`); the effect depends on `property.duplicateCandidateIds`.
- Therefore, after a plot-number edit:
  - the Manager could still see the old “similar property” badge/list;
  - a newly matching property would not appear;
  - the comparison panel would compare the new property fields against the old candidate set.

### 5.2 Current tree

`PropertiesService.recalculateDuplicateCandidates()` (`properties.service.ts:1564+`):
- runs only for PENDING edits;
- takes a `pg_advisory_xact_lock` on the new identity before the write (race safety);
- reads the saved row (including provisional/official owner and floors);
- classifies every active property in the same governorate/district except itself, using the **unchanged** `classifyDuplicate()`;
- writes `duplicateCandidateIds` to the latest approval request (`[]` when distinct);
- `resubmit()` carries the recalculated ids into the new review round (`properties.service.ts:1727-1740`), so “request changes → edit → resubmit” does not lose them.

The visual comparison rules were separately corrected in `apps/frontend/features/manager-properties/duplicate-comparison.ts`:
- both missing → «بيانات ناقصة» and counted as matched in the visual summary;
- one missing → «مختلف» with «—»;
- both present → «مطابق»/«مختلف» after normalization;
- `0` is not treated as missing;
- the backend classifier still gives no positive score for two missing values (covered by a direct unit test: missing strong identifiers on both sides → `DISTINCT`).

---

## 6. Proposed minimal fix (if starting from the pre-fix baseline)

1. **Backend notification event**
   - Add `EDITED: 'تم تعديل عقار تحت المراجعة'` and `edited(propertyId, version)` to `notification-events.ts`.
   - Add `notifyPropertyEdited()` to `NotificationsService`.
   - Call it from `PropertiesService.update()` inside the transaction after a successful write, only when:
     - `existing.status === PENDING`
     - `viewer.role === EMPLOYEE`
     - the pre/post diff is non-empty.

2. **Actual-change detection**
   - Capture the property snapshot before the write (`capturePropertySnapshot`).
   - Capture it again after all writes.
   - Use `diffPropertySnapshots()` and `formatPropertyChanges()`.
   - This also prevents no-op notifications and supplies the “updated fields” text.

3. **Duplicate recalculation**
   - In `update()` for PENDING, recompute candidates from the saved row with the same classifier and update the latest `PropertyApprovalRequest.duplicateCandidateIds`.
   - Carry the array through `resubmit()`.
   - Keep the existing `approveAsDistinct` gate unchanged.

4. **Manager refresh**
   - Add `autoSyncMs: 20_000` to the Manager `usePropertyList` call (or rely on the new notification + bell signal once the event exists).
   - Keep `selectedLive` from the newest rows.
   - Ensure the drawer refetches candidates when `duplicateCandidateIds` changes.

5. **Frontend edit payload**
   - On update only, send explicit `null` for cleared `governorate`, `district`, `block`, `plotNumber`, `sizeSqm`, `askingPrice`, so a cleared field is not silently kept.

### Tests needed

- Employee edits own PENDING property’s plot number → `200`, `Property.plotNumber` updated, `version + 1`, status still PENDING, P code unchanged.
- Manager `GET /properties/:id` returns the new value.
- Exactly one Manager notification per successful edit: title/body/code/employee name/changed labels/date, `PROPERTY_EDITED:<id>:v<version>`.
- No notification for no-op save, stale version (`409`), wrong employee (`403`), or failed transaction.
- Duplicate candidates added/cleared after the edit; approval is blocked until `approveAsDistinct`; candidates survive a change request + resubmit.
- Manager page/drawer refreshes after the edit without a manual reload.
- Comparison rules: both missing → «بيانات ناقصة» + visually matched; one missing → «مختلف»; equal → «مطابق»; different → «مختلف»; `0` not missing.
- Backend classifier: two missing strong identifiers never produce a positive match.

---

## 7. Verification evidence for the current tree

### 7.1 Isolated test database (allowed write-based reproduction)

After running the existing focused test on `arkan_crm_api_test`:

```
Property: P-000001, PENDING, block 12, plotNumber 970102, version 2
Notification: SYSTEM, title «تم تعديل عقار تحت المراجعة»,
              eventKey PROPERTY_EDITED:<id>:v2
```

After running the duplicate-recalculation test:

```
Property: P-000001, PENDING, plotNumber 970499, version 3
Approval request: duplicateCandidateIds = []
Notifications: PROPERTY_EDITED v2 and PROPERTY_EDITED v3
```

The candidate test’s intermediate assertion also confirms the candidate id was added before the distinct edit cleared it.

### 7.2 Development database (read-only inspection)

`arkan_crm` currently contains 3 properties, 3 approval requests and 5 notifications. No rows were modified during this diagnosis.

`P-000002` has `version = 4` and three `PROPERTY_UPDATE` audit rows (02:39, 02:40, 02:41) whose `after` payload is only `{"status":"PENDING"}` and there is no «تم تعديل عقار تحت المراجعة» notification. This is consistent with the pre-fix path (no changed-field labels, no edit event), but the audit payload alone cannot prove whether those three saves changed a field; the pre-fix code did not record that information.

### 7.3 Test / build status

- `test/employee-pending-property-edit.spec.ts` — 6/6 pass.
- `test/duplicate-comparison.spec.ts` — 16/16 pass.
- Focused regression groups: 7 suites / 149 tests pass; broader run: 13 suites / 208 tests pass.
- Backend and frontend `tsc --noEmit` pass.
- ESLint passes on all modified files.
- `nest build` and `next build` pass.

---

## 8. Conclusion

- **Employee edit reaches the database:** yes, for non-empty values. The old `Property.plotNumber` is replaced directly; no revision-only storage is involved.
- **Manager sees old data because:** the Manager client was not refreshed (no edit notification, no auto-sync) and the duplicate candidate list on the approval request was not recalculated.
- **Manager receives no notification because:** the pre-fix `update()` had no Manager notification writer; the event/handler simply did not exist.
- **Current working tree:** already contains the fix, verified on the isolated test database. No code, data, migrations or sequences were changed during this diagnosis.

**Stopped for approval before any further fix or review action.**
