import { SUPPORTED_LANGUAGES } from '../i18n/core.js'

export function readAccountLanguage(globalUserProfile) {
  const value = globalUserProfile?.preferredLanguage
  return SUPPORTED_LANGUAGES.includes(value) ? value : null
}

export function buildPreferredLanguagePatch(language, updatedAt) {
  if (!SUPPORTED_LANGUAGES.includes(language)) {
    throw new TypeError(`Unsupported preferred language: ${String(language)}`)
  }
  return {
    preferredLanguage: language,
    updatedAt,
  }
}

export async function persistAccountLanguage({
  uid,
  language,
  firestore,
  docFactory,
  update,
  timestamp,
}) {
  const normalizedUid = String(uid || '').trim()
  if (!normalizedUid) throw new TypeError('A signed-in uid is required')
  if (
    !firestore ||
    typeof docFactory !== 'function' ||
    typeof update !== 'function' ||
    typeof timestamp !== 'function'
  ) {
    throw new TypeError('Firestore adapter dependencies are required')
  }
  const patch = buildPreferredLanguagePatch(language, timestamp())
  await update(docFactory(firestore, 'users', normalizedUid), patch)
  return patch
}
