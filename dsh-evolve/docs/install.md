# 安装与运行（0.2.2-dev.5）

普通用户优先按[Quickstart](../../docs/quickstart.md)下载预构建包安装；以下是源码构建及进阶配置。

要求 DSH 0.2.1-rc.2、Node ^22.19.0 或 >=24、可写工作区及可用模型路由。无需修改 DSH 或 harness2 源码。npm 尚未发布，使用 Release 或本地构建的 tarball：

```sh
pnpm install
pnpm build
pnpm --filter @dsh-evolve/bundle pack --pack-destination "$PWD/dist"
dsh plugin --profile <name> add ./dist/dsh-evolve-bundle-0.2.2-dev.5.tgz
dsh --profile <name> --dump-config
```

安装包为独立 worker 声明了生产运行依赖。若 pnpm 11 报 `ERR_PNPM_IGNORED_BUILDS`，可在目标 profile 的 `pnpm-workspace.yaml` 合并以下设置再重试，保留已有设置；这是拒绝执行脚本，不是全局放行：

```yaml
allowBuilds:
  '@google/genai': false
  koffi: false
  protobufjs: false
```

当前 macOS arm64 安装验证使用包中的预构建内容；其他平台若缺少原生预构建，须按对应 DSH 安装要求处理。

应看到 core/observer/probe/sandbox/agent/tools/commands/ui 组合。不要再单独安装 core。安装验证使用临时 DSH_HOME，不改用户现有 profile。

本版本支持同一会话中的阶段学习、工作标题及阶段策略延续，并增加新输入验证。安装后重启对应 Profile，并使用新会话。

## 前台与 worker

默认 `proposer: llm`、`automaticLifecycle: true`、`worker: true`。正常聊天即可异步提取有来源的需求，在交付证据支持时自动结束任务并由宿主后台 worker 执行实验。普通回复结束只提供观察时机，idle、文件存在或模型自称完成都不能独自确立终态；等待用户输入时继续等待。`evolve_task` 和 `/evolve finish` 保留为显式协议/诊断入口。

正常使用不需要命令；可选 `/evolve work [id]` 或工具 `evolve_work` 手动执行一项。宿主退出后内置 worker 随之停止，若需继续处理，启动独立进程：

```sh
pnpm worker --workspace /path/to/task --config /path/to/provider.json --watch
# 安装包也导出同一入口：
dsh-evolve-worker --workspace /path/to/task --config /path/to/provider.json --watch
```

provider.json 使用 DSH PiAi providers 配置；密钥仅引用环境变量。使用与你的提供方和模型相符的配置，不要把认证值写入项目；密钥通过环境变量引用。独立 worker 保存配置指纹，恢复时配置变化会拒绝混跑。

watch 用 Ctrl-C 停止；任务中断后未知调用不自动重发。没有 worker 时 job 保持 queued，不表示后台已执行。常驻 DSH profile 默认已有宿主 worker；设置 `worker: false` 可关闭。headless 会随进程退出，需继续执行时使用独立 worker。

```sh
pnpm worker --workspace /path/to/task --status
pnpm worker --workspace /path/to/task --cancel --job <id>
pnpm worker --workspace /path/to/task --config /path/to/provider.json --job <id> --resume
```

resume 不返还已花费/未知 token，也不重置原 wall-clock 预算。预算已耗尽的实验不能通过反复恢复扩额。正常决定返回 exit 0，未完成/失败返回非零。

## 采用与范围

默认 `sessionAdoption: auto`，只对受支持的会话文本/原生技能自动采用；轻通知与 Evo 面板提供撤销。设为 `review` 可逐项确认。项目改动始终审查目标目录、实际 diff 和其他会话；Profile 还需勾选影响范围，默认保持现状。不能用配置将共享范围审批改为自动。

项目使用原生本地指令管理块与 Evo 命名空间技能，新会话加载，当前会话刷新不保证。Profile overlay 经原生配置加载：HMR 可能影响已有 Agent 后续请求，否则需重启。任意生成代码、插件实现或 Loop 驱动不进入自动采用。

## 控制

