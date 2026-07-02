import { sleep } from '../sp-client'

// T5: Cap concurrent SP polls at 5 across all libraries
const MAX_CONCURRENT_POLLS = 5

interface Task {
  fn: () => Promise<unknown>
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

let running = 0
const queue: Task[] = []

export async function schedulePoll<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    queue.push({ fn, resolve: resolve as (v: unknown) => void, reject })
    drain()
  })
}

function drain(): void {
  while (running < MAX_CONCURRENT_POLLS && queue.length > 0) {
    const task = queue.shift()!
    running++
    task.fn()
      .then(task.resolve, task.reject)
      .finally(() => { running--; drain() })
  }
}

// Per-library random jitter to prevent thundering-herd against SP server
export function jitter(maxMs = 5000): Promise<void> {
  return sleep(Math.floor(Math.random() * maxMs))
}
