# 在 DSH 中使用 Evo

[返回首页](../README.md) · [English overview](../README.en.md#use-the-plugin)

本文面向**直接使用插件的人**。无需理解源码、Fork 仓库或运行测试。首次目标是确认插件正确加载，再在明确的费用范围内试用自动学习。

## 1. 准备 DSH 和模型

已验证的宿主版本是 **DSH `0.2.1-rc.2`**。其他版本即使满足 manifest 的版本范围，也不代表已完成测试。

- 已安装 DSH 桌面版：在已有应用中使用；其默认 Profile 通常是 `desktop`。如果使用了自定义 Profile，后续命令必须填写它的名字。
- 希望使用独立 Web Profile：准备 Node `^22.19.0 || >=24`，并按 [DSH 官方安装说明](https://github.com/deepseek-ai/deepseek-harness)准备 CLI。可固定版本使用 `npx --yes @deepseek-ai/dsh@0.2.1-rc.2`，替代下文每一处 `dsh`。

先确认版本：

```sh
dsh --version
```

macOS 桌面版如果提示找不到 `dsh`，把命令中的 `dsh` 替换为：

```sh
"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"
```

在 DSH 中打开 **设置 → 模型**，配置自己的模型提供方、模型和认证方式。自定义 OpenAI 兼容端点参见 [DSH 模型配置指南](https://github.com/deepseek-ai/deepseek-harness/blob/main/docs/user/guide/providers.zh.md)。先在未启用 Evo 学习时确认 DSH 能正常回答并读取本地文件。Evo 不提供模型账号或免费额度，不要求必须使用 Ark；不同模型的效果与输出能力需要单独确认。

模型密钥只通过提供方配置或运行环境设置，不写进项目文件、任务提示或截图。

## 2. 下载插件包

打开 [Releases](https://github.com/mmj953131361-eng/dsh-evolve/releases)，选择 `v0.2.2-dev.5` 预发布，下载 Assets 中的：

- `dsh-evolve-bundle-0.2.2-dev.5.tgz`：可安装插件，不是页面自动生成的 Source code 压缩包。
- `evo-first-run.patch.yml`：首次仅验证加载，关闭 Evo 模型调用。
- `evo-learning.patch.yml`：显式开启有界学习的示例配置。
- `SHA256SUMS`：可选的文件校验清单。

无需安装 pnpm 或构建源码；这些是贡献者才需要的步骤。可选校验：macOS 在下载目录执行 `shasum -a 256 -c SHA256SUMS`，Linux 执行 `sha256sum -c SHA256SUMS`。

## 3. 安装到正确的 Profile

### 已有桌面 Profile

退出对应 DSH 实例后安装（将路径替换为真实下载位置）：

```sh
dsh plugin --profile desktop add /完整下载路径/dsh-evolve-bundle-0.2.2-dev.5.tgz
```

安装到 `web` 不会自动影响 `desktop`，反之亦然。重启对应 Profile 后，**新建会话**再验证。

首次希望完全不执行 Evo 的额外模型调用，可在该 Profile 的 `cordis.patch.yml` 中合并 `evo-first-run.patch.yml` 的内容后再启动。Profile 位于 `$DSH_HOME/profiles/<name>/`，未自定义 `DSH_HOME` 时默认在 `~/.dsh/profiles/<name>/`。保留文件里已有的配置，不要覆盖整个文件。熟悉后用学习配置替换这些 Evo 行。

### 独立 Web Profile（首次更容易隔离）

下面的 `evo-demo` 必须是**全新的名字**；如果已经存在，请换一个名字。只初始化一次：

```sh
dsh --profile evo-demo --from-default-profile web --dump-config
dsh plugin --profile evo-demo add /完整下载路径/dsh-evolve-bundle-0.2.2-dev.5.tgz
dsh --profile evo-demo --patch /完整下载路径/evo-first-run.patch.yml --port 3081
```

打开终端打印的本地地址。这里的 `--from-default-profile` 会替换目标 Profile，**不要用它重置日常使用的 Profile，也不要在后续重启时重复添加**。端口被占用时更换 `3081`。

首次配置中关闭了 Evo 学习，面板应显示暂停状态。配置 DSH 模型后，正常对话只用于确认宿主可用。要开始有界学习，停止这个 Web 实例，然后改用：

```sh
dsh --profile evo-demo --patch /完整下载路径/evo-learning.patch.yml --port 3081
```

本例的任务后实验上限是 2M 处理 token / 15 分钟，单次期望输出上限 16,384。它只是明确有界的试用配置，预算不足时可能无法完成实验，不保证会产生新策略。务必检查提供方价格及实际支持的输出长度。插件原始默认上限是 512M / 8 小时，不能把这些上限当成实际用量。

## 4. 创建工作区并完成一个普通任务

1. 在 DSH 添加一个可恢复的本地项目文件夹。
2. 新建会话，选择已配置且可用的模型。
3. 描述你真正要完成的任务，包括输入位置、交付物和验收要求。例如让它根据已有文档整理一份摘要，并要求保留输入文件。
4. 照常与 DSH 对话，无需调用 `evolve_task` 或记住学习命令。
5. 打开 Evo 入口，先看状态卡；需要时再展开“学习记录 / 变化 / 经验”。

这个版本支持同一会话中的阶段学习：有要求和阶段交付证据后可以排队实验，也可在面板选择“学习这个阶段”。继续下一阶段会保留原任务上下文，实质性需求变化会使旧候选失效。它尚不代表完整的长期项目管理。闲置、文件存在、助手自称完成都不足以单独触发“已完成”。任务缺少可核对的要求或交付证据时，Evo 可以保持观察，不应为了看到“进化”而强制批准。

后台候选使用受限本地文件工具；首次应选择本地资料和文件交付任务。依赖外网、Shell 或完整开发环境的任务，不能据此期待后台原样重放。

## 5. 看懂结果和确认

| 看到的状态 | 含义 | 你需要做什么 |
|---|---|---|
| 任务进行中 / 观察中 | 正在积累要求和交付证据 | 正常工作 |
| 排队 | 已登记实验，尚未完成执行 | 等待；确认 DSH 宿主仍在运行 |
| 正在学习 | 正在执行候选及比较 | 可继续前台工作，留意实际费用 |
| 保留原策略 | 没有可靠优于基线的可用候选 | 无需强制采用 |
| 已采用新策略 | 通过校验的会话策略已应用 | 看变化，必要时撤销 |
| 待确认 | 项目/Profile 或会话审查模式的建议尚未应用 | 审查实际差异和作用范围后决定 |
| 学习失败 / 需要留意 | 实验没有完成 | 查看原因；先处理配置、预算或模型问题，再考虑重试 |

“选中候选”和“已经采用”是不同状态。会话文本/原生技能默认自动采用，并提供精确撤销。项目变更必须确认；Profile 还必须确认目标和影响范围。关闭、暂缓或离开弹窗都不会批准。技能正文按需加载，项目变更用新会话验证，Profile 配置可能需要重启。

后台实验不会直接替换前台已经交给你的文件。学习结果也不保证能迁移到所有后续任务。

## 6. 暂停、撤销和卸载

- **暂停学习**：面板高级菜单选择暂停，或在支持 slash 命令的会话中执行 `/evolve off`。`/evolve on` 恢复开启，但不会自动重启已取消的实验。首次配置文件中禁用的组件要先修改配置并重启。
- **撤销某次采用**：使用对应轻提示或“变化”里的撤销；它针对那一次改动。用户后来编辑过文件时会报告冲突，不强行覆盖。
- **卸载插件**：先审查并撤销不想保留的项目/Profile 改动，再退出实例并执行：

  ```sh
  dsh plugin --profile desktop remove @dsh-evolve/bundle
  ```

  Web 示例把 `desktop` 换成 `evo-demo`；同时移除该 Profile 用户配置里 Evo 专属的覆盖行，后续启动不再传入 Evo 的 `--patch`。重启 DSH。

卸载不会自动擦除 `.dsh-evolve/` 历史，也不会替你反向覆盖已确认的项目文件。它们可能包含任务材料，归档或删除前先确认不再需要撤销和审计。

## 常见问题

| 问题 | 排查方法 |
|---|---|
| 找不到 Evo 入口 | 检查安装的 Profile、重启和新会话；查看 DSH 插件加载错误 |
| 提示模型/provider 未配置 | 先在 DSH 配好模型并选择；自定义 worker 路由见详细安装说明 |
| 长时间排队 | 检查宿主运行状态、worker 是否启用、预算及错误原因；退出宿主会停止内置 worker |
| 输出上限或预算失败 | 核对模型真实能力，减少任务规模或显式调整预算；提高上限不保证质量 |
| 触发不了学习 | 检查是否仍在等待用户输入、是否有 grounded requirements 和交付证据；暂停配置是否仍在启用 |
| `ERR_PNPM_IGNORED_BUILDS` | 按[详细安装说明](../dsh-evolve/docs/install.md)合并明确的 allowBuilds，不要全局放行所有脚本 |
| 变更已写入但行为没变 | 检查生效时机；技能需再次调用，项目用新会话，Profile 可能需重启 |

仍有问题请提交 [Issue](https://github.com/mmj953131361-eng/dsh-evolve/issues)，提供 DSH/Evo/操作系统版本、Profile 类型、复现步骤和脱敏错误。不要附密钥、整个任务快照或私人项目资料。更完整的开发/配置细节见[安装说明](../dsh-evolve/docs/install.md)；安全问题按 [SECURITY.md](../SECURITY.md)私密报告。
