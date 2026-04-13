import { redirect } from 'next/navigation'
import { format } from 'date-fns'

export default function ReportRedirect() {
  redirect(`/report/${format(new Date(), 'yyyy-MM-dd')}`)
}
