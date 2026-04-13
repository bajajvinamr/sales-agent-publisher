import { AlertTriangle, Info, AlertCircle } from 'lucide-react'

interface AlertCardProps {
  type: string
  message: string
  severity: 'high' | 'medium' | 'low'
}

const severityStyles = {
  high: {
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-800',
    sub: 'text-red-600',
    icon: <AlertCircle size={16} className="text-red-500 shrink-0 mt-0.5" />,
  },
  medium: {
    bg: 'bg-yellow-50 border-yellow-200',
    text: 'text-yellow-800',
    sub: 'text-yellow-600',
    icon: <AlertTriangle size={16} className="text-yellow-500 shrink-0 mt-0.5" />,
  },
  low: {
    bg: 'bg-blue-50 border-blue-200',
    text: 'text-blue-800',
    sub: 'text-blue-600',
    icon: <Info size={16} className="text-blue-500 shrink-0 mt-0.5" />,
  },
}

export default function AlertCard({ type, message, severity }: AlertCardProps) {
  const styles = severityStyles[severity]
  return (
    <div className={`${styles.bg} border rounded-lg px-3 py-2.5 flex items-start gap-2`}>
      {styles.icon}
      <div className="min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide ${styles.sub}`}>{type}</p>
        <p className={`text-sm ${styles.text} leading-snug mt-0.5`}>{message}</p>
      </div>
    </div>
  )
}
