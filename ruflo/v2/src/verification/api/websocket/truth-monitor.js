/**
 * WebSocket Truth Monitoring Server
 * Real-time verification and truth monitoring via WebSocket
 * 
 * Following patterns from existing WebSocket implementation in analysis.js
 */

const WebSocket = require('ws');
const { nanoid } = require('nanoid');
const EventEmitter = require('events');

class TruthMonitoringServer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.port = options.port || 8080;
    this.server = null;
    this.clients = new Map();
    this.subscriptions = new Map();
    this.heartbeatInterval = options.heartbeatInterval || 30000;
    this.messageBuffer = [];
    this.maxBufferSize = options.maxBufferSize || 1000;
    
    this.setupEventHandlers();
  }
  
  start() {
    this.server = new WebSocket.Server({ port: this.port });
    
    this.server.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });
    
    this.server.on('error', (error) => {
      console.error('WebSocket server error:', error);
      this.emit('error', error);
    });
    
    // Start heartbeat interval
    this.startHeartbeat();
    
    console.log(`Truth monitoring WebSocket server started on port ${this.port}`);
    this.emit('started', { port: this.port });
  }
  
  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    if (this.server) {
      this.server.close(() => {
        console.log('Truth monitoring WebSocket server stopped');
        this.emit('stopped');
      });
    }
  }
  
  handleConnection(ws, req) {
    const clientId = nanoid();
    const clientInfo = {
      id: clientId,
      ws,
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      connectedAt: Date.now(),
      subscriptions: new Set(),
      lastHeartbeat: Date.now(),
    };
    
    this.clients.set(clientId, clientInfo);
    
    console.log(`Truth monitoring client connected: ${clientId}`);
    
    // Send welcome message
    this.sendMessage(ws, {
      type: 'connected',
      payload: {
        client_id: clientId,
        server_time: Date.now(),
        available_events: this.getAvailableEventTypes(),
      },
    });
    
    // Send buffered messages if any
    this.sendBufferedMessages(ws);
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.handleMessage(clientId, message);
      } catch (error) {
        console.error('Invalid message format:', error);
        this.sendError(ws, 'INVALID_MESSAGE_FORMAT', 'Message must be valid JSON');
      }
    });
    
    ws.on('close', () => {
      this.handleDisconnection(clientId);
    });
    
    ws.on('error', (error) => {
      console.error(`Client ${clientId} error:`, error);
      this.handleDisconnection(clientId);
    });
    
    ws.on('pong', () => {
      if (this.clients.has(clientId)) {
        this.clients.get(clientId).lastHeartbeat = Date.now();
      }
    });
    
    this.emit('client_connected', { clientId, clientInfo });
  }
  
  handleDisconnection(clientId) {
    const client = this.clients.get(clientId);
    if (client) {
      // Clean up subscriptions
      client.subscriptions.forEach(subscriptionId => {
        this.removeSubscription(subscriptionId);
      });
      
      this.clients.delete(clientId);
      console.log(`Truth monitoring client disconnected: ${clientId}`);
      this.emit('client_disconnected', { clientId });
    }
  }
  
  handleMessage(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    switch (message.type) {
      case 'subscribe':
        this.handleSubscribe(clientId, message);
        break;
        
      case 'unsubscribe':
        this.handleUnsubscribe(clientId, message);
        break;
        
      case 'heartbeat':
        this.handleHeartbeat(clientId, message);
        break;
        
      case 'get_status':
        this.handleGetStatus(clientId, message);
        break;
        
      case 'get_metrics':
        this.handleGetMetrics(clientId, message);
        break;
        
      default:
        this.sendError(client.ws, 'UNKNOWN_MESSAGE_TYPE', `Unknown message type: ${message.type}`);
    }
  }
  
  handleSubscribe(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const { payload } = message;
    const subscriptionId = nanoid();
    
    const subscription = {
      id: subscriptionId,
      clientId,
      filter: this.validateSubscriptionFilter(payload.filter),
      createdAt: Date.now(),
    };
    
    this.subscriptions.set(subscriptionId, subscription);
    client.subscriptions.add(subscriptionId);
    
    this.sendMessage(client.ws, {
      type: 'subscription_created',
      payload: {
        subscription_id: subscriptionId,
        filter: subscription.filter,
      },
      id: message.id,
    });
    
    console.log(`Client ${clientId} subscribed with filter:`, subscription.filter);
  }
  
  handleUnsubscribe(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const { subscription_id } = message.payload;
    
    if (this.removeSubscription(subscription_id)) {
      client.subscriptions.delete(subscription_id);
      
      this.sendMessage(client.ws, {
        type: 'subscription_removed',
        payload: {
          subscription_id,
        },
        id: message.id,
      });
      
      console.log(`Client ${clientId} unsubscribed from ${subscription_id}`);
    } else {
      this.sendError(client.ws, 'SUBSCRIPTION_NOT_FOUND', `Subscription ${subscription_id} not found`);
    }
  }
  
  handleHeartbeat(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    client.lastHeartbeat = Date.now();
    
    this.sendMessage(client.ws, {
      type: 'heartbeat_ack',
      payload: {
        server_time: Date.now(),
      },
      id: message.id,
    });
  }
  
  handleGetStatus(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const status = {
      server_uptime: Date.now() - this.startTime,
      connected_clients: this.clients.size,
      active_subscriptions: this.subscriptions.size,
      message_buffer_size: this.messageBuffer.length,
      server_time: Date.now(),
    };
    
    this.sendMessage(client.ws, {
      type: 'status_response',
      payload: status,
      id: message.id,
    });
  }
  
  handleGetMetrics(clientId, message) {
    const client = this.clients.get(clientId);
    if (!client) return;
    
    const metrics = this.calculateServerMetrics();
    
    this.sendMessage(client.ws, {
      type: 'metrics_response',
      payload: metrics,
      id: message.id,
    });
  }
  
  // Broadcast truth monitoring events
  broadcastTruthEvent(event) {
    const truthEvent = {
      id: nanoid(),
      type: event.type || 'truth_change',
      timestamp: Date.now(),
      data: event.data,
      severity: event.severity || 'medium',
      source: event.source,
      confidence: event.confidence,
      metadata: event.metadata || {},
    };
    
    // Add to message buffer
    this.addToBuffer(truthEvent);
    
    // Find matching subscriptions
    const matchingSubscriptions = Array.from(this.subscriptions.values())
      .filter(sub => this.eventMatchesFilter(truthEvent, sub.filter));
    
    // Send to subscribed clients
    matchingSubscriptions.forEach(subscription => {
      const client = this.clients.get(subscription.clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        this.sendMessage(client.ws, {
          type: 'truth_event',
          payload: truthEvent,
        });
      }
    });
    
    this.emit('truth_event_broadcast', { event: truthEvent, subscribers: matchingSubscriptions.length });
  }
  
  // Broadcast verification updates
  broadcastVerificationUpdate(verification) {
    const event = {
      id: nanoid(),
      type: 'verification_update',
      timestamp: Date.now(),
      data: verification,
      severity: verification.status === 'failed' ? 'high' : 'medium',
      source: verification.source,
      confidence: verification.confidence,
    };
    
    this.broadcastTruthEvent(event);
  }
  
  // Broadcast system alerts
  broadcastAlert(alert) {
    const event = {
      id: nanoid(),
      type: 'system_alert',
      timestamp: Date.now(),
      data: alert,
      severity: alert.severity || 'high',
      source: 'system',
      confidence: 1.0,
    };
    
    this.broadcastTruthEvent(event);
  }
  
  validateSubscriptionFilter(filter = {}) {
    return {
      event_types: Array.isArray(filter.event_types) ? filter.event_types : ['truth_change', 'verification_update', 'system_alert'],
      severity_levels: Array.isArray(filter.severity_levels) ? filter.severity_levels : ['low', 'medium', 'high', 'critical'],
      sources: Array.isArray(filter.sources) ? filter.sources : [],
      targets: Array.isArray(filter.targets) ? filter.targets : [],
      confidence_min: typeof filter.confidence_min === 'number' ? filter.confidence_min : 0,
      confidence_max: typeof filter.confidence_max === 'number' ? filter.confidence_max : 1,
    };
  }
  
  eventMatchesFilter(event, filter) {
    // Check event type
    if (filter.event_types.length > 0 && !filter.event_types.includes(event.type)) {
      return false;
    }
    
    // Check severity
    if (filter.severity_levels.length > 0 && !filter.severity_levels.includes(event.severity)) {
      return false;
    }
    
    // Check source
    if (filter.sources.length > 0 && !filter.sources.includes(event.source)) {
      return false;
    }
    
    // Check confidence range
    if (event.confidence < filter.confidence_min || event.confidence > filter.confidence_max) {
      return false;
    }
    
    return true;
  }
  
  removeSubscription(subscriptionId) {
    return this.subscriptions.delete(subscriptionId);
  }
  
  sendMessage(ws, message) {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(message));
      } catch (error) {
        console.error('Error sending message:', error);
      }
    }
  }
  
  sendError(ws, code, message) {
    this.sendMessage(ws, {
      type: 'error',
      payload: {
        code,
        message,
        timestamp: Date.now(),
      },
    });
  }
  
  addToBuffer(event) {
    this.messageBuffer.push(event);
    
    // Keep buffer size under limit
    if (this.messageBuffer.length > this.maxBufferSize) {
      this.messageBuffer = this.messageBuffer.slice(-this.maxBufferSize);
    }
  }
  
  sendBufferedMessages(ws) {
    // Send last 10 buffered messages to new clients
    const recentMessages = this.messageBuffer.slice(-10);
    
    recentMessages.forEach(event => {
      this.sendMessage(ws, {
        type: 'truth_event',
        payload: {
          ...event,
          is_historical: true,
        },
      });
    });
  }
  
  startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      const now = Date.now();
      
      // Check for stale connections
      this.clients.forEach((client, clientId) => {
        const timeSinceLastHeartbeat = now - client.lastHeartbeat;
        
        if (timeSinceLastHeartbeat > this.heartbeatInterval * 2) {
          // Client is stale, close connection
          console.log(`Closing stale connection: ${clientId}`);
          client.ws.terminate();
          this.handleDisconnection(clientId);
        } else {
          // Send ping
          if (client.ws.readyState === WebSocket.OPEN) {
            client.ws.ping();
          }
        }
      });
    }, this.heartbeatInterval);
  }
  
  calculateServerMetrics() {
    const now = Date.now();
    const clients = Array.from(this.clients.values());
    
    return {
      server_uptime: now - (this.startTime || now),
      connected_clients: clients.length,
      active_subscriptions: this.subscriptions.size,
      message_buffer_size: this.messageBuffer.length,
      client_stats: {
        newest_connection: Math.min(...clients.map(c => now - c.connectedAt)),
        oldest_connection: Math.max(...clients.map(c => now - c.connectedAt)),
        average_connection_age: clients.length > 0 
          ? clients.reduce((sum, c) => sum + (now - c.connectedAt), 0) / clients.length 
          : 0,
      },
      subscription_stats: {
        subscriptions_per_client: this.subscriptions.size / Math.max(clients.length, 1),
        most_popular_event_types: this.getMostPopularEventTypes(),
      },
      performance: {
        memory_usage: process.memoryUsage(),
        cpu_usage: process.cpuUsage(),
      },
    };
  }
  
  getMostPopularEventTypes() {
    const eventTypeCounts = {};
    
    this.subscriptions.forEach(sub => {
      sub.filter.event_types.forEach(type => {
        eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
      });
    });
    
    return Object.entries(eventTypeCounts)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));
  }
  
  getAvailableEventTypes() {
    return [
      'truth_change',
      'verification_update',
      'verification_complete',
      'system_alert',
      'confidence_update',
      'error',
      'batch_update',
    ];
  }
  
  setupEventHandlers() {
    this.startTime = Date.now();
    
    // Handle process signals
    process.on('SIGINT', () => {
      console.log('Received SIGINT, shutting down truth monitoring server...');
      this.stop();
      process.exit(0);
    });
    
    process.on('SIGTERM', () => {
      console.log('Received SIGTERM, shutting down truth monitoring server...');
      this.stop();
      process.exit(0);
    });
  }
  
  // Utility methods for external integration
  getClientCount() {
    return this.clients.size;
  }
  
  getSubscriptionCount() {
    return this.subscriptions.size;
  }
  
  getConnectedClients() {
    return Array.from(this.clients.values()).map(client => ({
      id: client.id,
      ip: client.ip,
      connectedAt: client.connectedAt,
      subscriptions: client.subscriptions.size,
    }));
  }
}

module.exports = TruthMonitoringServer;
