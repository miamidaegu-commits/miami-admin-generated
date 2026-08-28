import fs from 'node:fs'
import path from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const PUBLIC_APP_URL_PLACEHOLDER = '__VITE_PUBLIC_APP_URL__'
const METADATA_TARGETS = [
  { relativePath: 'robots.txt', expectedPlaceholderCount: 1 },
  { relativePath: 'sitemap.xml', expectedPlaceholderCount: 3 },
]

function getCanonicalPublicAppUrl(value) {
  const publicAppUrl = String(value || '').trim().replace(/\/+$/, '')
  if (!publicAppUrl) {
    throw new Error('VITE_PUBLIC_APP_URL is required for build metadata.')
  }

  let parsedUrl
  try {
    parsedUrl = new URL(publicAppUrl)
  } catch {
    throw new Error('VITE_PUBLIC_APP_URL must be an absolute HTTP(S) URL.')
  }

  if (
    !['http:', 'https:'].includes(parsedUrl.protocol)
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
  ) {
    throw new Error(
      'VITE_PUBLIC_APP_URL must be an absolute HTTP(S) URL without credentials, query, or hash.'
    )
  }

  return publicAppUrl
}

function publicMetadataTransformPlugin(publicAppUrl) {
  return {
    name: 'public-app-url-metadata-transform',
    apply: 'build',
    closeBundle() {
      const distDir = path.resolve(process.cwd(), 'dist')

      for (const { relativePath, expectedPlaceholderCount } of METADATA_TARGETS) {
        const targetPath = path.resolve(distDir, relativePath)
        if (!targetPath.startsWith(`${distDir}${path.sep}`)) {
          throw new Error(`Metadata target escapes dist: ${relativePath}`)
        }

        const targetStat = fs.lstatSync(targetPath)
        if (!targetStat.isFile() || targetStat.isSymbolicLink()) {
          throw new Error(`Metadata target must be a regular non-symlink file: ${relativePath}`)
        }

        const source = fs.readFileSync(targetPath, 'utf8')
        const placeholderCount = source.split(PUBLIC_APP_URL_PLACEHOLDER).length - 1
        if (placeholderCount !== expectedPlaceholderCount) {
          throw new Error(
            `Unexpected metadata placeholder count for ${relativePath}: `
            + `${placeholderCount} (expected ${expectedPlaceholderCount})`
          )
        }

        const transformed = source.replaceAll(PUBLIC_APP_URL_PLACEHOLDER, publicAppUrl)
        if (transformed.includes(PUBLIC_APP_URL_PLACEHOLDER)) {
          throw new Error(`Metadata placeholder remains after transform: ${relativePath}`)
        }
        fs.writeFileSync(targetPath, transformed)
      }
    },
  }
}

export default defineConfig(({ command, mode }) => {
  const plugins = [react()]
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), '')
    plugins.push(publicMetadataTransformPlugin(
      getCanonicalPublicAppUrl(env.VITE_PUBLIC_APP_URL)
    ))
  }

  return { plugins }
})
