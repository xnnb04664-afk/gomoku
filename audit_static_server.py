from urllib.error import HTTPError, URLError
from urllib.request import urlopen


def probe(path):
    url = "http://127.0.0.1:3000/" + path
    try:
        with urlopen(url, timeout=5) as response:
            body = response.read()
            print(path, response.status, response.headers.get_content_type(), len(body))
    except HTTPError as exc:
        print(path, exc.code, "HTTPError", 0)
    except URLError as exc:
        print(path, "URLERROR", str(exc.reason), 0)


def main():
    for path in [
        "",
        "index.html",
        "server.js",
        "backend/worker.js",
        ".cloudflare_config.json",
        "release.keystore",
        ".git/config",
        "%2e%2e/server.js",
    ]:
        probe(path)


if __name__ == "__main__":
    main()
