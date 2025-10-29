


# ComfyUI Prompt Assistant✨提示词小助手



> 使用教程请查看：👉<a href="https://space.bilibili.com/520680644"><img src="https://img.shields.io/badge/B%E7%AB%99-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-blue?logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF"></a> &ensp;👈
> 
交流及群

<img src="https://data.xflow.cc/wechat.png" alt="微信交流群" width="300" height="300">

Bug反馈

https://ycn58r88iss5.feishu.cn/share/base/form/shrcnJ1AzbUJCynW9qrNJ2zPugy








## ✨插件介绍
  
这是一个无需添加节点，即可实现提示词翻译、扩写、预设标签插入、图片反推提示词、历史记录功能等功能的comfyUI插件。   
> 📍手动安装请从右侧[Releases](https://github.com/yawiii/comfyui_prompt_assistant/releases)下载最新版本。


## 📣更新
<details open>
 <summary>[2025-10-14]  V1.2.2 </summary>
  
- 移除兼容代码，不再支持comfyUI0.3.27以下的版本。避免小助手UI出现问题；
  
- 修复扩写、翻译使用302.ai服务时报错问题，ollama无法自动释放问题；
  
- 所有节点添加独立的ollama释放选项；
  
- 移除llm和vlm的强制直连参数，避免偶发请求报错问题，在设置界面中添加是否直连选项；
  
- 优化控制台日志输出格式，显示更加清晰直观；

</details>
<details>
 <summary>[2025-10-14]V1.2.1 </summary>
- 优化小助手UI的反应灵敏度；
  
- 增强api请求重试机制；

- 设置界面新增翻译标点符号、自动移除多余空格、移除多余连续点号、保留换行符等选项；

- 标签窗口记忆窗口大小，记忆上次选中的分类，以及标签栏滚动；
  
- API配置界面，新增自动获取模型列表功能；
  
- Ollama新增自动释放显存选项；
  
- 修复预览任意节点在列表情况无法为每个文本框创建小助手的bug。
</details>
<details>
 <summary>[2025-9-16]V1.2.0 </summary>
- 新增提示词扩写节点
  
- 新增302.AI、Ollama服务
  
- 标签面板新增记忆功能
  
- 右键菜单支持快速切换服务
  
- 针对某些主流模型支持关闭思维链
  
- 优化反推和翻译节点
  
- 新增交流反馈入口徽标
  
- 修复下拉菜单bug
  
- 修复标签面板搜索标签无法插入bug
  
- 修复base_url裁剪错误，解决偶发性请求报错
</details>
<details>
 <summary>V1.1.x </summary>
<details>
 <summary>[2025-8-28]V1.1.3 </summary>
  
- 优化小助手UI，实现自动避开滚动条，避免重叠误触
- 修复标签弹窗无滚动条，内容显示不全的问题
  
</details>
<details>
 <summary>[2025-8-23]V1.1.2 </summary>
  
- 重构节点，解决执行时产生多队列和重复执行的问题
- API配置界面添加模型参数，某些报错可以尝试调整最大token数解决
- 简化图像反推流程，提升反推速度
- 修复了标签按需加载时，无法搜索到未加载的标签
  
</details>
<details>
 <summary>[2025-8-10]V1.1.1 </summary>
  
-修复图像反推节点报错
  
</details>
<details>
 <summary>[2025-8-10]V1.1.0 </summary>
  
- 修改了UI交互
- 支持所有兼容OpenAI SDK API
- 新增自定自定义规则
- 新增自定义标签
- 新增图像反推、Kontext预设、翻译节点节点
  
</details>
</details>
<details>
 <summary>V1.0.x </summary>
<details>
 <summary>[2025-6-24]V1.0.6： </summary>
  
- 修复了一些界面bug
  
</details>
<details>
 <summary>[2025-6-24]V1.0.5： </summary>
  
- 修复新版创建使用选择工具栏创建kontext节点时，出现小助手UI异常问题
 
- 修复可能网络环境问题造成的智谱无法服务无法使用问题
 
- 修复可能出现实例清除出错导致工作流无法加载问题
  
- 修复AIGODLIKE-COMFYUI-TRANSLATION汉化插件导致标签弹窗打开卡住的问题
  
- 新增标签面板可以调整大小
  
- 优化UI资源加载机制
  
</details>
<details>
 <summary>[2025-6-24]V1.0.3： </summary>
  
- 重构了api请求服务，避免apikey暴露在前端
  
- 修改了配置的保存和读取机制，解决配置无法保存问题
  
- 修复了少许bug
  
</details>

<details>
<summary>[2025-6-21]V1.0.2：</summary>
  
- 修复了少许bug
  
</details>

<details>
<summary>[2025-6-15]V1.0.0:</summary>
  
 - 一键插入tag

- 支持llm扩写

- 支持百度翻译和llm翻译切换

- 图片反推提示词
  
- 历史、撤销、重做
</details>
</details>


## ✨ 功能介绍

![810x456-翻译](https://github.com/user-attachments/assets/dd4f282a-f9e3-4f0f-9da3-a141bea03653)

![810x456-扩写](https://github.com/user-attachments/assets/4060c46b-8ece-4917-9679-2e503947a810)

![810x456-反推](https://github.com/user-attachments/assets/38e49900-2375-4fe7-8211-1083e20f5d0d)

![810x456-历史](https://github.com/user-attachments/assets/49b903db-1cfd-40bb-bcb0-c1752474248e)

![810x456-配置功能](https://github.com/user-attachments/assets/673e1787-3110-4ed5-897a-eda192e3af3f)

## 📦 安装方法

#### 从ComfyUI Manager中安装
在Manager中输入“Prompt Assistant”或“提示词小助手”，点击Install，选择最新版本安装。


![安装](https://github.com/user-attachments/assets/8be5cf02-d4ec-4023-b400-84358f46c22c)


#### 手动安装



1. 从[克隆仓库](https://github.com/yawiii/comfyui_prompt_assistant/releases)中下载最新版本
解压缩到ComfyUI/custom_nodes目录下


2. 重启 ComfyUI

## ⚙️ 配置说明
目前小助手的翻译功能支持百度和智谱两种翻译服务，都是免费的。百度机翻速度快，智谱则是 AI翻译，更加准确。你可以根据自己的需求，进行切换 。而扩写和提示词反推则必须要使用智谱的服务来实现。  
申请教程，可查看作者 B 站视频：<a href="https://space.bilibili.com/520680644"><img src="https://img.shields.io/badge/B%E7%AB%99-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-blue?logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF"></a>

百度翻译申请入口：[通用文本翻译API链接](https://fanyi-api.baidu.com/product/11)   

![百度](https://github.com/user-attachments/assets/f3fe2d2d-9507-4bff-887e-003f2e13a19c)

智谱API申请入口：[智谱API申请](https://www.bigmodel.cn/invite?icode=Wz1tQAT40T9M8vwp%2F1db7nHEaazDlIZGj9HxftzTbt4%3D)

硅基流动 api申请入口：[硅基流动API申请](https://cloud.siliconflow.cn/i/FCDL2zBQ)  

![智谱](https://github.com/user-attachments/assets/d6eb29c0-8624-4bf2-96c4-33e99d096202)



#### 填入App id 、密钥、大模型API key

![设置](https://github.com/user-attachments/assets/d30d7c34-b6c6-4627-a554-ef7eee2f9cfb)


## 🎀特别感谢以下朋友提出的宝贵方案！

Cereza69、LAOGOU-666、H、小海、foryoung365、xu...

















