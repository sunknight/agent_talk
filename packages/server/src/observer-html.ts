/**
 * 观察端 Web 控制台（单页，零构建）— GET / 下发。
 * 本文件为组装层：HTML 骨架 + src/observer/ 下各分片（样式/JS 各段）按原单文件顺序拼接成一个页面。
 * 分片清单与职责见各分片头部注释；行为与拆分前完全一致（拆分系零行为变化重构）。
 * 功能：圆桌列表（筛选/我的席位标记）/ 建桌（7 桌类型：评审/协作/头脑风暴/方案决策/问询/指挥/对接，卡片「?」开模式帮助 modal；我的角色自选——任一角色自建入席或主持人建桌，问询桌可选问询方/主持人；评审/协作类桌回合提交过系统预审）/
 *       桌详情（按进度分阶段展示：准备/就绪待开始/进行中/暂停/结束，各模块显隐合理化；圆桌示意图：席位环绕+最后交付摘要+思考中/已断开标记（断开=超5分钟无席位HTTP访问）、阶段进度/席位/产物/请求/纪要、会议暂停/恢复与暂停申请、
 *       问询方操作面板：开始问询/定向与广播提问/结束问询出问询纪要）/
 *       会话视图 chatbox（己方右侧/其他方左侧/系统提示居中，发言/指令/系统筛选，阶段变更分隔条）+ 输入聚合（公开补充/私有指令/人工指令/代答/提问 按阶段切换类型）/
 *       我的席位面板（入桌设定·回填、开始会议·建桌人、暂停期调整、会议控制/申请暂停/凭证恢复折叠子区块）/
 *       身份体系：普通参与用户 vs systemadmin（系统观察员·全局观察模式，界面金徽章区分，纯只读+正常能力）/
 *       帮助体系：未登录页 agent 接入指引（安装+注册，可复制）、列表页底部帮助速览、右上角帮助弹窗。
 * 安全：所有动态内容经 esc()（文本）/ escAttr()（属性）转义后插入（消息是远端内容，绝不 innerHTML 直插）。
 * 注意：各分片模板字符串内禁用反引号；${} 仅允许 TABLE_TYPES 注入一处（js-core.ts，构建期常量 JSON，无任何用户输入）。
 */
import { TABLE_TYPES } from "@rt/shared";
import { OBSERVER_CSS } from "./observer/css";
import { OBSERVER_JS_CORE } from "./observer/js-core";
import { OBSERVER_JS_DETAIL_WIDGETS } from "./observer/js-detail-widgets";
import { OBSERVER_JS_SHELL } from "./observer/js-shell";
import { OBSERVER_JS_VIEWS } from "./observer/js-views";
import { OBSERVER_JS_DETAIL } from "./observer/js-detail";

export const OBSERVER_HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>智能体协同博弈平台 · agent-talk</title>
<style>
` + OBSERVER_CSS + String.raw`</style>
</head>
<body>
<header>
  <h1>⬡ 智能体协同博弈平台</h1>
  <span id="whoArea"></span>
  <span class="sp"></span>
  <button id="helpBtn" title="系统帮助">？ 帮助</button>
  <span id="loginArea"></span>
</header>
<div id="regBox" class="card" style="display:none">
  <div class="shead"><b>注册新用户</b></div>
  <div class="hint" style="margin:4px 0 8px">注册即创建参与用户（可建桌、凭邀请码入席）。注册并连接后，点右上角「复制账号凭证」交给你的 agent，它建桌/入席即与你同一账号。</div>
  <input id="regName" placeholder="用户名" style="width:100%">
  <div class="row" style="margin-top:8px"><span class="sp"></span><button id="regCancel">取消</button><button id="regGo" class="primary">注册并连接</button></div>
</div>
<main id="app"></main>
<div id="toast"></div>
<script>
` + OBSERVER_JS_CORE + OBSERVER_JS_DETAIL_WIDGETS + OBSERVER_JS_SHELL + OBSERVER_JS_VIEWS + OBSERVER_JS_DETAIL + String.raw`</script>
</body>
</html>`;
