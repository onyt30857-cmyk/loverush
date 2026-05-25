#!/usr/bin/env bash
# 安全版 admin 创建 · mnemonic 写本地文件 · stdout 只露 user_id
#
# 用法：
#   bash /tmp/register-admin-secure.sh "你想要的 display_name"
#
# 流程：
#   1. 跑脚本 → stdout 只打印 user_id（可以截图发任何人）
#   2. 跑 `open <secrets_file>` 打开本地敏感文件（mnemonic + tokens）
#   3. 复制到 1Password
#   4. 跑 `rm <secrets_file>` 删除本地文件

set -e
DISPLAY_NAME="${1:?usage: bash $0 \"<display_name>\"}"
SECRETS="$HOME/loverush-admin-$(date +%Y%m%d-%H%M%S).secrets"

RESP=$(curl -sS -X POST https://loverush-production.up.railway.app/auth/register \
  -H "Content-Type: application/json" \
  --data-binary @- <<JSON
{
  "user_type": "customer",
  "invite_code": "ADMIN-OPS-001",
  "display_name": "$DISPLAY_NAME",
  "locale": "zh"
}
JSON
)

python3 - "$RESP" "$SECRETS" "$DISPLAY_NAME" <<'PY'
import json, os, sys
resp = json.loads(sys.argv[1])
secrets_file = sys.argv[2]
display = sys.argv[3]

if "data" not in resp:
    print("ERROR · API 响应异常:", json.dumps(resp)[:400])
    sys.exit(1)

d = resp["data"]
user_id = d["user"]["id"]
mnemonic = d.get("mnemonic", "")
access = d.get("access_token", "")
refresh = d.get("refresh_token", "")

# Write sensitive to file with 600 perms
with open(secrets_file, "w") as f:
    f.write(f"# LoveRush admin secrets · display_name={display} · user_id={user_id}\n")
    f.write(f"# 创建时间: {d.get('expires_at','?')}\n")
    f.write(f"# 复制到 1Password 后跑: rm {secrets_file}\n\n")
    f.write(f"MNEMONIC (24 词 · 唯一恢复手段):\n{mnemonic}\n\n")
    f.write(f"ACCESS_TOKEN (1h TTL):\n{access}\n\n")
    f.write(f"REFRESH_TOKEN (30d TTL):\n{refresh}\n")
os.chmod(secrets_file, 0o600)

# stdout: 只可分享内容
print(f"user_id:      {user_id}")
print(f"display_name: {display}")
print(f"secrets:      {secrets_file}")
print()
print("下一步：")
print(f"  1. open {secrets_file}     # 打开敏感文件")
print(f"  2. 复制 mnemonic + tokens 到 1Password")
print(f"  3. rm {secrets_file}       # 删除本地文件")
PY
