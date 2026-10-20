# INT-03 交付清单与偏差说明

> 卡片：INT-03 状态刷新与交付确认
> 基线：`origin/main` @ `05e62d7`（工作分支 `feature/7fcb1330-80c0-417f-9bec-9af22fb20513`）
> 范围：状态、索引、测试对比文件与交付偏差核对。**本轮不修改业务设计，不执行任何测试。**

## 1. 交付清单

| 类别 | 文件 | 状态 |
|------|------|------|
| 架构 | `docs/trace/runs/v1/spac.md` | 已交付 |
| 规划 | `docs/trace/runs/v1/agent_plane.md`、`docs/trace/runs/v1/issues.yaml` | 已交付 |
| 测试对比 | `docs/trace/runs/v1/test-results/{card-id}.md`（22 份） | 已交付 |
| 交付核对 | `README.md`、`docs/trace/runs/v1/delivery-checklist.md` | 本卡产出 |
| 共享约定 | `conventions.md`、`roles.md`、`scenes.md` | 已交付 |
| 数据锚点 | `schema-shared.sql`、`seed-anchors.sql` | 已交付 |
| 共享内核 | `shared-kernel-manifest.yaml`、`docs/knowledge/shared-kernel-api.md` | 已交付 |
| 知识库 | `docs/knowledge/config-contract.md`、`dependency-graph.yaml`、`module-template.md`、`phase-contracts/`、`designs/` | 已交付 |
| 输入 | `input/v1.0/` | 未修改 |

## 2. 卡片状态核对

`issues.yaml` 顶层状态为 `design`；22 张卡均无独立 `status` 字段，不存在 `in_progress`/`done` 卡片状态。

| 卡片 | 状态 | test-results | 文件 | 设计态执行状态 |
|------|------|--------------|------|----------------|
| P0-01 | `design` | `docs/trace/runs/v1/test-results/P0-01.md` | 存在 | 设计态：未执行 |
| P0-02 | `design` | `docs/trace/runs/v1/test-results/P0-02.md` | 存在 | 设计态：未执行 |
| P0-03 | `design` | `docs/trace/runs/v1/test-results/P0-03.md` | 存在 | 设计态：未执行 |
| P0-04 | `design` | `docs/trace/runs/v1/test-results/P0-04.md` | 存在 | 设计态：未执行 |
| P0-05 | `design` | `docs/trace/runs/v1/test-results/P0-05.md` | 存在 | 设计态：未执行 |
| P0-06 | `design` | `docs/trace/runs/v1/test-results/P0-06.md` | 存在 | 设计态：未执行 |
| P0-07 | `design` | `docs/trace/runs/v1/test-results/P0-07.md` | 存在 | 设计态：未执行 |
| P0-08 | `design` | `docs/trace/runs/v1/test-results/P0-08.md` | 存在 | 设计态：未执行 |
| D01 | `design` | `docs/trace/runs/v1/test-results/D01.md` | 存在 | 设计态：未执行 |
| D02 | `design` | `docs/trace/runs/v1/test-results/D02.md` | 存在 | 设计态：未执行 |
| D03 | `design` | `docs/trace/runs/v1/test-results/D03.md` | 存在 | 设计态：未执行 |
| D04 | `design` | `docs/trace/runs/v1/test-results/D04.md` | 存在 | 设计态：未执行 |
| D05 | `design` | `docs/trace/runs/v1/test-results/D05.md` | 存在 | 设计态：未执行 |
| D06 | `design` | `docs/trace/runs/v1/test-results/D06.md` | 存在 | 设计态：未执行 |
| D07 | `design` | `docs/trace/runs/v1/test-results/D07.md` | 存在 | 设计态：未执行 |
| D08 | `design` | `docs/trace/runs/v1/test-results/D08.md` | 存在 | 设计态：未执行 |
| D09 | `design` | `docs/trace/runs/v1/test-results/D09.md` | 存在 | 设计态：未执行 |
| D10 | `design` | `docs/trace/runs/v1/test-results/D10.md` | 存在 | 设计态：未执行 |
| D11 | `design` | `docs/trace/runs/v1/test-results/D11.md` | 存在 | 设计态：未执行 |
| INT-01 | `design` | `docs/trace/runs/v1/test-results/INT-01.md` | 存在 | 设计态：未执行 |
| INT-02 | `design` | `docs/trace/runs/v1/test-results/INT-02.md` | 存在 | 设计态：未执行 |
| INT-03 | `design` | `docs/trace/runs/v1/test-results/INT-03.md` | 存在 | 设计态：未执行 |

