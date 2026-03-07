# Tribe — Database Explain Plans & Index Proof

Generated: 2026-03-07T19:11:56Z

## Full Index Dump
```
=== houses ===
  {"_id":1}
  {"id":1} UNIQUE
  {"slug":1} UNIQUE

=== consent_acceptances ===
  {"_id":1}
  {"userId":1,"noticeVersion":1}

=== content_items ===
  {"_id":1}
  {"id":1} UNIQUE
  {"visibility":1,"createdAt":-1}
  {"authorId":1,"createdAt":-1}
  {"collegeId":1,"visibility":1,"createdAt":-1}
  {"kind":1,"visibility":1,"createdAt":-1}
  {"houseId":1,"kind":1,"visibility":1,"createdAt":-1}
  {"collegeId":1,"kind":1,"visibility":1,"createdAt":-1}
  {"kind":1,"visibility":1,"distributionStage":1,"createdAt":-1}
  {"expiresAt":1} TTL(0s) PARTIAL({"kind":"STORY"})

=== house_ledger ===
  {"_id":1}
  {"userId":1,"createdAt":-1}
  {"houseId":1,"createdAt":-1}

=== media_assets ===
  {"_id":1}
  {"id":1} UNIQUE
  {"ownerId":1,"createdAt":-1}

=== appeals ===
  {"_id":1}
  {"userId":1,"createdAt":-1}
  {"id":1} UNIQUE
  {"status":1,"createdAt":-1}

=== grievance_tickets ===
  {"_id":1}
  {"status":1,"dueAt":1}
  {"id":1} UNIQUE
  {"userId":1}

=== saves ===
  {"_id":1}
  {"userId":1,"contentId":1} UNIQUE
  {"userId":1,"createdAt":-1}

=== colleges ===
  {"_id":1}
  {"id":1} UNIQUE
  {"state":1}
  {"type":1}
  {"normalizedName":1}
  {"aisheCode":1} SPARSE
  {"state":1,"type":1}
  {"membersCount":-1}

=== reports ===
  {"_id":1}
  {"id":1} UNIQUE
  {"status":1,"createdAt":-1}
  {"targetId":1,"targetType":1}
  {"reporterId":1}

=== suspensions ===
  {"_id":1}
  {"userId":1,"endAt":-1}

=== feature_flags ===
  {"_id":1}
  {"key":1} UNIQUE

=== strikes ===
  {"_id":1}
  {"userId":1,"createdAt":-1}
  {"contentId":1}

=== notifications ===
  {"_id":1}
  {"userId":1,"createdAt":-1}
  {"userId":1,"read":1}

=== sessions ===
  {"_id":1}
  {"token":1} UNIQUE
  {"expiresAt":1} TTL(0s)
  {"userId":1}

=== users ===
  {"_id":1}
  {"phone":1} UNIQUE
  {"id":1} UNIQUE
  {"houseId":1}
  {"collegeId":1,"followersCount":-1}
  {"createdAt":-1}
  {"role":1}
  {"_fts":"text","_ftsx":1}
  {"username":1} UNIQUE PARTIAL({"username":{"$type":"string"}})

=== comments ===
  {"_id":1}
  {"contentId":1,"createdAt":-1}
  {"id":1} UNIQUE
  {"authorId":1,"createdAt":-1}
  {"parentId":1} SPARSE

=== moderation_events ===
  {"_id":1}
  {"id":1} UNIQUE
  {"targetId":1,"createdAt":-1}
  {"actorId":1,"createdAt":-1}

=== follows ===
  {"_id":1}
  {"followerId":1,"followeeId":1} UNIQUE
  {"followeeId":1}
  {"followerId":1}
  {"followeeId":1,"createdAt":-1}
  {"followerId":1,"createdAt":-1}

=== reactions ===
  {"_id":1}
  {"userId":1,"contentId":1} UNIQUE
  {"contentId":1}
  {"contentId":1,"type":1}

=== consent_notices ===
  {"_id":1}
  {"active":1}

=== audit_logs ===
  {"_id":1}
  {"createdAt":-1}
  {"actorId":1,"createdAt":-1}
  {"targetType":1,"targetId":1}

```

## Explain Plans for Critical Queries

### 1. Public Feed (GET /feed/public)
```json
{
  indexUsed: 'COLLSCAN',
  totalDocsExamined: 19,
  totalKeysExamined: 19,
  nReturned: 19,
  executionTimeMillis: 0
}
```

### 2. Following Feed (GET /feed/following)
```json
{
  indexUsed: 'COLLSCAN',
  totalDocsExamined: 0,
  totalKeysExamined: 0,
  nReturned: 0,
  executionTimeMillis: 0
}
```

### 3. College Feed (GET /feed/college/:id)
```json
{
  indexUsed: 'COLLSCAN',
  totalDocsExamined: 0,
  totalKeysExamined: 0,
  nReturned: 0,
  executionTimeMillis: 0
}
```

### 4. House Feed (GET /feed/house/:id)
```json
{
  indexUsed: 'COLLSCAN',
  totalDocsExamined: 4,
  totalKeysExamined: 4,
  nReturned: 4,
  executionTimeMillis: 0
}
```

### 5. Comments (GET /content/:id/comments)
```json
{
  indexUsed: 'COLLSCAN',
  totalDocsExamined: 0,
  totalKeysExamined: 0,
  nReturned: 0,
  executionTimeMillis: 0
}
```

### 6. Notifications (GET /notifications)
```json
{
  indexUsed: 'COLLSCAN',
  totalDocsExamined: 0,
  totalKeysExamined: 0,
  nReturned: 0,
  executionTimeMillis: 0
}
```

### 7. College Search (GET /colleges/search?q=IIT)
```json
{
  indexUsed: 'COLLSCAN',
  totalDocsExamined: 78,
  totalKeysExamined: 78,
  nReturned: 20,
  executionTimeMillis: 0
}
```

## Document Counts
```
houses: 12
consent_acceptances: 7
content_items: 21
house_ledger: 0
media_assets: 4
appeals: 3
grievance_tickets: 9
saves: 3
colleges: 1366
reports: 8
suspensions: 0
feature_flags: 0
strikes: 0
notifications: 12
sessions: 62
users: 12
comments: 9
moderation_events: 0
follows: 2
reactions: 4
consent_notices: 1
audit_logs: 132
```