| 命令 | 效果 |
|---|---|
| `/evolve status` / `jobs` | 当前任务、实验及实际预算 |
| `/evolve propose` | 入队任务中实验，受前台预算比例约束 |
| `/evolve reflect` / `probe` | 入队完整任务后实验，每任务一项；不是立即改写 |
| `/evolve work [id]` | 显式运行实验，等待结果 |
| `/evolve cancel <id>` / `resume <id>` | 停止或显式恢复实验 |
| `/evolve finish completed\|failed\|timeout\|cancelled\|awaiting-input` | 明确声明任务状态 |
| `/evolve history` / `diff [id]` / `rollback [id]` | 审计及撤销当前任务覆盖 |
| `/evolve adoptions` / `review <id>` | 查看采用计划与完整实际差异 |
| `/evolve accept <id> <contentHash>` | 接受已审查计划；Profile 还需 `--confirm-scope <targetId>` |
| `/evolve dismiss <id> <contentHash>` / `undo <id> <contentHash>` | 拒绝待定建议或撤销对应已应用变化 |
| `/evolve library` | 查看经验等级和反例 |
| `/evolve off` / `on` | 停用/启用工作区进化；off 取消后台 job，on 不自动恢复 |
| `/evolve pending` / `approve` / `reject` / `promote` | L3 管理，动态验证和源 hash 绑定是前提 |

`evolve_task` 接受 requirements JSON：每项需要 id、description、source、required，可加 check `{path,kind:"exists"|"json"|"contains",value?}`。`evolve_note` 只记录假设。

Web 面板默认只显示当前会话的状态卡：正在做什么、当前策略和是否需要操作。点击“详情”展开“概览 / 学习记录 / 变化 / 经验”；内部 ID、token 账本和原始错误只在诊断中显示。手动学习、重新评估与暂停放在右上角高级菜单；暂停会停用 Evo 会话覆盖，取消的实验不会在恢复时自动重启。默认跟随系统语言，也可切换中英文。后台控制与上述服务相同。L3 默认无可信隔离 verifier，仅静态检查不能晋升；规则和 preset 也尚未进入自动实验。

## 数据与升级

```
.dsh-evolve/
  lifecycle.json                    # 任务、实验、预算、比较、经验
  checkpoints/<id>.json             # 冻结输入和哈希
  episodes/<id>/runs/<kind>-*/       # 独立执行目录
  sessions/<id>.json                # 会话当前 Revision
  adoptions/<session>.json          # 会话自动/手动采用记录
  shared-adoptions.json             # 项目/Profile 待确认及采用记录
  automation/<session>.json         # 需求与完成观察证据、调用账本
  revisions/<event-id>/             # Revision 元数据与完整树
  library/                          # 旧版文件保留、迁移为假设
  candidates/                       # L3 源码、验证与审批记录
  audit/<session>.jsonl             # 应用/回滚事件
```

旧 Revision/Library 元数据迁移前写备份，旧内容 ID 仍能读取。新任务不自动继承旧工作区 current。未知更高 schema 拒绝读写，不静默重置。输入快照包含本地任务材料，请像源文件一样保管。

卸载：`dsh plugin --profile <name> remove @dsh-evolve/bundle`。独立 worker 另行停止，工作区证据保留。

## 同一会话中的阶段学习

在有来源的要求与阶段交付证据后，Evo 可以为当前阶段排队学习，不必等待整个会话结束。面板的“学习这个阶段”与 `/evolve checkpoint` 提供手动入口。阶段关闭后继续工作会保留完整任务要求；实质性需求变化会更新目标版本，使旧目标下的候选不能直接采用。

自动阶段检查默认开启，`checkpoint: manual` 可改为手动。`checkpointIdleMs`、`checkpointCooldownMs` 和 `checkpointMinTurns` 控制等待、冷却和最少轮数。闲置本身不构成完成证据。阶段学习结果不能单独作为扩大到项目或 Profile 的证据。

适用的数据文件任务还会在冻结候选后生成新输入、独立推导预期并重复执行。缺少可替换数据或可靠预期时会记录跳过原因。这是额外的选择证据，不代表模型质量已经得到证明；所有调用仍受同一预算约束。
