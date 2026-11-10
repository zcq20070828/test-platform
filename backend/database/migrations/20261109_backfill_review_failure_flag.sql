-- 20261109: 回填历史审核记录的 error 标记（只改统计口径，不改任务判定）
--
-- 为什么需要回填：
--   2026-11-09 排查「分步测试审核不通过比例高」时发现，245 条审核记录里有 14 条
--   score 为 0 或 5。逐条核对后可确认其中的 12 条不是模型的判定结果，而是审核链路故障：
--     - parseReviewResult 解析失败时旧代码返回 score=0。实测任务 fece20f3 的
--       reviewer-1 原文明确写了 "score": 76（日志可查），被记成 0；
--     - 三个审核员的提示词都写明「几乎无实质内容 <40 分」，不存在主动给 0/5 分的情形；
--     - 这 12 条对应的任务本身也是 failed（余额不足/网关超时/服务重启/402），
--       审核拿着失败占位文本去评，分数没有意义。
--   这些 0/5 混在统计里会把审核通过率从 93.5% 压到 88.2%（实测），
--   看上去像产出物质量崩了，实际是审核链路坏了。
--
-- 回填范围（严格限定，可审计）：
--   score IN (0, 5) 且 error 为空 且 对应任务 status='failed' —— 共 12 行。
--   刻意**不包含**任务状态为 completed 的记录（如 e959e621 的 5/5）：
--   那些分数虽然也偏离提示词的评分区间，但任务确实产出了交付物，
--   无法仅凭分数断定是解析故障还是审核员的真实判断，因此保留原判定不动。
--   标记后的行在统计与聚合中被排除（见 lib/review-verdict.js 的 isReviewerFailure），
--   但**不修改 tasks.review_passed / tasks.status**：任务当时怎么判就保留怎么判，
--   回填只解决「历史通过率算不准」，不翻案。
--
-- 可回滚：UPDATE task_review_results SET error = NULL WHERE error LIKE '历史回填%';
UPDATE task_review_results r
JOIN tasks t ON t.id = r.task_id
SET r.error = '历史回填：任务执行失败，审核分数为故障产物，非模型判定结果'
WHERE r.score IN (0, 5)
  AND (r.error IS NULL OR r.error = '')
  AND t.status = 'failed';
