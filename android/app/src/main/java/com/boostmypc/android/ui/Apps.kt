package com.boostmypc.android.ui

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap
import com.boostmypc.android.UiState
import com.boostmypc.android.daysAgo
import com.boostmypc.android.formatSize
import com.boostmypc.android.plural
import com.boostmypc.android.scan.AppInfo
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private enum class Sort(val label: String) { SIZE("Les plus lourdes"), IDLE("Inutilisées"), CACHE("Cache") }

@Composable
fun AppsScreen(state: UiState, usage: Boolean, onGrantUsage: () -> Unit, onBack: () -> Unit) {
    val context = LocalContext.current
    var sort by rememberSaveable { mutableStateOf(Sort.SIZE) }
    var showSystem by rememberSaveable { mutableStateOf(false) }
    val apps = state.apps.orEmpty().filter { showSystem || !it.system }
    val list = when (sort) {
        Sort.SIZE -> apps.sortedByDescending { it.total }
        Sort.IDLE -> apps.sortedWith(compareBy<AppInfo> { it.lastUsed }.thenByDescending { it.total })
        Sort.CACHE -> apps.sortedByDescending { it.cache }
    }
    Screen("Applications", if (apps.isEmpty()) null else "${plural(apps.size, "application", "applications")} · ${formatSize(apps.sumOf { it.total })}. Touchez une application pour vider son cache ou ses données.", Tint.APPS, onBack) {
        if (!usage) {
            Column(Modifier.padding(16.dp)) {
                ListRow("Accès aux données d'utilisation", "Android ne donne la taille des applications qu'avec cette autorisation.", null, leading = { IconTile(Icons.Rounded.Apps, Tint.APPS, 38.dp) }, onClick = onGrantUsage)
            }
            return@Screen
        }
        if (state.loadingApps && apps.isEmpty()) {
            Box(Modifier.padding(40.dp).size(40.dp).align(Alignment.CenterHorizontally)) { CircularProgressIndicator(color = Tint.APPS.to) }
            return@Screen
        }
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp)) {
            Sort.entries.forEach { s -> Chip(s.label, sort == s) { sort = s } }
            Chip("Applications système", showSystem) { showSystem = !showSystem }
        }
        LazyColumn(contentPadding = PaddingValues(16.dp)) {
            itemsIndexed(list, key = { _, a -> a.pkg }) { i, a ->
                val shape = when {
                    list.size == 1 -> RoundedCornerShape(24.dp)
                    i == 0 -> RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)
                    i == list.lastIndex -> RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp)
                    else -> RoundedCornerShape(0.dp)
                }
                Box(Modifier.glass(shape)) {
                    ListRow(
                        a.label,
                        "${daysAgo(a.lastUsed)} · App ${formatSize(a.code)} · Données ${formatSize(a.data - a.cache)}" + if (a.cache > 10_000_000) " · Cache ${formatSize(a.cache)}" else "",
                        formatSize(if (sort == Sort.CACHE) a.cache else a.total),
                        leading = { AppIcon(a.pkg) },
                        onClick = { context.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${a.pkg}"))) },
                        trailing = if (a.system) null else ({
                            IconButton(onClick = { context.startActivity(Intent(Intent.ACTION_DELETE, Uri.parse("package:${a.pkg}"))) }) {
                                Icon(Icons.Rounded.DeleteOutline, "Désinstaller", tint = Palette.text3)
                            }
                        }),
                    )
                }
            }
        }
    }
}

@Composable
private fun AppIcon(pkg: String) {
    val context = LocalContext.current
    val icon by produceState<ImageBitmap?>(null, pkg) {
        value = withContext(Dispatchers.IO) {
            runCatching { context.packageManager.getApplicationIcon(pkg).toBitmap(96, 96).asImageBitmap() }.getOrNull()
        }
    }
    Box(Modifier.size(38.dp).clip(RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
        icon?.let { Image(it, null, Modifier.size(38.dp)) }
    }
}
