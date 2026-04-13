import type { Metadata } from 'next'
import './globals.css'
import Nav from '@/components/ui/nav'

export const metadata: Metadata = { title: 'Sales Tracker', description: 'Field Team Intelligence' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen pb-24">
        <header className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur-lg border-b border-zinc-800">
          <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-lg shadow-amber-500/25">
                <span className="text-zinc-950 text-sm font-black">ST</span>
              </div>
              <div>
                <p className="text-sm font-bold text-zinc-100 tracking-tight leading-none">Sales Tracker</p>
                <p className="text-[10px] text-zinc-500 font-medium mt-0.5">Field Intelligence</p>
              </div>
            </div>
            <div className="flex items-center gap-2 bg-zinc-800/50 rounded-full px-2.5 py-1">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-[10px] text-zinc-400 font-medium">Live</span>
            </div>
          </div>
        </header>
        <main className="max-w-md mx-auto px-4">{children}</main>
        <Nav />
      </body>
    </html>
  )
}
