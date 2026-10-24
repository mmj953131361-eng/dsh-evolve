# DSH Evo

**愿景：让 DSH 在工作中持续进化 harness，把经过验证的改进热载到 Agent。**

[English](README.en.md) · [快速开始](docs/quickstart.md) · [下载插件](https://github.com/mmj953131361-eng/dsh-evolve/releases) · [问题反馈](https://github.com/mmj953131361-eng/dsh-evolve/issues)

Evo 是 **DeepSeek Harness（DSH）的插件**。安装后照常与 DSH 对话，Evo 会观察有来源的任务要求和交付证据，在后台提出候选 harness、执行比较、合成并重新运行；有充分证据时采用新策略，也可以保留原策略。这里的 harness 指 Agent 的工作指令、任务上下文和原生技能等运行组件。

> **开发预览：`0.2.2-dev.4.public.1`。** 插件能运行学习流程，不代表每次都能提高质量，也没有证据证明已追平 Harness²。请先在可恢复的本地项目和独立 Profile 中试用。

## 我想直接使用

普通用户可以下载预构建 `.tgz`，**无需克隆本仓库、安装 pnpm 或自己构建**。

1. 安装或准备 **DSH `0.2.1-rc.2`**，并在 DSH 中配置可用的模型。
2. 从 [Releases](https://github.com/mmj953131361-eng/dsh-evolve/releases) 下载 `dsh-evolve-bundle-0.2.2-dev.4.public.1.tgz`。
3. 把插件安装到你实际使用的 Profile，例如桌面端的 `desktop`：

   ```sh
   dsh plugin --profile desktop add /完整下载路径/dsh-evolve-bundle-0.2.2-dev.4.public.1.tgz
   ```

4. 重启对应 DSH Profile，打开一个本地项目和新会话，正常描述任务。打开 Evo 入口查看学习状态、变化和撤销。

**首次安装、Web 版、模型配置、费用限制、排错和卸载，请按[用户 Quickstart](docs/quickstart.md)操作。** 首次可先停用自动后台执行，确认模型和预算后再启用；具体方法见 Quickstart。`queued` 只代表排队，`KEEP_BASE` 代表保留原策略，都不等于学习成功。

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

## 当前边界与费用

- 候选实验使用受限本地文件 runner，不能代表完整前台的 shell、网络、任意代码或所有插件能力。
- 闲置、模型说“完成”和文件存在都不能单独证明任务完成。
- 长期项目、跨月对话及目标变更管理仍在规划中。
- 后台实验会额外调用模型。当前默认任务后上限很大：**512M 处理 token、8 小时**；期望的单次输出上限为 1M，实际受模型/API 限制。这些是上限，不是实际用量；开始前请按 [Quickstart](docs/quickstart.md)设置适合自己的额度。
- 冻结输入和产物的相关内容会发送给你配置的模型服务。本地状态保存在项目的 `.dsh-evolve/`，请勿提交其中的任务快照或凭证。

公开仓库仅提供运行源码、安装包和用户/构建文档；单元测试、测试夹具、任务样例、评测脚本与结果不公开。没有公开证据证明当前版本能够稳定提高任务质量。

## 文档

- [用户 Quickstart](docs/quickstart.md)：下载、安装、模型、预算、暂停与卸载。
- [进阶安装与配置](dsh-evolve/docs/install.md)：源码构建、worker 和生效范围。
- [构建与提交说明](CONTRIBUTING.md)：公开源码的构建流程。
- [安全说明](SECURITY.md)：私密报告渠道和运行边界。

## 许可与致谢

Evo 原创部分采用 [MIT](LICENSE)。第三方部分保留各自许可证，详见 [NOTICE](NOTICE)、[第三方声明](THIRD_PARTY_NOTICES.md) 和 [licenses/](licenses/)。

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：宿主平台；本项目包含其 Agent Loop 等代码的修改副本，遵守 MIT。
- [Google Research Harness²](https://github.com/google-research/harness2)：Propose–Probe–Compose、经验积累和比较方法的重要参考；部分选择提示有改编，遵守 Apache-2.0。

本项目是独立社区项目，与 DeepSeek 或 Google 不存在官方隶属或背书关系。参考版本记录在 [references.lock.json](references.lock.json)，参考源码不作为本仓库的一部分分发。
