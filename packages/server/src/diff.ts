/** 文本 unified diff（按行 LCS）— 产物版本对比用，零依赖 */

type Op = { t: "=" | "-" | "+"; line: string };

function lcsDiff(a: string[], b: string[]): Op[] {
  const n = a.length, m = b.length;
  // DP 表（产物 ≤5MB、行数有限；超长文本退化为整体替换防 O(n*m) 爆内存）
  if (n * m > 4_000_000) {
    return [...a.map((line) => ({ t: "-" as const, line })), ...b.map((line) => ({ t: "+" as const, line }))];
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const ops: Op[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: "=", line: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ t: "-", line: a[i] }); i++; }
    else { ops.push({ t: "+", line: b[j] }); j++; }
  }
  while (i < n) { ops.push({ t: "-", line: a[i++] }); }
  while (j < m) { ops.push({ t: "+", line: b[j++] }); }
  return ops;
}

/** unified diff 文本（无上下文行合并优化，保持简单可靠） */
export function unifiedDiff(prev: string, next: string): string {
  if (prev === next) return "";
  const a = prev.split("\n");
  const b = next.split("\n");
  const ops = lcsDiff(a, b);
  const out: string[] = [];
  let del = 0, add = 0;
  for (const op of ops) {
    if (op.t === "-") { out.push(`- ${op.line}`); del++; }
    else if (op.t === "+") { out.push(`+ ${op.line}`); add++; }
    else out.push(`  ${op.line}`);
  }
  return `@@ -1,${a.length} +1,${b.length} @@ (${del} 删/${add} 增)\n${out.join("\n")}`;
}
