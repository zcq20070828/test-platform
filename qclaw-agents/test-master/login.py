"""用户登录功能模块"""

# 模拟用户数据库
USER_DB = {
    "admin": {"password": "admin123", "email": "admin@example.com"},
    "alice": {"password": "alice456", "email": "alice@example.com"},
    "bob": {"password": "bob789", "email": "bob@example.com"},
}


class LoginError(Exception):
    """登录异常基类"""
    pass


class UserNotFoundError(LoginError):
    """用户不存在"""
    pass


class PasswordError(LoginError):
    """密码错误"""
    pass


class InvalidInputError(LoginError):
    """输入无效"""
    pass


def validate_username(username):
    """验证用户名格式"""
    if not username:
        raise InvalidInputError("用户名不能为空")
    if len(username) < 3:
        raise InvalidInputError("用户名长度至少3个字符")
    if len(username) > 20:
        raise InvalidInputError("用户名长度不能超过20个字符")
    # 用户名只能包含字母、数字和下划线
    if not username.replace("_", "").isalnum():
        raise InvalidInputError("用户名只能包含字母、数字和下划线")
    return True


def validate_password(password):
    """验证密码格式"""
    if not password:
        raise InvalidInputError("密码不能为空")
    if len(password) < 6:
        raise InvalidInputError("密码长度至少6个字符")
    if len(password) > 30:
        raise InvalidInputError("密码长度不能超过30个字符")
    return True


def login(username, password):
    """
    用户登录验证
    
    Args:
        username: 用户名
        password: 密码
    
    Returns:
        dict: 用户信息（不包含密码）
    
    Raises:
        InvalidInputError: 输入验证失败
        UserNotFoundError: 用户不存在
        PasswordError: 密码错误
    """
    # 验证输入格式
    validate_username(username)
    validate_password(password)
    
    # 检查用户是否存在
    if username not in USER_DB:
        raise UserNotFoundError(f"用户 '{username}' 不存在")
    
    # 验证密码
    if USER_DB[username]["password"] != password:
        raise PasswordError("密码错误")
    
    # 返回用户信息（不包含密码）
    return {
        "username": username,
        "email": USER_DB[username]["email"]
    }


def register(username, password, email=None):
    """
    用户注册
    
    Args:
        username: 用户名
        password: 密码
        email: 邮箱（可选）
    
    Returns:
        dict: 新用户信息
    
    Raises:
        InvalidInputError: 输入验证失败
        LoginError: 用户已存在
    """
    # 验证输入格式
    validate_username(username)
    validate_password(password)
    
    if not email:
        raise InvalidInputError("邮箱不能为空")
    
    # 检查用户是否已存在
    if username in USER_DB:
        raise LoginError(f"用户 '{username}' 已存在")
    
    # 创建新用户
    USER_DB[username] = {
        "password": password,
        "email": email
    }
    
    return {
        "username": username,
        "email": email
    }


if __name__ == "__main__":
    # 简单交互测试
    print("=" * 60)
    print("          用户登录系统")
    print("=" * 60)
    
    while True:
        print("\n请选择操作:")
        print("1. 登录")
        print("2. 注册")
        print("3. 退出")
        
        choice = input("\n请输入选项(1/2/3): ").strip()
        
        if choice == "1":
            username = input("用户名: ").strip()
            password = input("密码: ").strip()
            try:
                user = login(username, password)
                print(f"\n✅ 登录成功！欢迎 {user['username']} ({user['email']})")
            except LoginError as e:
                print(f"\n❌ 登录失败: {e}")
        
        elif choice == "2":
            username = input("用户名: ").strip()
            password = input("密码: ").strip()
            email = input("邮箱: ").strip()
            try:
                user = register(username, password, email)
                print(f"\n✅ 注册成功！用户 {user['username']} 已创建")
            except LoginError as e:
                print(f"\n❌ 注册失败: {e}")
        
        elif choice == "3":
            print("\n再见！")
            break
        
        else:
            print("\n❌ 无效选项，请重新选择")
