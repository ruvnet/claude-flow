/**
 * API Key Redaction Utility
 * Prevents sensitive data from leaking into logs, memory, or git commits
 */

export class KeyRedactor {
  static API_KEY_PATTERNS = [
    // Anthropic API keys
    /sk-ant-[a-zA-Z0-9_-]{95,}/gi,

    // OpenRouter API keys
    /sk-or-[a-zA-Z0-9_-]{32,}/gi,

    // Google/Gemini API keys
    /AIza[a-zA-Z0-9_-]{35}/gi,

    // Generic API keys
    /[a-zA-Z0-9_-]{20,}API[a-zA-Z0-9_-]{20,}/gi,

    // Bearer tokens
    /Bearer\s+[a-zA-Z0-9_\-\.]{20,}/gi,

    // Environment variable format
    /([A-Z_]+_API_KEY|[A-Z_]+_TOKEN|[A-Z_]+_SECRET)=["']?([^"'\s]+)["']?/gi,

    // Supabase keys
    /eyJ[a-zA-Z0-9_-]*\.eyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]*/gi,
  ];

  static SENSITIVE_FIELDS = [
    'apiKey',
    'api_key',
    'token',
    'secret',
    'password',
    'private_key',
    'privateKey',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
  ];

  /**
   * Redact API keys and sensitive data from text
   */
  static redact(text, showPrefix = true) {
    if (!text) return text;

    let redacted = text;

    // Redact using patterns
    this.API_KEY_PATTERNS.forEach(pattern => {
      redacted = redacted.replace(pattern, (match) => {
        if (showPrefix && match.length > 8) {
          const prefix = match.substring(0, 8);
          return `${prefix}...[REDACTED]`;
        }
        return '[REDACTED_API_KEY]';
      });
    });

    return redacted;
  }

  /**
   * Redact sensitive fields in objects
   */
  static redactObject(obj, deep = true) {
    if (!obj || typeof obj !== 'object') return obj;

    const redacted = { ...obj };

    Object.keys(redacted).forEach(key => {
      const lowerKey = key.toLowerCase();

      // Check if field name is sensitive
      const isSensitive = this.SENSITIVE_FIELDS.some(field =>
        lowerKey.includes(field)
      );

      if (isSensitive && typeof redacted[key] === 'string') {
        const value = redacted[key];
        if (value && value.length > 8) {
          redacted[key] = `${value.substring(0, 4)}...[REDACTED]`;
        } else {
          redacted[key] = '[REDACTED]';
        }
      } else if (deep && typeof redacted[key] === 'object' && redacted[key] !== null) {
        redacted[key] = this.redactObject(redacted[key], deep);
      } else if (typeof redacted[key] === 'string') {
        // Redact any API keys in string values
        redacted[key] = this.redact(redacted[key]);
      }
    });

    return redacted;
  }

  /**
   * Sanitize text for safe logging
   */
  static sanitize(text) {
    return this.redact(text, true);
  }

  /**
   * Sanitize command arguments
   */
  static sanitizeArgs(args) {
    return args.map(arg => {
      // Check if arg is a flag value pair
      if (arg.includes('key') || arg.includes('token') || arg.includes('secret')) {
        return this.redact(arg);
      }
      return arg;
    });
  }

  /**
   * Check if text contains unredacted sensitive data
   */
  static containsSensitiveData(text) {
    return this.API_KEY_PATTERNS.some(pattern => pattern.test(text));
  }

  /**
   * Validate that text is safe for logging/storage
   */
  static validate(text) {
    const warnings = [];

    this.API_KEY_PATTERNS.forEach((pattern, index) => {
      if (pattern.test(text)) {
        warnings.push(`Potential API key detected (pattern ${index + 1})`);
      }
    });

    return {
      safe: warnings.length === 0,
      warnings,
    };
  }

  /**
   * Redact environment variables
   */
  static redactEnv(env) {
    const redacted = {};

    Object.keys(env).forEach(key => {
      const value = env[key];
      if (!value) {
        redacted[key] = '';
        return;
      }

      const lowerKey = key.toLowerCase();
      const isSensitive = lowerKey.includes('key') ||
                         lowerKey.includes('token') ||
                         lowerKey.includes('secret') ||
                         lowerKey.includes('password');

      if (isSensitive) {
        redacted[key] = value.length > 8
          ? `${value.substring(0, 4)}...[REDACTED]`
          : '[REDACTED]';
      } else {
        redacted[key] = value;
      }
    });

    return redacted;
  }
}

// Export singleton instance
export const redactor = KeyRedactor;
