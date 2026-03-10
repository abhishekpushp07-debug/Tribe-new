#!/usr/bin/env python3
"""
B3 Migration — Content Items Backfill
Adds canonical authorType/authorId/createdAs fields to legacy content items.

Safe, idempotent, non-destructive.
Run: python3 scripts/b3_backfill_author_fields.py
"""

import os
import sys
from pymongo import MongoClient

MONGO_URL = os.environ.get('MONGO_URL', 'mongodb://localhost:27017')
DB_NAME = os.environ.get('DB_NAME', 'your_database_name')

def run_backfill():
    client = MongoClient(MONGO_URL)
    db = client[DB_NAME]
    col = db['content_items']

    # Find all content items without authorType field
    query = {
        '$or': [
            {'authorType': {'$exists': False}},
            {'authorType': None},
        ]
    }
    total = col.count_documents(query)
    print(f'Found {total} content items needing backfill')

    if total == 0:
        print('Nothing to backfill. Already up to date.')
        return

    # Batch update — set authorType=USER, createdAs=USER
    # authorId should already match the existing authorId field
    result = col.update_many(
        query,
        [
            {
                '$set': {
                    'authorType': 'USER',
                    'createdAs': 'USER',
                    'actingUserId': { '$ifNull': ['$actingUserId', '$authorId'] },
                    'actingRole': { '$ifNull': ['$actingRole', None] },
                    'pageId': { '$ifNull': ['$pageId', None] },
                }
            }
        ]
    )
    print(f'Updated {result.modified_count} content items')
    print('Backfill complete. Re-run is safe (idempotent).')

if __name__ == '__main__':
    run_backfill()
