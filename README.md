


# ComfyUI Prompt Assistant✨提示词小助手
<a href="https://space.bilibili.com/520680644"><img src="https://img.shields.io/badge/B%E7%AB%99-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-blue?logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF"></a> &ensp;
<a href="https://qm.qq.com/cgi-bin/qm/qr?k=rLqiPclphF6D3aGc5Qu0bh6oPa8y0sjt&jump_from=webapi&authKey=JtSkQvgI9EZQPcZzmkqBSFkgregRcv56sz/Di637SxzpDHYtCbE8hQGAvk+EoxW"><img src="https://img.shields.io/badge/ComfyUI%E5%AD%A6%E4%B9%A0%E4%BA%A4%E6%B5%81%E7%BE%A4-15327075-blue?logo=QQ&logoColor=2300A5DC&labelColor=%23FFFFFF"></a> &ensp;
  
这是一个无需添加节点，即可实现提示词翻译、扩写、预设标签插入、图片反推提示词、历史记录功能等功能的comfyUI插件。   
> 📍原comfyui_prompt_widget项目已弃用，如已安装，请在ComfyUI Manager中卸载并重新搜索Prompt Assistant安装。


## 📋 计划

🔖研究中...：
- 支持本地反推提示词（JoyCaption Beta One）
- 支持一键识别插入lora触发词
- 支持划词翻译
- 标签工具支持调整和识别权重

✔️V1.0.0
- 一键插入tag
- 支持llm扩写
- 支持百度翻译和llm翻译切换
- 图片反推提示词
- 历史、撤销、重做


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

1. 进入 ComfyUI 的 `custom_nodes` 目录
```bash
cd ComfyUI/custom_nodes
```

2. 克隆仓库
```bash
git clone https://github.com/yawiii/comfyui_prompt_Assistant.git
```


4. 重启 ComfyUI

## ⚙️ 配置说明
目前小助手的翻译功能支持百度和智谱两种翻译服务，都是免费的。百度机翻速度快，智谱则是 AI翻译，更加准确。你可以根据自己的需求，进行切换 。而扩写和提示词反推则必须要使用智谱的服务来实现。  
申请教程，可查看作者 B 站视频：<a href="https://space.bilibili.com/520680644"><img src="https://img.shields.io/badge/B%E7%AB%99-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-blue?logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF"></a>

百度翻译申请入口：[通用文本翻译API链接](https://fanyi-api.baidu.com/product/11)   

![百度](https://github.com/user-attachments/assets/f3fe2d2d-9507-4bff-887e-003f2e13a19c)

智谱API申请入口：[智谱API申请](https://open.bigmodel.cn/dev/activities/free/glm-4-flash)  


![智谱](https://github.com/user-attachments/assets/d6eb29c0-8624-4bf2-96c4-33e99d096202)



#### 填入App id 、密钥、大模型API key

![设置](https://github.com/user-attachments/assets/d30d7c34-b6c6-4627-a554-ef7eee2f9cfb)



## 🫰🏻💖如果插件对您有帮助，不妨请我喝杯咖啡吧~💖🫰🏻


![赞赏码](https://github.com/user-attachments/assets/3072ba94-a910-4b32-a874-0aed0662a02f)




