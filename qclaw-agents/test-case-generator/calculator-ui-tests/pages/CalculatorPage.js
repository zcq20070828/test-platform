/**
 * 计算器页面对象模型(Page Object Model)
 * 封装计算器的所有操作和元素定位
 */
class CalculatorPage {
  constructor(page) {
    this.page = page;
    
    // ========== 元素定位器 ==========
    
    // 数字按钮 (0-9)
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
    
    // ========== 备用定位器(如果没有data-testid) ==========
    // 这些是通用的备用选择器,根据实际HTML结构调整
    
    this.digitButtonsFallback = {
      '0': page.getByRole('button', { name: '0' }),
      '1': page.getByRole('button', { name: '1' }),
      '2': page.getByRole('button', { name: '2' }),
      '3': page.getByRole('button', { name: '3' }),
      '4': page.getByRole('button', { name: '4' }),
      '5': page.getByRole('button', { name: '5' }),
      '6': page.getByRole('button', { name: '6' }),
      '7': page.getByRole('button', { name: '7' }),
      '8': page.getByRole('button', { name: '8' }),
      '9': page.getByRole('button', { name: '9' }),
    };
    
    this.operatorButtonsFallback = {
      '+': page.getByRole('button', { name: '+' }),
      '-': page.getByRole('button', { name: '−' }),
      '×': page.getByRole('button', { name: '×' }),
      '÷': page.getByRole('button', { name: '÷' }),
      '=': page.getByRole('button', { name: '=' }),
    };
  }
  
  // ========== 核心操作方法 ==========
  
  /**
   * 点击数字按钮(智能选择定位器)
   * @param {string} digit - 数字字符 '0'-'9'
   */
  async clickDigit(digit) {
    try {
      await this.digitButtons[digit].click({ timeout: 2000 });
    } catch {
      await this.digitButtonsFallback[digit].click();
    }
  }
  
  /**
   * 输入完整数字
   * @param {number|string} number - 要输入的数字
   */
  async inputNumber(number) {
    const numStr = number.toString();
    
    for (const char of numStr) {
      if (char === '.') {
        await this.clickDecimal();
      } else if (char === '-') {
        await this.toggleSign();
      } else if (char >= '0' && char <= '9') {
        await this.clickDigit(char);
      }
      // 短暂延迟,确保按钮点击生效
      await this.page.waitForTimeout(50);
    }
  }
  
  /**
   * 点击运算符按钮
   * @param {string} operator - 运算符 '+', '-', '×', '÷', '='
   */
  async clickOperator(operator) {
    try {
      await this.operatorButtons[operator].click({ timeout: 2000 });
    } catch {
      await this.operatorButtonsFallback[operator].click();
    }
  }
  
  /**
   * 输入完整的数学表达式
   * @param {string} expression - 表达式字符串,如 '10+20='
   * @example
   * await calculator.inputExpression('123+456=');
   * await calculator.inputExpression('(2+3)×4=');
   */
  async inputExpression(expression) {
    for (const char of expression) {
      if (char >= '0' && char <= '9') {
        await this.clickDigit(char);
      } else if (char === '.') {
        await this.clickDecimal();
      } else if (['+', '-', '×', '÷', '='].includes(char)) {
        await this.clickOperator(char);
      } else if (char === '(') {
        await this.clickLeftParen();
      } else if (char === ')') {
        await this.clickRightParen();
      }
      await this.page.waitForTimeout(50);
    }
  }
  
  /**
   * 点击小数点
   */
  async clickDecimal() {
    try {
      await this.decimalButton.click({ timeout: 2000 });
    } catch {
      await this.page.getByRole('button', { name: '.' }).click();
    }
  }
  
  /**
   * 点击左括号
   */
  async clickLeftParen() {
    try {
      await this.leftParen.click({ timeout: 2000 });
    } catch {
      await this.page.getByRole('button', { name: '(' }).click();
    }
  }
  
  /**
   * 点击右括号
   */
  async clickRightParen() {
    try {
      await this.rightParen.click({ timeout: 2000 });
    } catch {
      await this.page.getByRole('button', { name: ')' }).click();
    }
  }
  
  // ========== 功能按钮操作 ==========
  
  /**
   * 清除当前输入(C按钮)
   */
  async clear() {
    try {
      await this.clearButton.click({ timeout: 2000 });
    } catch {
      await this.page.getByRole('button', { name: /c|clear/i }).first().click();
    }
  }
  
  /**
   * 全部清除(AC按钮)
   */
  async allClear() {
    try {
      await this.allClearButton.click({ timeout: 2000 });
    } catch {
      await this.page.getByRole('button', { name: /ac|all.?clear/i }).click();
    }
  }
  
  /**
   * 退格删除(DEL/⌫按钮)
   */
  async backspace() {
    try {
      await this.backspaceButton.click({ timeout: 2000 });
    } catch {
      await this.page.getByRole('button', { name: /del|⌫|backspace/i }).click();
    }
  }
  
  /**
   * 正负切换(±按钮)
   */
  async toggleSign() {
    try {
      await this.negateButton.click({ timeout: 2000 });
    } catch {
      await this.page.getByRole('button', { name: /±|negate/i }).click();
    }
  }
  
  // ========== 结果获取方法 ==========
  
  /**
   * 获取显示屏当前值
   * @returns {Promise<string>} 显示屏内容
   */
  async getDisplayValue() {
    try {
      const text = await this.display.textContent({ timeout: 2000 });
      return text.trim();
    } catch {
      // 备用方案:尝试查找结果区域
      const resultElement = await this.page.locator('[data-testid*="result"], [data-testid*="display"], .result, .display').first();
      const text = await resultElement.textContent();
      return text.trim();
    }
  }
  
  /**
   * 获取表达式显示
   * @returns {Promise<string>} 表达式内容
   */
  async getExpression() {
    try {
      const text = await this.expression.textContent({ timeout: 2000 });
      return text.trim();
    } catch {
      return '';
    }
  }
  
  /**
   * 验证显示结果是否匹配预期(带容错)
   * @param {string|number} expected - 预期值
   * @param {object} options - 选项
   * @param {number} options.precision - 小数精度位数
   * @param {boolean} options.exactMatch - 是否完全匹配
   */
  async verifyResult(expected, options = {}) {
    const { precision = 2, exactMatch = false } = options;
    const actual = await this.getDisplayValue();
    const expectedStr = expected.toString();
    
    if (exactMatch) {
      return actual === expectedStr;
    }
    
    // 数值比较(带精度)
    const actualNum = parseFloat(actual.replace(/,/g, ''));
    const expectedNum = parseFloat(expectedStr);
    
    if (isNaN(actualNum) || isNaN(expectedNum)) {
      return actual === expectedStr;
    }
    
    const tolerance = Math.pow(10, -precision);
    return Math.abs(actualNum - expectedNum) < tolerance;
  }
  
  /**
   * 检查是否显示错误
   * @returns {Promise<boolean>}
   */
  async isErrorDisplayed() {
    const display = await this.getDisplayValue();
    return /error|overflow|infinity|nan|undefined|错误/i.test(display);
  }
  
  /**
   * 等待计算完成
   * @param {number} timeout - 超时时间(ms)
   */
  async waitForResult(timeout = 5000) {
    await this.page.waitForTimeout(100);
  }
}

module.exports = { CalculatorPage };
