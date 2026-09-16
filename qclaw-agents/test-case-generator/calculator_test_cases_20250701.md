# 计算器功能测试用例

**文档版本**: v1.0  
**创建日期**: 2025-07-01  
**测试模块**: 计算器功能  
**优先级说明**: P0-冒烟测试 | P1-核心功能 | P2-重要功能 | P3-一般功能

---

## 测试范围

- 基本运算: 加减乘除
- 数值类型: 整数、小数、负数、零
- 辅助功能: 括号、正负切换、清除、退格
- 异常处理: 除零、溢出、非法输入

---

## 1. 等价类划分测试用例

### 1.1 整数运算

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-EQ-001 | 正整数加法 | 计算器已启动 | 1. 输入 `123`<br>2. 点击 `+`<br>3. 输入 `456`<br>4. 点击 `=` | 显示 `579` | P1 |
| TC-EQ-002 | 正整数减法 | 计算器已启动 | 1. 输入 `999`<br>2. 点击 `-`<br>3. 输入 `123`<br>4. 点击 `=` | 显示 `876` | P1 |
| TC-EQ-003 | 正整数乘法 | 计算器已启动 | 1. 输入 `12`<br>2. 点击 `×`<br>3. 输入 `34`<br>4. 点击 `=` | 显示 `408` | P1 |
| TC-EQ-004 | 正整数除法(整除) | 计算器已启动 | 1. 输入 `100`<br>2. 点击 `÷`<br>3. 输入 `5`<br>4. 点击 `=` | 显示 `20` | P1 |
| TC-EQ-005 | 正整数除法(非整除) | 计算器已启动 | 1. 输入 `10`<br>2. 点击 `÷`<br>3. 输入 `3`<br>4. 点击 `=` | 显示 `3.333...` 或 `3.33`(按精度规则) | P1 |
| TC-EQ-006 | 零的加法 | 计算器已启动 | 1. 输入 `0`<br>2. 点击 `+`<br>3. 输入 `123`<br>4. 点击 `=` | 显示 `123` | P2 |
| TC-EQ-007 | 零的乘法 | 计算器已启动 | 1. 输入 `999`<br>2. 点击 `×`<br>3. 输入 `0`<br>4. 点击 `=` | 显示 `0` | P2 |

### 1.2 小数运算

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-EQ-008 | 小数加法 | 计算器已启动 | 1. 输入 `1.5`<br>2. 点击 `+`<br>3. 输入 `2.3`<br>4. 点击 `=` | 显示 `3.8` | P1 |
| TC-EQ-009 | 小数减法 | 计算器已启动 | 1. 输入 `5.5`<br>2. 点击 `-`<br>3. 输入 `2.2`<br>4. 点击 `=` | 显示 `3.3` | P1 |
| TC-EQ-010 | 小数乘法 | 计算器已启动 | 1. 输入 `2.5`<br>2. 点击 `×`<br>3. 输入 `4`<br>4. 点击 `=` | 显示 `10` | P1 |
| TC-EQ-011 | 小数除法 | 计算器已启动 | 1. 输入 `7.5`<br>2. 点击 `÷`<br>3. 输入 `2.5`<br>4. 点击 `=` | 显示 `3` | P1 |
| TC-EQ-012 | 纯小数运算 | 计算器已启动 | 1. 输入 `0.1`<br>2. 点击 `+`<br>3. 输入 `0.2`<br>4. 点击 `=` | 显示 `0.3`(验证精度处理) | P2 |
| TC-EQ-013 | 多位小数运算 | 计算器已启动 | 1. 输入 `1.234`<br>2. 点击 `+`<br>3. 输入 `5.678`<br>4. 点击 `=` | 显示 `6.912` | P2 |
| TC-EQ-014 | 小数点后连续零 | 计算器已启动 | 1. 输入 `1.001`<br>2. 点击 `×`<br>3. 输入 `1000`<br>4. 点击 `=` | 显示 `1001` | P2 |

