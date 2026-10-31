package com.boostmypc.android.scan

import android.app.AppOpsManager
import android.app.usage.StorageStatsManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Environment
import android.os.Process
import android.os.StatFs
import android.os.storage.StorageManager

data class AppInfo(
    val pkg: String,
    val label: String,
    val code: Long,
    val data: Long,
    val cache: Long,
    val lastUsed: Long,
    val installed: Long,
    val system: Boolean,
) {
    val total get() = code + data
}

data class Volume(val total: Long, val free: Long) {
    val used get() = total - free
}

fun volume(): Volume {
    val stat = StatFs(Environment.getDataDirectory().path)
    return Volume(stat.totalBytes, stat.availableBytes)
}

fun hasUsageAccess(context: Context): Boolean {
    val ops = context.getSystemService(AppOpsManager::class.java)
    val mode = if (Build.VERSION.SDK_INT >= 29) {
        ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    } else {
        @Suppress("DEPRECATION")
        ops.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
}

/**
 * Size of every installed app (code, data with cache, cache alone) and the last day it was opened.
 * Data includes the app's folder in Android/data. Needs usage access; without it the list is empty.
 */
fun loadApps(context: Context): List<AppInfo> {
    if (!hasUsageAccess(context)) return emptyList()
    val pm = context.packageManager
    val stats = context.getSystemService(StorageStatsManager::class.java)
    val usage = context.getSystemService(UsageStatsManager::class.java)
    val now = System.currentTimeMillis()
    val lastUsed = usage.queryAndAggregateUsageStats(now - 2L * 365 * 86_400_000, now)
        .mapValues { it.value.lastTimeUsed }
    val user = Process.myUserHandle()
    return pm.getInstalledApplications(PackageManager.GET_META_DATA).mapNotNull { app ->
        // Preinstalled apps stay preinstalled after an update; all are counted, as Android does.
        val system = app.flags and ApplicationInfo.FLAG_SYSTEM != 0
        val s = runCatching { stats.queryStatsForPackage(app.storageUuid ?: StorageManager.UUID_DEFAULT, app.packageName, user) }.getOrNull()
            ?: return@mapNotNull null
        val installed = runCatching { pm.getPackageInfo(app.packageName, 0).firstInstallTime }.getOrDefault(0L)
        AppInfo(
            pkg = app.packageName,
            label = pm.getApplicationLabel(app).toString(),
            code = s.appBytes,
            data = s.dataBytes,
            cache = s.cacheBytes,
            lastUsed = lastUsed[app.packageName] ?: 0L,
            installed = installed,
            system = system,
        )
    }.filter { it.pkg != context.packageName }.sortedByDescending { it.total }
}
