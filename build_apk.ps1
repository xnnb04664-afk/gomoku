# ==========================================
# 五子棋 Android APK 自动化编译与打包脚本
# ==========================================

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host ">>> [1/7] 初始化打包环境变量..." -ForegroundColor Cyan

$SDK_DIR = "C:\Users\ZhuanZ1\AppData\Local\Android\Sdk"
$BUILD_TOOLS = "$SDK_DIR\build-tools\35.0.0"
$ANDROID_JAR = "$SDK_DIR\platforms\android-35\android.jar"

$AAPT2 = "$BUILD_TOOLS\aapt2.exe"
$D8 = "$BUILD_TOOLS\d8.bat"
$ZIPALIGN = "$BUILD_TOOLS\zipalign.exe"
$APKSIGNER = "$BUILD_TOOLS\apksigner.bat"

$ROOT_DIR = "d:\小游戏\五子棋"
$SRC_DIR = "$ROOT_DIR\android_src"
$BUILD_DIR = "$ROOT_DIR\android_build_tmp"
$OUTPUT_APK = "$ROOT_DIR\五子棋大师.apk"
$KEYSTORE = "$ROOT_DIR\release.keystore"

# 清理并重建临时目录
if (Test-Path $BUILD_DIR) {
    Remove-Item -Recurse -Force $BUILD_DIR
}
New-Item -ItemType Directory -Path "$BUILD_DIR\gen" | Out-Null
New-Item -ItemType Directory -Path "$BUILD_DIR\classes" | Out-Null
New-Item -ItemType Directory -Path "$BUILD_DIR\dex" | Out-Null
New-Item -ItemType Directory -Path "$SRC_DIR\assets" -Force | Out-Null

Write-Host ">>> [2/7] 同步 Web 前端资源至 Assets..." -ForegroundColor Cyan
Copy-Item "$ROOT_DIR\index.html" "$SRC_DIR\assets\" -Force
Copy-Item -Recurse "$ROOT_DIR\css" "$SRC_DIR\assets\" -Force
Copy-Item -Recurse "$ROOT_DIR\js" "$SRC_DIR\assets\" -Force

Write-Host ">>> [3/7] 编译 Android 资源 (aapt2 compile & link)..." -ForegroundColor Cyan
& $AAPT2 compile --dir "$SRC_DIR\res" -o "$BUILD_DIR\resources.zip"
if ($LASTEXITCODE -ne 0) { throw "aapt2 compile failed" }

& $AAPT2 link -I $ANDROID_JAR --manifest "$SRC_DIR\AndroidManifest.xml" `
    -o "$BUILD_DIR\unaligned.apk" `
    -A "$SRC_DIR\assets" `
    --java "$BUILD_DIR\gen" `
    "$BUILD_DIR\resources.zip" `
    --auto-add-overlay
if ($LASTEXITCODE -ne 0) { throw "aapt2 link failed" }

Write-Host ">>> [4/7] 编译 Java 源代码 (javac)..." -ForegroundColor Cyan
$javaFiles = @(
    "$SRC_DIR\src\com\gomoku\master\MainActivity.java",
    (Get-ChildItem -Recurse "$BUILD_DIR\gen" -Filter *.java).FullName
)
& javac -encoding UTF-8 -cp $ANDROID_JAR -d "$BUILD_DIR\classes" $javaFiles
if ($LASTEXITCODE -ne 0) { throw "javac compilation failed" }

Write-Host ">>> [5/7] 生成 Dalvik 可执行文件 (d8 dex)..." -ForegroundColor Cyan
$classFiles = (Get-ChildItem -Recurse "$BUILD_DIR\classes" -Filter *.class).FullName
& $D8 --output "$BUILD_DIR\dex" $classFiles --lib $ANDROID_JAR --min-api 21
if ($LASTEXITCODE -ne 0) { throw "d8 dex generation failed" }

# 将 classes.dex 打包进 APK
Write-Host ">>> [6/7] 合并 Dex 并对齐 APK (zipalign)..." -ForegroundColor Cyan
Copy-Item "$BUILD_DIR\unaligned.apk" "$BUILD_DIR\with_dex.apk" -Force

# 使用 aapt 或 7z/jar 添加 classes.dex
Push-Location "$BUILD_DIR\dex"
& "$BUILD_TOOLS\aapt.exe" add "$BUILD_DIR\with_dex.apk" classes.dex
Pop-Location

# 4字节对齐
& $ZIPALIGN -f -p 4 "$BUILD_DIR\with_dex.apk" "$BUILD_DIR\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "zipalign failed" }

Write-Host ">>> [7/7] 对 APK 进行 V1+V2 签名 (apksigner)..." -ForegroundColor Cyan
if (-not (Test-Path $KEYSTORE)) {
    & keytool -genkeypair -v -keystore $KEYSTORE -storepass 123456 -alias gomoku -keypass 123456 -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=GomokuMaster, OU=Game, O=ZhuanZ1, L=BJ, ST=BJ, C=CN"
}

& $APKSIGNER sign --ks $KEYSTORE --ks-pass pass:123456 --ks-key-alias gomoku --key-pass pass:123456 --out $OUTPUT_APK "$BUILD_DIR\aligned.apk"
if ($LASTEXITCODE -ne 0) { throw "apksigner failed" }

# 清理临时文件
Remove-Item -Recurse -Force $BUILD_DIR

$apkItem = Get-Item $OUTPUT_APK
$apkSizeMB = [Math]::Round($apkItem.Length / 1MB, 2)

Write-Host "=================================================" -ForegroundColor Green
Write-Host "🎉 APK 打包成功！" -ForegroundColor Green
Write-Host "📁 文件路径: $OUTPUT_APK" -ForegroundColor Yellow
Write-Host "📦 文件大小: $apkSizeMB MB" -ForegroundColor Yellow
Write-Host "=================================================" -ForegroundColor Green
