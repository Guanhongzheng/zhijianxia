# 智简匣 · 容器镜像
#
# 两个进程合成一个镜像：Next 前端（3000）+ 可选后端（8787）。
# 后端是本项目的「可选件」—— 只用本地模型 / 本地主题时不需要它，
# 所以 start.mjs 会在 ZJ_WITH_SERVER=0 时只起前端。
#
# 为什么不把后端塞进 Next 的 route handler：后端有 WebSocket、SQLite 与文件监听，
# 需要一个长驻 Node 进程，Next 的 Serverless 风格运行时不合适。

# ---------- 依赖层（含 devDeps，构建要用） ----------
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# 后端有独立的 package.json，根目录 npm ci 不装它（HANDOVER §5 的坑）
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --prefix server

# ---------- 构建层 ----------
FROM deps AS build
WORKDIR /app
COPY . .
# ZJ_STANDALONE=1 让 next.config.ts 打开 output: 'standalone'
ENV ZJ_STANDALONE=1
# 先打插件包：后端首次启动会从 dist-plugins 读内置插件作为种子
# （缺失时只是跳过种子，不会崩 —— 但镜像里缺插件等于少一半功能）
RUN npm run plugins:build && npm run build

# ---------- 运行层 ----------
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    ZJ_WEB_PORT=3000 \
    HOSTNAME=0.0.0.0

# standalone 已经包含 Next 运行所需的 node_modules（裁剪过）
COPY --from=build /app/.next/standalone ./web
COPY --from=build /app/.next/static ./web/.next/static
COPY --from=build /app/public ./web/public

# 后端：源码 + 它自己的生产依赖
COPY --from=build /app/server ./server
COPY --from=build /app/dist-plugins ./dist-plugins
COPY --from=build /app/start.mjs ./start.mjs

# 数据目录（SQLite）挂卷，否则重建容器就丢配置与消息
VOLUME ["/app/server/data"]

EXPOSE 3000 8787
CMD ["node", "start.mjs"]
