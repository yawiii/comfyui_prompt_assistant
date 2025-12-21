/**
 * 视频抽帧工具节点扩展
 * 提供视频手动抽帧、预览和帧索引生成功能
 */

import { app } from "../../../../scripts/app.js";
import { api } from "../../../../scripts/api.js";
import { createSettingsDialog, createInputGroup, createTooltip, createConfirmPopup } from "../modules/uiComponents.js";
import { APIService } from "../services/api.js";

// 引入专用样式文件（保留用于视频播放器特定的布局样式）
const link = document.createElement("link");
link.rel = "stylesheet";
link.type = "text/css";
link.href = new URL("../css/captionFrame.css", import.meta.url).href;
document.head.appendChild(link);

// 弹窗状态跟踪（防止重复打开）
let isDialogOpen = false;

app.registerExtension({
    name: "ComfyUI.PromptAssistant.CaptionFrame",

    /**
     * 节点定义注册前的钩子
     * @param {Object} nodeType 节点类型定义
     * @param {Object} nodeData 节点数据
     */
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name === "VideoCaptionNode") {
            const onNodeCreated = nodeType.prototype.onNodeCreated;

            // --- 重写节点创建逻辑 ---
            nodeType.prototype.onNodeCreated = function () {
                if (onNodeCreated) {
                    onNodeCreated.apply(this, arguments);
                }

                const node = this;

                // 添加"选取反推帧"按钮
                // 初始状态下按钮可能隐藏，取决于"抽帧策略"
                const btnWidget = this.addWidget("button", "🎬选取反推帧", null, () => {
                    showFrameExtractionModal(node);
                });

                // 保存原始 computeSize 函数，用于动态隐藏/显示时的尺寸计算
                const origComputeSize = btnWidget.computeSize?.bind(btnWidget);

                // 确保按钮始终显示
                btnWidget.type = "button";
                btnWidget.computeSize = origComputeSize || (() => [0, 26]);
                btnWidget.hidden = false;

                // 仅重绘画布，不改变节点大小
                app.graph.setDirtyCanvas(true, false);
            };
        }
    }
});

/**
 * 显示视频抽帧工具弹窗
 * @param {Object} node 当前节点实例
 */
async function showFrameExtractionModal(node) {
    // 防止重复打开
    if (isDialogOpen) {
        return;
    }
    isDialogOpen = true;

    // 1. 获取连接的视频信息
    const videoInfo = await findConnectedVideo(node);

    if (!videoInfo) {
        isDialogOpen = false;
        alert("未检测到有效的视频输入连接。请确保节点已连接到 Load Video 节点。");
        return;
    }

    if (videoInfo.error) {
        isDialogOpen = false;
        alert(videoInfo.error);
        return;
    }

    // 2. 获取视频元数据（FPS、时长、总帧数）
    let initialFps = 30;
    let originalDuration = 0;
    let originalTotalFrames = 0;
    try {
        const response = await api.fetchApi(APIService.getDynamicApiBase() + '/video/info', {
            method: "POST",
            body: JSON.stringify({
                filename: videoInfo.filename,
                type: videoInfo.type
            })
        });
        const data = await response.json();
        if (data.success) {
            initialFps = data.fps || 30;
            originalDuration = data.duration || 0;
            originalTotalFrames = data.total_frames || 0;

            // 如果 total_frames 为 0（某些视频格式无法直接读取帧数），使用 fps * duration 计算
            if (originalTotalFrames === 0 && originalDuration > 0 && initialFps > 0) {
                originalTotalFrames = Math.floor(initialFps * originalDuration);
            }
        }
    } catch (e) {
        console.warn("[PromptAssistant] 获取视频信息失败, 将使用默认值:", e);
    }

    // 3. 计算实际使用的FPS（考虑force_rate参数）
    // force_rate > 0 时使用强制FPS，否则使用原始FPS
    const actualFps = (videoInfo.forceRate && videoInfo.forceRate > 0) ? videoInfo.forceRate : initialFps;

    // 4. 计算抽帧后的实际总帧数和持续时间
    // 如果使用了 force_rate，实际帧数 = 原始总帧数 * (force_rate / original_fps)
    let actualTotalFrames = originalTotalFrames;
    let actualDuration = originalDuration;

    // 有效性检查：确保帧数是有效的正整数
    if (!Number.isFinite(originalTotalFrames) || originalTotalFrames <= 0 || originalTotalFrames > 1e9) {
        // 如果帧数无效，尝试使用 duration * fps 计算
        if (originalDuration > 0 && initialFps > 0) {
            originalTotalFrames = Math.floor(originalDuration * initialFps);
            actualTotalFrames = originalTotalFrames;
        } else {
            // 最后的兜底值
            originalTotalFrames = 100;
            actualTotalFrames = 100;
        }
        console.warn('[PromptAssistant-CaptionFrame] 帧数无效，使用计算值:', originalTotalFrames);
    }

    if (videoInfo.forceRate && videoInfo.forceRate > 0 && initialFps > 0) {
        actualTotalFrames = Math.floor(originalTotalFrames * (videoInfo.forceRate / initialFps));
        actualDuration = actualTotalFrames / actualFps;
    }

    // 确保至少有1帧
    if (actualTotalFrames <= 0) {
        actualTotalFrames = 1;
    }

    console.log('[PromptAssistant-CaptionFrame] 视频元数据:', {
        originalFps: initialFps,
        originalDuration,
        originalTotalFrames,
        forceRate: videoInfo.forceRate,
        actualFps,
        actualTotalFrames,
        actualDuration
    });

    // 状态容器，用于在 renderContent 和 onSave 之间共享数据
    const state = {
        fps: actualFps,
        originalFps: initialFps,  // 保存原始FPS用于计算
        forceRate: videoInfo.forceRate || 0,  // 保存 force_rate 用于帧提取
        totalFrames: actualTotalFrames,  // 实际总帧数
        duration: actualDuration,  // 实际持续时间
        selectedFrames: new Set(),
        rangeStart: null,
        // 帧索引驱动相关状态
        currentFrameIndex: 0,  // 当前帧索引
        isLoading: false,  // 帧加载中标志
        frameCache: new Map(),  // 帧缓存 (frameIndex -> base64)
        filename: videoInfo.filename,  // 视频文件名
        widgets: {
            // 使用后端定义的英文 widget 名称
            manualIndex: node.widgets.find(w => w.name === "manual_indices"),
            strategy: node.widgets.find(w => w.name === "sampling_mode")
        }
    };

    // 初始化已选帧状态
    if (state.widgets.manualIndex?.value) {
        state.widgets.manualIndex.value.split(',').forEach(p => {
            p = p.trim();
            if (!p) return;
            if (p.includes('-')) state.selectedFrames.add(p);
            else {
                const n = parseInt(p);
                if (!isNaN(n)) state.selectedFrames.add(n);
            }
        });
    }

    // 3. 创建通用设置弹窗
    createSettingsDialog({
        title: '🎬 视频手动抽帧工具',
        saveButtonText: '确认应用',
        cancelButtonText: '取消',
        saveButtonIcon: 'pi-check',
        disableBackdropAndCloseOnClickOutside: true, // 不需要模态遮罩层，允许交互
        dialogClassName: 'caption-frame-dialog', // 自定义类名

        // 取消回调（跳过二次确认，直接关闭）
        onCancel: () => { },

        // 渲染弹窗内容
        renderContent: (contentContainer, header) => {
            // 注意：具体的 flex 布局和高度控制现在主要由 CSS 处理 (.caption-frame-dialog .p-dialog-content)

            // 构建界面
            renderVideoInterface(contentContainer, state, videoInfo, header);
        },

        // 保存回调
        onSave: () => {
            const sorted = Array.from(state.selectedFrames).sort((a, b) => {
                const getStart = v => typeof v === 'string' ? parseInt(v.split('-')[0]) : v;
                return getStart(a) - getStart(b);
            });

            if (state.widgets.manualIndex) {
                const newValue = sorted.join(",");
                state.widgets.manualIndex.value = newValue;

                // 触发 widget callback 确保值同步到节点
                if (state.widgets.manualIndex.callback) {
                    state.widgets.manualIndex.callback(newValue, app.graph, node, state.widgets.manualIndex);
                }

                // [Debug] 输出保存的值
                console.log('[PromptAssistant-CaptionFrame] 保存帧索引:', newValue);

                // 自动切换策略为手动
                if (state.widgets.strategy) {
                    state.widgets.strategy.value = "Manual (Indices)";

                    // 同样触发策略 widget 的 callback
                    if (state.widgets.strategy.callback) {
                        state.widgets.strategy.callback("Manual (Indices)", app.graph, node, state.widgets.strategy);
                    }
                }

                // 标记节点需要重新执行
                node.setDirtyCanvas(true, true);
                app.graph.setDirtyCanvas(true, true);
            }
        },

        // 关闭回调：清理资源
        onClose: () => {
            isDialogOpen = false;
            if (state.frameCache) {
                state.frameCache.clear();
            }
        }
    });
}

