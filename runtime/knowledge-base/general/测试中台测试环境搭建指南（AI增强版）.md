# 测试中台测试环境搭建指南（AI增强版）

**版本：V2.0 | 定稿日期：2026-05-21**

---

## 文件变更记录

| 版本号 | 日期 | 变更类型 | 修改人 | 摘要 |
|--------|------|----------|--------|------|
| V1.0 | 2024-9-15 | C | 郭娟、安小龙等 | 初始版本 |
| V2.0 | 2026/05/21 | M | 测试中台AI智能体 | AI化改造，融入智能体协作与知识库驱动 |

---

## 目录

1. 目标机器安装Docker（AI版）
2. 镜像制作（AI版）
3. 获取测试环境所需的镜像（AI版）
4. 创建和运行容器（AI版）
5. 测试和验证（AI版）
6. 其他注意事项（AI版）
7. AI智能体环境管理规范

---

## 1. 目标机器安装Docker（AI版）

### 1.1 Linux系统（以Ubuntu为例）

```bash
# 1. 更新软件包列表
sudo apt update

# 2. 安装必要的依赖
sudo apt install apt-transport-https ca-certificates curl gnupg-agent software-properties-common

# 3. 添加Docker的官方GPG密钥
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -

# 4. 添加Docker软件源
sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"

# 5. 安装Docker引擎
sudo apt install docker-ce docker-ce-cli containerd.io
```

📌 **AI增强**：api-executor可自动执行Docker安装脚本，支持批量部署

### 1.2 Windows系统

下载并安装Docker Desktop for Windows（https://www.docker.com/）。安装过程中可能需要启用Hyper-V。

### 1.3 macOS系统

下载并安装Docker Desktop for Mac（https://www.docker.com/）。

---

## 2. 镜像制作（AI版）

### 2.1 准备工作

确保系统已安装Docker。

📌 **AI增强**：api-executor可自动检测Docker环境，安装缺失依赖

### 2.2 镜像制作方法

#### 2.2.1 基于现有镜像创建

```bash
# 启动镜像并在容器里做修改
docker run -itd centos:7 /bin/bash
docker ps  # 查看启动的镜像信息

# 将修改后的容器提交为新的镜像
docker commit -m "new-images" -a "test" dda50e36fd55 centos:test
docker images  # 查看新生成的镜像
```

#### 2.2.2 基于本地模板创建

```bash
# 下载模板
wget http://download.openvz.org/template/precreated/debian-7.0-x86-minimal.tar.gz

# 导入容器生成镜像
cat debian-7.0-x86-minimal.tar.gz | docker import - debian:test
```

#### 2.2.3 基于Dockerfile创建（推荐）

**📌 AI增强**：api-executor可根据测试需求自动生成Dockerfile

##### 示例1：Flask Web应用

```dockerfile
FROM python:latest
WORKDIR /app
COPY . /app
RUN pip install -r requirements.txt
EXPOSE 5000
CMD ["python", "app.py"]
```

```bash
# 构建镜像
docker build -t my_app_image .

# 查看构建的镜像
docker images
```

##### 示例2：httpd服务

```dockerfile
FROM centos:7
MAINTAINER this is apache image <test>
RUN yum -y update
RUN yum -y install httpd
EXPOSE 80
ADD index.html /var/www/html/index.html
ENTRYPOINT ["/usr/sbin/apachectl"]
CMD ["-D", "FOREGROUND"]
```

```bash
docker build -t httpd:centos .
docker run -d -p 40330:80 httpd:centos
# 访问 192.168.30.11:40330 进行测试
```

##### 示例3：sshd服务

```dockerfile
FROM centos:7
MAINTAINER this is ssh image <ssh>
RUN yum -y update
RUN yum -y install openssh* net-tools lsof telnet passwd
RUN echo "abc123" | passwd --stdin root
RUN sed -i 's/UsePAM yes/UsePAM no/g' /etc/ssh/sshd_config
RUN sed -i '12d' /etc/pam.d/sshd
RUN ssh-keygen -t rsa -A
RUN mkdir -p /root/.ssh && chown root.root /root && chmod 700 /root/.ssh
EXPOSE 22
ENTRYPOINT ["/usr/sbin/sshd"]
CMD ["-D", "FOREGROUND"]
```

```bash
docker build -t sshd:centos .
docker run -d -p 40022:22 sshd:centos
```

##### 示例4：systemd服务

```dockerfile
FROM sshd:centos
MAINTAINER this is systemctl image <systemd>
ENV container docker
RUN (cd /lib/systemd/system/sysinit.target.wants/; for i in *; do [ $i == systemd-tmpfiles-setup.service ] || rm -f $i; done); \
    rm -f /lib/systemd/system/multi-user.target.wants/*; \
    rm -f /etc/systemd/system/*.wants/*; \
    rm -f /lib/systemd/system/local-fs.target.wants/*; \
    rm -f /lib/systemd/system/sockets.target.wants/*udev*; \
    rm -f /lib/systemd/system/sockets.target.wants/*initctl*; \
    rm -f /lib/systemd/system/basic.target.wants/*; \
    rm -f /lib/systemd/system/anaconda.target.wants/*;
VOLUME ["/sys/fs/cgroup"]
CMD ["/usr/sbin/init"]
```

