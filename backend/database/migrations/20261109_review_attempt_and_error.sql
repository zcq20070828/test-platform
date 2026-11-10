-- 20261109: 审核结果表补 attempt / error，让「审核不通过」可审计
--
-- 背景（2026-11-09 实测）：
--   1) task_review_results 全表 245 行 output 列全部为空。原因是写入时取了
--      result.text，而 callSingleReviewer 返回的对象只有 output 字段——字段名不匹配。
--      后果是「审核不通过」只有一个分数，没有理由、没有 issues，无法复核。
--   2) callReviewersSequentially 每次进入都先 DELETE 掉该 task 的历史审核记录，
--      所以只看得到最后一轮。一个重试 3 轮的任务，前两轮的分数与问题清单被删掉，
--      复盘时无法回答「是真改好了，还是模型改了措辞」。
--   3) 审核智能体自身调用失败时（网关超时/模型不可用），同一条 INSERT 会写入
--      score=0、passed=0，与「模型认真审核后给了 0 分」在数据上完全无法区分。
--      统计时这些 0 分会把通过率压低，看上去像是产出物质量崩了。
--
-- 修复：
--   - attempt：标注第几轮审核（0=首轮），历史不再删除，按 attempt 累积；
--   - error：审核智能体自身失败原因。非空表示该行不是一次有效判定，
--     统计与判定都必须排除（见 lib/review-verdict.js 的 isReviewerFailure）。
--
-- 兼容：两列均可空/有默认值，旧代码读写不受影响；旧数据 attempt=0、error=NULL。
ALTER TABLE task_review_results
  ADD COLUMN attempt INT NOT NULL DEFAULT 0
    COMMENT '第几轮审核（0=首轮），重试不再删除历史' AFTER passed,
  ADD COLUMN error VARCHAR(500) DEFAULT NULL
    COMMENT '审核智能体自身失败原因；非空表示该评分不可用' AFTER output,
  ADD INDEX idx_task_attempt (task_id, attempt);
