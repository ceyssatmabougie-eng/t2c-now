import { Router, type Router as RouterType } from 'express'

const router: RouterType = Router()

router.get('/', (_req, res) => {
  res.json({
    ok: true,
    name: 't2c-now-api',
  })
})

export default router
