


# ComfyUI Prompt Widget✨提示词小部件
一个可以在任意多行输入框实现翻译、扩写、预设、历史等功能的提示词小部件。    

<a href="https://space.bilibili.com/520680644"><img src="https://img.shields.io/badge/B%E7%AB%99-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-blue?logo=bilibili&logoColor=2300A5DC&labelColor=%23FFFFFF"></a> &ensp;
<a href="https://v.douyin.com/gJnTFSw_tZI/"><img src="https://img.shields.io/badge/%E6%8A%96%E9%9F%B3-%E4%BD%BF%E7%94%A8%E8%AF%B4%E6%98%8E-blue?style=flat&logo=TikTok&logoColor=%2324292E&labelColor=%23FFFFFF"></a> &ensp;
<a href="https://qm.qq.com/cgi-bin/qm/qr?k=rLqiPclphF6D3aGc5Qu0bh6oPa8y0sjt&jump_from=webapi&authKey=JtSkQvgI9EZQPcZzmkqBSFkgregRcv56sz/Di637SxzpDHYtCbE8hQGAvk+EoxW"><img src="https://img.shields.io/badge/QQ%E7%BE%A4-15327075-blue?logo=QQ&logoColor=2300A5DC&labelColor=%23FFFFFF&link=https%3A%2F%2Fspace.bilibili.com%2F520680644"></a> &ensp;





## ✨ 功能介绍

- 🌐 翻译  

![翻译](https://github.com/user-attachments/assets/25767da7-42bf-47a4-aba0-95db9285a4bf)  

  
- 💫 提示词扩写和润色  

![扩写2](https://github.com/user-attachments/assets/942f3acc-8d4d-4e79-a7da-8e389f3d8437)


  
- 📒 提示词预设  

![预设](https://github.com/user-attachments/assets/65becfc3-ddc7-4ab5-946f-12a47cafa4b6)  

- 🕐 历史记录  

![历史2](https://github.com/user-attachments/assets/e20b60a7-4756-4a54-b6a2-c6253c28bfa0)



## 📦 安装方法

#### 从ComfyUI Manager中安装
在Manager中输入“Prompt widget”或“comfyui_prompt_widget”，点击Install，选择最新版本安装。
![从Manager中安装](https://github.com/user-attachments/assets/2c357c5a-ecf2-45ea-8eb0-f76ee975ea6c)



#### 手动安装

1. 进入 ComfyUI 的 `custom_nodes` 目录
```bash
cd ComfyUI/custom_nodes
```

2. 克隆仓库
```bash
git clone https://github.com/yawiii/comfyui_prompt_widget.git
```


4. 重启 ComfyUI

## ⚙️ 配置说明

### 翻译功能API申请
目前翻译使用的是百度，需要自己申请一个API，实名认证后每个月有100万免费字符，能够满足基本使用需求。 然后在开发者信息中查看自己得APP ID和密钥，复制填入设置界面中的对应输入框中并保存即可。   

百度翻译申请入口：[通用文本翻译API链接](https://fanyi-api.baidu.com/product/11)   


![百度](https://github.com/user-attachments/assets/f3fe2d2d-9507-4bff-887e-003f2e13a19c)


### 大语言扩写API申请
扩写目前支持智谱和硅基流动等大模型提供商的API，目前测试了免费的智谱glm-4-flash-250414和硅基流动的Qwen/Qwen2.5-7B-Instruct。都是免费的，大家可以自行选择。 

智谱GLM4申请入口：[智谱glm-4-flash](https://open.bigmodel.cn/dev/activities/free/glm-4-flash)  


![智谱](https://github.com/user-attachments/assets/d6eb29c0-8624-4bf2-96c4-33e99d096202)


硅基流动API申请入口:[硅基流动](https://cloud.siliconflow.cn/models)

![硅基流动](https://github.com/user-attachments/assets/a4cc680a-9c36-4d9e-80be-7b09f5c05842)


### 填入App id 、密钥、模型等信息
如果是智谱的API Base URL填：
```
https://open.bigmodel.cn/api/paas/v4/chat/completions
```
模型填：
```
glm-4-flash-250414
```

如果是硅基流动API Base URL填：
```
https://api.siliconflow.cn/v1/chat/completions
```
模型根据自己选择模型填写即可，例如：
```
Qwen/Qwen2-7B-Instruct
THUDM/GLM-4-9B-0414
deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B
```


![配置API](https://github.com/user-attachments/assets/0d5cfcad-8f04-4707-8f66-324169665d59)






