export async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const concurrency = Math.max(1, Math.min(limit, items.length));
  let index = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (index < items.length) {
      const current = items[index];
      index += 1;
      await task(current);
    }
  });

  await Promise.all(workers);
}
