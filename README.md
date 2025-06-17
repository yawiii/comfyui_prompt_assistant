


# ComfyUI Prompt Assistant✨提示词小助手
<a href="https://space.bilibili.com/520680644"><img src="https://img.shields.io/badge/B%E7%AB%99-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-blue?logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF"></a> &ensp;
<a href="https://v.douyin.com/gJnTFSw_tZI/"><img src="https://img.shields.io/badge/%E6%8A%96%E9%9F%B3-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-blue?style=flat&logo=TikTok&logoColor=%2324292E&labelColor=%23FFFFFF"></a> &ensp;
<a href="https://qm.qq.com/cgi-bin/qm/qr?k=rLqiPclphF6D3aGc5Qu0bh6oPa8y0sjt&jump_from=webapi&authKey=JtSkQvgI9EZQPcZzmkqBSFkgregRcv56sz/Di637SxzpDHYtCbE8hQGAvk+EoxW"><img src="https://img.shields.io/badge/ComfyUI%E5%AD%A6%E4%B9%A0%E4%BA%A4%E6%B5%81%E7%BE%A4-15327075-blue?logo=QQ&logoColor=2300A5DC&labelColor=%23FFFFFF"></a> &ensp;
  
这是一个无需添加节点，即可实现提示词翻译、扩写、预设Tag插入、图片反推提示词、历史记录功能等功能的comfyUI插件。   
> 📍原comfyui_prompt_widget项目已弃用，如已安装，请在ComfyUI Manager中卸载并重新搜索Prompt Assistant安装。



## 📋 计划

🔖研究中...：
- 本地模型扩写、翻译、反推提示词。支持：JoyCaption Beta One
- 自动识别lora触发词
- 标签工具支持设置和识别权重
- 划词翻译

✔️V1.0.0
- 一键插入tag
- 支持llm扩写
- 支持百度翻译和llm翻译切换
- 图片反推提示词
- 历史、撤销、重做


## ✨ 功能介绍

- 🌐 翻译  

![翻译](https://github.com/user-attachments/assets/de090366-6cc4-4cd0-8d62-1beb4884ff55)


  
- 💫 扩写和润色  

![扩写](https://github.com/user-attachments/assets/b7a3736f-a5a5-4dd8-9b8b-a1eb692f3e35)


  
- 📒 一键插入Tag  

![标签](https://github.com/user-attachments/assets/43d317d6-a6a9-4446-9ebd-f6202c533806)




- 🌄 图片反推

![反推](https://github.com/user-attachments/assets/18a186a4-8410-4133-b7be-d88efa8b9928)



- 🕐 历史记录和撤销、重做  

![历史](https://github.com/user-attachments/assets/4efbc29f-43f7-436e-b1b3-d9b02c4991aa)

- 🔧 根据需求，关闭开启功能

![功能配置](https://github.com/user-attachments/assets/92a94168-61aa-4403-87b1-a3287c4e51f3)




## 📦 安装方法

#### 从ComfyUI Manager中安装
在Manager中输入“提示词小助手”或“Prompt Assistant”或“提示词小助手”，点击Install，选择最新版本安装。

![安装](https://github.com/user-attachments/assets/63f0aa9f-9eed-4d9f-bc8a-d3ff769836de)



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
要使用翻译、扩写、图片反推提示词功能，需要申请相应的API，并在设置界面中填入对应的API id、密钥或API key。
翻译功可选百度机翻（速度快）或者使用大模型进行翻译。扩写、图片反推提示词必须申请大模型的API才能使用。

### 翻译功能API申请
目前翻译使用的是百度，需要自己申请一个API，实名认证后每个月有100万免费字符，能够满足基本使用需求。 然后在开发者信息中查看自己得APP ID和密钥，复制填入设置界面中的对应输入框中并保存即可。   

百度翻译申请入口：[通用文本翻译API链接](https://fanyi-api.baidu.com/product/11)   


![百度](https://github.com/user-attachments/assets/f3fe2d2d-9507-4bff-887e-003f2e13a19c)


### 使用大语言进行翻译、扩写、提示词反推的 API key申请
目前大模型翻译和扩写，使用的是智谱的免费模型GLM-4-Flash-250414。图片反推使用的是免费的GLM-4V-Flash。申请非常简单。

智谱API申请入口：[智谱API申请](https://open.bigmodel.cn/dev/activities/free/glm-4-flash)  


![智谱](https://github.com/user-attachments/assets/d6eb29c0-8624-4bf2-96c4-33e99d096202)



### 填入App id 、密钥、大模型API key

![设置](https://github.com/user-attachments/assets/c3314682-e304-4406-87b0-123fd93146cf)






