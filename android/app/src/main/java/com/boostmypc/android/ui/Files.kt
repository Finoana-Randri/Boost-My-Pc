package com.boostmypc.android.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Android
import androidx.compose.material.icons.rounded.Article
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.DeleteOutline
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.ExpandLess
import androidx.compose.material.icons.rounded.ExpandMore
import androidx.compose.material.icons.rounded.Folder
import androidx.compose.material.icons.rounded.FolderZip
import androidx.compose.material.icons.rounded.Image
import androidx.compose.material.icons.rounded.InsertDriveFile
import androidx.compose.material.icons.rounded.Movie
import androidx.compose.material.icons.rounded.MusicNote
import androidx.compose.material.icons.rounded.PhotoLibrary
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.boostmypc.android.UiState
import com.boostmypc.android.formatSize
import com.boostmypc.android.plural
import com.boostmypc.android.scan.Category
import com.boostmypc.android.scan.FileItem
import com.boostmypc.android.scan.JunkKind
import com.boostmypc.android.scan.Node
import java.text.DateFormat
import java.util.Date

private const val STORAGE = "/storage/emulated/0"
private fun shortPath(path: String) = path.removePrefix(STORAGE).substringBeforeLast('/').ifEmpty { "/" }

fun iconOf(c: Category) = when (c) {
    Category.IMAGES -> Icons.Rounded.Image
    Category.VIDEOS -> Icons.Rounded.Movie
    Category.AUDIO -> Icons.Rounded.MusicNote
    Category.DOCUMENTS -> Icons.Rounded.Description
    Category.ARCHIVES -> Icons.Rounded.FolderZip
    Category.APK -> Icons.Rounded.Android
    Category.OTHER -> Icons.Rounded.InsertDriveFile
}

private fun tintOf(c: Category) = when (c) {
    Category.IMAGES -> Tint.PROTECTION
    Category.VIDEOS -> Tint.PERFORMANCE
    Category.AUDIO -> Tint.CLEANUP
    Category.DOCUMENTS -> Tint.CLUTTER
    Category.ARCHIVES -> Tint.LENS
    Category.APK -> Tint.CLEANUP
    Category.OTHER -> Tint.APPS
}

private fun kindIcon(k: JunkKind) = when (k) {
    JunkKind.THUMBNAILS -> Icons.Rounded.PhotoLibrary
    JunkKind.TEMP -> Icons.Rounded.Article
    JunkKind.EMPTY -> Icons.Rounded.Folder
    JunkKind.APK -> Icons.Rounded.Android
    JunkKind.ARCHIVES -> Icons.Rounded.FolderZip
}

/** Selection shared by the lists: paths picked by the user, with a running total. */
@Composable
private fun rememberSelection(initial: List<FileItem>) = remember { mutableStateListOf<String>().apply { addAll(initial.map { it.path }) } }