```bash
docker build -t systemd:centos .
docker run --privileged -d -P -v /sys/fs/cgroup:/sys/fs/cgroup:ro systemd:centos /sbin/init
```

##### 示例5：nginx服务

```dockerfile
FROM centos:7
MAINTAINER this is nginx image <nginx>
RUN yum -y update
RUN yum -y install pcre-devel zlib-devel gcc gcc-C++ make
RUN useradd -M -s /sbin/nologin nginx
ADD nginx-1.12.0.tar.gz /opt/
WORKDIR /opt/nginx-1.12.0
RUN ./configure --prefix=/usr/local/nginx --user=nginx --group=nginx --with-http_stub_status_module && make && make install
ENV PATH /usr/local/nginx/sbin:$PATH
EXPOSE 80
EXPOSE 443
RUN echo "daemon off;" >> /usr/local/nginx/conf/nginx.conf
ADD run.sh /run.sh
RUN chmod 755 /run.sh
CMD ["/run.sh"]
```

```bash
docker build -t nginx:centos .
docker run -itd -P nginx:centos /bin/bash
```

**⚠️ 网络报错修复**：

```bash
# [Warning] IPv4 forwarding is disabled. Networking will not work.
vim /etc/sysctl.conf
# 添加: net.ipv4.ip_forward=1
sysctl -p
systemctl restart network
systemctl restart docker
```

#### 2.2.4 镜像的其他操作

```bash
# 重命名镜像
docker tag my_app_image new_name:tag

# 推送镜像到仓库
docker login
docker push your_username/my_app_image
```

---

## 3. 获取测试环境所需的镜像（AI版）

```bash
# 搜索镜像
docker search python

# 拉取镜像
docker pull python:latest  # 最新版本
docker pull python:3.8     # 指定版本
```

📌 **AI增强**：
- api-executor可自动分析项目依赖，推荐合适的镜像版本
- 知识库驱动：记录历史项目使用的镜像版本，提供推荐

---

## 4. 创建和运行容器（AI版）

```bash
# 创建并运行容器
docker run -it --name my_python_test_container python:latest bash

# 在容器内安装测试框架
pip install pytest
```

📌 **AI增强**：
- api-executor可自动创建和配置测试容器
- 支持批量创建多个测试环境容器

---

## 5. 测试和验证（AI版）

| 验证方式 | 人工操作 | AI自动执行 |
|----------|---------|-----------|
| 浏览器访问验证 | ✅ 手动访问 | ✅ api-executor自动验证 |
| 测试脚本运行 | ✅ 手动执行 | ✅ api-executor自动运行 |
| 功能验证 | ✅ 手动验证 | ✅ api-executor自动验证 |
| 性能验证 | ✅ 手动验证 | ✅ api-executor自动验证 |

---

## 6. 其他注意事项（AI版）

### 6.1 容器资源管理

```bash
# 限制内存使用
docker run --memory=2g my_image

# 限制CPU使用
docker run --cpus=2 my_image
```

📌 **AI增强**：api-executor可根据测试类型自动配置资源限制：
- 功能测试：标准配置
- 性能测试：高配CPU和内存
- 安全测试：隔离网络

### 6.2 数据持久化

```bash
# 使用数据卷
docker run -v /host/path:/container/path my_image
```

📌 **AI增强**：测试数据自动挂载，data-masking确保敏感数据脱敏

### 6.3 容器网络配置

Docker提供多种网络模式：
- 桥接网络（默认）：容器间通信
- 自定义网络：复杂网络配置

📌 **AI增强**：api-executor自动配置测试网络，支持多环境隔离

---

## 7. AI智能体环境管理规范

### 智能体调度流程

| 阶段 | 智能体 | 职责 |
|------|--------|------|
| 环境检测 | api-executor | 自动检测Docker环境 |
| 镜像制作 | api-executor | 自动生成Dockerfile和构建镜像 |
| 容器创建 | api-executor | 自动创建和配置测试容器 |
| 环境验证 | api-executor | 自动验证环境可用性 |
| 数据准备 | test-data-generator | 生成测试数据 |
| 数据脱敏 | data-masking | 脱敏敏感数据 |
| 环境配置 | api-executor | 自动配置资源和网络 |
| 环境报告 | test-reporter | 自动生成环境配置报告 |

### 环境管理最佳实践

| 实践 | 描述 | AI实现 |
|------|------|--------|
| 环境一致性 | 确保测试环境与生产环境一致 | AI自动对比配置差异 |
| 环境隔离 | 不同测试任务使用独立环境 | AI自动创建隔离容器 |
| 环境可复现 | 记录环境配置，支持快速重建 | 知识库驱动配置管理 |
| 资源优化 | 按需分配资源，避免浪费 | AI自动调整资源限制 |

---

**文档编制**：测试中台AI智能体协作体系  
**技术支持**：test-master等13个智能体  
**质量审核**：ai-quality-reviewer-1/2/3 三重审核机制
