/**
 * Tribe — Moderation Repository (MongoDB)
 *
 * Keep DB writes out of service logic. Provider-agnostic audit storage.
 */

import { v4 as uuidv4 } from 'uuid'

export class MongoModerationRepository {
  constructor(db) {
    this.db = db
  }

  async saveAudit(record) {
    await this.db.collection('moderation_audit_logs').insertOne({
      id: uuidv4(),
      ...record,
      createdAt: record.createdAt || new Date(),
    })
  }

  async createReviewTicket(input) {
    const ticketId = uuidv4()

    await this.db.collection('moderation_review_queue').insertOne({
      id: ticketId,
      status: 'OPEN',
      priority: input.confidence >= 0.8 ? 'HIGH' : 'NORMAL',
      entityType: input.entityType,
      entityId: input.entityId,
      actorUserId: input.actorUserId,
      action: input.action,
      confidence: input.confidence,
      reasons: input.reasons,
      payload: input.payload || {},
      createdAt: input.createdAt || new Date(),
      updatedAt: input.createdAt || new Date(),
    })

    return ticketId
  }

  async getReviewQueue(status = 'OPEN', limit = 20) {
    return this.db.collection('moderation_review_queue')
      .find({ status }, { projection: { _id: 0 } })
      .sort({ priority: 1, createdAt: 1 })
      .limit(limit)
      .toArray()
  }
}
