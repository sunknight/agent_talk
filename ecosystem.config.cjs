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
