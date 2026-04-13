'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, FileText, Building2, MessageSquare, Settings } from 'lucide-react'

const items = [
  { href: '/', label: 'Home', Icon: Home },
  { href: '/report', label: 'Report', Icon: FileText },
  { href: '/schools', label: 'Schools', Icon: Building2 },
  { href: '/connect', label: 'Connect', Icon: MessageSquare },
  { href: '/settings', label: 'Settings', Icon: Settings },
]

export default function Nav() {
  const path = usePathname()
  return (
    <nav className="fixed bottom-0 inset-x-0 z-30 bg-zinc-950/90 backdrop-blur-lg border-t border-zinc-800 safe-b">
      <div className="max-w-md mx-auto grid grid-cols-5">
        {items.map(({ href, label, Icon }) => {
          const on = href === '/' ? path === '/' : path.startsWith(href)
          return (
            <Link key={href} href={href} className={`flex flex-col items-center py-2 gap-0.5 ${on ? 'text-amber-400' : 'text-zinc-500'}`}>
              <Icon size={20} strokeWidth={on ? 2.2 : 1.6} />
              <span className="text-[9px] font-semibold">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
