export interface SaveScheduler {
  schedule: (delay: number) => void
  flush: (keepalive?: boolean) => Promise<void>
  dispose: () => Promise<void>
}

export function createSaveScheduler(
  save: (keepalive: boolean) => void | Promise<void>,
): SaveScheduler {
  let timer: ReturnType<typeof setTimeout> | null = null

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function flush(keepalive = false) {
    clearTimer()
    await save(keepalive)
  }

  return {
    schedule(delay) {
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        void save(false)
      }, delay)
    },
    flush,
    dispose() {
      return flush(true)
    },
  }
}
