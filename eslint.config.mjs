// ESLint v9 flat config. Uses Next.js preset via FlatCompat shim (next/core-web-vitals + next/typescript).
// Kept minimal — the CI step is still `continue-on-error: true`, so this is a signal/nudge layer, not a gate.
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

export default [
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'tests/**',
      'src/generated/**',
      'prisma/generated/**',
    ],
  },
]
