# deepai2api

DeepAI (deepai.org) 匿名聊天通道的 OpenAI 兼容反代。无需账号、无需注册。

## 逆向结论 (2026-11-07 box 实测)

- 真实入口: `POST https://api.deepai.org/hacking_is_a_serious_crime` (FormData, 纯 HTTP)
- `api-key` 头是前端本地生成的，无需注册:

```
key = "tryit-" + rand + "-" + md5(UA + md5(UA + md5(UA + rand + SALT)))
SALT = hackers_become_a_little_stinkier_every_time_they_hack
```

UA 必须与请求头 `User-Agent` 一致。
- prompt 放 `chatHistory` 字段 (`[{"role":"user","content":"..."}]`)，没有 `message` 字段也能通
- **字段不齐返回 500 HTML 而非 401**，排查时先对齐字段
- 流式: `Transfer-Encoding: chunked`, `text/plain; charset=UTF-8`，body 就是纯文本增量
- 思考模式: 加 `thinking_support=1` → 先返回 `{task_id}`，轮询 `GET /check_chat_task_status?type=thinking-task&task_id=...`

## 免费模型 (匿名全通，自报名字验证)

standard, glm-5.3-flash (Z.ai), deepseek-v4.1-flash, qwen3.8-flash, gpt-6-luna (OpenAI),
tencent-hy3, gemma-4, gpt-oss-120b, llama-3.3-70b-instruct, llama-3.1-8b-instant,
claude-haiku-5-5

`genius`/`super_genius`/各家旗舰为付费档 (401 "Only paid accounts can use genius")。

## Worker API (OpenAI 兼容)

- `GET /v1/models` — 模型列表
- `POST /v1/chat/completions` — `stream: true/false` 均支持
- 鉴权: 环境变量 `ACCESS_KEY`，请求头 `Authorization: Bearer <ACCESS_KEY>` (留空则不校验)

```bash
# 非流式
curl -s $BASE/v1/chat/completions -H "Content-Type: application/json" \
  -H "Authorization: Bearer $KEY" \
  -d '{"model":"glm-5.3-flash","messages":[{"role":"user","content":"hi"}]}'

# 流式 (SSE)
curl -N $BASE/v1/chat/completions ... -d '{"model":"standard","stream":true,"messages":[...]}'
```

## 部署

```bash
npx wrangler deploy
# 需要时: wrangler secret put ACCESS_KEY
```

## 限制

- 出口需带真实浏览器 UA；高频短时会触发上游 500 软限流，Worker 内置了请求间隔保护
- `enabled_tools`/`sandbox` 固定为匿名安全值

License: MIT
