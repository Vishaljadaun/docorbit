# DocOrbit Cloud RAG gateway (v0.4)

This separate Cloudflare Worker allows DocOrbit AI Studio to use OpenRouter's **free-only** model router. GitHub Pages still hosts the main frontend.

The browser extracts and retrieves PDF passages locally. Only the selected passages you **explicitly consent to send** are sent through this Worker to OpenRouter and the selected model provider. Do not use sensitive documents without reviewing their data policies. The Worker does not intentionally store PDF text.

## Setup (requires Cloudflare account and OpenRouter key)

1. Create an API key at https://openrouter.ai/settings/keys and restrict spending in OpenRouter settings. **Never paste the key into React, GitHub, or a chat.**
2. Clone the repository. Use Node 22+.
3. In a terminal run:
   ```sh
   cd worker
   npm install
   npx wrangler login
   npx wrangler deploy
   npx wrangler secret put OPENROUTER_API_KEY
   ```
4. Copy the exact `https://docorbit-ai-gateway.<your-subdomain>.workers.dev` URL shown by Wrangler.
5. In DocOrbit AI Studio select **Cloud RAG**, paste this Worker URL and enable permission to send selected PDF excerpts, then choose an action.

The Worker is secured with a fixed `openrouter/free` model ID, a server-side key, a restricted web origin, request-size limits, and mandatory rate limiting. Origin checks alone are **not authentication**, and Workers' built-in rate limits are **approximate and per Cloudflare location**, not strict global daily limits. They do not guarantee protection from abuse or provider quotas. Add durable per-account budgets and authentication before wider public use.

Check that the gateway is configured: the site's cloud mode can call the Worker's `/health` endpoint. The Worker refuses cloud inference if either rate limiter binding or key is missing. There is no Cloudflare connection configured in this chat, so the Worker has **not been deployed** automatically.

## Tests

```sh
cd worker
npm test
```
