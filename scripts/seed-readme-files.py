"""创建截图用的独立文件目录；保留目录内已存在的同名文件。"""

import argparse
from pathlib import Path


# 为本地与 SSH 远端的文件浏览器创建相同的无敏感信息演示项目。
def seed_files(destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    files = {
        'README.md': '# MiraiHub demo workspace\n\n仅用于 README 截图演示，无业务数据或凭据。\n',
        'package.json': '{\n  "name": "miraihub-demo",\n  "version": "1.0.0",\n  "private": true\n}\n',
        'docker-compose.yml': '# README 演示配置\nservices:\n  web:\n    image: nginx:alpine\n',
        'nginx.conf': '# README 演示配置\nserver {\n    listen 8080;\n    root /srv/demo/public;\n}\n',
        'config/app.json': '{\n  "app": "MiraiHub Demo",\n  "environment": "demo",\n  "debug": false\n}\n',
        'config/database.json': '{\n  "database": "miraihub_readme_demo",\n  "credentials": "not-included"\n}\n',
        'public/index.html': '<!doctype html>\n<html lang="zh-CN"><title>MiraiHub demo</title><h1>演示项目</h1></html>\n',
        'src/main.ts': '// README 演示入口\nexport const project = "MiraiHub Demo"\n',
        'logs/demo.log': '[DEMO] workspace ready\n[DEMO] sample data loaded: 24 orders\n',
    }
    for name, content in files.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_text(content, encoding='utf-8')
    print(f'{destination.resolve()}: {len(files)} demo files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path('output/readme-demo/files'))
    seed_files(parser.parse_args().output)
