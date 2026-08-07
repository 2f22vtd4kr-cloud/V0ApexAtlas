/**
 * Process-wide research gate.
 *
 * A single API process can receive requests from several UI actions or
 * background jobs. Full web research is intentionally serialized here so one
 * target completes before another target starts, instead of multiplying
 * provider calls across overlapping jobs.
 */

let tail: Promise<void> = Promise.resolve();

export function runResearchExclusively<T>(
  targetLabel: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = tail;
  let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });

  return previous
    .then(task)
    .finally(() => {
      release();
    });
}