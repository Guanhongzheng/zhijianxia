# WebGPU 大模型优化 · 可行性评估与路线

> 面向「让 7B+ 在不牺牲质量的前提下跑起来」这一目标，对收到的六项方案逐条核对**在现有代码栈上能否落地**。
> 结论先行：**六项里有五项的核心收益发生在推理引擎内部，而当前引擎不提供这些钩子。**
> 所以规格里的优先级排反了 —— P0 与 P1 不是两件事，而是**同一个决策**。

---

## 0. 现状基线（已核实，非估计）

| 项 | 现状 | 出处 |
| --- | --- | --- |
| 推理引擎 | ONNX Runtime Web（JSEP）+ `@huggingface/transformers` | `src/lib/ai/runtime.ts` |
| WebGPU 权重上限 | 取 `GPUAdapter.limits` 实测预算（约 = 单次分配上限 × 50%） | `src/lib/ai/device-profile.ts` |
| 权重大小判据 | 整个权重必须放进**单个** GPU buffer（ORT 不分块） | `runtime.ts` 实测记录 |
| 权重来源 | ModelScope / HF，ONNX 量化档位只有 `q4` / `uint8` | `local-models.ts` |
| 权重缓存 | Cache API 64 MB 分片（绕开单条目 256 MB 上限） | `model-cache.ts` |
| 已验证上限 | WebGPU ≤ 约 1 GiB 权重；WASM 可到 1.58 GB（1.5B uint8，加载 319 s） | 实测记录 |

---

## 1. 逐项判定

| # | 规格项 | 在当前栈能否实现 | 判定与理由 |
| --- | --- | --- | --- |
| P0-a | 静态内存规划（遍历算子 DAG 预分配 arena） | **不能** | ORT 内部确有内存规划器，但 JS 侧**没有任何 API** 能查询算子 DAG 或预分配 WebGPU arena。WebGPU EP 的可配项只有 `preferredLayout` 一个。要做只能在引擎内部做。 |
| P0-b | OPFS 流式加载（WASM 堆只留 4×1 MiB 暂存） | **不能（收益部分）** | OPFS 可以替换现在的 Cache API 分片（存储层收益：可恢复下载、配额更清晰）；但 transformers.js 仍会把整份权重 `arrayBuffer()` 后交给 ORT —— 「边下边生成」需要引擎接受增量权重，ORT 不接受。 |
| P1 | 引擎可插拔（WebLLM / wllama） | **能** | 这是唯一能解锁其余各项的前置改动。 |
| P1-3 | KV Cache 压缩（TurboQuant 风格） | **不能** | transformers.js 不暴露 KV cache；TurboQuant 需要自定义 attention 内核。且官方实现尚未进入 llama.cpp / vLLM（Google 参考实现预计 2026 Q2）。 |
| P2 | 核融合 decode（单 shader 派发） | **不能** | 需要自己生成 WebGPU compute shader，等于自研引擎。 |
| P2-5 | 分割推理（浏览器 prefill + 局域网 decode） | **不能（当前架构）** | 需要两侧都能拿到隐藏状态与 KV cache，即两侧都得是自研/可改造的运行时。 |
| P3 | 量化格式扩展（q4_k_m / q2_k / q1_0） | **不能（在 ONNX 侧）** | 这些是 **GGUF/llama.cpp 的档位**，ONNX 模型文件没有对应量化方案。换到 wllama 才有意义。 |

### 关键证据：那 29–33% 是谁的数字

规格把「静态内存规划 + 高效模型加载，显存降低 29–33%、解码提升 45–69%」归给 P0。
核实结果：这是 **llama.cpp 的 WebGPU 后端**在 2026-05 落地时给出的数字
（论文与报道一致，覆盖 Intel / Apple / NVIDIA 三类 GPU）。

也就是说：**这个收益是「换到 llama.cpp 系引擎」的收益，不是「在 ORT 上做优化」的收益。**
把它列在 P0、把换引擎列在 P1，等于把结果放在了原因前面。

TurboQuant 同样核实为真实工作（Google Research，ICLR 2026；KV cache 压缩 ≥6×，无训练、无校准）。
但它需要把旋转 + 标量量化 + 1-bit 残差校正编进 attention 内核，
在 WebGPU 上等于自研算子库 —— 这属于引擎厂商的工作，不是应用层能做的。

---

## 2. 本轮已落地（可验证的那部分）

**把「权重能否上 GPU」的判据从硬编码常量改成设备实测预算。**

