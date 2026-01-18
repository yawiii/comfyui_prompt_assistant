# ComfyUI-Prompt-Assistant 仓库概览（Prompt Assistant）

## 1. 仓库基本信息

| 项 | 值 |
|---|---|
| 名称 | ComfyUI Prompt Assistant（提示词小助手 / `prompt-assistant`） |
| 版本 | `2.0.2`（来自 `pyproject.toml`） |
| 许可证 | GPL-3.0（见 `LICENSE` 与 `pyproject.toml`） |
| 主要语言 | JavaScript（前端扩展/UI）+ Python（ComfyUI 后端节点与 API） |
| 创建时间 | 无法在当前工作区准确推断（缺少 Git 历史/标签信息）；可参考 README 中最早的版本记录为 `2025-06-15`（V1.0.0） |
| 最后更新时间 | 无法在当前工作区准确推断（工作区文件时间戳一致，且未读取 Git 记录）；可参考 README 的版本更新区与 `pyproject.toml` 版本号 |

补充说明：
- 若需要“创建时间/最后更新时间”的严格结论，建议以 Git 提交历史（首个 commit、最近 commit）或 Release/Tag 为准。

## 2. 项目结构分析

该仓库是一个 **ComfyUI 自定义节点插件**：Python 部分提供节点与后端 API，JavaScript 部分在 ComfyUI 前端注入“小助手”UI 与交互能力。

### 2.1 顶层结构速览

| 路径 | 作用 |
|---|---|
| `__init__.py` | 插件入口：注册节点映射、声明 `WEB_DIRECTORY`、启动时注入前端 `version.js` |
| `server.py` | 后端 API：挂载到 ComfyUI `PromptServer`（aiohttp 路由），提供配置、服务商、翻译/扩写/图像与视频反推等接口 |
| `config_manager.py` | 配置与迁移：在 ComfyUI 用户目录下创建/读取/增量更新配置；管理服务商、模型、规则、标签等数据 |
| `node/` | ComfyUI 节点实现：翻译、扩写、图像反推、视频反推、Kontext 预设等 |
| `services/` | 调用第三方能力：OpenAI 兼容接口、Ollama 原生接口、百度翻译、模型列表、HTTP 客户端池等 |
| `utils/` | 通用工具：日志/进度条、图像处理、视频抽帧、迁移工具等 |
| `js/` | 前端扩展：注入 ComfyUI UI（小助手、设置、标签、历史、节点文档翻译等），并通过后端 API 代理请求以保护 API Key |
| `config/` | 内置模板：默认配置、规则模板、Kontext 预设模板、标签模板等 |
| `locales/` | 多语言节点定义：`nodeDefs.json`（en/zh/zh-TW） |
| `.github/workflows/publish_action.yml` | 发布：推送 `pyproject.toml` 更新时，发布到 Comfy Registry（GitHub Action） |

### 2.2 关键入口与装载方式

后端入口（节点/服务器初始化）：
- `__init__.py`：定义 `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS` 并暴露 `WEB_DIRECTORY = "./js"`，使 ComfyUI 加载前端资源。
- `server.py`：使用 `PromptServer.instance.routes.*` 挂载 aiohttp 路由，API 前缀会根据插件目录动态变化。

前端入口（ComfyUI 扩展注册）：
- `js/index.js`：`app.registerExtension({ name: "Comfy.PromptAssistant", setup() { ... } })`，在 ComfyUI 前端初始化 UI/功能挂载与节点监听。

## 3. 核心功能模块与技术栈分析

### 3.1 功能模块拆解（按“能力域”）

| 能力域 | 主要文件/目录 | 说明 |
|---|---|---|
| 节点能力（Node） | `node/*.py` | ComfyUI 节点：提示词翻译、扩写、图像反推、视频反推、Kontext 预设等；支持通过 `[R]` 触发强制执行（见各节点 `IS_CHANGED` 逻辑） |
| 后端 API（Frontend 代理） | `server.py` | 将前端请求转为后端调用，避免 API Key 暴露在浏览器端；支持流式接口与取消请求 |
| 配置与数据迁移 | `config_manager.py`、`utils/migration_tool.py`、`config/*_template.json` | 默认配置模板 + 用户配置目录（`ComfyUI/user/default/prompt-assistant`）迁移与增量更新 |
| LLM/VLM 调用层 | `services/llm.py`、`services/vlm.py`、`services/openai_base.py`、`services/thinking_control.py` | 统一 OpenAI 兼容调用、支持 Ollama 原生 `/api/chat`、支持“思维链控制/过滤”、支持进度条与降级重试 |
| 百度翻译 | `services/baidu.py` | 机器翻译作为单独服务商（并在节点层做特殊分支处理） |
| 前端 UI/交互注入 | `js/index.js`、`js/modules/*`、`js/services/*`、`js/css/*` | 小助手 UI（提示词优化/翻译/反推）、设置面板、标签管理、历史记录、节点帮助翻译、Node 2.0 挂载适配等 |
| 多语言支持 | `locales/*/nodeDefs.json` | 节点定义文案的多语言资源 |

### 3.2 技术栈

后端（Python）：
- 宿主：ComfyUI（通过其 `PromptServer`、`folder_paths`、`comfy.*` 等接口运行）
- Web：aiohttp 路由（由 ComfyUI 服务器体系提供）
- HTTP：`httpx`（异步请求第三方 LLM/VLM）
- 视觉/视频：`Pillow`（PIL）、`imageio`、`imageio-ffmpeg`（视频相关处理）
- 数值与张量：`numpy`、`torch`（与 ComfyUI 生态一致，部分节点处理图像/张量需要）