## 3. 核对结果

| 检查 | 结果 | 证据 |
|------|------|------|
| 22 个 id 均有对应 `test-results/{card-id}.md` | 通过 | 22/22，缺失 0 |
| 所有 test-results 含 `执行状态：未执行` | 通过 | 22/22，缺失 0 |
| `issues.yaml` 无 `in_progress`/`done` 状态 | 通过 | 顶层 `design`；卡内 status 字段 0 个 |
| `input/` 未被修改 | 通过 | `git status --porcelain -- input/` 为空 |
| README 文档索引目标存在 | 通过 | 19/19 个路径存在 |
| 未删除既有文件/偏差记录 | 通过 | `git diff --diff-filter=D --name-only` 为空 |

> 以上均为静态文档核对，不代表任何业务测试通过。`test-results` 中的设计态结论统一为「未执行」。

## 4. 偏差说明

### 4.1 子技能缺失（GAP-09）

- 缺失：`architecture-design-generator`、`plane-issue-decomposer`、`bmad-review`、`bmad-deep-recon`。
- 处置：主流程直接执行等价步骤（架构生成、卡片拆解、双 Gate 对抗评审）；未把缺失技能写成已完成调用。

### 4.2 孤儿用例（不新增覆盖）

| 类别 | 数量 | 编号 |
|------|-----:|------|
| 整条孤儿 | 11 | TC-BD-004、TC-BD-008、TC-AP-012、TC-AP-016、TC-EX-002、TC-EX-003、TC-CM-006、TC-AU-001、TC-AU-002、TC-AU-003、TC-AU-005 |
| 孤儿子断言 | 6 | O-AP-001-PERF、O-AT-007-GROUP、O-LG-001-PERM、O-BD-022-LOGIN、O-AU-006-LOGIN、O-AU-009-LOGIN |
| 永久孤儿 | 3 | OR-BD-004、OR-AP-016、O-LG-001-PERM |

- 明细与处置见 `output/v1.0/孤儿测试用例.md`；本卡只汇总登记，不删除、不冒充覆盖、不新增覆盖。

### 4.3 应用模块偏差（GAP-02 / GAP-03）

- `exchange` 应用模块：承载导入、导出、打印（D09/D10）；DDD 原始上下文未提供该模块。
- `statistics` 应用模块：承载工作量统计（D11），只读 `WorkloadQueryService`；DDD 原始上下文未提供该模块。
- 处置：在 `agent_plane.md` 差距报告中显式登记，未把应用模块伪装成领域限界上下文。

### 4.4 基线实现记录偏差

- 基线中部分 `test-results` 文件已含后续实现或静态验证记录（D01、D03、D04、D05、D06、D07、D08、D09、D11、P0-01、P0-02、P0-03、P0-04、P0-05、P0-07、P0-08）。
- 本卡按「设计态对比章节」口径核对：这些章节统一追加 `执行状态：未执行`；文件中已有的后续记录原样保留，不删除、不覆盖。
- 因此：若按文件全文口径，不能声称所有 test-results 都只有「未执行」记录；本卡不虚报，登记为基线偏差。

### 4.5 执行环境说明

- 工作区初始化标记为 `CHECKOUT_FAILED`；本次从 `origin/main` @ `05e62d7` 的官方 tarball 物化同一 commit 树，物化后 `git status` 干净。
- 未改动 `input/`；未执行数据库迁移、业务测试或端到端测试。

## 5. 下一轮入口

- 设计基准：`docs/trace/runs/v1/`（`spac.md`、`issues.yaml`、`test-results/`）。
- 执行入口：按 `issues.yaml` §3.2 执行波次从 W0（P0-01）开始；设计变更回到对应卡片处理，不在本卡扩展业务设计。
- 集成入口：INT-01 端到端验收 → INT-02 契约冻结归档 → INT-03 交付确认（本卡）。

## 6. 结论

- 交付文档一致，无虚报；本卡不声称任何测试通过。
- 偏差（子技能缺失、孤儿用例、应用模块、基线实现记录）均已登记，未删除任何既有偏差记录。
