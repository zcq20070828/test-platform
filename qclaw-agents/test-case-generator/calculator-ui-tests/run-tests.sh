#!/bin/bash

# 计算器UI自动化测试执行脚本
# 使用方法: ./run-tests.sh [选项]

set -e

echo "========================================="
echo "   计算器UI自动化测试执行脚本"
echo "========================================="
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查Node.js
if ! command -v node &> /dev/null; then
    echo -e "${RED}错误: 未检测到Node.js,请先安装Node.js${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Node.js版本: $(node -v)${NC}"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo ""
    echo -e "${YELLOW}未检测到依赖,正在安装...${NC}"
    npm install
    echo -e "${GREEN}✓ 依赖安装完成${NC}"
fi

# 检查Playwright浏览器
if [ ! -d "$HOME/.cache/ms-playwright" ] && [ ! -d "$HOME/Library/Caches/ms-playwright" ]; then
    echo ""
    echo -e "${YELLOW}未检测到Playwright浏览器,正在安装...${NC}"
    npx playwright install
    echo -e "${GREEN}✓ 浏览器安装完成${NC}"
fi

echo ""
echo "========================================="
echo "   选择测试类型"
echo "========================================="
echo "1) 运行所有测试"
echo "2) 等价类划分测试"
echo "3) 边界值测试"
echo "4) 优先级测试"
echo "5) 操作功能测试"
echo "6) 异常场景测试"
echo "7) 可视化模式运行"
echo "8) 调试模式运行"
echo "9) 查看测试报告"
echo "0) 退出"
echo "========================================="
echo ""

read -p "请选择 (0-9): " choice

case $choice in
    1)
        echo ""
        echo -e "${GREEN}运行所有测试...${NC}"
        npm test
        ;;
    2)
        echo ""
        echo -e "${GREEN}运行等价类划分测试...${NC}"
        npm run test:equivalence
        ;;
    3)
        echo ""
        echo -e "${GREEN}运行边界值测试...${NC}"
        npm run test:boundary
        ;;
    4)
        echo ""
        echo -e "${GREEN}运行优先级测试...${NC}"
        npm run test:priority
        ;;
    5)
        echo ""
        echo -e "${GREEN}运行操作功能测试...${NC}"
        npm run test:operations
        ;;
    6)
        echo ""
        echo -e "${GREEN}运行异常场景测试...${NC}"
        npm run test:exceptions
        ;;
    7)
        echo ""
        echo -e "${GREEN}以可视化模式运行...${NC}"
        npm run test:ui
        ;;
    8)
        echo ""
        echo -e "${GREEN}以调试模式运行...${NC}"
        npm run test:debug
        ;;
    9)
        echo ""
        echo -e "${GREEN}打开测试报告...${NC}"
        npm run test:report
        ;;
    0)
        echo ""
        echo -e "${YELLOW}退出${NC}"
        exit 0
        ;;
    *)
        echo ""
        echo -e "${RED}无效选择${NC}"
        exit 1
        ;;
esac

echo ""
echo "========================================="
echo -e "${GREEN}   测试执行完成!${NC}"
echo "========================================="
echo ""
echo "查看详细报告: npm run test:report"
echo ""
