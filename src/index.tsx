import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { renderer } from './renderer'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'

type Bindings = {
  KV: KVNamespace
  ROOT_REDIRECT_URL?: string
}

const RESERVED_KEYS = new Set([
  'admin',
  'create',
  'static',
  'api',
  'auth',
  'favicon.ico',
  'robots.txt'
])

const isValidKey = (key: string): boolean => {
  return /^[a-zA-Z0-9_-]+$/.test(key) && !RESERVED_KEYS.has(key.toLowerCase())
}

const app = new Hono<{
  Bindings: Bindings
}>()

app.all('*', renderer)

app.get('/:key{[a-zA-Z0-9_-]+}', async (c) => {
  const key = c.req.param('key')

  if (RESERVED_KEYS.has(key.toLowerCase())) {
    return c.redirect('/')
  }

  const url = await c.env.KV.get(key)

  if (url === null) {
    return c.redirect('/')
  }

  return c.redirect(url)
})

app.get('/', (c) => {
  const redirectUrl = c.env.ROOT_REDIRECT_URL
  if (redirectUrl) {
    return c.redirect(redirectUrl)
  }
  return c.redirect('/admin')
})

app.get('/admin', (c) => {
  return c.render(
    <div>
      <h2>Admin - Create shorten URL</h2>
      <form action="/create" method="post">
        <p>
          <label>URL</label>
          <br />
          <input
            type="text"
            name="url"
            autocomplete="off"
            placeholder="https://example.com"
            style={{
              width: '80%'
            }}
          />
        </p>
        <p>
          <label>Custom path (optional)</label>
          <br />
          <input
            type="text"
            name="key"
            autocomplete="off"
            placeholder="my-link"
            style={{
              width: '80%'
            }}
          />
        </p>
        <button type="submit">Create</button>
      </form>
    </div>
  )
})

const schema = z.object({
  url: z.string().url(),
  key: z.string().regex(/^[a-zA-Z0-9_-]*$/).optional()
})

const validator = zValidator('form', schema, (result, c) => {
  if (!result.success) {
    return c.render(
      <div>
        <h2>Error!</h2>
        <p>Invalid URL or custom path.</p>
        <a href="/admin">Back to admin</a>
      </div>
    )
  }
})

type CreateKeyResult = {
  key: string
  error?: string
}

const createKey = async (
  kv: KVNamespace,
  url: string,
  customKey?: string
): Promise<CreateKeyResult> => {
  if (customKey) {
    if (!isValidKey(customKey)) {
      return {
        key: customKey,
        error: 'This path is reserved or contains invalid characters.'
      }
    }
    const existing = await kv.get(customKey)
    if (existing !== null) {
      return { key: customKey, error: 'This path is already in use.' }
    }
    await kv.put(customKey, url)
    return { key: customKey }
  }

  const uuid = crypto.randomUUID()
  const key = uuid.substring(0, 6)
  const result = await kv.get(key)
  if (!result) {
    await kv.put(key, url)
  } else {
    return await createKey(kv, url)
  }
  return { key }
}

app.post('/create', csrf(), validator, async (c) => {
  const { url, key: customKey } = c.req.valid('form')
  const result = await createKey(c.env.KV, url, customKey)

  if (result.error) {
    return c.render(
      <div>
        <h2>Error!</h2>
        <p>{result.error}</p>
        <a href="/admin">Back to admin</a>
      </div>
    )
  }

  const shortenUrl = new URL(`/${result.key}`, c.req.url)

  return c.render(
    <div>
      <h2>Created!</h2>
      <input
        type="text"
        value={shortenUrl.toString()}
        style={{
          width: '80%'
        }}
        autofocus
      />
      <p>
        <a href="/admin">Create another</a>
      </p>
    </div>
  )
})

export default app
