import { createHash } from 'node:crypto';
export const sha256Hex = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex');
