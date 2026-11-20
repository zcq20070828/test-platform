-- 门禁「达标后收尾打磨」（2026-11-20）
--
-- 问题：门禁是「达标即停」——可用率 ≥85% 就 break，一轮都不修。
-- 实测任务 5d1f488c：186 条用例里 24 条不可用（18 条预期结果不可判定 +
-- 6 条步骤不合规），可用率 87.1% 刚过门槛，原样交付给用户。
-- 而同样的输入稍有波动就会掉到 85% 以下，此时才会去修。
-- 结果是一批「刚好过线」的半成品交付，用户仍需人工筛。
--
-- 解决：达标但未到打磨目标（默认门槛 +10 个百分点）时，用同一套定向修复
-- 再收一遍尾。打磨与「不达标修复」分开计数，且修完可用率下降就整轮回退。
--
-- 本表补两列以便趋势页区分这两类轮次。
-- 幂等：ADD COLUMN IF NOT EXISTS。

ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `polish_rounds` int(11) NOT NULL DEFAULT 0
    COMMENT '达标后的收尾打磨轮次（与 repair_rounds 分开统计）' AFTER `repair_rounds`;

ALTER TABLE `task_quality_metrics`
  ADD COLUMN IF NOT EXISTS `polish_gain` decimal(5,4) DEFAULT NULL
    COMMENT '打磨带来的可用率提升（打磨后 - 打磨前），回退时为 0' AFTER `polish_rounds`;
