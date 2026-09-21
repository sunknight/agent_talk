/**
 * 注入模式扫描 — 服务器侧标记（不拦截，只给端侧警示）。
 * 原则：宁可误报警示，不可漏报；最终裁决在端侧（skill 纪律 + 原生权限弹窗）。
 */
const PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)/i, label: "rm -rf 删除命令" },
  { re: /\bsudo\b/i, label: "sudo 提权" },
  { re: /curl[^\n|]{0,200}\|\s*(ba)?sh/, label: "curl 管道执行 shell" },
  { re: /wget[^\n|]{0,200}\|\s*(ba)?sh/, label: "wget 管道执行 shell" },
  { re: /base64\s+(-d|--decode)[^\n|]{0,200}\|/, label: "base64 解码管道执行" },
  { re: /忽略(之前|以上|前面|上述).{0,8}(指令|规则|设定|设置)/, label: "指示忽略既有指令" },
  { re: /ignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|rules?|settings?)/i, label: "指示忽略既有指令" },
  { re: /(disregard|forget)\s+(all\s+)?(previous|above|prior)\s+(instructions?|rules?)/i, label: "指示忽略既有指令" },
  { re: /\/etc\/(passwd|shadow|sudoers)/, label: "读取系统敏感文件" },
  { re: /BEGIN\s+(RSA|OPENSSH|EC|DSA)\s+PRIVATE\s+KEY/, label: "私钥内容" },
  { re: /\.ssh\/(id_rsa|id_ed25519|authorized_keys|config)/, label: "SSH 凭证路径" },
  { re: /\b(上传|发送|传给|外传|exfiltrate)\b.{0,30}\b(整个|所有|全部)?\s*(目录|磁盘|home|家目录|~)/i, label: "诱导批量外传文件" },
];

/** 扫描任意 JSON payload 的文本内容，返回命中的警示标签（空数组 = 干净） */
export function scanInjection(payload: unknown): string[] {
  let text: string;
  try { text = JSON.stringify(payload) ?? ""; } catch { return []; }
  const hits: string[] = [];
  for (const { re, label } of PATTERNS) {
    if (re.test(text) && !hits.includes(label)) hits.push(label);
  }
  return hits;
}

export const INJECTION_FLAG = "injection_suspect";
