// ── 服务器本地密钥文件（明文不进 git：/data 不在代码目录树，rsync/仓库都碰不到）──
// 格式：每行 KEY=VALUE，# 为注释，值可带成对引号；属主 web、权限 600。
// pm2 每次加载本文件时求值：缺文件 = 跳过注入（仅 warn，预审走 skipped 放行），不影响启动。
// 本地开发/测试可用 AGENT_TALK_SECRETS_FILE 指到别处。
const SECRETS_FILE = process.env.AGENT_TALK_SECRETS_FILE || "/data/agent_talk/secrets.env";
function loadSecrets() {
  try {
    const src = require("fs").readFileSync(SECRETS_FILE, "utf8");
    const out = {};
    for (const line of src.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (k) out[k] = v;
    }
    console.log(`[ecosystem] 已注入 ${SECRETS_FILE} 的 ${Object.keys(out).length} 个密钥`);
    return out;
  } catch {
    console.warn(`[ecosystem] 未找到 ${SECRETS_FILE}，跳过密钥注入（DeepSeek 预审将 skipped 放行）`);
    return {};
  }
}

module.exports = {
  apps: [
    {
      name: "agent-talk",
      cwd: "/home/web/code/agent_talk/packages/server",
      script: "dist/index.js",
      // 双版本并存时（系统 node 保留 20）：加下一行，本项目单独用 node24 跑；
      // 直接升级了系统 node 到 24 的话删掉这行
      interpreter: "/opt/node24/bin/node",
      // 数据目录显式绝对路径：与代码摆放解耦，备份/迁移一目了然
      env: {
        PORT: "38711",             // Node 监听 38711，仅本机；对外由 nginx 443 反代
        DATA_DIR: "/data/agent_talk",
        // BOOTSTRAP_ADMIN_TOKEN 见下方「首个管理员引导」，引导完成后删除此行
        ...loadSecrets(),          // DEEPSEEK_API_KEY / DEEPSEEK_MODEL 等（服务器 /data/agent_talk/secrets.env）
      },
      max_memory_restart: "512M",
      out_file: "/data/agent_talk/logs/out.log",
      error_file: "/data/agent_talk/logs/err.log",
      time: true,
      // Node 22.5~23.3 才需要下一行；≥23.4 删除
      // node_args: "--experimental-sqlite",
    },
  ],
};
