// Windows 的 cmd/PowerShell 不支持 `NODE_ENV=production node ...` 这种 POSIX 前缀语法，
// 所以 npm start 走这个脚本：先补默认环境变量，再以 ESM 方式加载打包产物。
process.env.NODE_ENV ??= "production";
await import("../dist/boot.js");