/**
 * 渲染视频操作界面
 * @param {HTMLElement} container 容器元素
 * @param {Object} state 状态对象
 * @param {Object} videoInfo 视频信息对象
 */
/**
 * 渲染视频操作界面
 * @param {HTMLElement} container 容器元素
 * @param {Object} state 状态对象
 * @param {Object} videoInfo 视频信息对象
 * @param {HTMLElement} [headerElement] 弹窗头部元素（可选）
 */
function renderVideoInterface(container, state, videoInfo, headerElement) {
    // --- 显示区域（混合模式：img 用于精确定位，video 用于流畅播放）---
    const frameContainer = document.createElement("div");
    frameContainer.className = "video-container frame-display-container";

    // 创建帧图片元素（用于精确定位模式）
    const frameImg = document.createElement("img");
    frameImg.id = "caption-frame-display";
    frameImg.className = "frame-display-img";
    frameImg.alt = "视频帧预览";

    // 创建视频元素（用于流畅播放模式，默认隐藏）
    const videoElement = document.createElement("video");
    videoElement.className = "frame-video-player";
    // 优化缓冲设置
    videoElement.preload = "auto";  // 尽可能多地预加载视频

    // 设置视频源
    if (videoInfo.fromLoadNode && state.fps !== state.originalFps) {
        const params = {
            filename: videoInfo.filename,
            type: videoInfo.type || "input",
            force_rate: state.fps,
            skip_first_frames: 0,
            select_every_nth: 1,
            frame_load_cap: 0,
            timestamp: Date.now()
        };
        videoElement.src = api.apiURL('/vhs/viewvideo?' + new URLSearchParams(params));
    } else {
        videoElement.src = videoInfo.url;
    }

    // 创建加载指示器
    const loadingIndicator = document.createElement("div");
    loadingIndicator.className = "frame-loading-indicator";
    loadingIndicator.innerHTML = '<span class="pi pi-spin pi-spinner"></span>';
    loadingIndicator.style.display = "none";

    // 缓冲状态事件监听 - 拖动到未缓冲位置时显示加载指示器
    videoElement.addEventListener("waiting", () => {
        loadingIndicator.style.display = "flex";
    });
    videoElement.addEventListener("canplay", () => {
        loadingIndicator.style.display = "none";
    });
    videoElement.addEventListener("canplaythrough", () => {
        loadingIndicator.style.display = "none";
    });

    frameContainer.appendChild(frameImg);
    frameContainer.appendChild(videoElement);
    frameContainer.appendChild(loadingIndicator);

    // 初始状态：显示视频，隐藏图片（video 预览模式）
    frameImg.style.display = "none";
    videoElement.style.display = "block";

    // 切换到图片模式
    const switchToImageMode = async (frameIndex) => {
        videoElement.style.display = "none";
        frameImg.style.display = "block";
        await loadFrame(frameIndex);
    };

    // 切换到视频播放模式
    const switchToVideoMode = (startFromFrame) => {
        // 同步视频进度到当前帧位置
        const targetTime = startFromFrame / state.fps;
        videoElement.currentTime = targetTime;
        frameImg.style.display = "none";
        videoElement.style.display = "block";
        videoElement.play();
    };

    // --- 帧加载函数 ---
    const loadFrame = async (frameIndex) => {
        if (state.isLoading) return;

        // 边界检查
        frameIndex = Math.max(0, Math.min(state.totalFrames - 1, frameIndex));
        state.currentFrameIndex = frameIndex;

        // 检查缓存
        if (state.frameCache.has(frameIndex)) {
            frameImg.src = `data:image/jpeg;base64,${state.frameCache.get(frameIndex)}`;
            updateDisplay();
            return;
        }

        // 显示加载指示器
        state.isLoading = true;
        loadingIndicator.style.display = "flex";

        try {
            const response = await api.fetchApi(APIService.getDynamicApiBase() + '/video/frame', {
                method: "POST",
                body: JSON.stringify({
                    filename: state.filename,
                    frame_index: frameIndex,
                    force_rate: state.forceRate
                })
            });
            const data = await response.json();

            if (data.success && data.data) {
                // 缓存帧数据
                state.frameCache.set(frameIndex, data.data);
                frameImg.src = `data:image/jpeg;base64,${data.data}`;

                // 预加载相邻帧（提升体验）
                preloadAdjacentFrames(frameIndex);
            } else {
                console.error("[PromptAssistant-CaptionFrame] 帧加载失败:", data.error);
            }
        } catch (e) {
            console.error("[PromptAssistant-CaptionFrame] 帧加载异常:", e);
        } finally {
            state.isLoading = false;
            loadingIndicator.style.display = "none";
            updateDisplay();
        }
    };

    // --- 预加载相邻帧（提升体验）---
    const preloadAdjacentFrames = async (centerIndex) => {
        const preloadRange = 2; // 预加载前后2帧
        for (let offset = 1; offset <= preloadRange; offset++) {
            const indices = [centerIndex - offset, centerIndex + offset];
            for (const idx of indices) {
                if (idx >= 0 && idx < state.totalFrames && !state.frameCache.has(idx)) {
                    // 异步预加载，不阻塞
                    api.fetchApi(APIService.getDynamicApiBase() + '/video/frame', {
                        method: "POST",
                        body: JSON.stringify({
                            filename: state.filename,
                            frame_index: idx,
                            force_rate: state.forceRate
                        })
                    }).then(res => res.json()).then(data => {
                        if (data.success && data.data) {
                            state.frameCache.set(idx, data.data);
                        }
                    }).catch(() => { }); // 静默忽略预加载失败
                }
            }
        }
    };

    // --- 信息移动到标题栏 ---
    let headerTimeSpan = null;
    let headerFrameSpan = null;

    if (headerElement) {
        // 创建标题栏信息容器（样式在 captionFrame.css 中定义）
        const infoContainer = document.createElement("div");
        infoContainer.className = "video-header-info";

        // 构建两行信息HTML
        infoContainer.innerHTML = `
            <div class="info-row"><span id="header-time">00:00.00/00:00.00</span></div>
            <div class="info-row"><span id="header-frame">0/${state.totalFrames}</span>&nbsp;${state.fps}fps</div>
        `;

        // 插入到关闭按钮之前
        const icons = headerElement.querySelector('.p-dialog-header-icons');
        if (icons) {
            headerElement.insertBefore(infoContainer, icons);
        } else {
            headerElement.appendChild(infoContainer);
        }

        headerTimeSpan = infoContainer.querySelector("#header-time");
        headerFrameSpan = infoContainer.querySelector("#header-frame");
    }

    container.appendChild(frameContainer);

    // --- 统一时间轴组件（合并进度条滑块和标记轨道）---
    const timelineContainer = document.createElement("div");
    timelineContainer.className = "unified-timeline-container";

    // 标记轨道层（底层，用于显示帧标记）
    const markerTrack = document.createElement("div");
    markerTrack.className = "frame-marker-track";
    timelineContainer.appendChild(markerTrack);

    // 自定义滑块层（顶层）
    const sliderThumb = document.createElement("div");
    sliderThumb.className = "timeline-slider-thumb";
    timelineContainer.appendChild(sliderThumb);

    container.appendChild(timelineContainer);

    // 拖动时切换到 video 预览模式（流畅），松开后精确加载帧
    let isDraggingSlider = false;

    // 统一的帧索引到百分比转换函数（确保滑块和标记使用相同的计算方式）
    const frameToPercent = (frameIndex) => {
        const maxFrame = state.totalFrames - 1;
        if (maxFrame <= 0) return 0;
        return (frameIndex / maxFrame) * 100;
    };

    // 更新滑块位置的辅助函数
    const updateSliderPosition = (frameIndex) => {
        sliderThumb.style.left = `${frameToPercent(frameIndex)}%`;
    };

    // 根据鼠标位置计算帧索引
    const getFrameFromMousePosition = (clientX) => {
        const rect = timelineContainer.getBoundingClientRect();
        const offsetX = clientX - rect.left;
        const percent = Math.max(0, Math.min(1, offsetX / rect.width));
        return Math.round(percent * (state.totalFrames - 1));
    };

    // 滑块拖动事件
    sliderThumb.addEventListener("mousedown", (e) => {
        e.preventDefault();
        isDraggingSlider = true;
        sliderThumb.classList.add("dragging");
        // 切换到 video 预览模式
        frameImg.style.display = "none";
        videoElement.style.display = "block";
        loadingIndicator.style.display = "none";

        const onMouseMove = (moveEvent) => {
            if (!isDraggingSlider) return;
            const targetFrame = getFrameFromMousePosition(moveEvent.clientX);
            state.currentFrameIndex = targetFrame;
            videoElement.currentTime = targetFrame / state.fps;
            updateSliderPosition(targetFrame);
            updateDisplay();
        };

        const onMouseUp = () => {
            isDraggingSlider = false;
            sliderThumb.classList.remove("dragging");
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    });

    // 时间轴点击跳转
    timelineContainer.addEventListener("click", (e) => {
        // 如果点击的是滑块本身或标记元素，不处理
        if (e.target === sliderThumb || e.target.closest('.frame-marker, .frame-marker-range, .frame-marker-temp')) {
            return;
        }
        const targetFrame = getFrameFromMousePosition(e.clientX);
        state.currentFrameIndex = targetFrame;
        videoElement.currentTime = targetFrame / state.fps;
        updateSliderPosition(targetFrame);
        updateDisplay();
    });

    // --- 控制区域 ---
    const controlsContainer = document.createElement("div");
    controlsContainer.className = "controls-container";
    container.appendChild(controlsContainer);

    // 辅助函数：创建按钮
    // 返回 { btn: HTMLElement, iconSpan: HTMLElement }
    const createBtn = (text, iconClass, onClick, type = 'secondary', iconPos = 'left') => {
        const btn = document.createElement("button");
        // 复用 PrimeVue 按钮样式
        btn.className = `p-button p-component p-button-${type} p-button-sm`;

        // 仅图标按钮处理
        const isIconOnly = !text && iconClass;
        if (isIconOnly) {
            btn.classList.add("p-button-icon-only");
        }

        let iconSpan = null;
        if (iconClass) {
            iconSpan = document.createElement("span");
            // 仅图标时不需要 left/right 定位类
            iconSpan.className = isIconOnly
                ? `p-button-icon pi ${iconClass}`
                : `p-button-icon-${iconPos} pi ${iconClass}`;
            btn.appendChild(iconSpan);
        }

        // 有文字时才添加 label
        if (text) {
            const labelSpan = document.createElement("span");
            labelSpan.className = "p-button-label";
            labelSpan.textContent = text;

            if (iconPos === 'right' && iconSpan) {
                // 图标在右时，需要先移除再重新排列
                btn.removeChild(iconSpan);
                btn.appendChild(labelSpan);
                btn.appendChild(iconSpan);
            } else {
                btn.appendChild(labelSpan);
            }
        }

        btn.onclick = onClick;
        btn.style.marginRight = "5px";
        return { btn, iconSpan };
    };

    // 2. 播放控制按钮组 (左侧)
    const playbackControls = document.createElement("div");
    playbackControls.className = "playback-controls";
    playbackControls.style.marginTop = "0";

    // 长按连续跳帧辅助函数
    // @param {HTMLElement} btn 按钮元素
    // @param {Function} action 跳帧操作函数
    const setupLongPressFrame = (btn, action) => {
        let pressTimer = null; // 长按延迟定时器
        let intervalTimer = null; // 连续触发定时器

        const startPress = () => {
            // 立即执行一次跳帧
            action();

            // 设置延迟后开始连续跳帧
            pressTimer = setTimeout(() => {
                intervalTimer = setInterval(() => {
                    action();
                }, 50); // 每200ms跳一帧
            }, 500); // 500ms后开始连续跳帧
        };

        const endPress = () => {
            if (pressTimer) {
                clearTimeout(pressTimer);
                pressTimer = null;
            }
            if (intervalTimer) {
                clearInterval(intervalTimer);
                intervalTimer = null;
            }
        };

        btn.addEventListener('mousedown', startPress);
        btn.addEventListener('mouseup', endPress);
        btn.addEventListener('mouseleave', endPress);
    };

    // 上一帧按钮（使用 video.currentTime 快速预览）
    const prevFrameBtn = createBtn("上一帧", "pi-caret-left", null).btn;
    setupLongPressFrame(prevFrameBtn, () => {
        stopPlayback(); // 停止播放
        if (state.currentFrameIndex > 0) {
            state.currentFrameIndex--;
            videoElement.currentTime = state.currentFrameIndex / state.fps;
            updateDisplay();
        }
    });
    playbackControls.appendChild(prevFrameBtn);

    // --- 播放/暂停功能（使用 video 元素流畅播放）---
    let isPlaying = false;
    let animationFrameId = null;  // 用于取消动画帧

    const playBtnObj = createBtn("播放", "pi-play", () => {
        if (isPlaying) {
            stopPlayback();
        } else {
            startPlayback();
        }
    });
    playbackControls.appendChild(playBtnObj.btn);

    // 使用 requestAnimationFrame 实现流畅的滑块更新
    const updatePlaybackProgress = () => {
        if (!isPlaying) return;

        // 使用 video.currentTime 计算连续的进度（而非离散帧索引）
        const currentTime = videoElement.currentTime;
        const duration = state.duration;

        // 直接使用时间比例计算滑块位置，实现平滑移动
        if (duration > 0) {
            const percent = Math.min(100, (currentTime / duration) * 100);
            sliderThumb.style.left = `${percent}%`;
        }

        // 同时更新帧索引（用于显示）
        const currentFrame = Math.floor(currentTime * state.fps);
        state.currentFrameIndex = Math.max(0, Math.min(state.totalFrames - 1, currentFrame));

        // 更新头部信息显示
        const formatTime = (s) => {
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            const ms = Math.floor((s % 1) * 100);
            return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
        };
        if (headerTimeSpan) headerTimeSpan.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
        if (headerFrameSpan) headerFrameSpan.textContent = `${state.currentFrameIndex} / ${state.totalFrames}`;

        // 继续下一帧动画
        animationFrameId = requestAnimationFrame(updatePlaybackProgress);
    };

    const startPlayback = () => {
        if (isPlaying) return;
        isPlaying = true;

        // 切换到视频播放模式
        switchToVideoMode(state.currentFrameIndex);

        // 启动流畅动画更新
        animationFrameId = requestAnimationFrame(updatePlaybackProgress);

        // 更新按钮图标
        if (playBtnObj.iconSpan) {
            playBtnObj.iconSpan.classList.remove("pi-play");
            playBtnObj.iconSpan.classList.add("pi-pause");
        }
    };

    const stopPlayback = () => {
        if (!isPlaying) return;
        isPlaying = false;

        // 取消动画帧
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }

        // 暂停视频(不自动抓取精确帧，继续显示 video)
        videoElement.pause();

        // 同步帧索引并更新显示
        const currentFrameFromVideo = Math.floor(videoElement.currentTime * state.fps);
        state.currentFrameIndex = Math.max(0, Math.min(state.totalFrames - 1, currentFrameFromVideo));
        updateDisplay();

        // 更新按钮图标
        if (playBtnObj.iconSpan) {
            playBtnObj.iconSpan.classList.remove("pi-pause");
            playBtnObj.iconSpan.classList.add("pi-play");
        }
    };

    // 视频播放结束时自动停止(保持 video 显示，不切换到 img)
    videoElement.addEventListener("ended", () => {
        isPlaying = false;
        if (animationFrameId) {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = null;
        }
        state.currentFrameIndex = state.totalFrames - 1;
        updateDisplay();
        if (playBtnObj.iconSpan) {
            playBtnObj.iconSpan.classList.remove("pi-pause");
            playBtnObj.iconSpan.classList.add("pi-play");
        }
    });

    // 下一帧按钮（使用 video.currentTime 快速预览）
    const nextFrameBtn = createBtn("下一帧", "pi-caret-right", null).btn;
    setupLongPressFrame(nextFrameBtn, () => {
        stopPlayback(); // 停止播放
        if (state.currentFrameIndex < state.totalFrames - 1) {
            state.currentFrameIndex++;
            videoElement.currentTime = state.currentFrameIndex / state.fps;
            updateDisplay();
        }
    });
    playbackControls.appendChild(nextFrameBtn);

    // 静音切换按钮
    const muteBtnObj = createBtn("", "pi-volume-up", () => {
        videoElement.muted = !videoElement.muted;
        // 切换图标
        if (muteBtnObj.iconSpan) {
            if (videoElement.muted) {
                muteBtnObj.iconSpan.classList.remove("pi-volume-up");
                muteBtnObj.iconSpan.classList.add("pi-volume-off");
            } else {
                muteBtnObj.iconSpan.classList.remove("pi-volume-off");
                muteBtnObj.iconSpan.classList.add("pi-volume-up");
            }
        }
    });
    playbackControls.appendChild(muteBtnObj.btn);

    // 3. 标记控制按钮组 (右侧)
    const markerControls = document.createElement("div");
    markerControls.className = "playback-controls";
    markerControls.style.marginTop = "0";
    markerControls.style.display = "flex";
    markerControls.style.gap = "8px";

    markerControls.appendChild(createBtn("标记当前帧", "pi-thumbtack", () => {
        state.selectedFrames.add(state.currentFrameIndex);
        renderTags();
    }, "primary").btn);

    markerControls.appendChild(createBtn("范围", "pi-step-backward-alt", () => {
        state.rangeStart = state.currentFrameIndex;
        // 在轨道上显示临时闪烁标记
        renderRangeStartMarker();
    }, "success").btn);

    markerControls.appendChild(createBtn("范围", "pi-step-forward-alt", (e) => {
        if (state.rangeStart === null) {
            // 使用气泡对话框提示用户
            const button = e.target.closest('button');
            createConfirmPopup({
                target: button,
                message: '请先设置起点',
                icon: 'pi-info-circle',
                singleButton: true,
                confirmLabel: '确定',
                position: 'top',
                onConfirm: () => { }
            });
            return;
        }
        const rangeEnd = state.currentFrameIndex;
        if (rangeEnd < state.rangeStart) {
            // 使用气泡对话框提示用户
            const button = e.target.closest('button');
            createConfirmPopup({
                target: button,
                message: '终点必须大于起点',
                icon: 'pi-exclamation-triangle',
                singleButton: true,
                confirmLabel: '确定',
                position: 'top',
                onConfirm: () => { }
            });
            return;
        }
        state.selectedFrames.add(`${state.rangeStart}-${rangeEnd}`);
        state.rangeStart = null;
        // 移除临时标记并渲染范围标记
        removeRangeStartMarker();
        renderTags();
    }, "success", "right").btn);

    controlsContainer.appendChild(playbackControls);
    controlsContainer.appendChild(markerControls);

    // --- 已选帧列表区域 ---
    const listContainer = document.createElement("div");
    listContainer.className = "frame-list-container";
    listContainer.style.marginTop = "0";

    const listHeader = document.createElement("div");
    listHeader.className = "frame-list-header";

    // 标签列表容器（左侧）
    const tagsList = document.createElement("div");
    tagsList.className = "frame-tags";
    listHeader.appendChild(tagsList);

    // 清空按钮（右侧）
    const clearBtnObj = createBtn("", "pi-eraser", () => {
        if (confirm("确定清空所有已选帧吗？")) {
            state.selectedFrames.clear();
            renderTags();
        }
    }, "danger");
    clearBtnObj.btn.style.padding = "6px 8px";
    listHeader.appendChild(clearBtnObj.btn);

    listContainer.appendChild(listHeader);
    container.appendChild(listContainer);

    // 添加 tooltip（需要在元素添加到 DOM 后）
    createTooltip({
        target: clearBtnObj.btn,
        content: "清空已选帧",
        position: "top"
    });

    // --- 事件绑定与逻辑 ---
    // --- 事件绑定与逻辑 ---
    // 获取引用以便更新 (优先使用 header 中的引用)


    // 更新显示函数（基于帧索引）
    const updateDisplay = () => {
        const currentFrame = state.currentFrameIndex;
        const totalFrames = state.totalFrames;
        // 根据帧索引计算当前时间
        const t = currentFrame / state.fps;
        const d = state.duration;

        // 格式化时间 MM:SS.ms
        const formatTime = (s) => {
            const m = Math.floor(s / 60);
            const sec = Math.floor(s % 60);
            const ms = Math.floor((s % 1) * 100);
            return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(2, '0')}`;
        };

        if (headerTimeSpan) headerTimeSpan.textContent = `${formatTime(t)} / ${formatTime(d)}`;
        if (headerFrameSpan) headerFrameSpan.textContent = `${currentFrame} / ${totalFrames}`;

        // 同步自定义滑块位置
        updateSliderPosition(currentFrame);
    };

    // --- 渲染范围起点临时标记 ---
    const renderRangeStartMarker = () => {
        // 先移除已有的临时标记
        removeRangeStartMarker();

        const totalFrames = state.totalFrames;
        if (totalFrames <= 0 || state.rangeStart === null) return;

        // 使用统一的帧到百分比转换函数
        const leftPercent = frameToPercent(state.rangeStart);
        const tempMarker = document.createElement("div");
        tempMarker.className = "frame-marker-temp";
        tempMarker.style.left = `${leftPercent}%`;
        tempMarker.dataset.frame = state.rangeStart;
        markerTrack.appendChild(tempMarker);

        // 添加 tooltip
        createTooltip({
            target: tempMarker,
            content: `范围起点: ${state.rangeStart}`,
            position: 'top'
        });
    };

    // --- 移除范围起点临时标记 ---
    const removeRangeStartMarker = () => {
        const tempMarker = markerTrack.querySelector(".frame-marker-temp");
        if (tempMarker) {
            tempMarker.remove();
        }
    };

    // --- 清理残留的 tooltip ---
    const clearTooltips = () => {
        document.querySelectorAll('.pa-tooltip').forEach(t => t.remove());
    };

    // --- 渲染帧标记轨道 ---
    const renderMarkers = () => {
        // 清理可能残留的 tooltip（拖动时元素被删除但 tooltip 未销毁）
        clearTooltips();
        markerTrack.innerHTML = "";
        const totalFrames = state.totalFrames;
        if (totalFrames <= 0) return;

        state.selectedFrames.forEach(item => {
            if (typeof item === 'string' && item.includes('-')) {
                // 范围标记（使用统一的帧到百分比转换）
                const [start, end] = item.split('-').map(Number);
                const leftPercent = frameToPercent(start);
                const rightPercent = frameToPercent(end);
                const widthPercent = rightPercent - leftPercent;

                const rangeEl = document.createElement("div");
                rangeEl.className = "frame-marker-range";
                rangeEl.style.left = `${leftPercent}%`;
                rangeEl.style.width = `${Math.max(widthPercent, 0.5)}%`;
                rangeEl.dataset.range = item;
                rangeEl.dataset.originalItem = item;

                // 创建左边缘手柄
                const leftHandle = document.createElement("div");
                leftHandle.className = "range-handle range-handle-left";
                rangeEl.appendChild(leftHandle);

                // 创建右边缘手柄
                const rightHandle = document.createElement("div");
                rightHandle.className = "range-handle range-handle-right";
                rangeEl.appendChild(rightHandle);

                // 左边缘拖动
                leftHandle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    clearTooltips(); // 拖动时立即清理 tooltip

                    let isDragging = false;
                    let dragLabel = null;
                    const originalStart = start;
                    const originalEnd = end;

                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) {
                            isDragging = true;
                            // 创建跟随标签
                            dragLabel = document.createElement("div");
                            dragLabel.className = "drag-label";
                            markerTrack.appendChild(dragLabel);
                        }

                        const trackRect = markerTrack.getBoundingClientRect();
                        const offsetX = moveEvent.clientX - trackRect.left;
                        const newPercent = Math.max(0, Math.min(1, offsetX / trackRect.width));
                        const newStart = Math.round(newPercent * (totalFrames - 1));

                        // 限制不能超过结束帧
                        const clampedStart = Math.max(0, Math.min(originalEnd - 1, newStart));

                        // 更新位置和宽度（使用统一的百分比转换）
                        const newLeftPercent = frameToPercent(clampedStart);
                        const newRightPercent = frameToPercent(originalEnd);
                        rangeEl.style.left = `${newLeftPercent}%`;
                        rangeEl.style.width = `${newRightPercent - newLeftPercent}%`;
                        rangeEl.dataset.range = `${clampedStart}-${originalEnd}`;

                        // 更新跟随标签
                        if (dragLabel) {
                            dragLabel.textContent = `帧 ${clampedStart}-${originalEnd}`;
                            // 标签位置定位在左边缘
                            dragLabel.style.left = `${newLeftPercent}%`;
                        }

                        // 同步 video 预览到新的起始帧
                        state.currentFrameIndex = clampedStart;
                        videoElement.currentTime = clampedStart / state.fps;
                        updateDisplay();
                    };

                    const onMouseUp = () => {
                        // 移除跟随标签
                        if (dragLabel) {
                            dragLabel.remove();
                            dragLabel = null;
                        }

                        if (isDragging) {
                            const newRange = rangeEl.dataset.range;
                            state.selectedFrames.delete(item);
                            state.selectedFrames.add(newRange);
                            renderTags();
                        }
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                // 右边缘拖动
                rightHandle.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    clearTooltips(); // 拖动时立即清理 tooltip

                    let isDragging = false;
                    let dragLabel = null;
                    const originalStart = start;
                    const originalEnd = end;

                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) {
                            isDragging = true;
                            // 创建跟随标签
                            dragLabel = document.createElement("div");
                            dragLabel.className = "drag-label";
                            markerTrack.appendChild(dragLabel);
                        }

                        const trackRect = markerTrack.getBoundingClientRect();
                        const offsetX = moveEvent.clientX - trackRect.left;
                        const newPercent = Math.max(0, Math.min(1, offsetX / trackRect.width));
                        const newEnd = Math.round(newPercent * (totalFrames - 1));

                        // 限制不能小于起始帧
                        const clampedEnd = Math.max(originalStart + 1, Math.min(totalFrames - 1, newEnd));

                        // 更新宽度（使用统一的百分比转换）
                        const leftPercent = frameToPercent(originalStart);
                        const rightPercent = frameToPercent(clampedEnd);
                        rangeEl.style.width = `${rightPercent - leftPercent}%`;
                        rangeEl.dataset.range = `${originalStart}-${clampedEnd}`;

                        // 更新跟随标签
                        if (dragLabel) {
                            dragLabel.textContent = `帧 ${originalStart}-${clampedEnd}`;
                            // 标签位置定位在右边缘
                            dragLabel.style.left = `${rightPercent}%`;
                        }

                        // 同步 video 预览到新的结束帧
                        state.currentFrameIndex = clampedEnd;
                        videoElement.currentTime = clampedEnd / state.fps;
                        updateDisplay();
                    };

                    const onMouseUp = () => {
                        // 移除跟随标签
                        if (dragLabel) {
                            dragLabel.remove();
                            dragLabel = null;
                        }

                        if (isDragging) {
                            const newRange = rangeEl.dataset.range;
                            state.selectedFrames.delete(item);
                            state.selectedFrames.add(newRange);
                            renderTags();
                        }
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                // 中间区域拖动（整体平移）
                rangeEl.addEventListener('mousedown', (e) => {
                    // 检查是否点击在手柄上，如果是则不处理
                    if (e.target.classList.contains('range-handle')) {
                        return;
                    }

                    e.stopPropagation();
                    e.preventDefault();
                    clearTooltips(); // 拖动时立即清理 tooltip

                    let isDragging = false;
                    let dragLabel = null;
                    const startX = e.clientX;
                    const originalStart = start;
                    const originalEnd = end;
                    const rangeWidth = originalEnd - originalStart;

                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) {
                            isDragging = true;
                            // 创建跟随标签
                            dragLabel = document.createElement("div");
                            dragLabel.className = "drag-label";
                            markerTrack.appendChild(dragLabel);
                        }

                        const deltaX = moveEvent.clientX - startX;
                        const trackRect = markerTrack.getBoundingClientRect();
                        const deltaPercent = deltaX / trackRect.width;
                        const deltaFrames = Math.round(deltaPercent * (totalFrames - 1));

                        let newStart = originalStart + deltaFrames;
                        let newEnd = originalEnd + deltaFrames;

                        // 限制范围不能超出边界
                        if (newStart < 0) {
                            newStart = 0;
                            newEnd = rangeWidth;
                        } else if (newEnd >= totalFrames) {
                            newEnd = totalFrames - 1;
                            newStart = newEnd - rangeWidth;
                        }

                        // 更新位置（使用统一的百分比转换）
                        const newLeftPercent = frameToPercent(newStart);
                        rangeEl.style.left = `${newLeftPercent}%`;
                        rangeEl.dataset.range = `${newStart}-${newEnd}`;

                        // 更新跟随标签
                        if (dragLabel) {
                            dragLabel.textContent = `帧 ${newStart}-${newEnd}`;
                            // 标签位置定位在范围中心
                            const centerFrame = (newStart + newEnd) / 2;
                            dragLabel.style.left = `${frameToPercent(centerFrame)}%`;
                        }

                        // 同步 video 预览到新的起始帧
                        state.currentFrameIndex = newStart;
                        videoElement.currentTime = newStart / state.fps;
                        updateDisplay();
                    };

                    const onMouseUp = () => {
                        // 移除跟随标签
                        if (dragLabel) {
                            dragLabel.remove();
                            dragLabel = null;
                        }

                        if (isDragging) {
                            const newRange = rangeEl.dataset.range;
                            state.selectedFrames.delete(item);
                            state.selectedFrames.add(newRange);
                            renderTags();
                        }
                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                // 双击范围帧跳转到起始帧
                rangeEl.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const range = rangeEl.dataset.range;
                    const startFrame = parseInt(range.split('-')[0]);
                    state.currentFrameIndex = startFrame;
                    videoElement.currentTime = startFrame / state.fps;
                    updateDisplay();
                });

                markerTrack.appendChild(rangeEl);

                // 使用 createTooltip 显示帧范围
                createTooltip({
                    target: rangeEl,
                    content: `帧 ${item}`,
                    position: 'top'
                });
            } else {
                // 单帧标记（使用统一的帧到百分比转换）
                const frame = typeof item === 'number' ? item : parseInt(item);
                const leftPercent = frameToPercent(frame);

                const markerEl = document.createElement("div");
                markerEl.className = "frame-marker";
                markerEl.style.left = `${leftPercent}%`;
                markerEl.dataset.frame = frame;
                markerEl.dataset.originalItem = item;

                // 添加拖动功能
                markerEl.addEventListener('mousedown', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    clearTooltips(); // 拖动时立即清理 tooltip

                    const originalFrame = parseInt(markerEl.dataset.frame);
                    const originalItem = markerEl.dataset.originalItem;
                    let isDragging = false;
                    let dragLabel = null;

                    const onMouseMove = (moveEvent) => {
                        if (!isDragging) {
                            isDragging = true;
                            // 创建跟随标签
                            dragLabel = document.createElement("div");
                            dragLabel.className = "drag-label";
                            markerTrack.appendChild(dragLabel);
                        }

                        const trackRect = markerTrack.getBoundingClientRect();
                        const offsetX = moveEvent.clientX - trackRect.left;
                        const newPercent = Math.max(0, Math.min(1, offsetX / trackRect.width));
                        const newFrame = Math.round(newPercent * (totalFrames - 1));

                        // 限制范围
                        const clampedFrame = Math.max(0, Math.min(totalFrames - 1, newFrame));

                        // 实时更新位置（使用统一的百分比转换）
                        markerEl.style.left = `${frameToPercent(clampedFrame)}%`;
                        markerEl.dataset.frame = clampedFrame;

                        // 更新跟随标签
                        if (dragLabel) {
                            dragLabel.textContent = `帧 ${clampedFrame}`;
                            dragLabel.style.left = `${frameToPercent(clampedFrame)}%`;
                        }

                        // 同步 video 预览
                        state.currentFrameIndex = clampedFrame;
                        videoElement.currentTime = clampedFrame / state.fps;
                        updateDisplay();
                    };

                    const onMouseUp = () => {
                        // 移除跟随标签
                        if (dragLabel) {
                            dragLabel.remove();
                            dragLabel = null;
                        }

                        if (isDragging) {
                            const newFrame = parseInt(markerEl.dataset.frame);

                            // 更新 selectedFrames
                            if (typeof originalItem === 'number') {
                                state.selectedFrames.delete(originalItem);
                            } else {
                                state.selectedFrames.delete(parseInt(originalItem));
                            }
                            state.selectedFrames.add(newFrame);

                            // 重新渲染
                            renderTags();
                        }

                        document.removeEventListener('mousemove', onMouseMove);
                        document.removeEventListener('mouseup', onMouseUp);
                    };

                    document.addEventListener('mousemove', onMouseMove);
                    document.addEventListener('mouseup', onMouseUp);
                });

                // 双击跳转到对应帧
                markerEl.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    const targetFrame = parseInt(markerEl.dataset.frame);
                    state.currentFrameIndex = targetFrame;
                    videoElement.currentTime = targetFrame / state.fps;
                    updateDisplay();
                });

                markerTrack.appendChild(markerEl);

                // 使用 createTooltip 显示帧号
                createTooltip({
                    target: markerEl,
                    content: `帧 ${frame}`,
                    position: 'top'
                });
            }
        });
    };

    // --- 渲染底部帧标签 ---
    const renderTags = () => {
        tagsList.innerHTML = "";
        const sorted = Array.from(state.selectedFrames).sort((a, b) => {
            const getStart = v => typeof v === 'string' ? parseInt(v.split('-')[0]) : v;
            return getStart(a) - getStart(b);
        });

        sorted.forEach(item => {
            const tag = document.createElement("div");
            // 根据类型添加对应的样式类
            const isRange = typeof item === 'string' && item.includes('-');
            tag.className = `frame-tag ${isRange ? 'frame-tag-range' : 'frame-tag-single'}`;
            tag.innerHTML = `<span>${item}</span>`;

            const removeIcon = document.createElement("span");
            removeIcon.className = "remove-frame";
            removeIcon.innerHTML = "×";
            removeIcon.onclick = () => {
                state.selectedFrames.delete(item);
                renderTags();
            };

            tag.appendChild(removeIcon);
            tagsList.appendChild(tag);
        });

        // 同步更新标记轨道
        renderMarkers();
    };

    // --- 帧滑块点击支持（在标记轨道上点击跳转到指定帧）---
    markerTrack.addEventListener('click', (e) => {
        if (e.target === markerTrack) {
            const rect = markerTrack.getBoundingClientRect();
            const clickPercent = (e.clientX - rect.left) / rect.width;
            const targetFrame = Math.round(clickPercent * state.totalFrames);
            loadFrame(Math.max(0, Math.min(state.totalFrames - 1, targetFrame)));
        }
    });

    // --- 初始化：加载第一帧 ---
    loadFrame(0);
    renderTags();
}

/**
 * 递归查找连接的视频源
 * @param {Object} node 起始节点
 * @returns {Promise<Object|null>} 视频信息对象 {url, filename, type}
 */
async function findConnectedVideo(node) {
    if (!node.inputs) return null;

    // 辅助函数：从节点提取视频文件信息
    const extractVideoFile = (node) => {
        let filename = null;
        let subfolder = "";
        let type = "input";
        let forceRate = 0;

        // 检测是否为VideoHelperSuite的Load Video节点
        const isLoadVideoNode = node.type?.includes("VHS_LoadVideo");

        // 策略1: 从 serialize.widgets_values 获取
        if (node.serialize) {
            const serialized = node.serialize();
            if (serialized?.widgets_values?.length > 0) {
                filename = serialized.widgets_values[0];
            }
        }

        // 策略2: 从 widgets 获取
        if (!filename && node.widgets?.length > 0) {
            for (const w of node.widgets) {
                if (w.value && typeof w.value === 'string' && w.value.length > 0) {
                    filename = w.value;
                    break;
                }
            }
        }

        // 策略3: 从 properties 获取
        if (!filename && node.properties) {
            filename = node.properties.video || node.properties.filename || node.properties.upload;
        }

        // 提取force_rate参数（来自VideoHelperSuite的Load Video节点）
        if (node.widgets) {
            const forceRateWidget = node.widgets.find(w => w.name === "force_rate");
            if (forceRateWidget && forceRateWidget.value != null) {
                forceRate = parseFloat(forceRateWidget.value);
            }
        }

        if (filename) {
            return { filename, subfolder, type, forceRate, fromLoadNode: isLoadVideoNode };
        }
        return null;
    };

    // 辅助函数：递归遍历图
    const findVideoSource = (currentNode, visited = new Set()) => {
        if (!currentNode || visited.has(currentNode.id)) return null;
        visited.add(currentNode.id);

        // 检查当前节点是否有视频文件
        const videoFile = extractVideoFile(currentNode);
        if (videoFile) return videoFile;

        // 递归查找上游节点
        if (currentNode.inputs) {
            for (const input of currentNode.inputs) {
                if (input.link) {
                    const link = app.graph.links[input.link];
                    if (link) {
                        const sourceNode = app.graph.getNodeById(link.origin_id);
                        const result = findVideoSource(sourceNode, visited);
                        if (result) return result;
                    }
                }
            }
        }
        return null;
    };

    // 1. 优先查找 Video 类型输入
    const videoInput = node.inputs.find(i => i.name === "视频" || i.type === "VIDEO");
    if (videoInput?.link) {
        const link = app.graph.links[videoInput.link];
        if (link) {
            const originNode = app.graph.getNodeById(link.origin_id);
            const videoFile = findVideoSource(originNode);
            if (videoFile) {
                const params = new URLSearchParams(videoFile);
                return {
                    url: api.apiURL("/view?" + params.toString()),
                    filename: videoFile.filename,
                    type: videoFile.type,
                    forceRate: videoFile.forceRate || 0,
                    fromLoadNode: videoFile.fromLoadNode || false
                };
            }
        }
    }

    // 2. 查找 Image 类型输入（图像序列）
    const imageInput = node.inputs.find(i => i.name === "图像序列" || i.type === "IMAGE");
    if (imageInput?.link) {
        const link = app.graph.links[imageInput.link];
        if (link) {
            const originNode = app.graph.getNodeById(link.origin_id);
            const videoFile = findVideoSource(originNode);

            if (videoFile) {
                const params = new URLSearchParams(videoFile);
                return {
                    url: api.apiURL("/view?" + params.toString()),
                    filename: videoFile.filename,
                    type: videoFile.type,
                    forceRate: videoFile.forceRate || 0,
                    fromLoadNode: videoFile.fromLoadNode || false
                };
            } else {
                return {
                    type: "image_sequence",
                    error: "检测到图像序列输入，但无法追溯到原始视频文件。请确保图像序列来自视频加载节点（如 VHS Load Video）。"
                };
            }
        }
    }

    return null;
}
