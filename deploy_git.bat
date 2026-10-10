@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo   邀请码测试系统 —— 一键初始化并提交 / 推送到 GitHub
echo ============================================================
echo.

REM 用本机已有的 PortableGit（WorkBuddy 自带，无需另行安装）
REM 注意：git.exe 在 cmd\ 子目录，不在 bin\（bin\ 只有 bash.exe）
set "PORTGIT=C:\Users\ace_t\.workbuddy\binaries\PortableGit\versions\1.2.0"
if exist "%PORTGIT%\cmd\git.exe" set "PATH=%PORTGIT%\cmd;%PATH%"
if exist "%PORTGIT%\bin\git.exe" set "PATH=%PORTGIT%\bin;%PATH%"

where git >nul 2>&1
if errorlevel 1 (
  echo [错误] 找不到 git.exe，请确认 PortableGit 路径是否存在：
  echo   %PORTGIT%
  pause
  exit /b 1
)

REM 1) 初始化（若尚未是仓库）
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [1/5] 初始化 git 仓库（默认分支 main）
  git init -b main
) else (
  echo [1/5] 已是 git 仓库，跳过初始化
)

REM 2) 暂存
echo [2/5] 暂存所有文件
git add .

REM 3) 展示状态，确认没有敏感文件被加入
echo [3/5] 当前暂存列表（请确认不含 data/ config.json node_modules）：
git status --short
echo.
echo 以下项应被忽略（列出即安全，不会上传）：
git check-ignore data config.json node_modules
echo.
echo 确认无误后按任意键提交；若发现敏感文件，请先关闭本窗口。
pause >nul

REM 4) 提交
echo [4/5] 提交
git -c user.name="tao" -c user.email="tao@local" commit -m "init invite-test-system"

REM 5) 远程 + 推送
echo [5/5] 推送至 GitHub
set /p REPO_URL=请输入你的 GitHub 仓库 HTTPS 地址（例如 https://github.com/用户名/invite-test-system.git）:
git remote get-url origin >nul 2>&1
if errorlevel 1 (
  git remote add origin %REPO_URL%
) else (
  git remote set-url origin %REPO_URL%
)
echo.
echo 即将推送。若提示输入用户名/密码：
echo   用户名 = 你的 GitHub 用户名
echo   密码   = GitHub Personal Access Token（不是登录密码！）
echo   如没有 Token：GitHub 网页 → 右上角头像 → Settings → Developer settings
echo              → Personal access tokens → Tokens(classic) → Generate，勾选 repo 权限，复制保存
echo.
pause
git push -u origin main

echo.
echo 完成。之后请回到部署文档，继续 Railway 部分。
pause
