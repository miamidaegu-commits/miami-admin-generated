import { doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase.js'
import { persistAccountLanguage } from './accountLanguage.js'

export function persistAccountLanguageToFirestore({ uid, language }) {
  return persistAccountLanguage({
    uid,
    language,
    firestore: db,
    docFactory: doc,
    update: updateDoc,
    timestamp: serverTimestamp,
  })
}
