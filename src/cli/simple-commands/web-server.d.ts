/**
 * Type declarations for web-server.js
 */

export interface WebServerOptions {
  port?: number;
  host?: string;
  enableSsl?: boolean;
  certPath?: string;
  keyPath?: string;
}

export interface ServerInstance {
  port: number;
  host: string;
  isRunning: boolean;
  stop(): Promise<void>;
}

export declare function startWebServer(options?: WebServerOptions): Promise<ServerInstance>;
export declare function stopWebServer(): Promise<void>;
export declare function getServerStatus(): { running: boolean; port?: number; host?: string };