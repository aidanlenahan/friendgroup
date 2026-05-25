import type { Redis } from "ioredis";

export function makeCache(redis: Redis) {
  async function get<T>(key: string): Promise<T | null> {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async function set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    await redis.setex(key, ttlSeconds, JSON.stringify(value));
  }

  async function del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await redis.del(...keys);
  }

  // Set a value and track its key in a named set for O(1) group invalidation.
  async function setTracked(key: string, setKey: string, value: unknown, ttlSeconds: number): Promise<void> {
    await redis
      .pipeline()
      .setex(key, ttlSeconds, JSON.stringify(value))
      .sadd(setKey, key)
      // Set lives slightly longer than its members so invalidation always sees the full list.
      .expire(setKey, ttlSeconds + 10)
      .exec();
  }

  // Delete all keys tracked in a set, then delete the set itself.
  async function delSet(setKey: string): Promise<void> {
    const keys = await redis.smembers(setKey);
    if (keys.length > 0) await redis.del(...keys);
    await redis.del(setKey);
  }

  // Non-blocking SCAN-based pattern delete. Kept as fallback; prefer delSet for hot paths.
  async function delPattern(pattern: string): Promise<void> {
    let cursor = "0";
    const found: string[] = [];
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      found.push(...batch);
    } while (cursor !== "0");
    if (found.length > 0) await redis.del(...found);
  }

  return { get, set, setTracked, del, delSet, delPattern };
}

export type AppCache = ReturnType<typeof makeCache>;
