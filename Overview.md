# ComfyUI 提示词小助手 (Prompt Assistant) 项目概述

本文档旨在提供对 ComfyUI 提示词小助手插件的全面分析，包括其用途、核心功能、技术实现及项目结构。

## 1. 项目用途

**ComfyUI 提示词小助手**是一个旨在增强 ComfyUI 原生提示词输入体验的插件。它通过在文本输入框旁边动态附加一个功能丰富的工具栏，为用户提供了一系列强大的提示词辅助功能，从而简化工作流、激发创意并提升效率。

核心目标是解决用户在编写复杂提示词时可能遇到的语言障碍、灵感枯竭以及效率不高等问题。

## 2. 核心功能

插件主要围绕两大核心模块构建：**提示词小助手 (Prompt Assistant)** 和 **图像小助手 (Image Caption)**。

### 2.1. 提示词小助手

当用户选中任何包含文本输入框（特别是正、负提示词框）的节点时，该模块会自动在该输入框旁边显示一个悬浮工具栏。其功能包括：

- **一键翻译**:
    - 支持 **百度翻译** 和 **大语言模型 (LLM) 翻译** 两种模式。
    - 能够自动检测输入语言，并将其翻译为指定的目标语言（默认为中文/英文）。
    - 用户可以在设置中配置百度翻译的 `APP ID`、`Secret Key` 以及 LLM 的 `API Key`。

- **智能扩写**:
    - 利用大语言模型（默认 `glm-4-flash`）对简单的核心提示词进行丰富和扩展，生成更具描述性和细节的复杂提示词。
    - 该功能有助于激发用户的创作灵感。

- **历史记录**:
    - 自动保存用户使用过的提示词。
    - 提供一个可搜索、可编辑的历史记录面板，方便用户快速复用、收藏或删除历史记录。

- **标签管理**:
    - 提供一个内置的、可高度自定义的标签库（支持多层嵌套）。
    - 用户可以通过点击快速将常用标签（如画质、风格、镜头等）插入到提示词中。

### 2.2. 图像小助手

当用户选中包含图像输出或输入的节点时（如 `LoadImage`, `SaveImage` 等），该模块会提供以下功能：

- **图像描述/反推提示词 (Image to Text)**:
    - 利用多模态大语言模型（默认 `glm-4v-flash`）分析图像内容。
    - 生成对图像的详细描述，这些描述可以作为新的提示词直接使用。

## 3. 技术实现

项目采用前后端分离的架构。

### 3.1. 后端 (Python)

后端基于 ComfyUI 的自定义节点开发框架，使用 `aiohttp` 提供 RESTful API 服务。

- **`server.py`**: Web 服务器的核心，定义了所有 API 路由，包括：
    - `/config/*`: 用于前端获取和更新服务配置（如 API Key）。
    - `/baidu/translate`: 处理百度翻译请求。
    - `/llm/expand`: 处理提示词扩写请求。
    - `/llm/translate`: 处理 LLM 翻译请求。
    - `/llm/vision`: 处理图像分析请求。

- **`services/` 目录**: 封装了与第三方服务的交互逻辑。
    - **`llm.py` & `llm_v.py`**: 这两个文件是与大语言模型交互的核心。它们默认使用**智谱 AI (BigModel)** 的 `glm-4-flash` 和 `glm-4v-flash` 模型。通过构造特定的系统提示词 (System Prompt) 来实现翻译、扩写和图像描述等功能。代码中还包含了代理错误处理机制。
    - **`baidu.py`**: 封装了对百度翻译 API 的调用。
    - **`__init__.py`**: 项目初始化文件，负责将版本号注入前端。
    - **`config_manager.py`**: 负责管理 `config.json` 配置文件，提供配置的读取和更新功能。

### 3.2. 前端 (JavaScript)

前端代码位于 `js/` 目录下，遵循 ComfyUI 的扩展脚本规范。

- **`index.js`**: 插件的前端入口。它通过 `app.registerExtension` 注册插件，并利用 ComfyUI 的生命周期钩子（如 `nodeCreated`, `nodeRemoved`）来动态管理小助手 UI 的创建和销毁。

- **`modules/PromptAssistant.js`**: 这是前端最核心的文件，定义了 `PromptAssistant` 类。该类负责：
    - **UI 动态注入**: 监听 ComfyUI 的节点事件，判断节点是否符合条件，然后动态创建和注入小助手工具栏的 HTML 结构。
    - **UI 定位与跟踪**: 通过复杂的 DOM 操作和事件监听（画布缩放、节点拖动等），确保工具栏始终精确地跟随在目标输入框旁边。
    - **智能显隐**: 利用全局鼠标事件监听，实现了当鼠标悬停在输入框或工具栏上时自动显示，移出时自动隐藏的智能交互。
    - **功能集成**: 集成了 `HistoryManager` 和 `TagManager` 等模块，通过弹窗 (`PopupManager`) 提供历史记录和标签选择功能。

- **`modules/ImageCaption.js`**: 负责图像小助手的功能实现，逻辑与 `PromptAssistant.js` 类似。

- **`services/api.js`**: 封装了所有与后端 API 的 `fetch` 请求。

- **`utils/` 目录**: 包含一系列工具类，如 `UIToolkit` (用于创建UI元素), `EventManager` (用于事件处理，如防抖), `PopupManager` (用于管理弹窗) 等，体现了良好的代码组织和复用。

- **`config/` 目录**: 存放前端的静态配置。
    - **`tags.json`**: 默认的标签库数据。
    - **`system_prompts.json`**: 存放了调用大语言模型时使用的各种系统提示词，这是实现扩写、翻译等功能的核心指令。

## 4. 项目结构

```
comfyui_prompt_assistant/
├── __init__.py             # 插件初始化，注入版本号
├── server.py               # 后端API服务器
├── config_manager.py       # 配置文件管理器
├── config.json.example     # 配置文件示例
├── requirements.txt        # Python依赖
├── js/
│   ├── index.js            # 前端主入口，负责扩展注册和节点注入
│   ├── modules/
│   │   ├── PromptAssistant.js  # 提示词小助手核心逻辑
│   │   ├── ImageCaption.js   # 图像小助手核心逻辑
│   │   ├── history.js        # 历史记录功能
│   │   ├── tag.js            # 标签管理功能
│   │   └── settings.js       # 插件设置
│   ├── services/
│   │   ├── api.js            # 前端API服务封装
│   │   └── cache.js          # 前端缓存服务
│   ├── utils/              # 前端工具类 (UI、事件、弹窗等)
│   ├── config/
│   │   ├── tags.json         # 标签数据
│   │   └── system_prompts.json # LLM系统提示词
│   └── css/                # 样式文件
└── services/
    ├── baidu.py              # 百度翻译服务
    ├── llm.py                # LLM文本服务 (扩写、翻译)
    └── llm_v.py              # LLM视觉服务 (图像描述)
```

## 5. 总结

ComfyUI 提示词小助手是一个设计精良、功能强大的插件。它通过前后端分离的架构，将 Python 的服务能力与 JavaScript 的前端交互能力紧密结合。后端利用大语言模型提供了强大的 AI 辅助功能，而前端则通过精细的 DOM 操作和事件管理，实现了与 ComfyUI 的无缝集成，极大地提升了用户体验。 