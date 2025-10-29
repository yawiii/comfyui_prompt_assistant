import os
import json

class ConfigManager:
    def __init__(self):
        # 插件目录和配置文件路径
        self.dir_path = os.path.dirname(os.path.abspath(__file__))

        # 创建config目录
        self.config_dir = os.path.join(self.dir_path, "config")
        if not os.path.exists(self.config_dir):
            os.makedirs(self.config_dir)

        self.config_path = os.path.join(self.config_dir, "config.json")
        self.system_prompts_path = os.path.join(self.config_dir, "system_prompts.json")
        self.active_prompts_path = os.path.join(self.config_dir, "active_prompts.json")
        self.tags_user_path = os.path.join(self.config_dir, "tags_user.json")

        # 默认配置
        self.default_config = {
            "__comment": "提示词小助手配置文件",
            "baidu_translate": {
                "app_id": "",
                "secret_key": ""
            },
            "llm": {
                "current_provider": "zhipu",
                "providers": {
                    "zhipu": {
                        "model": "glm-4-flash-250414",
                        "base_url": "https://open.bigmodel.cn/api/paas/v4",
                        "api_key": "",
                        "temperature": 0.7,
                        "max_tokens": 1000,
                        "top_p": 0.9
                    },
                    "siliconflow": {
                        "model": "Qwen/Qwen2.5-7B-Instruct",
                        "base_url": "https://api.siliconflow.cn/v1",
                        "api_key": "",
                        "temperature": 0.7,
                        "max_tokens": 1000,
                        "top_p": 0.9
                    },
                    "302ai": {
                        "model": "gemini-2.5-flash",
                        "base_url": "https://api.302.ai/v1",
                        "api_key": "",
                        "temperature": 0.7,
                        "max_tokens": 1000,
                        "top_p": 0.9
                    },
                    "ollama": {
                        "model": "huihui_ai/qwen3-abliterated:14b",
                        "base_url": "http://localhost:11434/v1",
                        "api_key": "ollama",
                        "temperature": 0.7,
                        "max_tokens": 1000,
                        "top_p": 0.9,
                        "auto_unload": True
                    },
                    "custom": {
                        "model": "",
                        "base_url": "",
                        "api_key": "",
                        "temperature": 0.7,
                        "max_tokens": 1000,
                        "top_p": 0.9
                    }
                }
            },
            "vlm": {
                "current_provider": "zhipu",
                "providers": {
                    "zhipu": {
                        "model": "glm-4v-flash",
                        "base_url": "https://open.bigmodel.cn/api/paas/v4",
                        "api_key": "",
                        "temperature": 0.7,
                        "max_tokens": 500,
                        "top_p": 0.9
                    },
                    "siliconflow": {
                        "model": "THUDM/GLM-4.1V-9B-Thinking",
                        "base_url": "https://api.siliconflow.cn/v1",
                        "api_key": "",
                        "temperature": 0.7,
                        "max_tokens": 500,
                        "top_p": 0.9
                    },
                    "302ai": {
                        "model": "gemini-2.5-flash",
                        "base_url": "https://api.302.ai/v1",
                        "api_key": "",
                        "temperature": 0.7,
                        "max_tokens": 500,
                        "top_p": 0.9
                    },
                    "ollama": {
                        "model": "aha2025/llama-joycaption-beta-one-hf-llava:Q6_K",
                        "base_url": "http://localhost:11434/v1",
                        "api_key": "ollama",
                        "temperature": 0.7,
                        "max_tokens": 500,
                        "top_p": 0.9,
                        "auto_unload": True
                    },
                    "custom": {
                        "model": "",
                        "base_url": "",
                        "api_key": "",
                        "temperature": 0.7,
                        "max_tokens": 500,
                        "top_p": 0.9
                    }
                }
            }
        }

        # 默认激活的提示词
        self.default_active_prompts = {
                "expand": "expand_扩写-自然语言",
                "vision_zh": "vision_zh_全图反推(中文)",
                "vision_en": "vision_en_全图反推(英文)"
        }

        # 默认提示词配置 (不再包含 active_prompts)
        self.default_system_prompts = {
            "expand_prompts": {
                "expand_扩写-自然语言": {
                    "name": "扩写-自然语言",
                    "role": "system",
                    "content": "你是一位专业的AI绘画提示词工程师，擅长将简短描述转化为高质量、细节丰富的提示词。请按照以下步骤处理用户输入：\n\n1. 分析理解：\n   - 识别用户输入的核心主题和关键元素\n   - 确定画面类型（人物、风景、静物、概念艺术等）\n   - 提取已有的视觉细节、风格倾向和情感基调\n\n2. 结构化扩展：\n   - 主体描述：补充主体的详细特征（如人物的外貌、表情、服装、姿态；物体的材质、形状、纹理等）\n   - 场景环境：根据主题补充或完善场景信息（室内/室外、自然/城市、时代背景等）\n   - 构图视角：添加画面构图信息（视角高度、景别大小、主体位置、前景/背景关系等）\n   - 光影氛围：补充光源类型、光线方向、明暗对比、色调氛围等\n   - 风格化：根据内容补充适合的艺术风格、渲染技术或参考艺术家\n   - 质量标签：添加提升画面品质的技术描述（高细节、高分辨率、写实渲染等）\n\n3. 智能补全：\n   - 当用户输入缺少关键元素时，基于主题自动补充合理的场景、光源、环境氛围等\n   - 确保补充内容与主题风格协调一致，不产生冲突元素\n   - 保持原始意图的同时，丰富画面的叙事性和视觉层次\n\n4. 输出格式：\n   - 使用自然流畅的语言描述，避免机械堆砌关键词\n   - 按照视觉重要性排序元素，主体描述在前，环境氛围在后\n   - 直接输出完整提示词，不添加解释、分类标签或注释\n   - 控制提示词长度在适当范围内，确保核心元素突出\n\n请直接返回扩展后的完整提示词，不需要解释你的思考过程或添加额外说明。"
                },
                "expand_扩写-Tag": {
                    "name": "扩写-Tag",
                    "role": "system",
                    "content": "你是一位专业的AI绘画提示词工程师，擅长将简短描述转化为高质量、细节丰富的提示词。请按照以下步骤处理用户输入：\n\n1. 分析理解：\n   - 识别用户输入的核心主题和关键元素\n   - 确定画面类型（人物、风景、静物、概念艺术等）\n   - 提取已有的视觉细节、风格倾向和情感基调\n\n2. 结构化扩展：\n   - 主体描述：补充主体的详细特征（如人物的外貌、表情、服装、姿态；物体的材质、形状、纹理等）\n   - 场景环境：根据主题补充或完善场景信息（室内/室外、自然/城市、时代背景等）\n   - 构图视角：添加画面构图信息（视角高度、景别大小、主体位置、前景/背景关系等）\n   - 光影氛围：补充光源类型、光线方向、明暗对比、色调氛围等\n   - 风格化：根据内容补充适合的艺术风格、渲染技术或参考艺术家\n   - 质量标签：添加提升画面品质的技术描述（高细节、高分辨率、写实渲染等）\n\n3. 智能补全：\n   - 当用户输入缺少关键元素时，基于主题自动补充合理的场景、光源、环境氛围等\n   - 确保补充内容与主题风格协调一致，不产生冲突元素\n   - 保持原始意图的同时，丰富画面的叙事性和视觉层次\n\n4. 输出格式：\n   - 直接输出标签，不添加任何分类或说明\n   - 按照视觉重要性排序元素，主体描述在前，环境氛围在后\n   - 控制提示词长度在适当范围内，确保核心元素突出\n\n请直接返回扩展后的完整提示词，不需要解释你的思考过程或添加额外说明。"
                },
                "expand_Kontext优化并翻译": {
                    "name": "Kontext优化并翻译",
                    "role": "system",
                    "content": "# Kontext Prompt Assistant Guide\n\nYou are an expert Flux.1 Kontext prompt engineer. Your task is to analyze user input, identify their image editing intent, and transform their request into an optimal Kontext prompt that follows best practices.\n\n## Your Process\n\n1. Analyze the user's input to determine their editing intent\n2. **Identify the main subject type from the user's description (human, animal, object, scene)**\n3. Select the most appropriate instruction type from the available categories\n4. Extract key information from the user's request\n5. **Determine what essential features must be preserved based on subject type**\n6. Restructure the information into a well-formed Kontext prompt following the syntax pattern for that instruction type\n7. **Always include appropriate preservation clauses based on the subject type**\n8. Return ONLY the final English prompt without explanations, notes, or quotation marks\n\n## Subject-Specific Preservation Guidelines\n\n### For Human Subjects\nWhen user describes modifications to people or human-related elements (clothing, hair, accessories, etc.), always include preservation clauses like:\n- \"while preserving the person's facial features, identity, and expressions\"\n- \"while maintaining the person's gender, age appearance, and unique characteristics\"\n- \"while keeping the exact same pose, proportions, and positioning\"\n\n### For Animal Subjects\nWhen user describes modifications to animals, include preservation clauses like:\n- \"while preserving the animal's species, breed characteristics, and expressions\"\n- \"while maintaining the exact same pose and proportions\"\n\n### For Objects\nWhen user describes modifications to products, objects, or items, include preservation clauses like:\n- \"while maintaining the object's proportions, position, and functionality\"\n- \"while preserving the object's core design elements and purpose\"\n\n### For Scenes/Environments\nWhen user describes modifications to scenes or environments, include preservation clauses like:\n- \"while maintaining the same composition, perspective, and spatial relationships\"\n- \"while preserving the scene's atmosphere and spatial layout\"\n\n## Instruction Types and Syntax Patterns\n\n### 1. Basic Modification\n**Pattern:** [Verb] [object] [modification details] [preservation clause]\n**Example:** Change the car color to red while maintaining the same lighting, reflections, and exact model details\n**Example (human):** Change the white shirt to a black tank top while preserving the person's facial features, expressions, and maintaining the exact same pose and proportions\n\n### 2. Style Transformation\n**Pattern:** Transform to [specific style name] with [style characteristics], while maintaining [elements to preserve]\n**Example:** Transform to 1960s pop art style with bright colors, bold graphics, and commercial aesthetics, while maintaining the original composition\n**Example (human):** Transform to 1960s pop art style with bright colors and bold graphics, while preserving the person's identity, facial features, and maintaining the same pose and proportions\n\n### 3. Character/Object Consistency\n**Pattern:** [Verb] [specific object description] [modification], [preserved features]\n**Example:** Change the clothes to be a viking warrior while preserving facial features, gender, age appearance, and maintaining the same pose\n\n### 4. Text Editing\n**Pattern:** [Verb] [text content] [modification method] [integration details]\n**Example:** Add ASCII style text only the single word 'Welcome' no additional letters to the display, integrated naturally with the environment\n\n### 5. Camera/Viewpoint Change\n**Pattern:** [Verb] [viewpoint description] [preserved elements]\n**Example:** Rotate the camera 180 degrees to view directly from behind the subject, showing its back while maintaining the same style and identity\n\n### 6. Lighting/Environment Change\n**Pattern:** Convert to [environment description] [lighting description], [preserved elements]\n**Example:** Convert to early morning scene with soft golden sunrise light and gentle morning mist, maintaining the same composition, subjects, and architectural details\n\n### 7. Deep Context Integration\n**Pattern:** [Relighting instruction] + [contextual story elements] + [color unification] + [asset adjustment] + [seamless integration] + [preservation clause]\n**Example:** Adjust the lighting to match the scene's dramatic side lighting, add subtle environmental elements like dust particles in the air, unify the color grading to the warm sepia tone of the background, adjust the hair to appear slightly windblown, and ensure perfect blending at all transition points while preserving the person's identity and facial features\n\n### 8. Seamless Blending\n**Pattern:** [Micro-lighting adjustment] + [skin tone and texture unification] + [edge perfect blending] + [preservation clause]\n**Example:** Fine-tune the lighting and shadows around the neck and jawline for perfect matching, unify the skin tones and micro-textures like pores and film grain across the blended area, and create an invisible transition at the neckline while maintaining the person's identity and facial features\n\n### 9. Scene Teleportation\n**Pattern:** [Subject] [teleported to] [detailed new environment description], [maintain pose and identity]\n**Example:** Place the subject in an ancient Egyptian temple with hieroglyphics on stone walls, golden artifacts, and warm torchlight, while maintaining the exact same pose, expression, and preserving all facial features and identity\n\n### 10. Camera Movement\n**Pattern:** Change to [camera angle type] [narrative purpose] [preservation clause]\n**Example:** Change to a dramatic low-angle shot from the ground, making the subject appear heroic and monumental against the sky, while preserving the person's identity, facial features, and clothing details\n\n### 11. Relighting\n**Pattern:** Relight the scene with [lighting style] [light source description] [lighting effect] [preservation clause]\n**Example:** Relight the scene with Film Noir aesthetics: hard, single-source key light creating deep shadows and high contrast, while maintaining all subject details and identities\n\n### 12. Professional Product Shot\n**Pattern:** [Professional lighting setup] + [composition description] + [product focus emphasis] + [preservation clause]\n**Example:** Set up three-point lighting with a softbox key light, rim light for separation, and fill light for shadows, compose on a clean white background with subtle shadow beneath, and emphasize crisp product details and perfect textures while maintaining the exact same product design and features\n\n### 13. Frame Zooming\n**Pattern:** [Zoom action] [target] [purpose] [preservation clause]\n**Example:** Slowly push in on the subject's eyes to reveal a subtle, hidden emotion while maintaining the person's identity and all facial features\n\n### 14. Material Transformation\n**Pattern:** Transform the subject into [material type] [material properties description] [preservation clause]\n**Example:** Transform the subject into a statue carved from a single piece of dark, polished obsidian with glossy, reflective surface that catches the light, while preserving the exact pose, proportions, and recognizable features\n\n### 15. Season Change\n**Pattern:** [Transform season] [season characteristics] [environment changes] [clothing adjustments] [preservation clause]\n**Example:** Plunge the scene into a deep, quiet Autumn. Change all foliage to rich tones of crimson and gold, litter the ground with fallen leaves, make the air feel crisp with a low golden light, and adjust the subject's clothing to include a cozy sweater while preserving all facial features, identity, and maintaining the same pose\n\n### 16. Art Style Emulation\n**Pattern:** Transform the image into [art movement] in the style of [artist], using [technique description] [preservation clause]\n**Example:** Transform the image into a Post-Impressionist painting in the style of Van Gogh, using thick, swirling brushstrokes, vibrant emotional colors, and dynamic sense of energy in every element, while maintaining the recognition of all subjects and their core identities\n\n## Core Principles for Effective Prompts\n\n1. **Be Specific and Clear**\n   - ✅ Convert to pencil sketch with natural graphite lines, cross-hatching, and visible paper texture\n   - ❌ Make it a sketch\n\n2. **Break Complex Edits into Steps**\n   - Handle subject first, then background\n   - Adjust lighting first, then change style\n\n3. **Explicitly State What to Preserve Based on Subject Type**\n   - For people: while preserving facial features, identity, expressions, gender, and proportions\n   - For objects: while maintaining the same design, proportions, and functionality\n   - For scenes: while preserving the spatial layout, composition, and atmosphere\n\n4. **Use Precise Verbs**\n   - Prefer \"change\", \"replace\", \"adjust\" over vague terms like \"transform\"\n   - Use specific action verbs that clearly communicate the intended modification\n\n5. **Include Professional Terminology**\n   - Photography: three-point lighting, backlight, softbox\n   - Art: brushstrokes, color saturation, composition\n\n6. **Add Narrative Elements**\n   - as if we are seeing them at a different stage of their life\n   - as if viewed through a tilt-shift lens\n\n7. **Analyze Text Context Carefully**\n   - Determine subject type by analyzing the vocabulary and terms used by the user\n   - Look for keywords related to people (clothing, hair, skin, face), animals, objects, or scenes\n   - Pay attention to descriptive words that indicate the nature of the subject\n   - When in doubt about the subject type, include more comprehensive preservation clauses\n\n## Response Format\n\nAnalyze the user's request and respond with ONLY the optimized English prompt for Kontext. Do not include explanations, notes, quotation marks, or any other text.\n\n## IMPORTANT: DO NOT include quotation marks in your response\n\nYour final output should be plain text without any surrounding quotes. For example:\n\n✅ CORRECT: Change the background to a beautiful tropical beach with golden sand\n❌ INCORRECT: \"Change the background to a beautiful tropical beach with golden sand\"\n\n## Examples\n\nUser: \"把这个人物放到海滩上\"\nResponse: Change the background to a beautiful tropical beach with golden sand, clear blue water, and palm trees, while keeping the person in the exact same position, scale, and pose, and preserving all facial features, expressions, and identity\n\nUser: \"让这张图片变成梵高风格\"\nResponse: Transform the image into a Post-Impressionist painting in the style of Van Gogh, using thick, swirling brushstrokes (impasto), vibrant, emotional colors, and a dynamic sense of energy and movement in every element, while maintaining the recognition of all subjects and their core identities\n\nUser: \"给这个人物换上维京战士的衣服\"\nResponse: Change the clothes to be a viking warrior with leather armor, fur accents, and metal details while preserving facial features, identity, gender, age appearance, and maintaining the exact same pose and proportions\n\nUser: \"让画面变成黄昏时分的感觉\"\nResponse: Convert to golden hour sunset scene with warm orange and pink lighting, long soft shadows, and a rich atmospheric glow, maintaining the same composition, subject details, and spatial relationships\n\nUser: \"在右边墙上写上'欢迎光临'\"\nResponse: Write the words '欢迎光临' on the wall on the right using the same style and texture as the surrounding environment, integrating naturally with the scene\n\nUser: \"把这个人变老20岁\"\nResponse: Age the subject by 20 years, adding appropriate wrinkles around the eyes and mouth, graying the hair naturally at the temples, and slightly softening the facial structure while maintaining their core identity, gender, proportions, and expression\n\nUser: \"请把图片中用红框圈出来的白色衬衫更换成黑色背心\"\nResponse: Change the white shirt highlighted in the red box to a black tank top while preserving the person's facial features, identity, gender, age appearance, and maintaining the exact same pose and proportions"
                }
            },
            "translate_prompts": {
                "ZH": {
                    "role": "system",
                    "content": "你是一名AI绘画领域的提示词翻译专家，负责将用户提供的文本内容由{src_lang}准确地翻译成{dst_lang}。要求：1.完整翻译用户提供的所有文本，不要遗漏；2.保持格式，不要改变原文的书写结构、保持权重标记格式【如(提示词内容:1.2)】等；2.翻译要准确理解全文，使用地道的{dst_lang}和AI绘画领域的专业术语；5.直接输出翻译结果，无需解释说明。不要输出思考过程。"
                }
            },
            "vision_prompts": {
                "vision_zh_全图反推(中文)": {
                    "name": "全图反推(中文)",
                    "role": "system",
                    "content": "你是一位专业的图像分析专家，请将提供的图片转换为适合AI绘图模型使用的自然语言。你的描述需要准确、详细，并符合Stable Diffusion等模型的提示词特点。\n\n分析重点：\n1. 主体描述（按重要性排序）：\n   - 人物/物体的具体类型和特征\n   - 准确的外观描述（发型、服装、表情等）\n   - 清晰的姿势和动作\n   - 关键细节特征\n\n2. 场景要素：\n   - 具体的场景类型\n   - 环境细节\n   - 空间关系\n   - 天气和时间状态\n\n3. 视觉风格：\n   - 整体艺术风格\n   - 画面质感\n   - 特殊效果\n\n4. 技术特征：\n   - 构图方式\n   - 光影效果\n   - 色彩特点\n   - 渲染风格\n\n输出要求：\n1. 使用AI绘图模型常用的描述方式\n2. 按重要性顺序组织描述\n3. 包含必要的艺术风格和技术标签\n4. 避免使用模型难以理解的抽象描述\n5. 保持描述的可执行性和清晰度\n\n示例输出：\n一位穿着白色连衣裙的年轻动漫女孩，金色长发飘逸，面带甜美笑容。她站在阳光明媚的春日花园中，周围绽放着粉色和白色的花朵。画面采用温暖的色调，细腻的动漫风格渲染，半身构图，柔和的自然光效果。背景经过适度模糊处理，突出人物主体。高质量插画风格，注重细节刻画，8k分辨率。\n\n注意事项：\n1. 使用具体而非抽象的描述\n2. 包含AI模型能够理解的标准术语\n3. 按照\"主体 > 场景 > 风格 > 效果\"的顺序组织描述\n4. 确保每个重要视觉元素都有明确描述\n5. 适当添加技术参数和质量标签\n\n请直接输出符合AI绘图要求的自然语言描述，确保描述既流畅自然，又包含足够的细节供模型准确理解和生成。"
                },
                "vision_zh_全图反推-Tag(中文)": {
                    "name": "全图反推-Tag(中文)",
                    "role": "system",
                    "content": "你是一位专业的图像分析专家。请仔细分析提供的图片，提取所有视觉元素并转换为中文标签，用于AI绘图模型使用。\n\n分析要点：\n1. 主体内容：\n   - 主要对象（人物/动物/物体）\n   - 外观特征（体态/表情/服装/材质）\n   - 动作姿态\n   - 细节特征（装饰/纹理/标志）\n\n2. 场景环境：\n   - 场景类型和环境\n   - 空间布局\n   - 环境元素\n   - 时间和天气\n\n3. 光影色彩：\n   - 光源和光照效果\n   - 主要色调和配色\n   - 明暗对比和氛围\n\n4. 构图视角：\n   - 构图方式\n   - 视角和景别\n   - 画面重点\n\n5. 艺术风格：\n   - 整体风格（写实/动漫/插画等）\n   - 特殊艺术效果\n   - 渲染技法\n\n输出要求：\n- 使用中文标签，以逗号分隔\n- 按重要性排序：主体 > 场景 > 风格 > 细节 > 技术特征\n- 所有标签在同一行内\n- 直接输出标签，不添加任何分类或说明\n\n示例输出：\n可爱女孩，金色长发，白色连衣裙，春日花园，阳光明媚，清新动漫风，温暖色调，甜美笑容，蝴蝶结装饰，半身构图，柔和光影，高清细节\n\n请直接输出标签序列，确保客观描述，避免主观评价。"
                },
                    "vision_en_全图反推(英文)": {
                    "name": "全图反推(英文)",
                    "role": "system",
                    "content": "You are a professional image analysis expert. Please convert the provided image into a natural language description suitable for AI image generation models like Stable Diffusion. Your description should be accurate, detailed, and follow prompt writing best practices.\n\nAnalysis Focus:\n1. Subject Description (in order of importance):\n   - Specific type and characteristics of people/objects\n   - Accurate appearance details (hairstyle, clothing, expressions)\n   - Clear poses and actions\n   - Key details and features\n\n2. Scene Elements:\n   - Specific scene type\n   - Environmental details\n   - Spatial relationships\n   - Weather and time conditions\n\n3. Visual Style:\n   - Overall artistic style\n   - Image quality\n   - Special effects\n\n4. Technical Features:\n   - Composition method\n   - Lighting effects\n   - Color characteristics\n   - Rendering style\n\nOutput Requirements:\n1. Use standard terminology common in AI image generation\n2. Organize description by importance\n3. Include necessary artistic style and technical tags\n4. Avoid abstract descriptions that models struggle with\n5. Maintain clarity and executability\n\nExample Output:\nA young anime girl wearing a white sundress, flowing golden hair, gentle smile on her face. She stands in a sun-lit spring garden surrounded by blooming pink and white flowers. Warm color palette, detailed anime style rendering, medium shot composition, soft natural lighting. Background with subtle blur effect to emphasize the subject. High-quality illustration style, intricate details, 8k resolution.\n\nGuidelines:\n1. Use specific rather than abstract descriptions\n2. Include standard terms that AI models understand\n3. Organize in order: subject > scene > style > effects\n4. Ensure each important visual element is clearly described\n5. Add appropriate technical parameters and quality tags\n\nPlease output a natural language description suitable for AI image generation, ensuring it is both fluent and contains sufficient details for accurate model interpretation and generation."
                },
                "vision_en_全图反推-Tag(英文)": {
                    "name": "全图反推-Tag(英文)",
                    "role": "system",
                    "content": "You are a professional image analysis expert. Please analyze the provided image and convert all visual elements into English tags suitable for AI image generation models.\n\nAnalysis Points:\n1. Main Subject:\n   - Primary objects (people/animals/objects)\n   - Appearance (physique/expression/clothing/texture)\n   - Actions and poses\n   - Detail features (decorations/patterns/marks)\n\n2. Scene & Environment:\n   - Scene type and setting\n   - Spatial layout\n   - Environmental elements\n   - Time and weather\n\n3. Light & Color:\n   - Light sources and lighting effects\n   - Main color schemes\n   - Contrast and atmosphere\n\n4. Composition:\n   - Composition method\n   - Perspective and shot type\n   - Focal points\n\n5. Artistic Style:\n   - Overall style (realistic/anime/illustration)\n   - Special artistic effects\n   - Rendering techniques\n\nOutput Requirements:\n- Use clear, standard English tags\n- Separate tags with commas\n- Order by importance: subject > scene > style > details > technical features\n- All tags in a single line\n- Direct tag output without categories or explanations\n\nExample Output:\nbeautiful girl, long blonde hair, white dress, spring garden, sunny day, anime style, warm colors, sweet smile, bow decoration, medium shot, soft lighting, high detail\n\nPlease output only the tag sequence. Ensure objective description and avoid subjective judgments. Use standard art and photography terminology where appropriate."
                }

            }
        }

        # 默认用户标签 - 空对象
        self.default_user_tags = {}

        # 确保配置文件存在
        self.ensure_config_exists()
        self.ensure_system_prompts_exists()
        # 先校验并补全系统提示词内容，再处理激活项
        self.validate_and_fix_system_prompts()
        self.ensure_active_prompts_exists()
        self.ensure_user_tags_exists()

        # 验证并修复激活提示词
        self.validate_and_fix_active_prompts()

        # 验证并修复模型参数配置
        self.validate_and_fix_model_params()
    # --- 统一日志输出（绿色前缀）---
    def _log(self, msg: str):
        """统一控制台日志前缀为绿色 [PromptAssistant]"""
        print(f"\033[32m[✨PromptAssistant]\033[0m {msg}")


    def ensure_config_exists(self):
        """确保配置文件存在，不存在则创建默认配置"""
        if not os.path.exists(self.config_path):
            self._log("配置文件不存在，创建默认配置文件...")
            self.save_config(self.default_config)

    def ensure_system_prompts_exists(self):
        """确保系统提示词配置文件存在，不存在则创建默认配置"""
        if not os.path.exists(self.system_prompts_path):
            self._log("系统提示词配置文件不存在，创建默认配置文件...")
            self.save_system_prompts(self.default_system_prompts)
        else:
            # 即使文件存在，也检查一下是否包含所有必要的提示词类型
            try:
                with open(self.system_prompts_path, "r", encoding="utf-8") as f:
                    system_prompts = json.load(f)

                # 检查是否包含所有必要的提示词类型
                need_update = False
                for prompt_type, default_prompts in self.default_system_prompts.items():
                    if prompt_type not in system_prompts:
                        self._log(f"系统提示词配置文件中缺少 {prompt_type} 类型，添加默认配置...")
                        system_prompts[prompt_type] = default_prompts
                        need_update = True

                # 如果需要更新，保存修复后的系统提示词
                if need_update:
                    self.save_system_prompts(system_prompts)
                    self._log("已完成系统提示词配置文件的修复")
            except Exception as e:
                self._log(f"检查系统提示词配置文件时出错: {str(e)}")

    def ensure_active_prompts_exists(self):
        """确保激活的提示词配置文件存在，不存在则创建默认配置"""
        if not os.path.exists(self.active_prompts_path):
            self._log("激活的提示词配置文件不存在，创建默认配置文件...")
            self.save_active_prompts(self.default_active_prompts)
        else:
            # 即使文件存在，也检查一下是否包含所有必要的提示词类型
            try:
                with open(self.active_prompts_path, "r", encoding="utf-8") as f:
                    active_prompts = json.load(f)

                # 检查是否包含所有必要的提示词类型
                need_update = False
                for prompt_type, default_value in self.default_active_prompts.items():
                    if prompt_type not in active_prompts:
                        self._log(f"激活的提示词配置文件中缺少 {prompt_type} 类型，添加默认配置...")
                        active_prompts[prompt_type] = default_value
                        need_update = True

                # 如果需要更新，保存修复后的激活提示词
                if need_update:
                    self.save_active_prompts(active_prompts)
                    self._log("已完成激活提示词配置文件的修复")
            except Exception as e:
                self._log(f"检查激活提示词配置文件时出错: {str(e)}")

    def ensure_user_tags_exists(self):
        """确保用户标签文件存在，不存在则创建空对象文件"""
        if not os.path.exists(self.tags_user_path):
            self._log("用户标签文件不存在，创建空标签文件...")
            self.save_user_tags(self.default_user_tags)

    def load_config(self):
        """加载配置文件"""
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载配置文件失败: {str(e)}")
            return self.default_config

    def save_config(self, config):
        """保存配置文件"""
        try:
            with open(self.config_path, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            self._log(f"保存配置文件失败: {str(e)}")
            return False

    def load_system_prompts(self):
        """加载系统提示词配置"""
        try:
            with open(self.system_prompts_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载系统提示词配置失败: {str(e)}")
            return self.default_system_prompts

    def save_system_prompts(self, system_prompts):
        """保存系统提示词配置"""
        try:
            with open(self.system_prompts_path, "w", encoding="utf-8") as f:
                json.dump(system_prompts, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            self._log(f"保存系统提示词配置失败: {str(e)}")
            return False

    def load_active_prompts(self):
        """加载激活的提示词配置"""
        try:
            with open(self.active_prompts_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载激活的提示词配置失败: {str(e)}")
            return self.default_active_prompts

    def save_active_prompts(self, active_prompts):
        """保存激活的提示词配置"""
        try:
            with open(self.active_prompts_path, "w", encoding="utf-8") as f:
                json.dump(active_prompts, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            self._log(f"保存激活的提示词配置失败: {str(e)}")
            return False

    def load_user_tags(self):
        """加载用户标签配置"""
        try:
            with open(self.tags_user_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            self._log(f"加载用户标签配置失败: {str(e)}")
            return self.default_user_tags

    def save_user_tags(self, user_tags):
        """保存用户标签配置"""
        try:
            with open(self.tags_user_path, "w", encoding="utf-8") as f:
                json.dump(user_tags, f, ensure_ascii=False, indent=2)
            return True
        except Exception as e:
            self._log(f"保存用户标签配置失败: {str(e)}")
            return False

    def get_system_prompts(self):
        """获取系统提示词配置 (合并提示词定义和激活状态)"""
        system_prompts = self.load_system_prompts()
        active_prompts = self.load_active_prompts()
        system_prompts['active_prompts'] = active_prompts
        return system_prompts

    def update_system_prompts(self, system_prompts):
        """更新系统提示词配置 (仅更新提示词定义)"""
        prompts_to_save = system_prompts.copy()
        if 'active_prompts' in prompts_to_save:
            del prompts_to_save['active_prompts']
        return self.save_system_prompts(prompts_to_save)

    def update_active_prompts(self, active_prompts):
        """更新所有激活的提示词"""
        return self.save_active_prompts(active_prompts)

    def update_active_prompt(self, prompt_type, prompt_id):
        """更新单个激活的提示词"""
        active_prompts = self.load_active_prompts()
        active_prompts[prompt_type] = prompt_id
        return self.save_active_prompts(active_prompts)

    def get_baidu_translate_config(self):
        """获取百度翻译配置"""
        config = self.load_config()
        return config.get("baidu_translate", self.default_config["baidu_translate"])

    def get_llm_config(self):
        """获取LLM配置"""
        config = self.load_config()
        llm_config = config.get("llm", self.default_config["llm"])

        # 构建前端友好的配置格式
        current_provider = llm_config.get("current_provider", "zhipu")
        provider_config = llm_config.get("providers", {}).get(current_provider, {})

        return {
            "provider": current_provider,
            "model": provider_config.get("model", ""),
            "base_url": provider_config.get("base_url", ""),
            "api_key": provider_config.get("api_key", ""),
            "temperature": provider_config.get("temperature", 0.7),
            "max_tokens": provider_config.get("max_tokens", 1000),
            "top_p": provider_config.get("top_p", 0.9),
            "providers": llm_config.get("providers", {})
        }

    def get_vision_config(self):
        """获取视觉模型配置"""
        config = self.load_config()
        vision_config = config.get("vlm", self.default_config["vlm"])

        # 构建前端友好的配置格式
        current_provider = vision_config.get("current_provider", "zhipu")
        provider_config = vision_config.get("providers", {}).get(current_provider, {})

        return {
            "provider": current_provider,
            "model": provider_config.get("model", ""),
            "base_url": provider_config.get("base_url", ""),
            "api_key": provider_config.get("api_key", ""),
            "temperature": provider_config.get("temperature", 0.7),
            "max_tokens": provider_config.get("max_tokens", 500),
            "top_p": provider_config.get("top_p", 0.9),
            "providers": vision_config.get("providers", {})
        }

    def get_settings(self):
        """获取ComfyUI用户设置（从设置文件读取）"""
        try:
            # ComfyUI的设置文件通常位于 user/default/comfy.settings.json
            # 需要找到ComfyUI的根目录
            import sys
            
            # 尝试从多个可能的路径查找设置文件
            possible_paths = []
            
            # 方法1: 通过当前文件路径向上查找
            current_dir = os.path.dirname(os.path.abspath(__file__))
            # custom_nodes/comfyui_prompt_assistant -> custom_nodes -> ComfyUI
            comfyui_root = os.path.dirname(os.path.dirname(current_dir))
            possible_paths.append(os.path.join(comfyui_root, "user", "default", "comfy.settings.json"))
            
            # 方法2: 通过sys.path查找
            for path in sys.path:
                if 'ComfyUI' in path:
                    possible_paths.append(os.path.join(path, "user", "default", "comfy.settings.json"))
            
            # 尝试读取设置文件
            for settings_path in possible_paths:
                if os.path.exists(settings_path):
                    try:
                        with open(settings_path, 'r', encoding='utf-8') as f:
                            settings_data = json.load(f)
                            # 返回设置数据
                            return settings_data
                    except Exception as e:
                        self._log(f"读取设置文件失败: {settings_path}, 错误: {str(e)}")
                        continue
            
            # 如果都找不到，返回空字典
            return {}
            
        except Exception as e:
            # 如果无法获取，返回空字典
            self._log(f"获取用户设置失败: {str(e)}")
            return {}

    def update_baidu_translate_config(self, app_id=None, secret_key=None):
        """更新百度翻译配置"""
        config = self.load_config()
        if "baidu_translate" not in config:
            config["baidu_translate"] = {}

        # 仅更新提供的参数
        if app_id is not None:
            config["baidu_translate"]["app_id"] = app_id
        if secret_key is not None:
            config["baidu_translate"]["secret_key"] = secret_key

        return self.save_config(config)

    def update_llm_config(self, provider=None, model=None, base_url=None, api_key=None, temperature=None, max_tokens=None, top_p=None, auto_unload=None, update_current=True):
        """更新LLM配置"""
        config = self.load_config()
        if "llm" not in config:
            config["llm"] = {"providers": {}}
        if "providers" not in config["llm"]:
            config["llm"]["providers"] = {}

        # 仅更新提供的参数
        if provider is not None:
            # 只有当update_current为True时才更新current_provider
            if update_current:
                config["llm"]["current_provider"] = provider

            # 确保provider存在于providers字典中
            if provider not in config["llm"]["providers"]:
                config["llm"]["providers"][provider] = {
                    "model": self.default_config["llm"]["providers"].get(provider, {}).get("model", ""),
                    "base_url": self.default_config["llm"]["providers"].get(provider, {}).get("base_url", ""),
                    "api_key": "",
                    "temperature": self.default_config["llm"]["providers"].get(provider, {}).get("temperature", 0.7),
                    "max_tokens": self.default_config["llm"]["providers"].get(provider, {}).get("max_tokens", 1000),
                    "top_p": self.default_config["llm"]["providers"].get(provider, {}).get("top_p", 0.9)
                }

        # 只有在同时提供provider和其他参数时才更新这些参数
        if provider is not None and model is not None:
            config["llm"]["providers"][provider]["model"] = model
        if provider is not None and base_url is not None:
            config["llm"]["providers"][provider]["base_url"] = base_url
        if provider is not None and api_key is not None:
            config["llm"]["providers"][provider]["api_key"] = api_key
        if provider is not None and temperature is not None:
            config["llm"]["providers"][provider]["temperature"] = temperature
        if provider is not None and max_tokens is not None:
            config["llm"]["providers"][provider]["max_tokens"] = max_tokens
        if provider is not None and top_p is not None:
            config["llm"]["providers"][provider]["top_p"] = top_p
        if provider is not None and auto_unload is not None:
            config["llm"]["providers"][provider]["auto_unload"] = auto_unload

        return self.save_config(config)

    def update_vision_config(self, provider=None, model=None, base_url=None, api_key=None, temperature=None, max_tokens=None, top_p=None, auto_unload=None, update_current=True):
        """更新视觉模型配置"""
        config = self.load_config()
        if "vlm" not in config:
            config["vlm"] = {"providers": {}}
        if "providers" not in config["vlm"]:
            config["vlm"]["providers"] = {}

        # 仅更新提供的参数
        if provider is not None:
            # 只有当update_current为True时才更新current_provider
            if update_current:
                config["vlm"]["current_provider"] = provider

            # 确保provider存在于providers字典中
            if provider not in config["vlm"]["providers"]:
                config["vlm"]["providers"][provider] = {
                    "model": self.default_config["vlm"]["providers"].get(provider, {}).get("model", ""),
                    "base_url": self.default_config["vlm"]["providers"].get(provider, {}).get("base_url", ""),
                    "api_key": "",
                    "temperature": self.default_config["vlm"]["providers"].get(provider, {}).get("temperature", 0.7),
                    "max_tokens": self.default_config["vlm"]["providers"].get(provider, {}).get("max_tokens", 500),
                    "top_p": self.default_config["vlm"]["providers"].get(provider, {}).get("top_p", 0.9)
                }

        # 只有在同时提供provider和其他参数时才更新这些参数
        if provider is not None and model is not None:
            config["vlm"]["providers"][provider]["model"] = model
        if provider is not None and base_url is not None:
            config["vlm"]["providers"][provider]["base_url"] = base_url
        if provider is not None and api_key is not None:
            config["vlm"]["providers"][provider]["api_key"] = api_key
        if provider is not None and temperature is not None:
            config["vlm"]["providers"][provider]["temperature"] = temperature
        if provider is not None and max_tokens is not None:
            config["vlm"]["providers"][provider]["max_tokens"] = max_tokens
        if provider is not None and top_p is not None:
            config["vlm"]["providers"][provider]["top_p"] = top_p
        if provider is not None and auto_unload is not None:
            config["vlm"]["providers"][provider]["auto_unload"] = auto_unload

        return self.save_config(config)
    def validate_and_fix_system_prompts(self):
        """验证并补全系统提示词配置，按默认项补齐缺失项（不覆盖用户自定义）"""
        try:
            system_prompts = self.load_system_prompts()
            need_update = False

            # 逐类检查：扩写/翻译/反推
            for prompt_type, default_prompts in self.default_system_prompts.items():
                # 确保类型存在且为字典
                if prompt_type not in system_prompts or not isinstance(system_prompts[prompt_type], dict):
                    system_prompts[prompt_type] = {}
                    need_update = True
                    self._log(f"提示词类型缺失或格式不正确，已初始化: {prompt_type}")

                # 按默认清单补齐缺失项，并为已存在项补齐缺失字段
                for prompt_id, default_def in default_prompts.items():
                    if prompt_id not in system_prompts[prompt_type]:
                        system_prompts[prompt_type][prompt_id] = default_def
                        need_update = True
                        self._log(f"为 {prompt_type} 补充默认提示词: {prompt_id}")
                    else:
                        # 补齐缺失字段（如 name/role/content 等），不覆盖用户已有内容
                        for key in default_def.keys():
                            if key not in system_prompts[prompt_type][prompt_id]:
                                system_prompts[prompt_type][prompt_id][key] = default_def[key]
                                need_update = True
                                self._log(f"为提示词 {prompt_id} 补齐字段: {key}")

            if need_update:
                self.save_system_prompts(system_prompts)
                self._log("已完成系统提示词配置的验证和补全")
        except Exception as e:
            self._log(f"验证和补全系统提示词配置时出错: {str(e)}")


    def validate_and_fix_active_prompts(self):
        """验证激活提示词是否存在，如果不存在则修复"""
        try:
            # 加载当前的系统提示词和激活提示词
            system_prompts = self.load_system_prompts()
            active_prompts = self.load_active_prompts()

            # 标记是否需要更新系统提示词
            need_update_system = False
            # 标记是否需要更新激活提示词
            need_update_active = False

            # 检查系统提示词类型是否为空，如果为空则从默认配置中恢复
            prompt_types = {
                "expand_prompts": "扩写提示词",
                "translate_prompts": "翻译提示词",
                "vision_prompts": "反推提示词"
            }

            for prompt_type, type_name in prompt_types.items():
                if prompt_type not in system_prompts or not system_prompts[prompt_type]:
                    self._log(f"警告：{type_name}类型为空，从默认配置中恢复...")
                    system_prompts[prompt_type] = self.default_system_prompts[prompt_type]
                    need_update_system = True

            # 特别检查vision_prompts中是否包含中文和英文反推提示词
            if "vision_prompts" in system_prompts:
                # 检查是否有中文反推提示词
                has_zh_vision = False
                for key in system_prompts["vision_prompts"].keys():
                    if key.startswith("vision_zh_"):
                        has_zh_vision = True
                        break

                if not has_zh_vision:
                    self._log("警告：系统提示词中没有中文反推提示词，从默认配置中恢复...")
                    # 从默认配置中恢复所有中文反推提示词
                    for key, value in self.default_system_prompts["vision_prompts"].items():
                        if key.startswith("vision_zh_"):
                            system_prompts["vision_prompts"][key] = value
                            need_update_system = True

                # 检查是否有英文反推提示词
                has_en_vision = False
                for key in system_prompts["vision_prompts"].keys():
                    if key.startswith("vision_en_"):
                        has_en_vision = True
                        break

                if not has_en_vision:
                    self._log("警告：系统提示词中没有英文反推提示词，从默认配置中恢复...")
                    # 从默认配置中恢复所有英文反推提示词
                    for key, value in self.default_system_prompts["vision_prompts"].items():
                        if key.startswith("vision_en_"):
                            system_prompts["vision_prompts"][key] = value
                            need_update_system = True

            # 如果需要更新系统提示词，保存修复后的系统提示词
            if need_update_system:
                self.save_system_prompts(system_prompts)
                self._log("已恢复缺失的提示词类型")

            # 检查并修复扩写提示词
            if "expand" in active_prompts:
                expand_id = active_prompts["expand"]
                if expand_id not in system_prompts.get("expand_prompts", {}):
                    self._log(f"警告：激活的扩写提示词 {expand_id} 不存在，尝试修复...")
                    # 尝试获取第一个可用的扩写提示词
                    expand_prompts = system_prompts.get("expand_prompts", {})
                    if expand_prompts:
                        first_expand_id = next(iter(expand_prompts))
                        active_prompts["expand"] = first_expand_id
                        self._log(f"已将激活的扩写提示词修复为 {first_expand_id}")
                        need_update_active = True
                    else:
                        # 如果没有可用的扩写提示词，使用默认值并确保它存在于系统提示词中
                        default_expand_id = "expand_扩写-自然语言"
                        active_prompts["expand"] = default_expand_id

                        # 确保默认值存在于系统提示词中
                        if default_expand_id not in system_prompts.get("expand_prompts", {}):
                            if "expand_prompts" not in system_prompts:
                                system_prompts["expand_prompts"] = {}
                            system_prompts["expand_prompts"][default_expand_id] = self.default_system_prompts["expand_prompts"][default_expand_id]
                            need_update_system = True

                        self._log("未找到可用的扩写提示词，使用默认值并确保它存在于系统提示词中")
                        need_update_active = True

            # 检查并修复中文反推提示词
            if "vision_zh" in active_prompts:
                vision_zh_id = active_prompts["vision_zh"]
                if vision_zh_id not in system_prompts.get("vision_prompts", {}):
                    self._log(f"警告：激活的中文反推提示词 {vision_zh_id} 不存在，尝试修复...")
                    # 尝试获取第一个可用的中文反推提示词
                    vision_prompts = {k: v for k, v in system_prompts.get("vision_prompts", {}).items() if k.startswith("vision_zh_")}
                    if vision_prompts:
                        first_vision_zh_id = next(iter(vision_prompts))
                        active_prompts["vision_zh"] = first_vision_zh_id
                        self._log(f"已将激活的中文反推提示词修复为 {first_vision_zh_id}")
                        need_update_active = True
                    else:
                        # 如果没有可用的中文反推提示词，使用默认值并确保它存在于系统提示词中
                        default_vision_zh_id = "vision_zh_全图反推(中文)"
                        active_prompts["vision_zh"] = default_vision_zh_id

                        # 确保默认值存在于系统提示词中
                        if default_vision_zh_id not in system_prompts.get("vision_prompts", {}):
                            if "vision_prompts" not in system_prompts:
                                system_prompts["vision_prompts"] = {}
                            system_prompts["vision_prompts"][default_vision_zh_id] = self.default_system_prompts["vision_prompts"][default_vision_zh_id]
                            need_update_system = True

                        self._log("未找到可用的中文反推提示词，使用默认值并确保它存在于系统提示词中")
                        need_update_active = True

            # 检查并修复英文反推提示词
            if "vision_en" in active_prompts:
                vision_en_id = active_prompts["vision_en"]
                if vision_en_id not in system_prompts.get("vision_prompts", {}):
                    self._log(f"警告：激活的英文反推提示词 {vision_en_id} 不存在，尝试修复...")
                    # 尝试获取第一个可用的英文反推提示词
                    vision_prompts = {k: v for k, v in system_prompts.get("vision_prompts", {}).items() if k.startswith("vision_en_")}
                    if vision_prompts:
                        first_vision_en_id = next(iter(vision_prompts))
                        active_prompts["vision_en"] = first_vision_en_id
                        self._log(f"已将激活的英文反推提示词修复为 {first_vision_en_id}")
                        need_update_active = True
                    else:
                        # 如果没有可用的英文反推提示词，使用默认值并确保它存在于系统提示词中
                        default_vision_en_id = "vision_en_全图反推(英文)"
                        active_prompts["vision_en"] = default_vision_en_id

                        # 确保默认值存在于系统提示词中
                        if default_vision_en_id not in system_prompts.get("vision_prompts", {}):
                            if "vision_prompts" not in system_prompts:
                                system_prompts["vision_prompts"] = {}
                            system_prompts["vision_prompts"][default_vision_en_id] = self.default_system_prompts["vision_prompts"][default_vision_en_id]
                            need_update_system = True

                        self._log("未找到可用的英文反推提示词，使用默认值并确保它存在于系统提示词中")
                        need_update_active = True

            # 如果需要更新系统提示词，保存修复后的系统提示词
            if need_update_system:
                self.save_system_prompts(system_prompts)
                self._log("已完成系统提示词的验证和修复")

            # 如果需要更新，保存修复后的激活提示词
            if need_update_active:
                self.save_active_prompts(active_prompts)
                self._log("已完成激活提示词的验证和修复")

            # 如果系统提示词或激活提示词有更新，重新加载一次确保一致性
            if need_update_system or need_update_active:
                # 重新加载系统提示词和激活提示词
                system_prompts = self.load_system_prompts()
                active_prompts = self.load_active_prompts()
                self._log("已重新加载提示词配置")

        except Exception as e:
            self._log(f"验证和修复激活提示词时出错: {str(e)}")

    def validate_and_fix_model_params(self):
        """验证并修复模型参数配置，确保所有提供商都包含必要的参数"""
        try:
            # 加载当前配置
            config = self.load_config()
            need_update = False

            # 检查LLM配置，并补全新增提供商
            if "llm" in config:
                if "providers" not in config["llm"]:
                    config["llm"]["providers"] = {}
                    need_update = True
                # 新增提供商预设
                for p in ["302ai", "ollama"]:
                    if p not in config["llm"]["providers"]:
                        config["llm"]["providers"][p] = self.default_config["llm"]["providers"][p]
                        need_update = True
                        self._log(f"为LLM添加默认提供商: {p}")
                for provider_name, provider_config in config["llm"]["providers"].items():
                    # 检查并添加缺失的temperature参数
                    if "temperature" not in provider_config:
                        provider_config["temperature"] = 0.7
                        need_update = True
                        self._log(f"为LLM提供商 {provider_name} 添加默认temperature参数: 0.7")

                    # 检查并添加缺失的max_tokens参数
                    if "max_tokens" not in provider_config:
                        provider_config["max_tokens"] = 1000
                        need_update = True
                        self._log(f"为LLM提供商 {provider_name} 添加默认max_tokens参数: 1000")

                    # 检查并添加缺失的top_p参数
                    if "top_p" not in provider_config:
                        provider_config["top_p"] = 0.9
                        need_update = True
                        self._log(f"为LLM提供商 {provider_name} 添加默认top_p参数: 0.9")

                    # 检查并添加缺失的auto_unload参数（仅Ollama）
                    if provider_name == "ollama" and "auto_unload" not in provider_config:
                        provider_config["auto_unload"] = True
                        need_update = True
                        self._log(f"为LLM提供商 {provider_name} 添加默认auto_unload参数: True")

            # 检查视觉模型配置，并补全新增提供商
            if "vlm" in config:
                if "providers" not in config["vlm"]:
                    config["vlm"]["providers"] = {}
                    need_update = True
                # 新增提供商预设
                for p in ["302ai", "ollama"]:
                    if p not in config["vlm"]["providers"]:
                        config["vlm"]["providers"][p] = self.default_config["vlm"]["providers"][p]
                        need_update = True
                        self._log(f"为视觉模型添加默认提供商: {p}")
                for provider_name, provider_config in config["vlm"]["providers"].items():
                    # 检查并添加缺失的temperature参数
                    if "temperature" not in provider_config:
                        provider_config["temperature"] = 0.7
                        need_update = True
                        self._log(f"为视觉模型提供商 {provider_name} 添加默认temperature参数: 0.7")

                    # 检查并添加缺失的max_tokens参数
                    if "max_tokens" not in provider_config:
                        provider_config["max_tokens"] = 500
                        need_update = True
                        self._log(f"为视觉模型提供商 {provider_name} 添加默认max_tokens参数: 500")

                    # 检查并添加缺失的top_p参数
                    if "top_p" not in provider_config:
                        provider_config["top_p"] = 0.9
                        need_update = True
                        self._log(f"为视觉模型提供商 {provider_name} 添加默认top_p参数: 0.9")

                    # 检查并添加缺失的auto_unload参数（仅Ollama）
                    if provider_name == "ollama" and "auto_unload" not in provider_config:
                        provider_config["auto_unload"] = True
                        need_update = True
                        self._log(f"为视觉模型提供商 {provider_name} 添加默认auto_unload参数: True")

            # 如果有更新，保存配置
            if need_update:
                self.save_config(config)
                self._log("已完成模型参数配置的验证和修复")

        except Exception as e:
            self._log(f"验证和修复模型参数时出错: {str(e)}")

# 创建全局配置管理器实例
config_manager = ConfigManager()