@Composable
fun JunkScreen(state: UiState, onBack: () -> Unit, onDelete: (List<FileItem>) -> Unit) {
    val r = state.result ?: return
    val selected = rememberSelection(r.junk.filter { it.kind.preselected }.map { it.file })
    var open by rememberSaveable { mutableStateOf(setOf(JunkKind.ARCHIVES.name, JunkKind.APK.name)) }
    var confirm by remember { mutableStateOf(false) }
    val groups = r.junk.groupBy { it.kind }
    val picked = r.junk.filter { it.file.path in selected }.map { it.file }
    Screen("Fichiers inutiles", "Ce qui peut être supprimé sans gêner vos applications.", Tint.CLEANUP, onBack,
        bottom = { ActionBar(if (picked.isEmpty()) "Sélectionnez des éléments" else "Sélection : ${formatSize(picked.sumOf { it.size })}", "Supprimer", Tint.CLEANUP, picked.isNotEmpty()) { confirm = true } },
    ) {
        if (r.junk.isEmpty()) Empty("Aucun fichier inutile trouvé.")
        LazyColumn(contentPadding = PaddingValues(16.dp)) {
            JunkKind.entries.filter { groups.containsKey(it) }.forEach { kind ->
                val items = groups.getValue(kind)
                val all = items.all { it.file.path in selected }
                val isOpen = kind.name in open
                item(kind.name) {
                    Column(Modifier.padding(bottom = 12.dp).glass()) {
                        ListRow(
                            kind.title, kind.detail, formatSize(items.sumOf { it.file.size }),
                            leading = { IconTile(kindIcon(kind), Tint.CLEANUP, 38.dp) },
                            checked = all,
                            onCheck = { on -> items.forEach { selected.remove(it.file.path) }; if (on) selected.addAll(items.map { it.file.path }) },
                            trailing = {
                                IconButton(onClick = { open = if (isOpen) open - kind.name else open + kind.name }) {
                                    Icon(if (isOpen) Icons.Rounded.ExpandLess else Icons.Rounded.ExpandMore, null, tint = Palette.text2)
                                }
                            },
                        )
                        if (isOpen) items.take(300).forEach { j ->
                            val f = j.file
                            ListRow(f.name, shortPath(f.path), if (f.size > 0) formatSize(f.size) else null,
                                leading = { Spacer(Modifier.width(6.dp)) },
                                checked = f.path in selected,
                                onCheck = { on -> if (on) selected.add(f.path) else selected.remove(f.path) })
                        }
                        if (isOpen && items.size > 300) Text("… et ${items.size - 300} autres", color = Palette.text3, fontSize = 12.sp, modifier = Modifier.padding(14.dp))
                    }
                }
            }
        }
    }
    if (confirm) ConfirmDelete(picked.size, formatSize(picked.sumOf { it.size }), onConfirm = { confirm = false; onDelete(picked); selected.clear() }, onDismiss = { confirm = false })
}

@Composable
fun LargeScreen(state: UiState, onBack: () -> Unit, onDelete: (List<FileItem>) -> Unit) {
    val r = state.result ?: return
    val selected = rememberSelection(emptyList())
    var confirm by remember { mutableStateOf(false) }
    var filter by rememberSaveable { mutableStateOf<String?>(null) }
    val list = r.large.filter { filter == null || it.category.name == filter }
    val picked = r.large.filter { it.path in selected }
    val date = remember { DateFormat.getDateInstance(DateFormat.MEDIUM) }
    Screen("Gros fichiers", "Les fichiers de plus de 50 Mo, du plus gros au plus petit.", Tint.CLUTTER, onBack,
        bottom = { ActionBar(if (picked.isEmpty()) "${plural(list.size, "fichier", "fichiers")} · ${formatSize(list.sumOf { it.size })}" else "Sélection : ${formatSize(picked.sumOf { it.size })}", "Supprimer", Tint.CLUTTER, picked.isNotEmpty()) { confirm = true } },
    ) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp)) {
            Chip("Tous", filter == null) { filter = null }
            r.large.map { it.category }.distinct().sortedBy { it.ordinal }.forEach { c -> Chip(c.label, filter == c.name) { filter = c.name } }
        }
        if (list.isEmpty()) Empty("Aucun fichier de plus de 50 Mo.")
        LazyColumn(contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 6.dp, bottom = 16.dp)) {
            item {
                Column(Modifier.glass().padding(vertical = 4.dp)) {
                    list.forEach { f ->
                        ListRow(f.name, "${shortPath(f.path)} · ${date.format(Date(f.modified))}", formatSize(f.size),
                            leading = { IconTile(iconOf(f.category), tintOf(f.category), 34.dp) },
                            checked = f.path in selected,
                            onCheck = { on -> if (on) selected.add(f.path) else selected.remove(f.path) })
                    }
                }
            }
        }
    }
    if (confirm) ConfirmDelete(picked.size, formatSize(picked.sumOf { it.size }), onConfirm = { confirm = false; onDelete(picked); selected.clear() }, onDismiss = { confirm = false })
}

