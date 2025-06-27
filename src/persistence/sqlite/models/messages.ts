import { execute, query, queryOne, getDatabase } from '../database';

export interface Message {
  id: string;
  type: string;
  senderId: string;
  receivers: string[]; // Stored as JSON
  content: string | Record<string, any>; // JSON or text
  priority: 'low' | 'normal' | 'high' | 'critical';
  reliability: 'best-effort' | 'at-least-once' | 'exactly-once';
  correlationId?: string;
  replyTo?: string;
  ttlMs?: number;
  compressed: boolean;
  encrypted: boolean;
  sizeBytes: number;
  contentType: string;
  route: string[]; // Stored as JSON
  createdAt: Date;
  expiresAt?: Date;
}

export interface MessageAcknowledgment {
  messageId: string;
  agentId: string;
  status: 'acknowledged' | 'rejected';
  acknowledgedAt: Date;
}

export interface MessageWithAcknowledgments extends Message {
  acknowledgments: MessageAcknowledgment[];
  deliveryRate: number;
}

export class MessageModel {
  private static readonly TABLE_NAME = 'messages';
  private static readonly ACK_TABLE = 'message_acknowledgments';

  static async create(message: Omit<Message, 'createdAt'>): Promise<string> {
    const content = typeof message.content === 'string' 
      ? message.content 
      : JSON.stringify(message.content);

    await execute(
      `INSERT INTO ${this.TABLE_NAME} 
       (id, type, sender_id, receivers, content, priority, reliability,
        correlation_id, reply_to, ttl_ms, compressed, encrypted,
        size_bytes, content_type, route, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        message.id,
        message.type,
        message.senderId,
        JSON.stringify(message.receivers),
        content,
        message.priority,
        message.reliability,
        message.correlationId,
        message.replyTo,
        message.ttlMs,
        message.compressed ? 1 : 0,
        message.encrypted ? 1 : 0,
        message.sizeBytes,
        message.contentType,
        JSON.stringify(message.route),
        message.expiresAt?.toISOString()
      ]
    );

    return message.id;
  }

  static async findById(id: string): Promise<MessageWithAcknowledgments | undefined> {
    const message = await queryOne<any>(
      `SELECT * FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );

    if (!message) return undefined;

    const acknowledgments = await query<any>(
      `SELECT * FROM ${this.ACK_TABLE} WHERE message_id = ?`,
      [id]
    );

    return this.mapToMessageWithAcknowledgments(message, acknowledgments);
  }

  static async findBySender(senderId: string, limit: number = 100): Promise<Message[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE sender_id = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [senderId, limit]
    );

