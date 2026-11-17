#!/usr/bin/env python3
"""Generate auditable HTTP and permission inventories into the external Humite doc site."""
import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JAVA = ROOT / "apps/server/src/main/java/com/elexvx/humite"
DEFAULT_DOC_DIR = Path(
    os.environ.get("HUMITE_DOC_DIR", "/Users/johntao/Documents/ChatGPT/doc/docs/humite")
)
REPO_BLOB_BASE = os.environ.get(
    "HUMITE_REPO_BLOB_BASE", "https://github.com/johntao2004/Silvae/blob/main"
)
ANNOTATION = re.compile(r"@(Get|Post|Put|Patch|Delete|Request)Mapping(?:\(([^)]*)\))?")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_DOC_DIR,
        help="Target directory for generated Markdown pages (defaults to external doc/docs/humite).",
    )
    return parser.parse_args()


def paths(arguments):
    if not arguments:
        return [""]
    match = re.match(r"\s*(?:(?:path|value)\s*=\s*)?(\{[^}]*\}|\"[^\"]*\")", arguments)
    if not match:
        raise ValueError("Unrecognized mapping: " + arguments)
    return re.findall(r'"([^"]*)"', match.group(1))


def main():
    args = parse_args()
    out_dir = args.output_dir.resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = []
    for source in sorted(JAVA.rglob("*Controller.java")):
        if source.name == "SpaForwardController.java":
            continue
        text = source.read_text(encoding="utf-8")
        declaration = re.search(r"\bclass\s+\w+", text)
        assert declaration, source
        prefix = text[: declaration.start()]
        base = list(ANNOTATION.finditer(prefix))
        bases = paths(base[-1].group(2)) if base else [""]
        for annotation in ANNOTATION.finditer(text, declaration.end()):
            if annotation.group(1) == "Request":
                raise ValueError("Add support for method-level RequestMapping: " + str(source))
            line = text.count("\n", 0, annotation.start()) + 1
            for base_path in bases:
                for suffix in paths(annotation.group(2)):
                    path = base_path + suffix
                    rows.append(
                        (
                            path,
                            annotation.group(1).upper(),
                            source.relative_to(ROOT).as_posix(),
                            line,
                        )
                    )

    header = f"""---
title: HTTP 接口清单
description: 查看从 Humite 服务端 Controller 生成的 {len(rows)} 条 HTTP 路由。
---

# HTTP 接口清单

由 §python3 scripts/generate-api-reference.py§ 从当前 Controller 注解生成；不含 SPA forward 和 Spring Boot Actuator。路径中的参数名保留实现定义。Spring 对 GET 的隐式 HEAD 支持不逐条列出。

此表只列路由，认证、权限及请求结构请参考 [API 说明](api.md) 和对应源码。

清单依据本地工作区生成。更名后的 §com.elexvx.humite§ 源码路径将在更名提交推送到 [上游仓库](https://github.com/johntao2004/Silvae) 后可用。

| 方法 | 路径 | 实现 |
| --- | --- | --- |
"""
    endpoints_md = header.replace("§", chr(96))
    for path, method, source, line in sorted(rows):
        endpoints_md += (
            f"| §{method}§ | §{path}§ | [{Path(source).stem}]({REPO_BLOB_BASE}/{source}#L{line}) |\n".replace(
                "§", chr(96)
            )
        )
    (out_dir / "api-endpoints.md").write_text(endpoints_md, encoding="utf-8")

    permissions = json.loads(
        (ROOT / "apps/server/src/main/resources/role-permissions.json").read_text(encoding="utf-8")
    )
    permissions_md = f"""---
title: 权限目录
description: 查阅 Humite 服务端权限配置生成的 {len(permissions)} 项权限码、默认角色和依赖。
---

# 权限目录

由 §python3 scripts/generate-api-reference.py§ 从 §role-permissions.json§ 生成。角色列是默认策略；Owner 可调整其他角色授权，当前生效策略以 §GET /api/v1/auth/permissions§ 为准。领域层仍检查资源归属及固定 Owner 约束。

| 分组 | 权限码 | 名称 | 默认角色 | 依赖 |
| --- | --- | --- | --- | --- |
""".replace("§", chr(96))
    for item in permissions:
        permissions_md += (
            "| "
            + " | ".join(
                [
                    item["group"],
                    "`" + item["code"] + "`",
                    item["label"],
                    ", ".join(item["roles"]),
                    ", ".join(item.get("requires", [])) or "—",
                ]
            )
            + " |\n"
        )
    (out_dir / "permissions.md").write_text(permissions_md, encoding="utf-8")
    print(f"Generated {len(rows)} HTTP routes and {len(permissions)} permissions into {out_dir}.")


if __name__ == "__main__":
    main()
