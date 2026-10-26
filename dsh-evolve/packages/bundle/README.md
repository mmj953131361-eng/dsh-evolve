# @dsh-evolve/bundle 0.2.2-dev.13

DSH Harness Evolve（Evo）的单包安装入口，rc.2 / rc.3 已验证安装和启动，包含 core、observer、agent、probe、sandbox、tools、commands、ui 与可选 loop。无需单独安装兄弟包。

```sh
dsh plugin --profile <name> add ./dsh-evolve-bundle-0.2.2-dev.13.tgz
```

普通聊天默认自动观察有来源的需求与交付证据，宿主后台 worker 执行 baseline → INV/DOM → compose 重跑 → 匿名选择，再按决定进行新输入验证与反思；选择器明确弃权会直接保留基线并结束可选评估。剩余 next-turn 消息按原顺序并入当前请求，可选 loop 也整批 claim。idle 本身不代表任务完成。允许 KEEP_BASE 和不写经验。会话优化默认自动可撤销，项目明确确认，Profile 额外确认影响范围。状态、完整 diff 和失败重试在 Evo 入口，不要求用户输入命令。

宿主退出后需继续执行时，可选启动独立 worker：`dsh-evolve-worker --workspace /path/to/task --config /path/to/provider.json --watch`。

独立 worker 的配置使用 DSH PiAi providers 对象与 apiKeyEnv；不接受明文 apiKey。`--status` 读取状态，`--cancel --job <id>` 停止，`--resume --job <id>` 显式恢复但不返还预算。

自动探测当前仅支持本地文件，采用限于支持的原生文本/技能组件；没有 shell、外网操作或生成代码执行。L3 需要可信动态隔离验证及 hash 绑定审批，默认保持 pending-validation。尚未证明能够稳定提升任务质量。


用户 Quickstart：https://github.com/mmj953131361-eng/dsh-harness-evolve/blob/master/docs/quickstart.md

原创部分为 MIT；内联第三方材料保留各自许可。安装包附带 NOTICE、THIRD_PARTY_NOTICES.md 和 LICENSES/（Apache-2.0 与 DeepSeek MIT 全文）。
