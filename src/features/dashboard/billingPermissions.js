const ADMIN_BILLING_ROLES = new Set(['admin', 'owner', 'staff-admin', 'staff_admin'])

export const BILLING_FIELD_KEYS = [
  'amount',
  'amountPaid',
  'billing',
  'billingMemo',
  'discount',
  'fee',
  'memo',
  'paidAt',
  'payment',
  'paymentMemo',
  'paymentMethod',
  'paymentStatus',
  'price',
  'refund',
  'refundAmount',
  'refundMemo',
  'tuition',
]

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase()
}

export function canViewBillingFields(userProfile, membership) {
  const role = normalizeRole(userProfile?.role)
  const membershipRole = normalizeRole(
    membership?.role || userProfile?.membershipRole || userProfile?.role
  )
  return ADMIN_BILLING_ROLES.has(role) || ADMIN_BILLING_ROLES.has(membershipRole)
}

export function stripBillingFieldsForRestrictedViewer(row) {
  if (!row || typeof row !== 'object') return row
  const next = { ...row }
  BILLING_FIELD_KEYS.forEach((key) => {
    if (key in next) delete next[key]
  })
  return next
}
