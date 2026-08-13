"""用户登录功能测试模块"""

from login import (
    login, register, USER_DB,
    LoginError, UserNotFoundError, PasswordError, InvalidInputError
)


# 测试用例：正常登录
test_login_success = [
    # (username, password, description)
    ("admin", "admin123", "管理员登录成功"),
    ("alice", "alice456", "普通用户alice登录成功"),
    ("bob", "bob789", "普通用户bob登录成功"),
]


# 测试用例：用户不存在
test_user_not_found = [
    # (username, password, description)
    ("nonexistent", "pass123", "不存在的用户登录"),
    ("unknown", "test456", "未知用户登录"),
]


# 测试用例：密码错误
test_password_error = [
    # (username, password, description)
    ("admin", "wrongpass", "管理员密码错误"),
    ("alice", "wrongpass", "用户alice密码错误"),
    ("bob", "incorrect", "用户bob密码错误"),
]


# 测试用例：输入验证失败
test_invalid_input = [
    # (username, password, description, expect_error)
    ("", "pass123", "用户名为空", InvalidInputError),
    ("", "", "用户名和密码都为空", InvalidInputError),
    ("ab", "pass123", "用户名太短(<3字符)", InvalidInputError),
    ("a" * 21, "pass123", "用户名太长(>20字符)", InvalidInputError),
    ("user@name", "pass123", "用户名包含特殊字符(@)", InvalidInputError),
    ("user name", "pass123", "用户名包含空格", InvalidInputError),
    ("admin", "", "密码为空", InvalidInputError),
    ("admin", "12345", "密码太短(<6字符)", InvalidInputError),
    ("admin", "a" * 31, "密码太长(>30字符)", InvalidInputError),
]


def run_test_case(test_func, username, password, description, expect_error=None):
    """
    执行单个测试用例
    
    Args:
        test_func: 测试函数（login/register）
        username: 用户名
        password: 密码
        description: 用例描述
        expect_error: 期望的异常类型（None表示期望成功）
    
    Returns:
        dict: 测试结果
    """
    try:
        if expect_error:
            # 期望抛出异常
            try:
                test_func(username, password)
                return {
                    "desc": description,
                    "username": username,
                    "password": "***",
                    "expected": f"抛出 {expect_error.__name__}",
                    "actual": "未抛出异常",
                    "passed": False,
                }
            except expect_error as e:
                return {
                    "desc": description,
                    "username": username,
                    "password": "***",
                    "expected": f"抛出 {expect_error.__name__}",
                    "actual": f"抛出 {type(e).__name__}: {str(e)[:30]}",
                    "passed": True,
                }
            except Exception as e:
                return {
                    "desc": description,
                    "username": username,
                    "password": "***",
                    "expected": f"抛出 {expect_error.__name__}",
                    "actual": f"抛出 {type(e).__name__}: {str(e)[:30]}",
                    "passed": False,
                }
        else:
            # 期望成功
            result = test_func(username, password)
            return {
                "desc": description,
                "username": username,
                "password": "***",
                "expected": "登录成功",
                "actual": f"登录成功: {result['username']}",
                "passed": True,
            }
    except Exception as e:
        return {
            "desc": description,
            "username": username,
            "password": "***",
            "expected": "登录成功",
            "actual": f"抛出 {type(e).__name__}: {str(e)[:30]}",
            "passed": False,
        }


def run_tests():
    """执行所有测试用例，返回结果"""
    results = []
    
    # 测试1: 正常登录
    for username, password, desc in test_login_success:
        result = run_test_case(login, username, password, desc)
        results.append(result)
    
    # 测试2: 用户不存在
    for username, password, desc in test_user_not_found:
        result = run_test_case(login, username, password, desc, UserNotFoundError)
        results.append(result)
    
    # 测试3: 密码错误
    for username, password, desc in test_password_error:
        result = run_test_case(login, username, password, desc, PasswordError)
        results.append(result)
    
    # 测试4: 输入验证失败
    for username, password, desc, error_type in test_invalid_input:
        result = run_test_case(login, username, password, desc, error_type)
        results.append(result)
    
    return results


def print_report(results):
    """打印测试报告"""
    total = len(results)
    passed = sum(1 for r in results if r["passed"])
    failed = total - passed
    
    print("=" * 80)
    print("          用户登录功能测试报告")
    print("=" * 80)
    print(f"{'序号':<4} {'用例描述':<30} {'用户名':<15} {'期望结果':<20} {'实际结果':<20} {'状态':<6}")
    print("-" * 80)
    
    for i, r in enumerate(results, 1):
        status = "✅ 通过" if r["passed"] else "❌ 失败"
        print(f"{i:<4} {r['desc']:<30} {r['username']:<15} {r['expected']:<20} {r['actual']:<20} {status}")
    
    print("=" * 80)
    print(f"总计: {total} 个用例, 通过: {passed} 个, 失败: {failed} 个")
    print(f"通过率: {passed/total*100:.1f}%")
    print("=" * 80)
    
    # 打印失败用例详情
    if failed > 0:
        print("\n失败用例详情:")
        print("-" * 80)
        for i, r in enumerate(results, 1):
            if not r["passed"]:
                print(f"{i}. {r['desc']}")
                print(f"   期望: {r['expected']}")
                print(f"   实际: {r['actual']}")
        print("=" * 80)


if __name__ == "__main__":
    results = run_tests()
    print_report(results)