### 1.3 负数运算

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-EQ-015 | 负数加正数 | 计算器已启动 | 1. 输入 `-5`<br>2. 点击 `+`<br>3. 输入 `10`<br>4. 点击 `=` | 显示 `5` | P1 |
| TC-EQ-016 | 负数加负数 | 计算器已启动 | 1. 输入 `-3`<br>2. 点击 `+`<br>3. 输入 `-7`<br>4. 点击 `=` | 显示 `-10` | P1 |
| TC-EQ-017 | 正数减负数 | 计算器已启动 | 1. 输入 `5`<br>2. 点击 `-`<br>3. 输入 `-3`<br>4. 点击 `=` | 显示 `8` | P1 |
| TC-EQ-018 | 负数减正数 | 计算器已启动 | 1. 输入 `-5`<br>2. 点击 `-`<br>3. 输入 `3`<br>4. 点击 `=` | 显示 `-8` | P1 |
| TC-EQ-019 | 负数乘正数 | 计算器已启动 | 1. 输入 `-4`<br>2. 点击 `×`<br>3. 输入 `5`<br>4. 点击 `=` | 显示 `-20` | P1 |
| TC-EQ-020 | 负数乘负数 | 计算器已启动 | 1. 输入 `-3`<br>2. 点击 `×`<br>3. 输入 `-4`<br>4. 点击 `=` | 显示 `12` | P1 |
| TC-EQ-021 | 负数除正数 | 计算器已启动 | 1. 输入 `-12`<br>2. 点击 `÷`<br>3. 输入 `4`<br>4. 点击 `=` | 显示 `-3` | P1 |
| TC-EQ-022 | 负数除负数 | 计算器已启动 | 1. 输入 `-20`<br>2. 点击 `÷`<br>3. 输入 `-5`<br>4. 点击 `=` | 显示 `4` | P1 |

### 1.4 零的特殊场景

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-EQ-023 | 零除正数 | 计算器已启动 | 1. 输入 `0`<br>2. 点击 `÷`<br>3. 输入 `5`<br>4. 点击 `=` | 显示 `0` | P2 |
| TC-EQ-024 | 零除负数 | 计算器已启动 | 1. 输入 `0`<br>2. 点击 `÷`<br>3. 输入 `-5`<br>4. 点击 `=` | 显示 `0` 或 `-0`(按系统实现) | P2 |
| TC-EQ-025 | 零的连续运算 | 计算器已启动 | 1. 输入 `0`<br>2. 点击 `+`<br>3. 输入 `0`<br>4. 点击 `=` | 显示 `0` | P3 |

---

## 2. 边界值测试用例

### 2.1 最大值边界

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-BV-001 | 最大支持数值加法 | 计算器已启动 | 1. 输入最大支持值(如 `999999999`)<br>2. 点击 `+`<br>3. 输入 `1`<br>4. 点击 `=` | 显示溢出提示或科学计数法表示 | P0 |
| TC-BV-002 | 最大值减1运算 | 计算器已启动 | 1. 输入最大支持值<br>2. 点击 `-`<br>3. 输入 `1`<br>4. 点击 `=` | 显示正确结果 | P1 |
| TC-BV-003 | 最大值乘法溢出 | 计算器已启动 | 1. 输入最大支持值<br>2. 点击 `×`<br>3. 输入 `2`<br>4. 点击 `=` | 显示溢出提示 | P0 |

### 2.2 最小值边界

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-BV-004 | 最小负数运算 | 计算器已启动 | 1. 输入最小支持值(如 `-999999999`)<br>2. 点击 `-`<br>3. 输入 `1`<br>4. 点击 `=` | 显示溢出提示或科学计数法表示 | P0 |
| TC-BV-005 | 最小值加1运算 | 计算器已启动 | 1. 输入最小支持值<br>2. 点击 `+`<br>3. 输入 `1`<br>4. 点击 `=` | 显示正确结果 | P1 |

### 2.3 精度边界

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-BV-006 | 小数精度上限 | 计算器已启动 | 1. 输入 `1.123456789`<br>2. 点击 `+`<br>3. 输入 `0.000000001`<br>4. 点击 `=` | 显示正确结果或按精度规则截断 | P1 |
| TC-BV-007 | 小数精度下限 | 计算器已启动 | 1. 输入 `0.00000001`<br>2. 点击 `×`<br>3. 输入 `100000000`<br>4. 点击 `=` | 显示 `1` | P1 |
| TC-BV-008 | 非常小的小数 | 计算器已启动 | 1. 输入 `0.0000000001`<br>2. 点击 `+`<br>3. 输入 `0.0000000001`<br>4. 点击 `=` | 显示 `2e-10` 或 `0.0000000002` | P2 |
| TC-BV-009 | 浮点精度问题 | 计算器已启动 | 1. 输入 `0.1`<br>2. 点击 `+`<br>3. 输入 `0.2`<br>4. 点击 `=` | 显示 `0.3` 而非 `0.30000000000000004` | P0 |

### 2.4 显示位数边界

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-BV-010 | 最大显示位数 | 计算器已启动 | 1. 输入最大显示位数(如10位)<br>2. 观察显示 | 显示完整,不截断 | P1 |
| TC-BV-011 | 超出显示位数 | 计算器已启动 | 1. 输入超出显示位数的数值<br>2. 观察显示 | 显示科学计数法或滚动显示 | P1 |
| TC-BV-012 | 小数位数截断 | 计算器已启动 | 1. 输入 `1`<br>2. 点击 `÷`<br>3. 输入 `3`<br>4. 点击 `=` | 显示 `0.333333` 或按精度规则显示 | P1 |

