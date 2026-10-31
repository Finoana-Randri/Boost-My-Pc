package com.boostmypc.android.scan

import java.io.File
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes

enum class Category(val label: String) {
    IMAGES("Photos et images"),
    VIDEOS("Vidéos"),
    AUDIO("Audio"),
    DOCUMENTS("Documents"),
    ARCHIVES("Archives"),
    APK("Installateurs APK"),
    OTHER("Autres fichiers"),
}

private val EXT = buildMap {
    listOf("jpg", "jpeg", "png", "heic", "heif", "webp", "gif", "bmp", "dng", "raw").forEach { put(it, Category.IMAGES) }
    listOf("mp4", "mkv", "mov", "avi", "3gp", "webm", "m4v", "ts", "flv").forEach { put(it, Category.VIDEOS) }
    listOf("mp3", "m4a", "aac", "wav", "flac", "ogg", "opus", "amr", "wma").forEach { put(it, Category.AUDIO) }
    listOf("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "odt", "ods", "epub", "csv", "rtf").forEach { put(it, Category.DOCUMENTS) }
    listOf("zip", "rar", "7z", "tar", "gz", "tgz", "xz", "bz2", "iso").forEach { put(it, Category.ARCHIVES) }
    listOf("apk", "apks", "xapk", "apkm").forEach { put(it, Category.APK) }
}
// Split archives: name.zip.001, name.7z.002, name.r01, name.part2.rar
private val SPLIT_ARCHIVE = Regex("""\.(zip|7z|rar|tar)\.\d{2,3}$|\.r\d{2}$|\.z\d{2}$""", RegexOption.IGNORE_CASE)

fun categoryOf(name: String): Category {
    if (SPLIT_ARCHIVE.containsMatchIn(name)) return Category.ARCHIVES
    val ext = name.substringAfterLast('.', "").lowercase()
    return EXT[ext] ?: Category.OTHER
}

/** A folder or a file of the storage map. Files under [SMALL] are only counted in their folder. */
class Node(val name: String, val path: String, val isDir: Boolean) {
    var size = 0L
    var files = 0
    var newest = 0L
    val children = mutableListOf<Node>()
    var parent: Node? = null
}

data class FileItem(val path: String, val name: String, val size: Long, val modified: Long, val category: Category, val isDir: Boolean = false)

enum class JunkKind(val title: String, val detail: String, val preselected: Boolean) {
    THUMBNAILS("Miniatures", "Aperçus des photos, recréés automatiquement par la galerie", true),
    TEMP("Fichiers temporaires et journaux", "Fichiers .tmp, .log et rapports de plantage laissés par les applications", true),
    EMPTY("Dossiers vides", "Dossiers qui ne contiennent plus rien", true),
    APK("Installateurs APK", "Fichiers d'installation d'applications ; inutiles une fois l'application installée", false),
    ARCHIVES("Archives volumineuses", "Fichiers .zip, .rar, .7z et archives en plusieurs parties ; inutiles si vous les avez déjà extraites", false),
}

data class JunkItem(val kind: JunkKind, val file: FileItem)

class ScanResult(
    val root: Node,
    val categories: Map<Category, Long>,
    val large: List<FileItem>,
    val junk: List<JunkItem>,
    val total: Long,
    val fileCount: Int,
)

data class ScanProgress(val files: Int, val bytes: Long, val folder: String)

private const val SMALL = 1_000_000L
private const val LARGE = 50_000_000L
private const val ARCHIVE_MIN = 20_000_000L
private val TEMP_EXT = setOf("tmp", "temp", "log", "dmp", "trace")
private val TEMP_DIRS = setOf("callstacks", "crashlogs", "crash", "logs", ".logs", "tombstones")

/**
 * Walks the shared storage once and builds the folder map, the size of each kind of file, the
 * large files and the files that can be removed safely. Android/data and Android/obb belong to
 * their apps and are measured with the app sizes instead.
 */
class Scanner(private val rootDir: File, private val onProgress: (ScanProgress) -> Unit) {
    @Volatile var cancelled = false

    fun run(): ScanResult {
        val root = Node(rootDir.name, rootDir.path, true)
        val categories = Category.entries.associateWith { 0L }.toMutableMap()
        val large = mutableListOf<FileItem>()
        val junk = mutableListOf<JunkItem>()
        var count = 0
        var bytes = 0L
        var lastReport = 0L
        val stack = ArrayDeque<Node>().apply { addLast(root) }
        val skip = setOf(File(rootDir, "Android/data").path, File(rootDir, "Android/obb").path)

        Files.walkFileTree(rootDir.toPath(), object : SimpleFileVisitor<Path>() {
            override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                if (cancelled) return FileVisitResult.TERMINATE
                val path = dir.toString()
                if (path == rootDir.path) return FileVisitResult.CONTINUE
                if (path in skip) return FileVisitResult.SKIP_SUBTREE
                val node = Node(dir.fileName.toString(), path, true).also { it.parent = stack.last() }
                stack.last().children += node
                stack.addLast(node)
                return FileVisitResult.CONTINUE
            }

            override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                if (!attrs.isRegularFile) return FileVisitResult.CONTINUE
                val dir = stack.last()
                val name = file.fileName.toString()
                val size = attrs.size()
                val modified = attrs.lastModifiedTime().toMillis()
                val category = categoryOf(name)
                count++
                bytes += size
                dir.size += size
                dir.files++
                if (modified > dir.newest) dir.newest = modified
                categories[category] = categories.getValue(category) + size
                val item = FileItem(file.toString(), name, size, modified, category)
                if (size >= SMALL) dir.children += Node(name, item.path, false).also { it.size = size; it.files = 1; it.newest = modified; it.parent = dir }
                if (size >= LARGE) large += item
                val ext = name.substringAfterLast('.', "").lowercase()
                when {
                    category == Category.APK -> junk += JunkItem(JunkKind.APK, item)
                    category == Category.ARCHIVES && size >= ARCHIVE_MIN -> junk += JunkItem(JunkKind.ARCHIVES, item)
                    ext in TEMP_EXT || dir.name.lowercase() in TEMP_DIRS -> junk += JunkItem(JunkKind.TEMP, item)
                }
                val now = System.currentTimeMillis()
                if (now - lastReport > 120) {
                    lastReport = now
                    onProgress(ScanProgress(count, bytes, dir.path.removePrefix(rootDir.path).ifEmpty { "/" }))
                }
                return if (cancelled) FileVisitResult.TERMINATE else FileVisitResult.CONTINUE
            }

            override fun visitFileFailed(file: Path, exc: IOException) = FileVisitResult.CONTINUE

            override fun postVisitDirectory(dir: Path, exc: IOException?): FileVisitResult {
                if (dir.toString() == rootDir.path) return FileVisitResult.CONTINUE
                val node = stack.removeLast()
                val parent = stack.last()
                parent.size += node.size
                parent.files += node.files
                if (node.newest > parent.newest) parent.newest = node.newest
                if (node.files == 0 && node.children.isEmpty()) {
                    junk += JunkItem(JunkKind.EMPTY, FileItem(node.path, node.name, 0, 0, Category.OTHER, isDir = true))
                } else if (node.name.equals(".thumbnails", true) || node.name.equals(".thumbcache", true)) {
                    junk += JunkItem(JunkKind.THUMBNAILS, FileItem(node.path, node.name, node.size, node.newest, Category.IMAGES, isDir = true))
                    // Their files are listed once, as the folder.
                    junk.removeAll { it.kind == JunkKind.TEMP && it.file.path.startsWith(node.path + "/") }
                }
                node.children.sortByDescending { it.size }
                return FileVisitResult.CONTINUE
            }
        })
        root.children.sortByDescending { it.size }
        large.sortByDescending { it.size }
        junk.sortWith(compareBy<JunkItem> { it.kind.ordinal }.thenByDescending { it.file.size })
        return ScanResult(root, categories, large.take(400), junk, root.size, count)
    }
}

/**
 * Removes a deleted file or folder from the map and from the totals of the folders above it.
 * Small files have no node of their own: their size is taken from their folder.
 */
fun Node.remove(path: String, size: Long, files: Int = 1) {
    var dir = this
    while (true) {
        val child = dir.children.firstOrNull { path == it.path || path.startsWith(it.path + "/") } ?: break
        if (child.path == path) {
            dir.children.remove(child)
            dir.subtract(child.size, child.files)
            return
        }
        dir = child
    }
    dir.size -= size
    dir.files -= files
    dir.parent?.subtract(size, files)
}

private fun Node.subtract(size: Long, files: Int) {
    var p: Node? = this
    while (p != null) {
        p.size -= size
        p.files -= files
        p = p.parent
    }
}
