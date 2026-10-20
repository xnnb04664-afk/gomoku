# APK 启动与包体优化候选

日期：2026-10-20。基于当前 `master` 的 `0f5caa8`，保留已有更新引导、棋盘与 AI 功能。GitHub v1.0.147 已于此前发布；本轮形成新的本地优化候选，没有覆盖现有 Release 附件或重新部署生产。

## 改动

- 原生库保留 `-O3`，不修改搜索源码、预算或评分。通过函数/数据分段及链接器垃圾回收删除未使用代码，隐藏静态 C++ 运行库导出，使用 NDK 自带 `llvm-strip --strip-unneeded` 移除符号元数据。包内仍包含 arm64-v8a、armeabi-v7a、x86、x86_64 四种 ABI，且每种只导出实际需要的两个 JNI 入口。
- 每次构建在 `.codex-diagnostics/native-symbols/<构建时间及进程号>/<ABI>/` 留下未裁剪的匹配库，供崩溃地址符号化；包内库保留 Build ID 和异常展开等运行信息。这个诊断目录不会发布进 APK 或 Git。
- 原生启动页素材成功加载后移除位于正式画面下方的备用海报；不再在不透明天空图片下重复填充整屏底色。素材加载失败仍保留备用海报，已有异步解码、纹理准备、逐颗落子和 180 ms 淡出逻辑保留。
- 新增实际 APK 的 ELF 包装检查，并在发布文件清单中登记该检查与本文档。

构建与链接依据：[NDK 构建维护指南](https://android.googlesource.com/platform/ndk/+/refs/heads/main/docs/BuildSystemMaintainers.md)、[Android NDK 符号可见性建议](https://developer.android.com/ndk/guides/middleware-vendors)。

## 对照结果

- 优化前 APK：4,202,895 bytes；优化后大小和摘要见下方最终核验。初次构建为 3,883,407 bytes，约减少 312 KiB / 7.6%。
- 四种原生库的 ZIP 压缩总量从 761,041 bytes 降为 440,940 bytes，约减少 42.1%；arm64 库定义导出由 552 个降为 2 个。以上是实际包内文件统计，不代表帧率或搜索速度提高相同比例。
- 本轮不重压缩美术图片，也不通过移除架构来减少体积。

## 验证与边界

- `native_apk_packaging_smoke.py`：检查实际 APK 四种 ABI 的精确 JNI 导出集合、移除符号表、保留 Build ID 和至少 16 KiB ELF LOAD 对齐。
- `native_ai_jni_smoke.py`：真实主机 JVM 调用当前 C++ JNI，验证黑白双方必胜落点、Java 回退、初始化与输入不变；主机测试使用对应平台支持的分段/垃圾回收参数。Windows PE 不支持 ELF 的 exclude-libs 参数，Android ELF 的导出裁剪由上述实际 APK 检查单独验证。
- AI 16 项战术/路由、原生启动回退、淡出生命周期、底包版本引导、资源清单检查通过。
- 完整 APK 构建通过；正式签名、ZIP 对齐和最终包核验随后记录。
- `adb devices -l` 无设备；没有宣称真机帧率、启动耗时或设备完整安装验收通过。

优化前 APK 备份：`D:\回收站\gomoku-before-apk-opt-20261020-105250\五子棋.apk`。保留原签名与版本号 `1.0.147 / Build 148`，需要完整安装这个优化 APK 才能应用原生库与原生启动页变化。

## 最终候选核验

- APK：3,883,407 bytes（约 3.70 MiB），SHA-256 `716cda0ca3e3c658be55a79794eaae44acba39af3fc5fbbf302f7d65059158df`。
- 相对备份减少 319,488 bytes，约 7.6%。包内 20 个 PNG/WebP/JPEG 图片文件逐字节一致，未降低画质。C++ 搜索源码 SHA-256 保持 `63696a09cfa13767b7b781b312cacc69c24c5274bb0d09d1a709569556a4e231`。
- 正式 v1/v2/v3 签名与 ZIP 16 KiB 对齐验证通过；签名证书 SHA-256 保持 `9895769979e7cf5a91243968464872dbd7320d8ff4b1448b382e5d02e676940e`。
- 四种 ABI 的实际包检查、原生 JNI 与 Java 回退、16 项 AI 战术/路由、资源清单、启动回退/淡出、13 黑/13 白早期像素、网页缓存及底包版本引导检查通过。没有设备可做实际启动耗时或帧率对照。