@Composable
fun MapScreen(state: UiState, start: String?, onBack: () -> Unit, onDelete: (List<FileItem>) -> Unit) {
    val r = state.result ?: return
    var path by rememberSaveable { mutableStateOf(start ?: r.root.path) }
    var pending by remember { mutableStateOf<Node?>(null) }
    // Reading the revision redraws the map after a deletion changed it in place.
    @Suppress("UNUSED_VARIABLE") val revision = state.revision
    val node = r.root.findDir(path) ?: r.root
    BackHandler(node !== r.root) { path = node.parent?.path ?: r.root.path }
    Screen("Carte du stockage", null, Tint.LENS, onBack) {
        Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            val chain = generateSequence(node) { it.parent }.toList().reversed()
            chain.forEachIndexed { i, n ->
                Text(if (n === r.root) "Stockage interne" else n.name, color = if (n === node) Palette.text else Palette.text3, fontSize = 14.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(RoundedCornerShape(8.dp)).clickable { path = n.path }.padding(4.dp))
                if (i < chain.lastIndex) Icon(Icons.Rounded.ChevronRight, null, Modifier.size(16.dp), tint = Palette.text3)
            }
        }
        Text("${formatSize(node.size)} · ${plural(node.files, "fichier", "fichiers")}", color = Palette.text2, fontSize = 13.sp, modifier = Modifier.padding(horizontal = 24.dp))
        LazyColumn(contentPadding = PaddingValues(16.dp)) {
            item {
                Column(Modifier.glass().padding(vertical = 4.dp)) {
                    val small = node.size - node.children.sumOf { it.size }
                    node.children.forEach { n ->
                        Column {
                            ListRow(n.name, if (n.isDir) plural(n.files, "fichier", "fichiers") else null, formatSize(n.size),
                                leading = { IconTile(if (n.isDir) Icons.Rounded.Folder else iconOf(com.boostmypc.android.scan.categoryOf(n.name)), if (n.isDir) Tint.LENS else Tint.APPS, 34.dp) },
                                onClick = if (n.isDir) ({ path = n.path }) else null,
                                trailing = {
                                    IconButton(onClick = { pending = n }) { Icon(Icons.Rounded.DeleteOutline, "Supprimer", tint = Palette.text3) }
                                })
                            Bar(if (node.size > 0) n.size.toFloat() / node.size else 0f)
                        }
                    }
                    if (small > 0) ListRow("Petits fichiers", "Fichiers de moins de 1 Mo dans ce dossier", formatSize(small), leading = { IconTile(Icons.Rounded.InsertDriveFile, Tint.APPS, 34.dp) })
                    if (node.children.isEmpty() && small <= 0) Empty("Ce dossier est vide.")
                }
            }
        }
    }
    pending?.let { n ->
        ConfirmDelete(1, "${n.name} · ${formatSize(n.size)}", onConfirm = {
            pending = null
            onDelete(listOf(FileItem(n.path, n.name, n.size, n.newest, com.boostmypc.android.scan.categoryOf(n.name), n.isDir)))
        }, onDismiss = { pending = null })
    }
}

private fun Node.findDir(path: String): Node? {
    if (this.path == path) return this
    val child = children.firstOrNull { it.isDir && (path == it.path || path.startsWith(it.path + "/")) } ?: return null
    return child.findDir(path)
}

@Composable
private fun Bar(fraction: Float) {
    Box(Modifier.padding(start = 62.dp, end = 16.dp, bottom = 6.dp).fillMaxWidth().height(4.dp).clip(CircleShape).background(Palette.track)) {
        Box(Modifier.fillMaxWidth(fraction.coerceIn(0f, 1f)).fillMaxHeight().clip(CircleShape).background(Tint.LENS.brush))
    }
}

@Composable
fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.padding(end = 8.dp).then(if (on) Modifier.clip(CircleShape).background(Tint.SMART.brush) else Modifier.glass(CircleShape, .8f))
            .clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp),
    ) { Text(label, color = Palette.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }
}

@Composable
fun Empty(text: String) {
    Text(text, color = Palette.text2, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().padding(32.dp))
}
