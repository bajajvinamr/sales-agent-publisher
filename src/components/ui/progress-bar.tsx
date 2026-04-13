interface ProgressBarProps {
  current: number
  target: number
  label: string
}

export default function ProgressBar({ current, target, label }: ProgressBarProps) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0

  const barColor =
    pct >= 100
      ? 'bg-green-500'
      : pct >= 75
      ? 'bg-yellow-400'
      : 'bg-red-400'

  const textColor =
    pct >= 100
      ? 'text-green-700'
      : pct >= 75
      ? 'text-yellow-700'
      : 'text-red-600'

  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium text-gray-700 w-24 truncate shrink-0">{label}</span>
      <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
        <div
          className={`${barColor} h-3 rounded-full transition-all duration-300`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`text-sm font-semibold ${textColor} w-16 text-right shrink-0`}>
        {current}/{target}
      </span>
    </div>
  )
}