- 之前：`WEBGPU_MAX_Q4_BYTES = 1 GiB` 写死，来自一台 RTX 40 系机器的实测。
- 现在：读 `GPUAdapter.limits`，`预算 = min(maxBufferSize, maxStorageBufferBindingSize) × 50%`。
- 系数取 50% 是刻意的：主流设备（2 GiB 上限）算出来正好 **1 GiB，与旧常量完全一致** ——
  已验证过的设备行为不变；改的是两头：
  - 弱设备（报 256 MiB）提前拦住，不再「下完几百 MB 才在分配阶段崩」；
  - 高端设备（报 4 GiB）预算 2 GiB，**1.5B 的 1.7 GB 权重终于能上 GPU**（旧常量会误拦）。
- 相关文件：`src/lib/ai/device-profile.ts`（新增，纯函数）、`runtime.ts`、`local-models.ts`、`settings-panel.tsx`
- 测试：`npm run ai:budget`（12 项，覆盖回落、主流、高端、弱设备、边界与文案）

这只是**应用层能给到的最优解**：判据更准、错误更早、文案更实。它不改变推理本身的性能。

---

## 3. 建议路线（重排后）

### Phase 1 · 引擎边界 —— ✅ 已完成

抽出 `InferenceEngine` 接口（`load / generate / unload` + 引擎元信息），
Transformers.js 作为唯一实现，**Worker 退化成纯管道**（消息 id、进度、错误归一、卸载时序），
推理实现搬到 `src/lib/ai/engine/transformers.ts`。

```
src/lib/ai/engine/
├── types.ts          InferenceEngine / 参数 / 进度回调
├── transformers.ts   ONNX Runtime Web 实现（从 ai-worker 原样搬移）
└── registry.ts       引擎单例注册表；未知 id 回落默认引擎
```

- 价值：Phase 2 变成「加一个 engine 文件 + register 一行」，不必再动那套容易出错的时序逻辑；
- 验收：`typecheck` 干净、契约 69/69、**真机端到端**（下载 SmolLM2 417 MB → 加载 3 s
  （缓存命中 + WebGPU）→ 对话出字）通过，控制台无错误；
- 说明：接口刻意只有三个动作，没有提前设计可取消流 / 多模态 / 工具调用 ——
  第二个引擎真出现时再按需长，否则是抽象税。

### Phase 2 · 接入第二个引擎（3–5 天，需要决策）

候选与取舍：

| 引擎 | 优势 | 代价 |
| --- | --- | --- |
| **WebLLM**（MLC/TVM） | WebGPU 原生、内核自动调优、静态内存规划是它的既有能力；支持 1B–8B 常见模型 | ≈2 MB 依赖 + MLC 格式权重（与现有 ONNX 清单不通用）；模型托管在境外 CDN，国内可达性需实测 |
| **wllama**（llama.cpp WASM） | GGUF 格式齐全（q4_k_m / q2_k / q1_0 全在）；可复用 ModelScope 镜像 | WebGPU 支持成熟度需验证；WASM 路径是 CPU，速度不及 GPU |

建议先做 **WebLLM**：它直接对应「7B 能跑」的目标，且静态内存规划/内核调优是现成的。
代价是要接受**第二套模型格式与第二份清单**。

### Phase 3 · 上下文与 KV（依赖 Phase 2 的引擎能力）

不自研 TurboQuant。走引擎自带能力：WebLLM 的滑动窗口 / 上下文窗口配置。
若确实需要更长上下文，再评估引擎是否暴露 KV 相关参数 —— 在应用层「压缩 KV」这个动作本身不存在。

### Phase 4 · 分割推理（另立项）

工程量与 Phase 2 同级甚至更大，且需要后端模型服务。
与「局域网工具箱」的定位契合，但**必须先有 Phase 1 的接口**才谈得上拆前后段。

---

## 4. 需要拍板的三件事

1. **7B 的预期**：7B q4 权重约 4 GB。即使换 WebLLM、即使显存够，下载 4 GB + 首 token 冷启动
   在桌面浏览器上是「能跑」而非「好用」。要不要把目标下调为 **1.5B–3B 的可用性**（当前 1.5B 在 WASM 下 319 s 加载，换成 WebLLM 后预计进入十秒级）？
2. **第二套模型格式**：接受「ONNX 清单 + MLC 清单」并存，还是逐步迁移到单一格式？
3. **依赖与体积**：为 WebGPU 引擎增加 ≈2 MB 运行时代码（首屏要懒加载），是否可以接受？

---

## 5. 一句话总结

- 规格里**唯一能在当前架构上立刻做、且有真实收益**的，是「按设备实测预算做准入」——已完成。
- 其余五项都不是「优化」，而是**换引擎带来的能力**。想拿到 7B，先做 Phase 1 的接口，再做 Phase 2 的接入；
  在这之前投入 KV 压缩、核融合，等于在别人的引擎里改别人的内核。