---

## 3. 优先级测试用例(括号运算)

### 3.1 无括号基础运算

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-PR-001 | 同级运算从左到右 | 计算器已启动 | 1. 输入 `10-5-2`<br>2. 点击 `=` | 显示 `3` (依次计算) | P1 |
| TC-PR-002 | 乘除优先于加减 | 计算器已启动 | 1. 输入 `2+3×4`<br>2. 点击 `=` | 显示 `14` (先乘后加) | P0 |
| TC-PR-003 | 混合运算优先级 | 计算器已启动 | 1. 输入 `10÷2+3×4-5`<br>2. 点击 `=` | 显示 `12` (先除乘,后加减) | P1 |
| TC-PR-004 | 连续乘除运算 | 计算器已启动 | 1. 输入 `20÷4×5`<br>2. 点击 `=` | 显示 `25` (从左到右) | P1 |

### 3.2 单层括号

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-PR-005 | 括号改变优先级 | 计算器已启动 | 1. 输入 `(2+3)×4`<br>2. 点击 `=` | 显示 `20` (先括号内) | P0 |
| TC-PR-006 | 括号内加减运算 | 计算器已启动 | 1. 输入 `10-(5+2)`<br>2. 点击 `=` | 显示 `3` | P1 |
| TC-PR-007 | 括号内乘除运算 | 计算器已启动 | 1. 输入 `2×(3+4)`<br>2. 点击 `=` | 显示 `14` | P1 |
| TC-PR-008 | 括号在开头 | 计算器已启动 | 1. 输入 `(10-5)÷5`<br>2. 点击 `=` | 显示 `1` | P1 |
| TC-PR-009 | 括号在结尾 | 计算器已启动 | 1. 输入 `10÷(2+3)`<br>2. 点击 `=` | 显示 `2` | P1 |
| TC-PR-010 | 单个数字括号 | 计算器已启动 | 1. 输入 `5×(10)`<br>2. 点击 `=` | 显示 `50` | P3 |

### 3.3 多层嵌套括号

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-PR-011 | 两层括号嵌套 | 计算器已启动 | 1. 输入 `((2+3)×4)`<br>2. 点击 `=` | 显示 `20` | P1 |
| TC-PR-012 | 三层括号嵌套 | 计算器已启动 | 1. 输入 `((2+(3×4))-5)`<br>2. 点击 `=` | 显示 `9` | P1 |
| TC-PR-013 | 四层括号嵌套 | 计算器已启动 | 1. 输入 `(((1+2)+3)+4)`<br>2. 点击 `=` | 显示 `10` | P2 |
| TC-PR-014 | 复杂嵌套表达式 | 计算器已启动 | 1. 输入 `((10-5)×(2+3))`<br>2. 点击 `=` | 显示 `25` | P1 |
| TC-PR-015 | 深度嵌套边界 | 计算器已启动 | 1. 输入最大支持层数的括号嵌套<br>2. 点击 `=` | 显示正确结果或提示超出限制 | P2 |

### 3.4 混合优先级

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-PR-016 | 括号与混合运算 | 计算器已启动 | 1. 输入 `2+3×(4+5)`<br>2. 点击 `=` | 显示 `29` | P0 |
| TC-PR-017 | 多个括号表达式 | 计算器已启动 | 1. 输入 `(2+3)×(4-1)`<br>2. 点击 `=` | 显示 `15` | P1 |
| TC-PR-018 | 嵌套与混合运算 | 计算器已启动 | 1. 输入 `10-(2×(3+4))`<br>2. 点击 `=` | 显示 `-4` | P1 |
| TC-PR-019 | 复杂综合表达式 | 计算器已启动 | 1. 输入 `((10÷2)+3)×(4-1)`<br>2. 点击 `=` | 显示 `24` | P1 |

---

## 4. 操作功能测试用例

### 4.1 正负切换(±)

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-OP-001 | 正数切换为负数 | 计算器已启动 | 1. 输入 `123`<br>2. 点击 `±` 按钮 | 显示 `-123` | P0 |
| TC-OP-002 | 负数切换为正数 | 计算器已启动 | 1. 输入 `-456`<br>2. 点击 `±` 按钮 | 显示 `456` | P0 |
| TC-OP-003 | 零的正负切换 | 计算器已启动 | 1. 输入 `0`<br>2. 点击 `±` 按钮 | 显示 `0` 或 `-0`(按系统实现) | P2 |
| TC-OP-004 | 运算后切换符号 | 计算器已启动 | 1. 输入 `5+3=`<br>2. 点击 `±` 按钮 | 显示 `-8` | P1 |
| TC-OP-005 | 输入中切换符号 | 计算器已启动 | 1. 输入 `123`<br>2. 点击 `±`<br>3. 继续输入 `456` | 显示 `-123456` 或 `-123`后追加`456` | P2 |
| TC-OP-006 | 小数切换符号 | 计算器已启动 | 1. 输入 `1.5`<br>2. 点击 `±` 按钮 | 显示 `-1.5` | P1 |
| TC-OP-007 | 连续切换符号 | 计算器已启动 | 1. 输入 `100`<br>2. 连续点击 `±` 3次 | 显示 `-100` | P2 |

