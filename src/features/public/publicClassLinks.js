export const publicClassLinks = {
  instagramUrl: 'https://www.instagram.com/daegumiami/',
  youtubeUrl: 'https://www.youtube.com/@MiamiDaeguMiami',
  reviewUrl: 'https://blog.naver.com/sak7566/224013120801',
  sampleVideoUrl: 'https://www.youtube.com/shorts/DsFx-6GJA3w',
  contactUrl: '',
}

export function hasPublicClassLink(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'https:'
  } catch {
    return false
  }
}
