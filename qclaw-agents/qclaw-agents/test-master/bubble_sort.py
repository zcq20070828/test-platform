# 冒泡排序函数实现

def bubble_sort(arr):
    """
    冒泡排序算法实现
    
    参数:
        arr: 待排序的列表
    
    返回:
        排序后的列表
    """
    n = len(arr)
    
    # 外层循环控制排序轮数
    for i in range(n):
        # 优化：使用标志位检测是否已经有序
        swapped = False
        
        # 内层循环进行相邻元素比较和交换
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                # 交换相邻元素
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        
        # 如果这一轮没有发生交换，说明已经有序，提前结束
        if not swapped:
            break
    
    return arr


def bubble_sort_desc(arr):
    """
    冒泡排序 - 降序排列
    
    参数:
        arr: 待排序的列表
    
    返回:
        降序排列的列表
    """
    n = len(arr)
    
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if arr[j] < arr[j + 1]:  # 改为小于号实现降序
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        
        if not swapped:
            break
    
    return arr


# 测试代码
if __name__ == "__main__":
    # 测试用例
    test_cases = [
        [64, 34, 25, 12, 22, 11, 90],
        [5, 2, 8, 1, 9, 3],
        [1, 2, 3, 4, 5],  # 已排序
        [5, 4, 3, 2, 1],  # 逆序
        [42],  # 单个元素
        []  # 空列表
    ]
    
    print("=" * 50)
    print("冒泡排序测试")
    print("=" * 50)
    
    for i, arr in enumerate(test_cases, 1):
        original = arr.copy()
        sorted_arr = bubble_sort(arr.copy())
        print(f"\n测试用例 {i}:")
        print(f"原始数组: {original}")
        print(f"升序结果: {sorted_arr}")
        print(f"降序结果: {bubble_sort_desc(original.copy())}")
    
    print("\n" + "=" * 50)
    print("所有测试完成!")
    print("=" * 50)