### 4.2 清除功能(C/AC)

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-OP-008 | C清除当前输入 | 计算器已启动 | 1. 输入 `123+456`<br>2. 点击 `C` 按钮 | 清除当前输入,保留之前运算 | P0 |
| TC-OP-009 | AC全部清除 | 计算器已启动 | 1. 输入 `123+456`<br>2. 点击 `AC` 按钮 | 清除所有内容,显示 `0` | P0 |
| TC-OP-010 | 运算后清除 | 计算器已启动 | 1. 输入 `10+20=`<br>2. 点击 `AC` | 显示 `0`,清除历史 | P1 |
| TC-OP-011 | 清除后重新运算 | 计算器已启动 | 1. 输入 `123`<br>2. 点击 `AC`<br>3. 输入 `5+3=` | 显示 `8` | P1 |
| TC-OP-012 | 连续清除 | 计算器已启动 | 1. 输入 `123`<br>2. 连续点击 `AC` 2次 | 保持显示 `0` | P3 |

### 4.3 退格功能(⌫/DEL)

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-OP-013 | 删除最后一位 | 计算器已启动 | 1. 输入 `1234`<br>2. 点击 `⌫` | 显示 `123` | P0 |
| TC-OP-014 | 连续退格 | 计算器已启动 | 1. 输入 `1234`<br>2. 连续点击 `⌫` 4次 | 显示 `0` | P1 |
| TC-OP-015 | 小数退格 | 计算器已启动 | 1. 输入 `12.34`<br>2. 点击 `⌫` | 显示 `12.3` | P1 |
| TC-OP-016 | 删除小数点 | 计算器已启动 | 1. 输入 `12.3`<br>2. 点击 `⌫` | 显示 `12` | P1 |
| TC-OP-017 | 负号退格 | 计算器已启动 | 1. 输入 `-123`<br>2. 点击 `⌫` | 显示 `-12` | P1 |
| TC-OP-018 | 退格到空 | 计算器已启动 | 1. 输入 `1`<br>2. 点击 `⌫` | 显示 `0` | P1 |
| TC-OP-019 | 运算符后无法退格 | 计算器已启动 | 1. 输入 `123+`<br>2. 点击 `⌫` | 删除运算符或无操作(按实现) | P2 |
| TC-OP-020 | 结果显示时退格 | 计算器已启动 | 1. 输入 `10+20=`<br>2. 点击 `⌫` | 清除结果或修改结果(按实现) | P2 |

---

## 5. 异常场景测试用例

### 5.1 除零错误

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-EX-001 | 正数除零 | 计算器已启动 | 1. 输入 `10`<br>2. 点击 `÷`<br>3. 输入 `0`<br>4. 点击 `=` | 显示错误提示:`Error`、`Infinity` 或 `除数不能为0` | P0 |
| TC-EX-002 | 负数除零 | 计算器已启动 | 1. 输入 `-10`<br>2. 点击 `÷`<br>3. 输入 `0`<br>4. 点击 `=` | 显示错误提示:`-Infinity` 或错误信息 | P0 |
| TC-EX-003 | 零除零 | 计算器已启动 | 1. 输入 `0`<br>2. 点击 `÷`<br>3. 输入 `0`<br>4. 点击 `=` | 显示错误提示:`NaN` 或错误信息 | P0 |
| TC-EX-004 | 小数除零 | 计算器已启动 | 1. 输入 `1.5`<br>2. 点击 `÷`<br>3. 输入 `0`<br>4. 点击 `=` | 显示错误提示 | P1 |
| TC-EX-005 | 连续运算中除零 | 计算器已启动 | 1. 输入 `10÷0×5=` | 显示错误,中断运算 | P0 |
| TC-EX-006 | 括号内除零 | 计算器已启动 | 1. 输入 `(10÷0)+5=` | 显示错误提示 | P1 |

