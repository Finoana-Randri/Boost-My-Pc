package com.boostmypc.android.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.slideInVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Apps
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.CleaningServices
import androidx.compose.material.icons.rounded.DonutLarge
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.FolderOpen
import androidx.compose.material.icons.rounded.Inventory2
import androidx.compose.material.icons.rounded.QueryStats
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boostmypc.android.UiState
import com.boostmypc.android.formatSize
import com.boostmypc.android.plural
import com.boostmypc.android.scan.Category

enum class Dest { HOME, JUNK, LARGE, APPS, MAP }

private val CATEGORY_COLORS = mapOf(
    Category.IMAGES to Color(0xFFFF6A9A),
    Category.VIDEOS to Color(0xFFFFA24A),
    Category.AUDIO to Color(0xFF4BE3A0),
    Category.DOCUMENTS to Color(0xFF36D6E0),
    Category.ARCHIVES to Color(0xFFB48CFF),
    Category.APK to Color(0xFFD9F36B),
    Category.OTHER to Color(0xFF9C93B8),
)
private val APPS_COLOR = Color(0xFF4FA8FF)
private val SYSTEM_COLOR = Color(0xFF6B5F8F)

@Composable
fun HomeScreen(
    state: UiState,
    allFiles: Boolean,
    usage: Boolean,
    onGrantFiles: () -> Unit,
    onGrantUsage: () -> Unit,
    onScan: () -> Unit,
    onCancel: () -> Unit,
    onOpen: (Dest, String?) -> Unit,
) {
    val v = state.volume
    val r = state.result
    val appsTotal = state.apps?.sumOf { it.total } ?: 0L
    val filesTotal = r?.total ?: 0L
    val known = appsTotal + filesTotal
    val system = (v.used - known).coerceAtLeast(0)
    Screen("Boost My Pc", "Voyez ce qui remplit votre téléphone et libérez de l'espace.", Tint.SMART, onBack = null) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).navigationBarsPadding()) {
            if (!allFiles) PermissionCard("Accès à tous les fichiers", "Nécessaire pour mesurer chaque dossier et supprimer les fichiers que vous choisissez.", onGrantFiles)
            if (!usage) PermissionCard("Accès aux données d'utilisation", "Affiche la taille de chaque application et depuis quand vous ne l'avez pas ouverte.", onGrantUsage)

            Column(Modifier.padding(top = 12.dp).fillMaxWidth().glass(RoundedCornerShape(28.dp)).padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                val segments = if (r != null) buildList {
                    if (appsTotal > 0) add(Segment(appsTotal.toFloat() / v.total, APPS_COLOR))
                    Category.entries.forEach { c -> add(Segment((r.categories[c] ?: 0L).toFloat() / v.total, CATEGORY_COLORS.getValue(c))) }
                    add(Segment(system.toFloat() / v.total, SYSTEM_COLOR))
                } else listOf(Segment(v.used.toFloat() / v.total, Tint.SMART.to))
                StorageRing(segments, Modifier.size(210.dp)) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(formatSize(v.free), color = Palette.text, fontSize = 34.sp, fontWeight = FontWeight.Bold, letterSpacing = (-.5).sp)
                        Text("libres sur ${formatSize(v.total)}", color = Palette.text2, fontSize = 13.sp)
                        val pct = (v.used * 100 / v.total).toInt()
                        Text("$pct % utilisés", color = if (pct >= 95) Palette.bad else if (pct >= 85) Palette.warn else Palette.ok, fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 4.dp))
                    }
                }
                if (r != null) {
                    Spacer(Modifier.height(18.dp))
                    val legend = buildList {
                        if (appsTotal > 0) add(Triple("Applications", appsTotal, APPS_COLOR))
                        Category.entries.forEach { c -> add(Triple(c.label, r.categories[c] ?: 0L, CATEGORY_COLORS.getValue(c))) }
                        add(Triple(if (appsTotal > 0) "Système" else "Système et applications", system, SYSTEM_COLOR))
                    }.filter { it.second > 0 }.sortedByDescending { it.second }
                    legend.chunked(2).forEach { pair ->
                        Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            pair.forEach { (label, size, color) -> LegendItem(label, size, color, Modifier.weight(1f)) }
                            if (pair.size == 1) Spacer(Modifier.weight(1f))
                        }
                    }
                }
            }

            Box(Modifier.fillMaxWidth().padding(vertical = 22.dp), contentAlignment = Alignment.Center) {
                if (state.scanning) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        ScanButton("Arrêter", Tint.SMART, 112.dp, onClick = onCancel)
                        val p = state.progress
                        Text(if (p == null) "Analyse…" else "${plural(p.files, "fichier", "fichiers")} · ${formatSize(p.bytes)}", color = Palette.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 14.dp))
                        Text(p?.folder ?: "", color = Palette.text3, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 24.dp))
                    }
                } else {
                    ScanButton(if (r == null) "Analyser" else "Actualiser", Tint.SMART, if (r == null) 124.dp else 96.dp, enabled = allFiles, onClick = onScan)
                }
            }

            AnimatedVisibility(r != null, enter = fadeIn() + slideInVertically { it / 6 }) {
                if (r != null) Column {
                    val junk = r.junk.filter { it.kind.preselected }.sumOf { it.file.size }
                    val archives = r.junk.filter { !it.kind.preselected }.sumOf { it.file.size }
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Card(Icons.Rounded.CleaningServices, Tint.CLEANUP, "Fichiers inutiles", formatSize(junk + archives), if (archives > 0) "dont ${formatSize(archives)} d'archives et d'APK" else "Miniatures, journaux, dossiers vides", Modifier.weight(1f)) { onOpen(Dest.JUNK, null) }
                        Card(Icons.Rounded.Inventory2, Tint.CLUTTER, "Gros fichiers", formatSize(r.large.sumOf { it.size }), plural(r.large.size, "fichier de plus de 50 Mo", "fichiers de plus de 50 Mo"), Modifier.weight(1f)) { onOpen(Dest.LARGE, null) }
                    }
                    Spacer(Modifier.height(12.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        val apps = state.apps.orEmpty()
                        val idle = apps.count { !it.system && System.currentTimeMillis() - it.lastUsed > 90L * 86_400_000 }
                        Card(Icons.Rounded.Apps, Tint.APPS, "Applications", if (apps.isEmpty()) "—" else formatSize(appsTotal),
                            if (apps.isEmpty()) "Autorisez l'accès aux données d'utilisation" else "${plural(apps.size, "app", "apps")} · $idle inutilisées depuis 3 mois", Modifier.weight(1f)) { onOpen(Dest.APPS, null) }
                        Card(Icons.Rounded.DonutLarge, Tint.LENS, "Carte du stockage", formatSize(r.total), plural(r.fileCount, "fichier", "fichiers") + " dans le stockage interne", Modifier.weight(1f)) { onOpen(Dest.MAP, null) }
                    }
                    SectionTitle("Plus gros dossiers")
                    Column(Modifier.glass().padding(vertical = 4.dp)) {
                        r.root.children.filter { it.isDir }.take(6).forEach { n ->
                            ListRow(n.name, plural(n.files, "fichier", "fichiers"), formatSize(n.size), leading = { IconTile(Icons.Rounded.Folder, Tint.LENS, 34.dp) }, onClick = { onOpen(Dest.MAP, n.path) },
                                trailing = { Icon(Icons.Rounded.ChevronRight, null, tint = Palette.text3) })
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
            if (r == null && !state.scanning) {
                Row(Modifier.fillMaxWidth().glass().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconTile(Icons.Rounded.QueryStats, Tint.LENS, 36.dp)
                    Spacer(Modifier.width(12.dp))
                    Text("L'analyse parcourt le stockage interne, mesure chaque dossier et chaque application, puis vous propose ce qui peut être supprimé. Rien n'est effacé sans votre accord.", color = Palette.text2, fontSize = 13.sp)
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

@Composable
private fun LegendItem(label: String, size: Long, color: Color, modifier: Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.size(10.dp).clip(CircleShape).background(color))
        Spacer(Modifier.width(8.dp))
        Column {
            Text(label, color = Palette.text2, fontSize = 12.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(formatSize(size), color = Palette.text, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun Card(icon: ImageVector, tint: Tint, title: String, value: String, sub: String, modifier: Modifier, onClick: () -> Unit) {
    Column(modifier.height(170.dp).glass().clickable(onClick = onClick).padding(16.dp)) {
        IconTile(icon, tint, 38.dp)
        Spacer(Modifier.weight(1f))
        Text(title, color = Palette.text2, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text(value, color = Palette.text, fontSize = 24.sp, fontWeight = FontWeight.Bold, letterSpacing = (-.3).sp)
        Text(sub, color = Palette.text3, fontSize = 11.5.sp, maxLines = 2, overflow = TextOverflow.Ellipsis, lineHeight = 14.sp)
    }
}

@Composable
private fun PermissionCard(title: String, text: String, onGrant: () -> Unit) {
    Row(Modifier.padding(top = 12.dp).fillMaxWidth().glass().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        IconTile(Icons.Rounded.FolderOpen, Tint.PERFORMANCE, 38.dp)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Palette.text, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text(text, color = Palette.text2, fontSize = 12.5.sp)
        }
        Spacer(Modifier.width(10.dp))
        Box(Modifier.clip(CircleShape).background(Tint.SMART.brush).clickable(onClick = onGrant).padding(horizontal = 16.dp, vertical = 10.dp)) {
            Text("Autoriser", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold)
        }
    }
}
