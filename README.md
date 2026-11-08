# deepai2api

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/pingmike2/deepai2api)

DeepAI (deepai.org) 免费聊天通道的 OpenAI 兼容反代，部署在 Cloudflare Workers 上。

**无需账号、无需注册、无需 API Key** —— 密钥是前端本地算出来的，本项目把它复刻到了服务端。

> 纯逆向研究产物，仅供学习交流。请勿用于重负载场景，尊重上游服务。

## 特性

- OpenAI 兼容 `/v1/chat/completions`（流式 SSE / 非流式）和 `/v1/models`
- 11 个免费模型匿名全通，含 GLM 5.3 Flash、DeepSeek V4.1 Flash、GPT-6 Luna 等
- tryit 密钥本地现算，纯 JS MD5，无外部依赖
- 一键部署到 Cloudflare Workers（免费额度足够个人用）
- `ACCESS_KEY` 可选鉴权

## 快速开始

```bash
git clone https://github.com/pingmike2/deepai2api
cd deepai2api
npx wrangler deploy
npx wrangler secret put ACCESS_KEY   # 可选，设置了就必须带 Bearer token
```

调用：

```bash
BASE=https://your-worker.workers.dev

# 非流式
curl -s $BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"hi"}]}'

# 流式 (SSE)
curl -N $BASE/v1/chat/completions \
  -H "Authorization: Bearer $KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"standard","stream":true,"messages":[{"role":"user","content":"hi"}]}'
```

上下文是多轮的：把历史放在 `messages` 里传上来即可（上游无状态，每次全量重放）。

## 免费模型

以下模型全部匿名实测通过（每个都让模型自报名字验证，不是看 UI 标签）：

| 模型 ID | 来源 |
|---|---|
| `standard` | DeepAI 默认 |
| `glm-5.3-flash` | Z.ai |
| `deepseek-v4.1-flash` | DeepSeek |
| `qwen3.8-flash` | 阿里 Qwen |
| `gpt-6-luna` | OpenAI |
| `tencent-hy3` | 腾讯 |
| `gemma-4` | Google |
| `gpt-oss-120b` | OpenAI 开源 |
| `llama-3.3-70b-instruct` | Meta |
| `llama-3.1-8b-instant` | Meta |
| `claude-haiku-5-5` | Anthropic |

`genius` / `super_genius` / 各家旗舰是付费档，匿名请求返回 401 `Only paid accounts can use genius`。

传了不认识的 model 会回落到 `standard`。

## 逆向笔记

不想看的可以跳过，这部分是给后来踩坑的人的。

真实入口不是网页表单，而是一个名字起得很坦率的端点：

```
POST https://api.deepai.org/hacking_is_a_serious_crime
Content-Type: application/x-www-form-urlencoded
api-key: <本地计算的 tryit key>
```

密钥算法（前端 `generateIslandKey()` 的等价实现）：

```
key = "tryit-" + rand + "-" + md5(UA + md5(UA + md5(UA + rand + SALT)))
SALT = "hackers_become_a_little_stinkier_every_time_they_hack"
```

`rand` 是 `Math.random()*1e11` 取整。**UA 必须与请求头 `User-Agent` 完全一致**，否则密钥对不上。

请求字段（缺一个就是 500 HTML 页面，不是 401，这是最大的坑）：

| 字段 | 值 |
|---|---|
| `chat_style` | `chat`（或 `ai-code`） |
| `model` | 模型 ID，见上表 |
| `chatHistory` | `[{"role":"user","content":"..."}]` —— **prompt 在这里** |
| `language` | `en` |
| `web_access_enabled` | `true` |
| `sandbox_enabled` | `false` |
| `session_uuid` / `sensitivity_request_id` | uuid4 |
| `tool_activity_support` / `thinking_image_tool_support` | `1` |
| `hacker_is_stinky` | `very_stinky`（没错，就这么写的） |
| `enabled_tools` | `["image_generator","image_editor"]` |

响应是 `Transfer-Encoding: chunked` + `text/plain; charset=UTF-8`，body 就是纯文本增量，没有 SSE 帧，Worker 里转成了 OpenAI 格式的 `delta.content`。

思考模式：加 `thinking_support=1` 后请求变成两段式 —— 先返回 `{task_id}`，再轮询 `GET /check_chat_task_status?type=thinking-task&task_id=...`。本项目暂未封装。

排查方法沉淀：静态分析挖不到发送逻辑时，直接用浏览器自动化劫持 `window.fetch`，dump `FormData.entries()`，一步定位真实请求。

## 手动部署 Workers

不想用按钮/CLI 的话，网页控制台一样能部署：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages** → **Create application** → **Create Worker**，随便起个名（如 `deepai2api`），先 Deploy 一个空 Worker
2. 点 **Edit code**，把本仓库的 [`worker.js`](worker.js) 内容整段粘贴进去替换默认代码，**Deploy**
3. （可选）设置鉴权：Worker 页面 → **Settings** → **Variables and Secrets** → **Add**：
   - Type 选 `Secret`，Name 填 `ACCESS_KEY`，Value 自己生成一个随机串
   - 设置后所有请求必须带 `Authorization: Bearer <你的ACCESS_KEY>`
4. 验证：访问 `https://<你的worker名>.<你的子域>.workers.dev/v1/models`，返回模型列表 JSON 即成功

> 前面“快速开始”里的 CLI 方式（`npx wrangler deploy`）与此等价，二选一即可。

## 已知限制

- 上游按 IP 风控，短时高频会触发 500 软限流（没有账号体系，它只能看出口 IP）
- 上游会注入自己的 system prompt，模型偶尔自称 "Standard AI Chat by DeepAI"，免费档模型上下文纪律偏差，别信它的自我陈述
- `enabled_tools` / `sandbox` 固定为匿名安全值，图像生成等工具调用未封装
- 通道随时可能因上游改版失效，本仓库不承诺维护

## 致谢

- 逆向过程中参考了 DeepAI 前端源码与 [gpt4free](https://github.com/xtekky/gpt4free) 社区的思路

## 免责声明

- 本项目与 DeepAI 无任何关联，仅供技术研究和学习使用
- 使用本项目产生的任何后果由使用者自行承担，包括但不限于账号/IP 被上游封禁、服务不可用等
- 请遵守上游服务的使用条款，勿将其用于商业用途或大规模滥用
- 模型输出内容不代表本项目作者立场，请自行甄别
- 本项目按"现状"提供，不提供任何明示或暗示的保证

## License

MIT
