import { Redis } from 'ioredis';

export function createRedis(url: string): Redis {
  return new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
}
