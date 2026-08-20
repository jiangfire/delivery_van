FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# dist/boot.js 是 .js 后缀的 ESM 产物，需要 package.json 的 "type": "module" 才能被 Node 正确加载
COPY package.json ./
# dist/boot.js 已 bundle 除 better-sqlite3 外的全部依赖，运行时 node_modules 只需：
# better-sqlite3（原生模块，构建阶段在容器内 npm ci 装的就是 linux 版二进制）及其声明依赖 node-addon-api（头文件库，无自身依赖）
COPY --from=build /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=build /app/node_modules/node-addon-api ./node_modules/node-addon-api
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/boot.js"]
