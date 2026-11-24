// Vercel serverless function: POST /api/parse-rule  { text, context: { brands, platforms } }
import { handleParseRuleRequest } from '../server/parseRule.js'

export default handleParseRuleRequest
