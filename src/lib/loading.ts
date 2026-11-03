// Requests the user is waiting on: while any is running, the SKY logo spins.
let running = 0;
const listeners = new Set<(busy: boolean) => void>();
export function subscribeLoading(fn: (busy: boolean) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
/** Runs `work` with the loader showing. */
export async function withLoader<T>(work: Promise<T>): Promise<T> {
  if (running++ === 0) listeners.forEach((fn) => fn(true));
  try {
    return await work;
  } finally {
    if (--running === 0) listeners.forEach((fn) => fn(false));
  }
}
