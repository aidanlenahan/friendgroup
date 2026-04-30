-- Add a shared calendar token at the group level.
ALTER TABLE "Group" ADD COLUMN "calendarToken" TEXT;

-- Backfill from an existing membership token when available so previously shared
-- subscriptions are more likely to keep working after deploy.
WITH ranked_tokens AS (
  SELECT DISTINCT ON (m."groupId")
    m."groupId",
    m."calendarToken"
  FROM "Membership" m
  WHERE m."calendarToken" IS NOT NULL
  ORDER BY
    m."groupId",
    CASE
      WHEN m.role = 'owner' THEN 0
      WHEN m.role = 'admin' THEN 1
      ELSE 2
    END,
    m."createdAt" ASC
)
UPDATE "Group" g
SET "calendarToken" = ranked_tokens."calendarToken"
FROM ranked_tokens
WHERE g.id = ranked_tokens."groupId"
  AND g."calendarToken" IS NULL;

CREATE UNIQUE INDEX "Group_calendarToken_key" ON "Group"("calendarToken");