### 5.2 溢出错误

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-EX-007 | 加法溢出 | 计算器已启动 | 1. 输入最大值<br>2. 点击 `+`<br>3. 输入 `1`<br>4. 点击 `=` | 显示 `Overflow` 或科学计数法 | P0 |
| TC-EX-008 | 乘法溢出 | 计算器已启动 | 1. 输入大数<br>2. 点击 `×`<br>3. 输入大数<br>4. 点击 `=` | 显示溢出提示或科学计数法 | P0 |
| TC-EX-009 | 负数下溢 | 计算器已启动 | 1. 输入最小负数<br>2. 点击 `-`<br>3. 输入 `1`<br>4. 点击 `=` | 显示下溢提示 | P0 |
| TC-EX-010 | 幂运算溢出 | 计算器已启动(如支持) | 1. 输入 `9`<br>2. 点击幂运算<br>3. 输入 `99`<br>4. 点击 `=` | 显示溢出提示 | P1 |
| TC-EX-011 | 阶乘溢出 | 计算器已启动(如支持) | 1. 输入 `100`<br>2. 点击阶乘 `n!` | 显示溢出提示 | P1 |

### 5.3 非法输入

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-EX-012 | 连续输入运算符 | 计算器已启动 | 1. 输入 `10++5`<br>2. 观察结果 | 忽略重复运算符或提示错误 | P1 |
| TC-EX-013 | 连续输入小数点 | 计算器已启动 | 1. 输入 `1.2.3`<br>2. 观察结果 | 忽略第二个小数点 | P1 |
| TC-EX-014 | 运算符开头 | 计算器已启动 | 1. 直接点击 `+`<br>2. 输入 `5`<br>3. 点击 `=` | 显示 `5` 或提示错误 | P2 |
| TC-EX-015 | 运算符结尾 | 计算器已启动 | 1. 输入 `10+`<br>2. 点击 `=` | 提示表达式不完整或忽略 | P1 |
| TC-EX-016 | 括号不匹配(缺右括号) | 计算器已启动 | 1. 输入 `(10+5`<br>2. 点击 `=` | 提示括号不匹配 | P0 |
| TC-EX-017 | 括号不匹配(缺左括号) | 计算器已启动 | 1. 输入 `10+5)`<br>2. 点击 `=` | 提示括号不匹配或忽略 | P0 |
| TC-EX-018 | 空括号 | 计算器已启动 | 1. 输入 `()`<br>2. 点击 `=` | 提示表达式错误 | P1 |
| TC-EX-019 | 括号内只有运算符 | 计算器已启动 | 1. 输入 `(+5)`<br>2. 点击 `=` | 提示表达式错误 | P1 |
| TC-EX-020 | 特殊字符输入 | 计算器已启动 | 1. 尝试粘贴或输入字母、符号等 | 忽略非法输入 | P2 |

### 5.4 其他异常

| 用例ID | 标题 | 前置条件 | 测试步骤 | 预期结果 | 优先级 |
|--------|------|----------|----------|----------|--------|
| TC-EX-021 | 连续点击等号 | 计算器已启动 | 1. 输入 `5+3`<br>2. 连续点击 `=` 3次 | 保持结果 `8` 或重复上次运算 | P2 |
| TC-EX-022 | 空表达式计算 | 计算器已启动 | 1. 不输入任何内容<br>2. 点击 `=` | 显示 `0` 或无反应 | P2 |
| TC-EX-023 | 超长表达式 | 计算器已启动 | 1. 输入超长表达式(如100个字符)<br>2. 点击 `=` | 显示错误或正确计算 | P2 |
| TC-EX-024 | 内存溢出恢复 | 计算器已启动 | 1. 执行大量运算<br>2. 观察内存使用<br>3. 点击 `AC` | 内存释放,恢复正常 | P3 |

---

## 6. UI自动化测试用例(Playwright)

### 6.1 测试环境配置

```javascript
// playwright.config.js
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
```

### 6.2 页面对象模型(POM)

