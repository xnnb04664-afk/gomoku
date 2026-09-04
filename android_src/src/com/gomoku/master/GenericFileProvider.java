package com.gomoku.master;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import java.io.File;
import java.io.FileNotFoundException;

/**
 * 跨进程安全 FileProvider (支持 Android 7.0 ~ Android 15 / API 21~35)
 * 解决原生安装 APK 时系统 PackageInstaller 无法读取应用私有目录导致的【安装包不存在】问题
 */
public class GenericFileProvider extends ContentProvider {

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (uri == null || !"/download/gomoku_latest.apk".equals(uri.getPath()) || !"r".equals(mode)) {
            throw new FileNotFoundException("拒绝访问非安装包 URI");
        }
        File destDir = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (destDir == null) {
            destDir = getContext().getFilesDir();
        }
        File apkFile = new File(destDir, "gomoku_latest.apk");
        if (apkFile.exists()) {
            return ParcelFileDescriptor.open(apkFile, ParcelFileDescriptor.MODE_READ_ONLY);
        }
        throw new FileNotFoundException("安装包未就绪: " + uri.getPath());
    }

    @Override
    public String getType(Uri uri) {
        return "application/vnd.android.package-archive";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        return null;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        return null;
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
