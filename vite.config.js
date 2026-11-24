import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * In production /api/parse-rule is a Vercel serverless function (api/parse-rule.js).
 * In `npm run dev` this plugin mounts the same handler on the Vite dev server,
 * so local and deployed behaviour match and the API key stays server-side.
 */
function devApi() {
  return {
    name: 'dev-api',
    configureServer(server) {
      server.middlewares.use('/api/parse-rule', async (req, res) => {
        const { handleParseRuleRequest } = await server.ssrLoadModule('/server/parseRule.js')
        await handleParseRuleRequest(req, res)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load .env (all keys, not just VITE_*) into process.env for the dev API only.
  // Nothing here is exposed to the browser bundle.
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['GEMINI_API_KEY', 'GEMINI_MODEL']) {
    if (env[key] && !process.env[key]) process.env[key] = env[key]
  }
  return { plugins: [react(), devApi()] }
})
