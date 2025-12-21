# ComfyUI Prompt Assistant✨提示词小助手V2.0

![GitHub Repo stars](https://img.shields.io/github/stars/yawiii/ComfyUI-Prompt-Assistant)
![GitHub Release](https://img.shields.io/github/v/release/yawiii/ComfyUI-Prompt-Assistant)![GitHub Repo stars](https://img.shields.io/github/stars/yawiii/ComfyUI-Prompt-Assistant)
[![Static Badge](https://img.shields.io/badge/%E4%BA%A4%E6%B5%81%E5%8F%8D%E9%A6%88-blue?logo=wechat&logoColor=green&labelColor=%23FFFFFF&color=%2307A3D7)](https://https://data.xflow.cc/wechat.png)
[![Static Badge](https://img.shields.io/badge/%E4%BD%BF%E7%94%A8%E6%95%99%E7%A8%8B-blue?style=flat&logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF&color=%2307A3D7)](https://space.bilibili.com/520680644)
[![Static Badge](https://img.shields.io/badge/Bug-反馈-orange)](https://ycn58r88iss5.feishu.cn/share/base/form/shrcnJ1AzbUJCynW9qrNJ2zPugy)


**全新版本的提示词小助手上线啦！功能更强，响应速度更快！适配comfyUI node2.0！**

支持调用云端大模型API、本地Ollama大模型。实现提示词、markdown节点、节点文档翻译；提示词优化、图像/视频反推；常用标签预设、历史记录等功能。是一个全能all in one的提示词插件！


## **📣更新**

<details open>

<summary>[2025-12-21]  V2.0.0 </summary>

* 调用优化：全面重构小助手，提升API、Ollama调用和稳定度、响应速度；
* UI优化：重构前端小助手组件，更加稳定，支持node2.0模式，可以自定义显示位置、拖动按钮排序；
* 标签模块优化：全新标签机制。改为加载csv模式，支持多到csv随时切换、支持标签收藏；
* 规则模块优化：全新则配置窗口、支持分类、定义规则显示的位置；加入多个预置规则；
* API服务模块优化：全新api配置界面。支持自定义服务、支持添加多个模型作为备选；扩写、翻译、反推可独立选择服务和模型；
* 节点重构：重构所有节点，支持多语言，添加视频反推节点（beta）；
* 用户配置文件迁移：迁移到\\user\\default\\prompt-assistant，避免重装时用户数据丢失；
* 新增功能：节点文档翻译、markdown节点翻译

</details>

<details>

<summary>V1.2.x </summary>

<details>

<summary>[2025-11-12]  V1.2.3 </summary>

* 修复ollama和自定义服务时，返回为空的问题；
* Ollama改用原生接口，更好支持qwen3vl；
* 新增http api作为保底，避免出现请求异常;

</details>

<details>

<summary>[2025-10-14]  V1.2.2 </summary>

* 移除兼容代码，不再支持comfyUI0.3.27以下的版本。避免小助手UI出现问题；
* 修复扩写、翻译使用302.ai服务时报错问题，ollama无法自动释放问题；
* 所有节点添加独立的ollama释放选项；
* 移除llm和vlm的强制直连参数，避免偶发请求报错问题，在设置界面中添加是否直连选项；
* 优化控制台日志输出格式，显示更加清晰直观；

</details>

<details>

<summary>[2025-10-14]V1.2.1 </summary>

* 优化小助手UI的反应灵敏度；
* 增强api请求重试机制；
* 设置界面新增翻译标点符号、自动移除多余空格、移除多余连续点号、保留换行符等选项；
* 标签窗口记忆窗口大小，记忆上次选中的分类，以及标签栏滚动；
* API配置界面，新增自动获取模型列表功能；
* Ollama新增自动释放显存选项；
* 修复预览任意节点在列表情况无法为每个文本框创建小助手的bug。

</details>

<details>

<summary>[2025-9-16]V1.2.0 </summary>

* 新增提示词扩写节点
* 新增302.AI、Ollama服务
* 标签面板新增记忆功能
* 右键菜单支持快速切换服务
* 针对某些主流模型支持关闭思维链
* 优化反推和翻译节点
* 新增交流反馈入口徽标
* 修复下拉菜单bug
* 修复标签面板搜索标签无法插入bug
* 修复base\_url裁剪错误，解决偶发性请求报错

</details>
</details>

<details>

<summary>V1.1.x </summary>

<details>

<summary>[2025-8-28]V1.1.3 </summary>

* 优化小助手UI，实现自动避开滚动条，避免重叠误触
* 修复标签弹窗无滚动条，内容显示不全的问题

</details>

<details>

<summary>[2025-8-23]V1.1.2 </summary>

* 重构节点，解决执行时产生多队列和重复执行的问题
* API配置界面添加模型参数，某些报错可以尝试调整最大token数解决
* 简化图像反推流程，提升反推速度
* 修复了标签按需加载时，无法搜索到未加载的标签

</details>

<details>

<summary>[2025-8-10]V1.1.1 </summary>

-修复图像反推节点报错

</details>

<details>

<summary>[2025-8-10]V1.1.0 </summary>

* 修改了UI交互
* 支持所有兼容OpenAI SDK API
* 新增自定自定义规则
* 新增自定义标签
* 新增图像反推、Kontext预设、翻译节点节点

</details>

</details>

<details>

<summary>V1.0.x </summary>

<details>

<summary>[2025-6-24]V1.0.6： </summary>

* 修复了一些界面bug

</details>

<details>

<summary>[2025-6-24]V1.0.5： </summary>

* 修复新版创建使用选择工具栏创建kontext节点时，出现小助手UI异常问题
* 修复可能网络环境问题造成的智谱无法服务无法使用问题
* 修复可能出现实例清除出错导致工作流无法加载问题
* 修复AIGODLIKE-COMFYUI-TRANSLATION汉化插件导致标签弹窗打开卡住的问题
* 新增标签面板可以调整大小
* 优化UI资源加载机制

</details>

<details>

<summary>[2025-6-24]V1.0.3： </summary>

* 重构了api请求服务，避免apikey暴露在前端
* 修改了配置的保存和读取机制，解决配置无法保存问题
* 修复了少许bug

</details>

<details>

<summary>[2025-6-21]V1.0.2：</summary>

* 修复了少许bug

</details>

<details>

<summary>[2025-6-15]V1.0.0:</summary>

* 一键插入tag
* 支持llm扩写
* 支持百度翻译和llm翻译切换
* 图片反推提示词
* 历史、撤销、重做

</details>

</details>

## **✨ 功能介绍**

![小助手交互](https://github.com/user-attachments/assets/eda1aab1-0199-43d3-ac34-92788d2513ae)


### 节点介绍

#### **翻译节点**

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=ZGJkMGYyMTBiYmQ3MjlkNzZiY2IyOTJlOWZjY2ZlZjRfMXlJUVNDZDNrb0FPQnNFOVNjdHJqRWlLUTgxdUQ0UGlfVG9rZW46UG5EOWJUUW5Rb0R2b1h4djZHMGNEQ1l0bm9lXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

#### **提示词优化节点**

搭配规则使用，可以发挥发挥小助手最大潜力

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=MzZkZGNiMzQwMGEzMjBkZWE3YTBiOGJkNmVhYTVkMzJfdUVqOXZwQlVaRjNsMzUyQ3dmZUNCSGFMbG05bGxxbUdfVG9rZW46VzNFZ2JzaXhSbzBMYW94aW81bGNXeFlybmZoXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

#### **图像反推节点**

可以反推图像、结合视觉模型优化图像编辑指令

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=MGNjOTFmYTAxNWI3ODc0ZDdjMzNkOTI4MGU3N2RkZTVfUkdPbnVJVzhGU1V5QkFlNW5sbzhvNEVPM3JCVkNQTDVfVG9rZW46Sllra2JESEY1bzVSRXp4MW9qeWM5VW92bmRnXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=MTI0MjI1MTljZmIzYWVjNWEyOTQ5ZmE2ZDMxMDgyYTRfTkxhaExLelJJV1YwNWZ2anczUTZDWGRYV2JiNnQ2cDlfVG9rZW46TzNIYWJQTElNbzk0b1J4NWVtNmNNalNtbkxiXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

#### **视频反推节点**

（⚠️beta：目前仅能实现关键字反推，反推结果仍不稳，持续优化中）

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=M2M0ZjRiNDQ2NTVmY2E4Y2JkMzRjOTRmMzVhOTZmMTZfeDAySEh3MUhjY0ZCcndQMzUwZFlKWFppMTR0NW9jbmJfVG9rZW46R0FCRmJoV1Z1bzU0ejl4Znd3ZmNjRDVDblNnXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=NjFkM2M3ZDFjZmVkNWVkYjAzNDI1MmE0YzI5Nzc1OGRfckxPRDZiTGIzcVg5OGVPemt2NWxRVk4wbGhtYmN0OGlfVG9rZW46SU9zTWJsVVZOb3UwOU94QXNYcWNVWWIzbkpnXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

## **📦 安装方法**

### ⚠️旧版本迁移注意事项

如果您安装过提示词小助手2.0.0之前的版本，请注意备份原插件目录下的config目录。避免api配置、自定义规则、自定义标签数据丢失！

如果您之前是通过**Manager**安装则直接更新即可，如果您使用的是手动安装，建议删除旧的插件目录（记得备份config目录！！）将新的插件放入到“custom\_nodes”目录，再将需要恢复的配置文件放回config目录

#### **从ComfyUI Manager中安装**

在Manager中输入“Prompt Assistant”或“提示词小助手”，点击Install，选择最新版本安装。

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=MTBhMWY2MWQzY2IyZTI4YzRmNjZlMjc1YTQ3ZjdlZDdfWm5BNkhVT0d2VXQ3ME5JVlRjWWl3RnVyN3J2bTBKWFhfVG9rZW46V3JxeGJYd1BFbzZObEd4Qm9pVmN3dDZQbkhlXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

#### **手动安装**

1. ### 从[克隆仓库](https://github.com/yawiii/comfyui_prompt_assistant/releases)中下载最新版本

解压缩到ComfyUI/custom\_nodes目录下

⚠️注意：建议将插件目录名称修改为：“prompt-assistant”，以符合ComfyUI规范

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=ZmY5MGI5YjAxZThmYzMxMDdkYTEyMTcyYzAyY2M2NjZfRk5kT0ppbnJTNjR1Yk5zR1JmZHBmRmZIN1JBS2pWU0FfVG9rZW46SXplS2JzMUZqb2JqNFJ4bjkwTmNwWXIybnpmXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

2. 重启 ComfyUI

### 数据自动迁移

新版本能自动将用户的api配置、自定义规则、自定义标签进行升级和迁移。您可以根据自己的需要，将要做迁移的文件，放置在“prompt-assistant\\config”目录下。如果不选择迁移，重新安装后，API配置信息，需要重新手动配置！ 可迁移文件有

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=NjNjYThmYzk1ZTAwOGU5OWI4MWZhNzI2YjRkOGQzNGZfeUgzM3hXYXVzYlYwc1BhUWJ2M3g1SmhSV1RFMXJTNWxfVG9rZW46QnlXbWJualZub2llTDV4Qkgxa2NGWXl5blpmXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

新版本的小助手配置文件储存在“ComfyUI\\user\\default\\prompt-assistant”目录下，

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=MjBhM2EzYzkyNTk4NjBkZmU0NmVlZGIwY2Q0NWZmYjhfQ1dHZkpRQ3ZIVFRRSzVTNURxNnYxZzZMdVg5TEF6eW1fVG9rZW46UlJsemI2Vnlnb2pkU1p4QTVOSGN4TExlblhjXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

## **⚙️ 配置说明**

### 配置AIP Key，并配置模型

![](https://ycn58r88iss5.feishu.cn/space/api/box/stream/download/asynccode/?code=Y2NhMDcyYTQ3MmZhMjRiMmZjNWRiNzA2OGM5MGVmYmVfS2dXamtFRFJpSDducmZ4alNWRWxLSU9Hak1vWFFzSUNfVG9rZW46VmhTR2JudEpmb2Q5SUZ4VGpmVmNvSUFFbmFkXzE3NjYzMjczMDg6MTc2NjMzMDkwOF9WNA)

### 服务说明

您可以自己新增服务商，或者选择内置的服务商进行使用：

*\*免责声明：本插件仅提供*​*API*​*调用工具，第三方服务责任与本插件无关，插件所涉用户配置信息均存储于本地。对于因账号使用产生的任何问题，本插件不承担责任！*

​**百度翻译（机器翻译**​**）：速度快，但是翻译质量一般。使用魔法时可能会导致无法请求**​**每个月有免费500w额度**

**​百度翻译申请入口：​**[通用文本翻译API链接](https://fanyi-api.baidu.com/product/11)

**​智谱（大语言模型模型）：​**速度快，无限额度；目前免费模型有：glm-4.5-flash（限制频次）、 glm-4-flash-250414、GLM-4.6V-Flash、GLM-4V-Flash；注意，模型有审查，如果请求内容违规，会返回空结果。并非插件bug

**智谱API**​**​申请入口：​**[智谱API申请](https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D)

**​xFlow-API聚合：​**提供各类模型api聚合（如Gemini、nano Bannana、Grok、ChatGTP...），实现一个apikey调用，无需解决网络问题；

**​xFlow-API聚合申请入口：​**[xFlow API申请](https://api.xflow.cc/register?aff=Z063)

## **🎀特别感谢以下朋友！**

感谢群友为V2.0.0版本提供规则模板：阿丹、CJL、诺曼底
