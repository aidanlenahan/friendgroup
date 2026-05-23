import { Navigate } from 'react-router-dom'

// /contact redirects to /help with the contact modal open
export default function ContactPage() {
  return <Navigate to="/help?contact=1" replace />
}
