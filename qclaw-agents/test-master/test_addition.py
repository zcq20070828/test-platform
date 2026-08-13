"""加法运算测试模块"""

def add(a, b):
    """加法运算"""
    return a + b


# 测试用例
test_cases = [
    # (a, b, expected, description)
    (1, 2, 3, "正数加法: 1 + 2 = 3"),
    (0, 0, 0, "零值加法: 0 + 0 = 0"),
    (-1, 1, 0, "正负加法: -1 + 1 = 0"),
    (-3, -5, -8, "负数加法: -3 + -5 = -8"),
    (100, 200, 300, "大数加法: 100 + 200 = 300"),
    (0, 5, 5, "零与正数: 0 + 5 = 5"),
    (-10, 0, -10, "负数与零: -10 + 0 = -10"),
    (999999, 1, 1000000, "边界加法: 999999 + 1 = 1000000"),
]


def run_tests():
    """执行所有测试用例，返回结果"""
    results = []
    for a, b, expected, desc in test_cases:
        actual = add(a, b)
        passed = actual == expected
        results.append({
            "desc": desc,
            "input": f"{a} + {b}",
            "expected": expected,
            "actual": actual,
            "passed": passed,
        })
    return results


if __name__ == "__main__":
    results = run_tests()
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed

    print("=" * 60)
    print("         加法运算测试报告")
    print("=" * 60)
    print(f"{'用例描述':<30} {'输入':<15} {'期望':<10} {'实际':<10} {'结果':<6}")
    print("-" * 60)
    for r in results:
        status = "✅ 通过" if r["passed"] else "❌ 失败"
        print(f"{r['desc']:<30} {r['input']:<15} {r['expected']:<10} {r['actual']:<10} {status}")
    print("=" * 60)
    print(f"总计: {total} 个用例, 通过: {passed} 个, 失败: {failed} 个")
    print(f"通过率: {passed/total*100:.1f}%")
    print("=" * 60)
