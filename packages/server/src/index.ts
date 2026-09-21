/** 服务器入口：node dist/index.js [port] [dataDir] */
import { join, resolve } from "node:path";
import { Hub } from "./engine";
import { Store } from "./store";
import { createHttpServer } from "./api";

export { Hub, ApiError } from "./engine";
export { Store } from "./store";
export { createHttpServer } from "./api";

/** 默认数据目录：项目根 roundtable_data/（src 与 dist 同在 packages/server 下，三层上溯即项目根） */
function defaultDataDir(): string {
  return resolve(__dirname, "..", "..", "..", "roundtable_data");
}

export async function start(opts: { port: number; dataDir?: string; host?: string }) {
  const dataDir = opts.dataDir ?? defaultDataDir();
  const store = new Store(dataDir);
  bootstrapAdmin(store);
  const hub = new Hub(store);
  const http = createHttpServer(hub);
  await new Promise<void>((resolve) => http.listen(opts.port, opts.host ?? "0.0.0.0", resolve));
  process.stdout.write(`[roundtable-server] listening on ${(http.address() as { port: number }).port} (data: ${join(dataDir, "roundtable.db")})\n`);
  const shutdown = () => { store.close(); http.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  return { http, hub, store };
}

/**
 * systemadmin 引导：BOOTSTRAP_ADMIN_TOKEN=<用户原始 token> 启动时，若系统尚无 systemadmin，
 * 将该 token 对应用户升级为 systemadmin（替代旧版“停服手改 state.json”的做法）。
 */
function bootstrapAdmin(store: Store) {
  const token = process.env.BOOTSTRAP_ADMIN_TOKEN;
  if (!token) return;
  if (store.listUsers().some((u) => u.role === "systemadmin")) return;
  const u = store.findUserByToken(token);
  if (!u) {
    process.stderr.write("[roundtable-server] BOOTSTRAP_ADMIN_TOKEN 未匹配到用户，忽略\n");
    return;
  }
  store.setUserRole(u.userId, "systemadmin");
  process.stdout.write(`[roundtable-server] 已将用户 ${u.name}(${u.userId}) 引导为 systemadmin\n`);
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? process.argv[2] ?? 8787);
  const dataDir = process.env.DATA_DIR ?? process.argv[3];
  start({ port, dataDir });
}
