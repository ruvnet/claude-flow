/**
 * Secure Protocol Implementation
 * Handles encryption and authentication for IPC communication
 */

import * as crypto from 'crypto';
import { 
  IPCMessage, 
  IPCSecurityOptions,
  IPCError,
  IPCErrorCode
} from '../types.js';

/**
 * Secure protocol handler for IPC messages
 */
export class SecureProtocol {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyDerivationIterations = 100000;
  private encryptionKey?: Buffer;
  private authTokenHash?: string;
  
  constructor(private readonly options: IPCSecurityOptions) {
    this.initialize();
  }
  
  /**
   * Initialize security components
   */
  private initialize(): void {
    // Setup authentication token hash
    if (this.options.enableAuthentication && this.options.authToken) {
      this.authTokenHash = crypto
        .createHash('sha256')
        .update(this.options.authToken)
        .digest('hex');
    }
    
    // Setup encryption key
    if (this.options.enableEncryption && this.options.authToken) {
      // Derive encryption key from auth token
      this.encryptionKey = crypto.pbkdf2Sync(
        this.options.authToken,
        'claude-flow-ipc-salt',
        this.keyDerivationIterations,
        32,
        'sha256'
      );
    }
  }
  
  /**
   * Wrap a message with security features
   */
  async wrapMessage(message: IPCMessage): Promise<IPCMessage> {
    let wrappedMessage = { ...message };
    
    // Add authentication
    if (this.options.enableAuthentication) {
      wrappedMessage = this.addAuthentication(wrappedMessage);
    }
    
    // Add encryption
    if (this.options.enableEncryption) {
      wrappedMessage = await this.encryptMessage(wrappedMessage);
    }
    
    return wrappedMessage;
  }
  
  /**
   * Unwrap a message and verify security
   */
  async unwrapMessage(message: IPCMessage): Promise<IPCMessage> {
    let unwrappedMessage = { ...message };
    
    // Decrypt if needed
    if (this.options.enableEncryption) {
      unwrappedMessage = await this.decryptMessage(unwrappedMessage);
    }
    
    // Verify authentication
    if (this.options.enableAuthentication) {
      this.verifyAuthentication(unwrappedMessage);
    }
    
    return unwrappedMessage;
  }
  
  /**
   * Add authentication to message
   */
  private addAuthentication(message: IPCMessage): IPCMessage {
    if (!this.authTokenHash) {
      throw new IPCError(
        IPCErrorCode.AUTHENTICATION_FAILED,
        'Authentication token not configured'
      );
    }
    
    // Create message signature
    const messageData = JSON.stringify({
      id: message.id,
      type: message.type,
      command: message.command,
      timestamp: message.timestamp
    });
    
    const signature = crypto
      .createHmac('sha256', this.authTokenHash)
      .update(messageData)
      .digest('hex');
    
    return {
      ...message,
      headers: {
        ...message.headers,
        'auth-signature': signature,
        'auth-timestamp': Date.now().toString()
      }
    };
  }
  
  /**
   * Verify message authentication
   */
  private verifyAuthentication(message: IPCMessage): void {
    if (!this.authTokenHash) {
      throw new IPCError(
        IPCErrorCode.AUTHENTICATION_FAILED,
        'Authentication token not configured'
      );
    }
    
    const signature = message.headers?.['auth-signature'];
    const authTimestamp = message.headers?.['auth-timestamp'];
    
    if (!signature || !authTimestamp) {
      throw new IPCError(
        IPCErrorCode.AUTHENTICATION_FAILED,
        'Missing authentication headers'
      );
    }
    
    // Check timestamp to prevent replay attacks (5 minute window)
    const timestamp = parseInt(authTimestamp, 10);
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      throw new IPCError(
        IPCErrorCode.AUTHENTICATION_FAILED,
        'Authentication timestamp expired'
      );
    }
    
    // Verify signature
    const messageData = JSON.stringify({
      id: message.id,
      type: message.type,
      command: message.command,
      timestamp: message.timestamp
    });
    
    const expectedSignature = crypto
      .createHmac('sha256', this.authTokenHash)
      .update(messageData)
      .digest('hex');
    
    if (!crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )) {
      throw new IPCError(
        IPCErrorCode.AUTHENTICATION_FAILED,
        'Invalid message signature'
      );
    }
  }
  
  /**
   * Encrypt message payload
   */
  private async encryptMessage(message: IPCMessage): Promise<IPCMessage> {
    if (!this.encryptionKey) {
      throw new IPCError(
        IPCErrorCode.PROTOCOL_ERROR,
        'Encryption key not configured'
      );
    }
    
    // Only encrypt the payload
    if (!message.payload) {
      return message;
    }
    
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);
    
    const payloadJson = JSON.stringify(message.payload);
    const encrypted = Buffer.concat([
      cipher.update(payloadJson, 'utf8'),
      cipher.final()
    ]);
    
    const authTag = cipher.getAuthTag();
    
    return {
      ...message,
      payload: {
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        authTag: authTag.toString('base64')
      },
      headers: {
        ...message.headers,
        'content-encrypted': 'true'
      }
    };
  }
  
  /**
   * Decrypt message payload
   */
  private async decryptMessage(message: IPCMessage): Promise<IPCMessage> {
    if (!this.encryptionKey) {
      throw new IPCError(
        IPCErrorCode.PROTOCOL_ERROR,
        'Encryption key not configured'
      );
    }
    
    // Check if message is encrypted
    if (message.headers?.['content-encrypted'] !== 'true') {
      return message;
    }
    
    const { encrypted, iv, authTag } = message.payload || {};
    
    if (!encrypted || !iv || !authTag) {
      throw new IPCError(
        IPCErrorCode.PROTOCOL_ERROR,
        'Invalid encrypted message format'
      );
    }
    
    try {
      const decipher = crypto.createDecipheriv(
        this.algorithm,
        this.encryptionKey,
        Buffer.from(iv, 'base64')
      );
      
      decipher.setAuthTag(Buffer.from(authTag, 'base64'));
      
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encrypted, 'base64')),
        decipher.final()
      ]);
      
      const payload = JSON.parse(decrypted.toString('utf8'));
      
      // Remove encryption headers
      const headers = { ...message.headers };
      delete headers['content-encrypted'];
      
      return {
        ...message,
        payload,
        headers
      };
    } catch (error) {
      throw new IPCError(
        IPCErrorCode.PROTOCOL_ERROR,
        'Failed to decrypt message',
        error
      );
    }
  }
  
  /**
   * Generate a secure token
   */
  static generateAuthToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }
  
  /**
   * Hash a token for storage
   */
  static hashToken(token: string): string {
    return crypto
      .createHash('sha256')
      .update(token)
      .digest('hex');
  }
}