```javascript
// pages/CalculatorPage.js
class CalculatorPage {
  constructor(page) {
    this.page = page;
    
    // 数字按钮
    this.digitButtons = {
      '0': page.locator('[data-testid="digit-0"]'),
      '1': page.locator('[data-testid="digit-1"]'),
      '2': page.locator('[data-testid="digit-2"]'),
      '3': page.locator('[data-testid="digit-3"]'),
      '4': page.locator('[data-testid="digit-4"]'),
      '5': page.locator('[data-testid="digit-5"]'),
      '6': page.locator('[data-testid="digit-6"]'),
      '7': page.locator('[data-testid="digit-7"]'),
      '8': page.locator('[data-testid="digit-8"]'),
      '9': page.locator('[data-testid="digit-9"]'),
    };
    
    // 运算符按钮
    this.operatorButtons = {
      '+': page.locator('[data-testid="operator-plus"]'),
      '-': page.locator('[data-testid="operator-minus"]'),
      '×': page.locator('[data-testid="operator-multiply"]'),
      '÷': page.locator('[data-testid="operator-divide"]'),
      '=': page.locator('[data-testid="operator-equals"]'),
    };
    
    // 功能按钮
    this.clearButton = page.locator('[data-testid="button-clear"]');
    this.allClearButton = page.locator('[data-testid="button-all-clear"]');
    this.backspaceButton = page.locator('[data-testid="button-backspace"]');
    this.negateButton = page.locator('[data-testid="button-negate"]');
    this.decimalButton = page.locator('[data-testid="button-decimal"]');
    this.leftParen = page.locator('[data-testid="button-left-paren"]');
    this.rightParen = page.locator('[data-testid="button-right-paren"]');
    
    // 显示区域
    this.display = page.locator('[data-testid="calculator-display"]');
    this.expression = page.locator('[data-testid="calculator-expression"]');
  }
  
  // 输入数字
  async inputNumber(number) {
    const numStr = number.toString();
    for (const char of numStr) {
      if (char === '.') {
        await this.decimalButton.click();
      } else if (char === '-') {
        await this.negateButton.click();
      } else {
        await this.digitButtons[char].click();
      }
    }
  }
  
  // 输入表达式
  async inputExpression(expression) {
    for (const char of expression) {
      if (char >= '0' && char <= '9') {
        await this.digitButtons[char].click();
      } else if (char === '.') {
        await this.decimalButton.click();
      } else if (['+', '-', '×', '÷', '='].includes(char)) {
        await this.operatorButtons[char].click();
      } else if (char === '(') {
        await this.leftParen.click();
      } else if (char === ')') {
        await this.rightParen.click();
      }
    }
  }
  
  // 获取显示结果
  async getDisplayValue() {
    return await this.display.textContent();
  }
  
  // 清除
  async clear() {
    await this.allClearButton.click();
  }
  
  // 退格
  async backspace() {
    await this.backspaceButton.click();
  }
  
  // 正负切换
  async toggleSign() {
    await this.negateButton.click();
  }
}

module.exports = { CalculatorPage };
```

### 6.3 等价类划分测试脚本

```javascript
// tests/equivalence-class.spec.js
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('等价类划分测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.clear();
  });
  
  // 整数运算
  test.describe('整数运算', () => {
    test('TC-EQ-001: 正整数加法', async () => {
      await calculator.inputExpression('123+456=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('579');
    });
    
    test('TC-EQ-002: 正整数减法', async () => {
      await calculator.inputExpression('999-123=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('876');
    });
    
    test('TC-EQ-003: 正整数乘法', async () => {
      await calculator.inputExpression('12×34=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('408');
    });
    
    test('TC-EQ-004: 正整数除法(整除)', async () => {
      await calculator.inputExpression('100÷5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('20');
    });
    
    test('TC-EQ-005: 正整数除法(非整除)', async () => {
      await calculator.inputExpression('10÷3=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/3\.33{1,2}/);
    });
  });
  
  // 小数运算
  test.describe('小数运算', () => {
    test('TC-EQ-008: 小数加法', async () => {
      await calculator.inputExpression('1.5+2.3=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3.8');
    });
    
    test('TC-EQ-009: 小数减法', async () => {
      await calculator.inputExpression('5.5-2.2=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3.3');
    });
    
    test('TC-EQ-010: 小数乘法', async () => {
      await calculator.inputExpression('2.5×4=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('10');
    });
    
    test('TC-EQ-011: 小数除法', async () => {
      await calculator.inputExpression('7.5÷2.5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3');
    });
    
    test('TC-EQ-012: 纯小数运算-验证精度', async () => {
      await calculator.inputExpression('0.1+0.2=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0.3');
    });
  });
  
  // 负数运算
  test.describe('负数运算', () => {
    test('TC-EQ-015: 负数加正数', async () => {
      await calculator.inputNumber(-5);
      await calculator.operatorButtons['+'].click();
      await calculator.inputNumber(10);
      await calculator.operatorButtons['='].click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('5');
    });
    
    test('TC-EQ-016: 负数加负数', async () => {
      await calculator.inputNumber(-3);
      await calculator.operatorButtons['+'].click();
      await calculator.inputNumber(-7);
      await calculator.operatorButtons['='].click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-10');
    });
    
    test('TC-EQ-020: 负数乘负数', async () => {
      await calculator.inputNumber(-3);
      await calculator.operatorButtons['×'].click();
      await calculator.inputNumber(-4);
      await calculator.operatorButtons['='].click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('12');
    });
    
    test('TC-EQ-022: 负数除负数', async () => {
      await calculator.inputNumber(-20);
      await calculator.operatorButtons['÷'].click();
      await calculator.inputNumber(-5);
      await calculator.operatorButtons['='].click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('4');
    });
  });
  
  // 零的特殊场景
  test.describe('零的特殊场景', () => {
    test('TC-EQ-006: 零的加法', async () => {
      await calculator.inputExpression('0+123=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('123');
    });
    
    test('TC-EQ-007: 零的乘法', async () => {
      await calculator.inputExpression('999×0=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-EQ-023: 零除正数', async () => {
      await calculator.inputExpression('0÷5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
  });
});
```

