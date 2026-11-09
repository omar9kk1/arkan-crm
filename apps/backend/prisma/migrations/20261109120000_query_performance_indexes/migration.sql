-- Additive query-performance indexes.
--
-- Justified by EXPLAIN (ANALYZE, BUFFERS) on arkan_crm_api_test with synthetic
-- data (1,003 users, 20,000 clients, 20,000 properties, 60,000 follow-ups,
-- 20,040 approval requests, 30,000 notifications, 10,000 deals, 30,000 audit
-- logs, 30,000 follow-up subjects).
--
-- No table or column is changed, no row is rewritten, and every index can be
-- dropped to roll back.

-- Client cards: follow-up filter + min(dueAt) per page/counter.
CREATE INDEX "FollowUp_clientId_status_dueAt_idx"
  ON "FollowUp" ("clientId", "status", "dueAt");

-- Latest approval round per property (notification enrichment, review flows).
CREATE INDEX "PropertyApprovalRequest_propertyId_createdAt_idx"
  ON "PropertyApprovalRequest" ("propertyId", "createdAt");

-- Property list/search: newest-first cursor without a full sort.
CREATE INDEX "Property_createdAt_idx"
  ON "Property" ("createdAt");

-- Client list: newest-first cursor (OWNER/global and scoped reads).
CREATE INDEX "Client_createdAt_idx"
  ON "Client" ("createdAt");

-- Employee directory aggregate: clients created by a profile.
CREATE INDEX "Client_createdById_idx"
  ON "Client" ("createdById");

-- Notification bell: recipient inbox ordered by createdAt DESC, id DESC.
CREATE INDEX "Notification_userId_createdAt_idx"
  ON "Notification" ("userId", "createdAt");

-- Dashboard period totals (default month/window filters).
CREATE INDEX "Deal_closedAt_idx"
  ON "Deal" ("closedAt");

-- Employee directory aggregate/sort: deals attributed to a profile on either
-- side (property employee or client employee).
CREATE INDEX "Deal_propertyEmployeeId_idx"
  ON "Deal" ("propertyEmployeeId");
CREATE INDEX "Deal_clientEmployeeId_idx"
  ON "Deal" ("clientEmployeeId");

-- Dashboard recent activity: newest audit rows without a full scan.
CREATE INDEX "AuditLog_createdAt_idx"
  ON "AuditLog" ("createdAt");

-- Manager follow-up listing: responsible manager ordered by next due date.
CREATE INDEX "FollowUpSubject_responsibleUserId_nextDueAt_idx"
  ON "FollowUpSubject" ("responsibleUserId", "nextDueAt");
