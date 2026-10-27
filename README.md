# DSH Harness Evolve

**让 DSH 从工作中改进 harness，通过真实重跑验证，并将改进热载到 Agent。**

[English](README.en.md) · [快速开始](docs/quickstart.md) · [下载插件](https://github.com/mmj953131361-eng/dsh-harness-evolve/releases) · [问题反馈](https://github.com/mmj953131361-eng/dsh-harness-evolve/issues)

DSH Harness Evolve（面板简称 **Evo**）是 **DeepSeek Harness 的自进化插件**。你照常描述任务、补充要求和检查交付物；Evo 从有来源的任务要求与执行证据中提出不同策略，在隔离副本里重跑、合成与比较，再决定采用新策略或保留原策略。

我们希望每次改进都能回答：**为什么改、执行后怎样、影响谁、如何撤销。**当前优化对象包括工作指令、任务上下文、记忆文本和 DSH 原生技能；项目与 Profile 的共享改动需要确认。

## 快速开始

普通用户下载预构建 `.tgz` 即可，**无需克隆仓库或构建源码**。

1. 准备 DSH 和可用模型。dev.13 已验证 DSH `0.2.1-rc.2` / `0.2.1-rc.3` 的安装与启动；其他版本按宿主 API 检查，详见[兼容性](dsh-evolve/docs/compat.md)。
2. 从 [Releases](https://github.com/mmj953131361-eng/dsh-harness-evolve/releases) 下载 `dsh-evolve-bundle-0.2.2-dev.13.tgz`。
3. 退出对应 DSH 实例，安装到实际使用的 Profile，例如桌面端 `desktop`：

   ```sh
   dsh plugin --profile desktop add /完整下载路径/dsh-evolve-bundle-0.2.2-dev.13.tgz
   ```

4. 重启对应 Profile，打开本地项目和新会话，正常完成任务。在 **Evo** 入口查看状态、策略变化和撤销。

首次安装、模型配置、学习开关与卸载见[用户 Quickstart](docs/quickstart.md)。后台实验登记、执行、选中与实际采用分别显示；排队不代表已进化，保留原策略也是正常结果。

## 自进化如何工作与生效

```mermaid
flowchart LR
  A[任务要求与交付证据] --> B[提出候选策略]
  B --> C[同一冻结输入独立执行]
  C --> D[依据执行证据合成]
  D --> E[独立重跑与比较]
  E --> F[采用并可撤销 / 保留原策略]
```

- **任务前**：查找适用且经过验证的经验；没有就正常开始。
- **任务中**：观察遗漏、无进展、重复操作和失败，符合条件时启动受预算约束的实验。
- **任务后**：从冻结输入重跑基线和不同候选；合成后的策略必须再次执行，不能只凭提示文本更长就采用。
- **经验**：保存完整策略、来源、适用条件、反例和证据等级，区分当前任务验证与跨任务支持。

通过验证的改进，按作用范围决定是否确认以及何时生效：

| 范围 | 交互 | 生效方式 |
|---|---|---|
| 当前会话 | 受支持的文本/原生技能默认自动采用，提供撤销；可改为逐项确认 | 下一请求更新；技能正文按原生调用加载 |
| 当前项目 | 必须审查实际文件差异后确认 | Evo 管理区域和专用技能目录；使用新会话验证 |
| 指定 Profile | 必须确认目标 Profile 和影响范围 | 经原生配置加载，可能需要重启 |

关闭或推迟确认不代表批准。插件保留用户文件内容，并在目标或版本冲突时拒绝覆盖。当前支持的组件主要是**指令、任务上下文、记忆文本和原生技能**；工具、插件实现、MCP、权限和 Loop 的任意修改尚未进入自动候选与采用流程。

## 文档

- [用户 Quickstart](docs/quickstart.md)：下载、安装、模型、预算、暂停与卸载。
- [宿主兼容性](dsh-evolve/docs/compat.md)：DSH 升级、加载状态和故障隔离。
- [进阶安装与配置](dsh-evolve/docs/install.md)：源码构建、worker 和生效范围。
- [构建与提交说明](CONTRIBUTING.md)：公开源码的构建流程。
- [安全说明](SECURITY.md)：私密报告渠道和运行边界。

## 许可与致谢

Evo 原创部分采用 [MIT](LICENSE)。第三方部分保留各自许可证，详见 [NOTICE](NOTICE)、[第三方声明](THIRD_PARTY_NOTICES.md) 和 [licenses/](licenses/)。

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：宿主平台；本项目包含其 Agent Loop 等代码的修改副本，遵守 MIT。
- [Google Research Harness²](https://github.com/google-research/harness2)：Propose–Probe–Compose、经验积累和比较方法的重要参考；部分选择提示有改编，遵守 Apache-2.0。

本项目是独立社区项目，与 DeepSeek 或 Google 不存在官方隶属或背书关系。参考版本记录在 [references.lock.json](references.lock.json)，参考源码不作为本仓库的一部分分发。
