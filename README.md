# CrazySMM Local Console

一个可本地运行或容器部署的 CrazySMM 浏览器控制台，用于整理批量任务、按增长模型拆分计划、执行定时批次，以及查询余额、服务和订单状态。

## 功能

- 将 `链接 | 数量` 批量内容解析、核对并导出为三列、CSV、JSON 或 API Payload
- 使用增长模型将总量拆分到不同日期和时间段
- 将计划保存为本地批次，支持 dry-run 和 live 两种执行模式
- 查询 CrazySMM 余额、服务列表与订单状态
- 将 Key、批次状态和执行结果保存在可挂载的数据目录中

## 快速开始

环境要求：Node.js 18 或更高版本。项目只使用 Node.js 内置模块，没有第三方运行时依赖。

```bash
npm ci
npm start
```

打开 <http://127.0.0.1:5178>。项目自带一个最小增长模型样例，因此无需额外数据即可启动并体验模型拆分和 dry-run。

CrazySMM API Key 可以在“API 状态”页面中保存，也可以通过 `CRAZYSMM_API_KEY` 环境变量传入。余额、服务、订单查询和 live 下单需要有效 Key；普通解析、模型拆分和 dry-run 不需要。

## 使用 Docker Compose

```bash
cp .env.example .env
docker compose up --build -d
```

打开 <http://127.0.0.1:5178>。查看日志或停止服务：

```bash
docker compose logs -f
docker compose down
```

Compose 会把以下目录挂载到宿主机，容器重建后数据仍会保留：

- `work/`：API Key、本地输入和运行状态
- `outputs/`：生成的批次、订单结果和日志

## 直接使用 Docker

```bash
docker build -t crazysmm-local-console .
docker run --rm \
  --name crazysmm-local-console \
  --env-file .env \
  -p 5178:5178 \
  -v "$PWD/work:/app/work" \
  -v "$PWD/outputs:/app/outputs" \
  crazysmm-local-console
```

## 部署到 Railway

仓库包含 `railway.json`，Railway CLI 部署会使用 Railpack，并通过 `/api/health` 判断部署是否成功。根目录 Dockerfile 继续用于本地、CI 和其他容器平台。

建议为服务挂载一个 Railway Volume：

- 挂载路径：`/app/data`
- 环境变量：`DATA_ROOT=/app/data`

这样页面保存的 API Key、生成批次与执行结果会在重新部署后保留。生成 Railway 域名后即可通过公网地址访问控制台。

## 部署到其他容器平台

仓库根目录的 `Dockerfile` 可直接用于 Railway、Render、Fly.io、Cloud Run 或其他支持容器的服务。部署时使用以下约定：

- 服务监听 `HOST=0.0.0.0`
- 端口读取 `PORT`，默认 `5178`
- 健康检查路径为 `/api/health`
- 如需持久化 Key、批次和结果，可挂载 `/app/work` 与 `/app/outputs`，或设置 `DATA_ROOT` 后挂载单一数据目录
- 如需使用自己的增长模型，将 CSV 放入镜像或持久卷，并设置 `GROWTH_MODEL_CSV`

## 配置

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `HOST` | `0.0.0.0` | HTTP 服务监听地址 |
| `PORT` | `5178` | HTTP 服务端口 |
| `CRAZYSMM_API_URL` | `https://crazysmm.com/api/v2` | CrazySMM API 地址 |
| `CRAZYSMM_API_KEY` | 空 | CrazySMM API Key |
| `GROWTH_MODEL_CSV` | `examples/traffic_growth_model_points.sample.csv` | 增长模型 CSV 路径 |
| `DATA_ROOT` | 项目根目录 | Key、批次与执行结果的持久化根目录 |

在页面中保存的 API Key 会写入：

```text
work/crazysmm-local/.env
```

## 增长模型

仓库自带 `examples/traffic_growth_model_points.sample.csv`，用于开箱验证。生产使用时可通过绝对路径覆盖：

```bash
GROWTH_MODEL_CSV=/absolute/path/to/model.csv npm start
```

CSV 需要包含以下字段：

```text
model_id,model_key,model_name,family,horizon_days,slot,day,hour_start,hour_end,progress_start,progress_end,phase,increment_share,cumulative_share
```

## 验证

检查 JavaScript 语法：

```bash
npm run check
```

验证容器配置：

```bash
docker compose config
docker build -t crazysmm-local-console:test .
```

GitHub Actions 会自动运行语法检查并构建 Docker 镜像。验证过程不会调用 CrazySMM，也不会触发 live 下单。

## 目录结构

```text
.
├── .github/workflows/ci.yml     # 自动检查与镜像构建
├── examples/                    # 可直接运行的增长模型样例
├── public/                      # 浏览器界面
├── Dockerfile                   # 容器镜像定义
├── compose.yaml                 # 本地或服务器一键部署
├── railway.json                 # Railway 构建、健康检查与重启策略
├── server.js                    # HTTP 服务与 CrazySMM API 代理
├── work/                        # 本地配置和输入数据（不提交）
└── outputs/                     # 批次与执行结果（不提交）
```

`live` 模式会调用真实下单接口；复刻或部署后的首次验证建议先使用 dry-run。

本项目当前未附带开源许可证。