前端（JavaScript/CSS）：
- 宿主：ComfyUI 前端扩展机制（`scripts/app.js`、LiteGraph、Node 2.0/VueNodes 适配）
- UI：纯原生模块组织 + CSS（大量使用 ComfyUI 的主题变量/对话框样式类）
- 拖拽：`Sortable.min.js`（第三方库）

### 3.3 核心数据流（简化）

```text
ComfyUI 前端 (js/index.js 等)
  ├─ 读取/更新配置、发起扩写/翻译/反推请求
  └─ HTTP -> 后端代理 API: /{plugin_dir}/api/...
                │
                ▼
ComfyUI 后端 (server.py)
  ├─ 从用户配置目录读取服务商/API Key/模型/规则/标签
  ├─ 调用 services/llm.py, services/vlm.py, services/baidu.py
  └─ 返回结构化 JSON（可流式）
```

## 4. 依赖项与第三方库使用情况

### 4.1 Python 依赖（仓库声明）

来自 `requirements.txt`：

| 依赖 | 用途（从代码推断） |
|---|---|
| `httpx` | 调用 OpenAI 兼容接口、Ollama 接口等（异步/流式） |
| `imageio` | 视频处理/读写（配合视频反推、抽帧） |
| `imageio-ffmpeg` | `imageio` 的 FFmpeg 后端支持 |

### 4.2 Python 运行时隐式依赖（由 ComfyUI/环境提供）

代码中直接 import 但未在 `requirements.txt` 声明（通常由 ComfyUI 环境自带）：

| 依赖 | 出现位置示例 | 说明 |
|---|---|---|
| `aiohttp` | `server.py` | ComfyUI 的 Web 服务器体系 |
| `torch` | `node/*.py` | ComfyUI 常规依赖 |
| `numpy` | `node/*caption*.py` | 图像/数组处理 |
| `Pillow (PIL)` | `node/*caption*.py` | 图像编码/处理 |
| `folder_paths`、`comfy.*` | 多处 | ComfyUI 插件标准 API |

### 4.3 前端第三方库

| 依赖 | 路径 | 用途 |
|---|---|---|
| SortableJS（minified） | `js/lib/Sortable.min.js` | 标签/按钮等可拖拽排序交互 |

## 5. 构建与部署方式

### 5.1 作为 ComfyUI 自定义节点安装

README 已给出两种主流方式：
- 通过 ComfyUI Manager 搜索安装（推荐）
- 手动克隆/下载到 `ComfyUI/custom_nodes/` 并重启 ComfyUI

插件前端资源由 ComfyUI 通过 `WEB_DIRECTORY = "./js"` 直接加载，无需额外前端构建步骤（未发现 `package.json`、打包器或构建脚本）。

### 5.2 发布（Comfy Registry）

仓库包含 GitHub Action：`.github/workflows/publish_action.yml`
- 触发条件：推送到 `main` 且变更包含 `pyproject.toml`
- 动作：调用 `Comfy-Org/publish-node-action@v1` 发布到注册表（依赖仓库 Secret `REGISTRY_ACCESS_TOKEN`）

## 6. 测试策略与覆盖率

现状（基于仓库扫描结果）：
- 未发现 `pytest/unittest` 测试用例、测试目录、覆盖率配置（如 `coverage.py` / `pytest.ini` / `tox.ini`）。
- CI 中仅发现发布工作流，未发现自动化测试工作流。

建议（若未来要补齐）：
- 后端：针对 `services/openai_base.py` 的 URL 解析、降级重试、输出过滤；针对 `config_manager.py` 的迁移与原子写入；使用 mock 的 httpx 进行离线测试。
- 前端：可用最小化的集成测试验证 API URL 推断逻辑（`js/services/api.js` 的动态路由推断）。

## 7. 项目文档现状评估

### 7.1 已有文档与可读性
- `README.md`：覆盖较完整，包含功能说明、安装、配置、更新日志与使用截图，面向用户友好。
- `config/*_template.json`：作为“可执行文档”，固化了默认规则、服务商示例与 Kontex 预设格式。

### 7.2 开发者文档缺口（建议补充的内容类型）
- 架构说明：前端扩展如何挂载、后端 API 前缀如何动态推断、节点与 API 的关系。
- API 约定：`/{plugin_dir}/api/...` 的接口分组、请求/响应结构、流式接口格式。
- 贡献指南：本地调试方式（如何在 ComfyUI 中热加载/查看日志）、如何添加新服务商/模型适配等。

## 附：后端 API 路由概览（按类别）

说明：实际前缀为 `/{插件目录名}/api`（后端与前端都会进行动态推断/生成），避免因插件文件夹被重命名导致路径失效。

| 类别 | 代表接口（节选） | 说明 |
|---|---|---|
| 设置 | `GET/POST /settings/streaming_progress` | 流式进度显示开关（运行时即时生效） |
| 配置读取 | `GET /config/llm`、`/config/vision`、`/config/system_prompts`、`/config/tags*` | 拉取各类配置与模板 |
| 配置写入 | `POST /config/llm`、`/config/vision`、`/config/system_prompts`、`/config/active_prompt` | 更新用户配置 |
| 服务商管理 | `GET /services`、`POST/PUT/DELETE /services/{service_id}` | v2.0 服务商增删改查（含 masked 版本） |
| 模型管理 | `GET/POST /services/{service_id}/models` 等 | 获取/新增/删除/排序/默认模型等 |
| 业务调用 | `POST /llm/expand`、`/llm/translate`、`/vlm/analyze`、`/baidu/translate` | 扩写、翻译、图像理解、百度翻译 |
| 流式调用 | `POST /llm/expand/stream`、`/llm/translate/stream`、`/vlm/analyze/stream` | 支持流式输出（前端可做打字效果） |
| 视频能力 | `POST /video/info`、`/video/frame` | 视频信息提取与抽帧（支撑视频反推/手动抽帧 UI） |

