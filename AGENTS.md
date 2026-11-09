# MiraiHub Agent 约定

适用范围：本仓库及其子目录。

## 默认加载 vue-code

- 每次在本仓库开始新任务时，先读取并启用用户的 `vue-code` 技能，按当前任务适用的规则执行，无需用户重复提醒或确认。
- 技能入口：`C:/Users/admin/.codex/skills/vue-code/SKILL.md`。该技能在技能清单中的名称为 `vue-frontend-architecture`。
- 如果入口路径不存在，先从当前可用技能清单中查找 `vue-code` 或 `vue-frontend-architecture` 的实际位置；仍未找到时明确说明缺失，不得声称已经加载。
- 同一对话中已读取且未变更的技能无需重复读取；每次对话首次启用时简短告知用户。
- 根据任务读取技能引用的相关参考文件，不要一次性加载整个 `references/` 目录。涉及 Vue 代码时同时遵循 `vue-best-practices`，其他关联技能按需读取。
- 具体编码规范以该技能当前内容为准，复用项目现有结构和实现，以最小必要改动完成任务，不为套用示例迁移或重写无关代码。
