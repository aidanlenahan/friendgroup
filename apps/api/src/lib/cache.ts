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

  // Non-blocking SCAN-based pattern delete. Use sparingly — O(N) over keyspace.
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

  return { get, set, del, delPattern };
}

export type AppCache = ReturnType<typeof makeCache>;
