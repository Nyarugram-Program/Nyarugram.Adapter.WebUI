import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig, loadEnv, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import tsconfigPaths from 'vite-tsconfig-paths'

const monacoEditorPath = normalizePath(
  path.resolve(__dirname, 'node_modules/monaco-editor/min/vs')
)

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const configuredBase = env.VITE_BASE_PATH || '/'
  const baseWithSlash = configuredBase.startsWith('/')
    ? configuredBase
    : `/${configuredBase}`
  const base = baseWithSlash.endsWith('/')
    ? baseWithSlash
    : `${baseWithSlash}/`

  return {
    base,
    plugins: [
      react(),
      tsconfigPaths(),
      viteStaticCopy({
        targets: [
          {
            src: monacoEditorPath,
            dest: 'monaco-editor/min'
          }
        ]
      })
    ],
    build: {
      assetsInlineLimit: 0,
      rollupOptions: {
        output: {
          manualChunks: {
            'monaco-editor': ['monaco-editor'],
            'react-dom': ['react-dom'],
            'react-router-dom': ['react-router-dom'],
            'react-hook-form': ['react-hook-form'],
            'react-icons': ['react-icons'],
            'react-hot-toast': ['react-hot-toast'],
            qface: ['qface']
          }
        }
      }
    }
  }
})
