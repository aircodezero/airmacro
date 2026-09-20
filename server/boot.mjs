/*
 * Démarrage commun des apps du dépôt (AirCrypto, AirMacro) : en-têtes de sécurité,
 * API sous /api, Vite en middleware (dev) ou build statique (prod), port fourni par
 * le superviseur (PORT) sinon port stable avec repli éphémère s'il est occupé.
 */
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

export const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const prod = process.env.AIRCRYPTO_PROD === '1'
if (!prod) process.env.NODE_ENV = 'development'

/**
 * @param {{
 *   name: string,
 *   defaultPort: number,
 *   registerApi: (api: import('express').Router) => void,
 *   vite: { root: string, configFile?: string },
 *   distDir: string,
 *   onListening?: () => void,
 * }} options
 */
export async function bootServer({ name, defaultPort, registerApi, vite, distDir, onListening }) {
  const app = express()
  app.disable('x-powered-by')
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    next()
  })

  const api = express.Router()
  registerApi(api)
  app.use('/api', api)
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found', path: req.path })
  })

  // PORT fourni par le superviseur si présent ; sinon port stable peu commun,
  // avec repli éphémère si déjà occupé (machine partagée entre projets).
  const requestedPort = Number(process.env.PORT) || defaultPort
  const server = http.createServer(app)
  let fellBack = false
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && !fellBack) {
      fellBack = true
      console.warn(`Port ${requestedPort} occupé — repli sur un port éphémère`)
      server.listen(0)
      return
    }
    console.error(err)
    process.exit(1)
  })

  if (prod) {
    app.use(express.static(distDir))
    app.use((_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'))
    })
  } else {
    const { createServer: createViteServer } = await import('vite')
    const devServer = await createViteServer({
      root: vite.root,
      configFile: vite.configFile,
      appType: 'spa',
      server: { middlewareMode: true, hmr: { server } },
    })
    app.use(devServer.middlewares)
  }

  server.listen(requestedPort, () => {
    const actualPort = server.address().port
    console.log(
      `${name} ${prod ? '(prod)' : '(dev)'}${process.env.AIRCRYPTO_OFFLINE === '1' ? ' [OFFLINE]' : ''} — Local: http://127.0.0.1:${actualPort}/`,
    )
    onListening?.()
  })
  return server
}
