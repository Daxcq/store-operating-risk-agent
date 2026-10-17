/**
 * 生产启动入口（单端口 HTTP 服务）。
 *
 * 为什么用 vite preview 而不是自己写 http 服务：
 *   vite.config.js 里的 laisen-retail-agent-api 插件同时挂在 configurePreviewServer 上，
 *   /api/v1/* 全部由 src/server/api.js 在同一个 Node 进程内响应，不依赖任何外部后端。
 *   自己起一个静态服务器会把 API middleware 丢掉。
 *
 * 约定的输入输出：
 *   读 process.env.PORT（平台注入），绑定 0.0.0.0，必须能接受反向代理的 Host。
 *   启动前需要已有 dist/（start 脚本里先跑 vite build）。
 */

import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { preview } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))

// 数据层用 process.cwd() 拼 data/*.csv 的路径，先把 cwd 钉死在项目根，
// 避免从别的目录拉起进程时 CSV 读不到、静默退化成一堆兜底数字。
process.chdir(root)

const port = Number(process.env.PORT) || 4173

const server = await preview({
  root,
  configFile: fileURLToPath(new URL('./vite.config.js', import.meta.url)),
  preview: {
    host: '0.0.0.0',
    port,
    strictPort: true,
    // 反向代理进来的域名不在白名单里会被 Vite 拒绝（Blocked request. This host is not allowed.）
    allowedHosts: true,
  },
})

server.printUrls()

const shutdown = async () => {
  await server.close()
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
