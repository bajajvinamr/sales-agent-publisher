import type { ReactNode } from 'react'

interface StatCardProps {
  label: string
  value: string | number
  color?: string
  icon?: ReactNode
}

export default function StatCard({ label, value, color = 'text-blue-600', icon }: StatCardProps) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 uppercase tracking-wide leading-tight">{label}</span>
        {icon && <span className="text-gray-400">{icon}</span>}
      </div>
      <span className={`text-3xl font-bold ${color} leading-none mt-1`}>{value}</span>
    </div>
  )
}
