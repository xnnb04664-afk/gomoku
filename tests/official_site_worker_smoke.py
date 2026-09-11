import json
from urllib.request import urlopen


def get(path):
    with urlopen(f"http://127.0.0.1:8788{path}", timeout=20) as response:
        return response.status, response.headers, response.read()


def main():
    status, _, body = get("/api/site-version")
    assert status == 200
    data = json.loads(body)
    assert data["code"] == 0 and data["tag"].startswith("v")
    assert data["build"] == 121

    for path, marker in (("/", "一盘棋"), ("/help/", "怎样开始一局"), ("/privacy/", "我们保存什么"), ("/play/", "gomokuResourceLoader")):
        status, _, body = get(path)
        assert status == 200, path
        assert marker in body.decode("utf-8"), path
    print("official site worker smoke: PASS")


if __name__ == "__main__":
    main()
