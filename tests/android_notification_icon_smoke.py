"""Focused guard for the Android monochrome notification icon contract."""

from pathlib import Path
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
ANDROID_NS = "http://schemas.android.com/apk/res/android"
ANDROID = f"{{{ANDROID_NS}}}"


def main() -> None:
    icon_path = ROOT / "android_src/res/drawable/ic_stat_gomoku.xml"
    icon = ET.parse(icon_path).getroot()
    assert icon.tag == "vector", f"Expected vector drawable, got {icon.tag}"
    assert icon.attrib[f"{ANDROID}width"] == "24dp"
    assert icon.attrib[f"{ANDROID}height"] == "24dp"
    assert icon.attrib[f"{ANDROID}viewportWidth"] == "24"
    assert icon.attrib[f"{ANDROID}viewportHeight"] == "24"
    assert not any(key.endswith("background") for key in icon.attrib), "Notification icon must have a transparent canvas"

    paths = list(icon)
    assert paths, "Notification icon has no visible geometry"
    for path in paths:
        assert path.tag == "path", f"Unexpected drawable child: {path.tag}"
        for color_attr in ("fillColor", "strokeColor"):
            color = path.attrib.get(f"{ANDROID}{color_attr}")
            if color is None:
                continue
            assert color in {"#FFFFFFFF", "@android:color/transparent"}, (
                f"Notification geometry must stay monochrome/transparent, got {color}"
            )

    activity = (ROOT / "android_src/src/com/gomoku/master/MainActivity.java").read_text(encoding="utf-8")
    assert ".setSmallIcon(R.drawable.ic_stat_gomoku)" in activity
    assert ".setSmallIcon(R.drawable.ic_launcher)" not in activity

    print("android notification icon smoke: PASS")


if __name__ == "__main__":
    main()