    return results.map(this.mapToMessage);
  }

  static async findByReceiver(receiverId: string, limit: number = 100): Promise<Message[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE json_extract(receivers, '$') LIKE ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [`%"${receiverId}"%`, limit]
    );

    return results.map(this.mapToMessage);
  }

  static async findByType(type: string, limit: number = 100): Promise<Message[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE type = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [type, limit]
    );

    return results.map(this.mapToMessage);
  }

  static async findByCorrelation(correlationId: string): Promise<Message[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE correlation_id = ?
       ORDER BY created_at ASC`,
      [correlationId]
    );

    return results.map(this.mapToMessage);
  }

  static async findExpired(): Promise<Message[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.TABLE_NAME} 
       WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP
       ORDER BY expires_at`
    );

    return results.map(this.mapToMessage);
  }

  static async findUnacknowledged(agentId: string): Promise<Message[]> {
    const results = await query<any>(
      `SELECT m.* FROM ${this.TABLE_NAME} m
       WHERE json_extract(m.receivers, '$') LIKE ?
       AND NOT EXISTS (
         SELECT 1 FROM ${this.ACK_TABLE} a
         WHERE a.message_id = m.id AND a.agent_id = ?
       )
       ORDER BY m.priority DESC, m.created_at ASC`,
      [`%"${agentId}"%`, agentId]
    );

    return results.map(this.mapToMessage);
  }

  static async acknowledge(
    messageId: string, 
    agentId: string, 
    status: 'acknowledged' | 'rejected' = 'acknowledged'
  ): Promise<boolean> {
    const result = await execute(
      `INSERT OR REPLACE INTO ${this.ACK_TABLE} 
       (message_id, agent_id, status)
       VALUES (?, ?, ?)`,
      [messageId, agentId, status]
    );

    return result.changes > 0;
  }

  static async bulkAcknowledge(
    acknowledgments: Array<{ messageId: string; agentId: string; status: 'acknowledged' | 'rejected' }>
  ): Promise<number> {
    const db = getDatabase();
    return db.withTransaction(async (conn) => {
      const stmt = conn.prepare(
        `INSERT OR REPLACE INTO ${this.ACK_TABLE} 
         (message_id, agent_id, status)
         VALUES (?, ?, ?)`
      );

      let count = 0;
      for (const ack of acknowledgments) {
        const result = stmt.run(ack.messageId, ack.agentId, ack.status);
        if (result.changes > 0) count++;
      }

      return count;
    });
  }

  static async getAcknowledgments(messageId: string): Promise<MessageAcknowledgment[]> {
    const results = await query<any>(
      `SELECT * FROM ${this.ACK_TABLE} WHERE message_id = ?`,
      [messageId]
    );

    return results.map(row => ({
      messageId: row.message_id,
      agentId: row.agent_id,
      status: row.status,
      acknowledgedAt: new Date(row.acknowledged_at)
    }));
  }

  static async getDeliveryStatus(messageId: string): Promise<{
    totalReceivers: number;
    acknowledged: number;
    rejected: number;
    pending: number;
    deliveryRate: number;
  }> {
    const message = await this.findById(messageId);
    if (!message) {
      return {
        totalReceivers: 0,
        acknowledged: 0,
        rejected: 0,
        pending: 0,
        deliveryRate: 0
      };
    }

    const totalReceivers = message.receivers.length;
    const acknowledged = message.acknowledgments.filter(a => a.status === 'acknowledged').length;
    const rejected = message.acknowledgments.filter(a => a.status === 'rejected').length;
    const pending = totalReceivers - acknowledged - rejected;
    const deliveryRate = totalReceivers > 0 ? (acknowledged / totalReceivers) * 100 : 0;

    return {
      totalReceivers,
      acknowledged,
      rejected,
      pending,
      deliveryRate
    };
  }

  static async delete(id: string): Promise<boolean> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} WHERE id = ?`,
      [id]
    );
    return result.changes > 0;
  }

  static async cleanupExpired(): Promise<number> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME} 
       WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP`
    );
    return result.changes;
  }

  static async cleanupOld(daysToKeep: number = 30): Promise<number> {
    const result = await execute(
      `DELETE FROM ${this.TABLE_NAME}
       WHERE created_at < datetime('now', '-' || ? || ' days')`,
      [daysToKeep]
    );
    return result.changes;
  }

  static async getStatistics(): Promise<{
    totalMessages: number;
    messagesByType: Record<string, number>;
    messagesByPriority: Record<Message['priority'], number>;
    averageDeliveryRate: number;
    recentMessages: number;
    expiredMessages: number;
    averageMessageSize: number;
  }> {
    const db = getDatabase();
    return db.withConnection(async (conn) => {
      const totalStmt = conn.prepare(
        `SELECT COUNT(*) as count FROM ${this.TABLE_NAME}`
      );
      const total = totalStmt.get() as any;

      const typeStmt = conn.prepare(
        `SELECT type, COUNT(*) as count FROM ${this.TABLE_NAME} GROUP BY type`
      );
      const typeResults = typeStmt.all() as any[];

      const priorityStmt = conn.prepare(
        `SELECT priority, COUNT(*) as count FROM ${this.TABLE_NAME} GROUP BY priority`
      );
      const priorityResults = priorityStmt.all() as any[];

      const deliveryStmt = conn.prepare(`
        SELECT AVG(delivery_rate) as avg_rate FROM (
          SELECT 
            m.id,
            CAST(COUNT(a.agent_id) AS REAL) / json_array_length(m.receivers) * 100 as delivery_rate
          FROM ${this.TABLE_NAME} m
          LEFT JOIN ${this.ACK_TABLE} a ON m.id = a.message_id AND a.status = 'acknowledged'
          GROUP BY m.id
        )
      `);
      const delivery = deliveryStmt.get() as any;

      const recentStmt = conn.prepare(
        `SELECT COUNT(*) as count FROM ${this.TABLE_NAME} 
         WHERE created_at > datetime('now', '-1 hour')`
      );
      const recent = recentStmt.get() as any;

      const expiredStmt = conn.prepare(
        `SELECT COUNT(*) as count FROM ${this.TABLE_NAME} 
         WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP`
      );
      const expired = expiredStmt.get() as any;

      const sizeStmt = conn.prepare(
        `SELECT AVG(size_bytes) as avg_size FROM ${this.TABLE_NAME}`
      );
      const size = sizeStmt.get() as any;

      const messagesByType: Record<string, number> = {};
      typeResults.forEach(row => {
        messagesByType[row.type] = row.count;
      });

      const messagesByPriority: Record<Message['priority'], number> = {
        low: 0,
        normal: 0,
        high: 0,
        critical: 0
      };
      priorityResults.forEach(row => {
        messagesByPriority[row.priority as Message['priority']] = row.count;
      });

      return {
        totalMessages: total.count || 0,
        messagesByType,
        messagesByPriority,
        averageDeliveryRate: delivery.avg_rate || 0,
        recentMessages: recent.count || 0,
        expiredMessages: expired.count || 0,
        averageMessageSize: size.avg_size || 0
      };
    });
  }

  static async getRecentActivity(minutes: number = 60): Promise<{
    messagesSent: number;
    messagesAcknowledged: number;
    uniqueSenders: number;
    uniqueReceivers: number;
    topTypes: Array<{ type: string; count: number }>;
  }> {
    const db = getDatabase();
    return db.withConnection(async (conn) => {
      const cutoff = `datetime('now', '-${minutes} minutes')`;

      const sentStmt = conn.prepare(
        `SELECT COUNT(*) as count FROM ${this.TABLE_NAME} WHERE created_at > ${cutoff}`
      );
      const sent = sentStmt.get() as any;

      const ackedStmt = conn.prepare(
        `SELECT COUNT(*) as count FROM ${this.ACK_TABLE} WHERE acknowledged_at > ${cutoff}`
      );
      const acked = ackedStmt.get() as any;

      const sendersStmt = conn.prepare(
        `SELECT COUNT(DISTINCT sender_id) as count FROM ${this.TABLE_NAME} WHERE created_at > ${cutoff}`
      );
      const senders = sendersStmt.get() as any;

      const receiversStmt = conn.prepare(
        `SELECT COUNT(DISTINCT agent_id) as count FROM ${this.ACK_TABLE} WHERE acknowledged_at > ${cutoff}`
      );
      const receivers = receiversStmt.get() as any;

      const topTypesStmt = conn.prepare(
        `SELECT type, COUNT(*) as count FROM ${this.TABLE_NAME} 
         WHERE created_at > ${cutoff}
         GROUP BY type
         ORDER BY count DESC
         LIMIT 5`
      );
      const topTypes = topTypesStmt.all() as any[];

      return {
        messagesSent: sent.count || 0,
        messagesAcknowledged: acked.count || 0,
        uniqueSenders: senders.count || 0,
        uniqueReceivers: receivers.count || 0,
        topTypes: topTypes.map(t => ({ type: t.type, count: t.count }))
      };
    });
  }

  private static mapToMessage(row: any): Message {
    let content: string | Record<string, any>;
    try {
      content = JSON.parse(row.content);
    } catch {
      content = row.content;
    }

    return {
      id: row.id,
      type: row.type,
      senderId: row.sender_id,
      receivers: JSON.parse(row.receivers || '[]'),
      content,
      priority: row.priority,
      reliability: row.reliability,
      correlationId: row.correlation_id,
      replyTo: row.reply_to,
      ttlMs: row.ttl_ms,
      compressed: !!row.compressed,
      encrypted: !!row.encrypted,
      sizeBytes: row.size_bytes,
      contentType: row.content_type,
      route: JSON.parse(row.route || '[]'),
      createdAt: new Date(row.created_at),
      expiresAt: row.expires_at ? new Date(row.expires_at) : undefined
    };
  }

  private static mapToMessageWithAcknowledgments(
    messageRow: any, 
    ackRows: any[]
  ): MessageWithAcknowledgments {
    const message = this.mapToMessage(messageRow);
    const acknowledgments = ackRows.map(row => ({
      messageId: row.message_id,
      agentId: row.agent_id,
      status: row.status,
      acknowledgedAt: new Date(row.acknowledged_at)
    }));

    const deliveryRate = message.receivers.length > 0
      ? (acknowledgments.filter(a => a.status === 'acknowledged').length / message.receivers.length) * 100
      : 0;

    return {
      ...message,
      acknowledgments,
      deliveryRate
    };
  }
}