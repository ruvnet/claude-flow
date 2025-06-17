/**
 * Utility functions for formatting data display
 */

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatPercentage(value: number, decimals: number = 1): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

export function formatNumber(num: number): string {
  return num.toLocaleString();
}

export function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function formatUptime(startTime: Date): string {
  const uptime = Date.now() - startTime.getTime();
  return formatDuration(uptime);
}

export function formatRate(rate: number): string {
  if (rate < 1) return `${(rate * 1000).toFixed(1)}/s`;
  if (rate < 60) return `${rate.toFixed(1)}/s`;
  return `${(rate / 60).toFixed(1)}/min`;
}

export function truncate(str: string, length: number): string {
  if (str.length <= length) return str;
  return str.substring(0, length - 3) + '...';
}

export function formatStatus(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

export function formatHealth(health: number): string {
  const percentage = Math.round(health * 100);
  let emoji = '🟢';
  
  if (health < 0.3) emoji = '🔴';
  else if (health < 0.7) emoji = '🟡';
  
  return `${emoji} ${percentage}%`;
}

export function formatMetric(value: number, unit: string): string {
  if (value < 1000) return `${value.toFixed(1)} ${unit}`;
  if (value < 1000000) return `${(value / 1000).toFixed(1)}K ${unit}`;
  return `${(value / 1000000).toFixed(1)}M ${unit}`;
}