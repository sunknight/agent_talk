/** 资料文档在线预览验收（任务 0009）：页面含预览按钮/弹层/格式白名单/渲染与净化函数、
 *  docx 走 CDN mammoth + sanitize、md 有限渲染、Esc/遮罩关闭与 blob 回收。字符串级断言（零浏览器依赖）。 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start } from "../src";

let base = "";
let http: import("node:http").Server;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "rt-preview-"));
  ({ http } = await start({ port: 0, dataDir: dir, host: "127.0.0.1" }));
  base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});
afterAll(() => new Promise<void>((r) => { http.closeIdleConnections?.(); http.close(() => r()); }));

describe("观察页资料文档在线预览", () => {
  it("页面含预览入口与弹层：docPv 按钮、dmodal 弹层、Esc 关闭、blob 回收", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("docPv"); // 预览按钮
    expect(html).toContain("openDocPreview");
    expect(html).toContain("docPvModal");
    expect(html).toContain("dmodal"); // 弹层样式
    expect(html).toContain("closeDocPreview");
    expect(html).toContain("revokeObjectURL"); // 关闭回收 blob
    expect(html).toMatch(/Escape/); // Esc 关闭
  });

  it("格式白名单：文本/图片/pdf/docx 判定与渲染分支", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("docPreviewKind");
    for (const ext of ["txt:1", "md:1", "markdown:1", "json:1", "csv:1", "xml:1", "html:1"]) {
      expect(html).toContain(ext);
    }
    for (const ext of ["png:1", "jpg:1", "jpeg:1", "gif:1", "webp:1", "svg:1", "bmp:1", "avif:1"]) {
      expect(html).toContain(ext);
    }
    expect(html).toContain("application/pdf"); // pdf iframe
    expect(html).toContain("'pdf'?'application/pdf'");
    expect(html).toContain("docx"); // docx 分支
  });

  it("docx 预览：CDN mammoth 按需加载 + 输出 sanitize + 失败回退", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("ensureMammoth");
    expect(html).toContain("mammoth.browser.min.js"); // CDN
    expect(html).toContain("convertToHtml");
    expect(html).toContain("sanitizeHtml"); // 输出净化
    expect(html).toContain("下载后本地打开"); // CDN 不可用回退提示
    // sanitize：移除危险标签与事件属性
    expect(html).toContain("'script,style,iframe,object,embed,link,meta,form,base'");
    expect(html).toContain("indexOf('on')===0");
  });

  it("md 有限渲染：esc 后白名单转换（标题/列表/代码块/链接白名单），无原始 innerHTML", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("miniMd");
    expect(html).toContain("'<ul>'");
    expect(html).toContain("<pre>");
    expect(html).toContain("noopener noreferrer"); // 外链安全属性
    expect(html).toContain("https?:"); // 链接协议白名单
    // 文本类非 md 一律 esc 后 pre 展示
    expect(html).toContain("('<pre>'+esc(txt)+'</pre>')");
    // 超大文本省略提示
    expect(html).toContain("1000000");
  });

  it("预览权限与按钮复用下载通道（my/documents），无独立绕权接口", async () => {
    const html = await (await fetch(base + "/")).text();
    expect(html).toContain("canDl&&docPreviewKind"); // 有下载权且格式可预览才出按钮
    expect(html).toContain("downloadDoc"); // 下载与预览弹层共用
    expect(html).toContain("my/documents/"); // 走 my 通道（席位身份校验）
  });
});