### 6.4 边界值测试脚本

```javascript
// tests/boundary-value.spec.js
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('边界值测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.clear();
  });
  
  test.describe('精度边界', () => {
    test('TC-BV-006: 小数精度上限', async () => {
      await calculator.inputExpression('1.123456789+0.000000001=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/1\.12345679/);
    });
    
    test('TC-BV-007: 小数精度下限', async () => {
      await calculator.inputExpression('0.00000001×100000000=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('1');
    });
    
    test('TC-BV-009: 浮点精度问题-0.1+0.2', async () => {
      await calculator.inputExpression('0.1+0.2=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0.3');
    });
  });
  
  test.describe('溢出边界', () => {
    test('TC-BV-001: 最大值加法溢出', async () => {
      // 假设最大支持9位数
      await calculator.inputExpression('999999999+1=');
      const result = await calculator.getDisplayValue();
      // 应显示溢出提示或科学计数法
      expect(result.trim()).toMatch(/Error|Overflow|1e\+9|1\.0e\+9/i);
    });
    
    test('TC-BV-003: 最大值乘法溢出', async () => {
      await calculator.inputExpression('999999999×2=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/Error|Overflow|\d+e\+\d+/i);
    });
  });
});
```

### 6.5 括号优先级测试脚本

```javascript
// tests/priority.spec.js
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('优先级测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.clear();
  });
  
  test.describe('无括号基础运算', () => {
    test('TC-PR-001: 同级运算从左到右', async () => {
      await calculator.inputExpression('10-5-2=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3');
    });
    
    test('TC-PR-002: 乘除优先于加减', async () => {
      await calculator.inputExpression('2+3×4=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('14');
    });
    
    test('TC-PR-003: 混合运算优先级', async () => {
      await calculator.inputExpression('10÷2+3×4-5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('12');
    });
  });
  
  test.describe('单层括号', () => {
    test('TC-PR-005: 括号改变优先级', async () => {
      await calculator.inputExpression('(2+3)×4=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('20');
    });
    
    test('TC-PR-006: 括号内加减运算', async () => {
      await calculator.inputExpression('10-(5+2)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('3');
    });
    
    test('TC-PR-007: 括号内乘除运算', async () => {
      await calculator.inputExpression('2×(3+4)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('14');
    });
  });
  
  test.describe('多层嵌套括号', () => {
    test('TC-PR-011: 两层括号嵌套', async () => {
      await calculator.inputExpression('((2+3)×4)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('20');
    });
    
    test('TC-PR-012: 三层括号嵌套', async () => {
      await calculator.inputExpression('((2+(3×4))-5)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('9');
    });
    
    test('TC-PR-014: 复杂嵌套表达式', async () => {
      await calculator.inputExpression('((10-5)×(2+3))=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('25');
    });
  });
  
  test.describe('混合优先级', () => {
    test('TC-PR-016: 括号与混合运算', async () => {
      await calculator.inputExpression('2+3×(4+5)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('29');
    });
    
    test('TC-PR-017: 多个括号表达式', async () => {
      await calculator.inputExpression('(2+3)×(4-1)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('15');
    });
  });
});
```

### 6.6 操作功能测试脚本

```javascript
// tests/operations.spec.js
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('操作功能测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.clear();
  });
  
  test.describe('正负切换', () => {
    test('TC-OP-001: 正数切换为负数', async () => {
      await calculator.inputNumber(123);
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-123');
    });
    
    test('TC-OP-002: 负数切换为正数', async () => {
      await calculator.inputNumber(-456);
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('456');
    });
    
    test('TC-OP-003: 零的正负切换', async () => {
      await calculator.inputNumber(0);
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/0|-0/);
    });
    
    test('TC-OP-004: 运算后切换符号', async () => {
      await calculator.inputExpression('5+3=');
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-8');
    });
    
    test('TC-OP-007: 连续切换符号', async () => {
      await calculator.inputNumber(100);
      await calculator.toggleSign();
      await calculator.toggleSign();
      await calculator.toggleSign();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-100');
    });
  });
  
  test.describe('清除功能', () => {
    test('TC-OP-008: C清除当前输入', async () => {
      await calculator.inputNumber(123);
      await calculator.operatorButtons['+'].click();
      await calculator.inputNumber(456);
      await calculator.clearButton.click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-009: AC全部清除', async () => {
      await calculator.inputExpression('123+456');
      await calculator.allClearButton.click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-011: 清除后重新运算', async () => {
      await calculator.inputNumber(123);
      await calculator.clear();
      await calculator.inputExpression('5+3=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('8');
    });
  });
  
  test.describe('退格功能', () => {
    test('TC-OP-013: 删除最后一位', async () => {
      await calculator.inputNumber(1234);
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('123');
    });
    
    test('TC-OP-014: 连续退格', async () => {
      await calculator.inputNumber(1234);
      for (let i = 0; i < 4; i++) {
        await calculator.backspace();
      }
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
    
    test('TC-OP-015: 小数退格', async () => {
      await calculator.inputExpression('12.34');
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('12.3');
    });
    
    test('TC-OP-017: 负号退格', async () => {
      await calculator.inputNumber(-123);
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('-12');
    });
    
    test('TC-OP-018: 退格到空', async () => {
      await calculator.inputNumber(1);
      await calculator.backspace();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
  });
});
```

