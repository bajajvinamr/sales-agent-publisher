export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { initApp } = await import('@/lib/init')
    initApp()
  }
}