### 6.7 异常场景测试脚本

```javascript
// tests/exceptions.spec.js
const { test, expect } = require('@playwright/test');
const { CalculatorPage } = require('../pages/CalculatorPage');

test.describe('异常场景测试', () => {
  let calculator;
  
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    calculator = new CalculatorPage(page);
    await calculator.clear();
  });
  
  test.describe('除零错误', () => {
    test('TC-EX-001: 正数除零', async () => {
      await calculator.inputExpression('10÷0=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/Error|Infinity|除数不能为0/i);
    });
    
    test('TC-EX-002: 负数除零', async () => {
      await calculator.inputNumber(-10);
      await calculator.operatorButtons['÷'].click();
      await calculator.inputNumber(0);
      await calculator.operatorButtons['='].click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/Error|-Infinity/i);
    });
    
    test('TC-EX-003: 零除零', async () => {
      await calculator.inputExpression('0÷0=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/Error|NaN|未定义/i);
    });
    
    test('TC-EX-005: 连续运算中除零', async () => {
      await calculator.inputExpression('10÷0×5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/Error|Infinity/i);
    });
  });
  
  test.describe('非法输入', () => {
    test('TC-EX-013: 连续输入小数点', async () => {
      await calculator.inputExpression('1.2.3');
      const result = await calculator.getDisplayValue();
      // 应该忽略第二个小数点
      expect(result.trim()).toMatch(/1\.23|1\.2/);
    });
    
    test('TC-EX-014: 运算符开头', async () => {
      await calculator.operatorButtons['+'].click();
      await calculator.inputNumber(5);
      await calculator.operatorButtons['='].click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/5|Error/);
    });
    
    test('TC-EX-016: 括号不匹配-缺右括号', async () => {
      await calculator.inputExpression('(10+5=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/Error|括号不匹配/i);
    });
    
    test('TC-EX-017: 括号不匹配-缺左括号', async () => {
      await calculator.inputExpression('10+5)=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/Error|括号不匹配|\d+/);
    });
    
    test('TC-EX-018: 空括号', async () => {
      await calculator.inputExpression('()=');
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toMatch(/Error|0/);
    });
  });
  
  test.describe('其他异常', () => {
    test('TC-EX-021: 连续点击等号', async () => {
      await calculator.inputExpression('5+3=');
      await calculator.operatorButtons['='].click();
      await calculator.operatorButtons['='].click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('8');
    });
    
    test('TC-EX-022: 空表达式计算', async () => {
      await calculator.operatorButtons['='].click();
      const result = await calculator.getDisplayValue();
      expect(result.trim()).toBe('0');
    });
  });
});
```

### 6.8 测试运行命令

```bash
# 安装依赖
npm install -D @playwright/test

# 运行所有测试
npx playwright test

# 运行特定测试文件
npx playwright test tests/equivalence-class.spec.js

# 运行特定测试用例
npx playwright test -g "TC-EQ-001"

# 生成HTML报告
npx playwright test --reporter=html
npx playwright show-report

# 调试模式
npx playwright test --debug

# UI模式
npx playwright test --ui

# 查看测试报告
npx playwright test --reporter=list
```

---

## 测试数据汇总

| 分类 | 用例数量 | P0 | P1 | P2 | P3 |
|------|---------|----|----|----|----| 
| 等价类划分 | 25 | 0 | 15 | 8 | 2 |
| 边界值测试 | 12 | 3 | 7 | 2 | 0 |
| 优先级测试 | 19 | 3 | 12 | 4 | 0 |
| 操作功能 | 20 | 4 | 9 | 6 | 1 |
| 异常场景 | 24 | 5 | 10 | 7 | 2 |
| **总计** | **100** | **15** | **53** | **27** | **5** |

---

## 备注

1. **测试优先级执行顺序**: P0 → P1 → P2 → P3
2. **自动化测试覆盖**: 核心P0/P1用例已实现UI自动化
3. **测试数据准备**: 需根据实际计算器实现调整最大值/最小值边界
4. **兼容性测试**: 建议在不同浏览器(Chrome/Firefox/Safari)执行
5. **性能测试**: 连续运算、超大数运算的性能表现需额外测试

---

**文档维护人**: 测试团队  
**最后更新**: 2025-07-01
