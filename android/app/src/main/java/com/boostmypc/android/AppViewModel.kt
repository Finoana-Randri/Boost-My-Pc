package com.boostmypc.android

import android.app.Application
import android.os.Environment
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.boostmypc.android.scan.AppInfo
import com.boostmypc.android.scan.FileItem
import com.boostmypc.android.scan.ScanProgress
import com.boostmypc.android.scan.ScanResult
import com.boostmypc.android.scan.Scanner
import com.boostmypc.android.scan.Volume
import com.boostmypc.android.scan.loadApps
import com.boostmypc.android.scan.remove
import com.boostmypc.android.scan.volume
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File

data class UiState(
    val volume: Volume,
    val scanning: Boolean = false,
    val progress: ScanProgress? = null,
    val result: ScanResult? = null,
    val apps: List<AppInfo>? = null,
    val loadingApps: Boolean = false,
    // The map is changed in place after a deletion; this tells the screens to redraw it.
    val revision: Int = 0,
    val message: String? = null,
)

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val _state = MutableStateFlow(UiState(volume()))
    val state: StateFlow<UiState> = _state
    private var scanner: Scanner? = null
    private var job: Job? = null

    fun refresh() {
        _state.update { it.copy(volume = volume()) }
        if (_state.value.apps.isNullOrEmpty() && !_state.value.loadingApps) loadAppSizes()
    }

    fun scan() {
        if (job?.isActive == true) return
        _state.update { it.copy(scanning = true, progress = ScanProgress(0, 0, "/")) }
        job = viewModelScope.launch {
            loadAppSizes()
            val result = withContext(Dispatchers.IO) {
                val s = Scanner(Environment.getExternalStorageDirectory()) { p -> _state.update { it.copy(progress = p) } }
                scanner = s
                runCatching { s.run() }.getOrNull()?.takeUnless { s.cancelled }
            }
            _state.update { it.copy(scanning = false, progress = null, result = result ?: it.result, volume = volume()) }
        }
    }

    fun cancel() {
        scanner?.cancelled = true
    }

    fun reloadApps() = loadAppSizes()

    private fun loadAppSizes() {
        _state.update { it.copy(loadingApps = true) }
        viewModelScope.launch {
            val apps = withContext(Dispatchers.IO) { runCatching { loadApps(getApplication()) }.getOrDefault(emptyList()) }
            _state.update { it.copy(apps = apps, loadingApps = false) }
        }
    }

    /** Deletes the files and folders the user picked, then updates every list and the map. */
    fun delete(items: List<FileItem>) {
        viewModelScope.launch {
            val done = withContext(Dispatchers.IO) {
                items.filter { item ->
                    val f = File(item.path)
                    if (item.isDir) f.deleteRecursively() else f.delete() || !f.exists()
                }
            }
            val freed = done.sumOf { it.size }
            _state.update { s ->
                val r = s.result ?: return@update s
                val gone = done.map { it.path }.toSet()
                val inside = { path: String -> path in gone || done.any { it.isDir && path.startsWith(it.path + "/") } }
                done.forEach { r.root.remove(it.path, it.size) }
                val categories = r.categories.toMutableMap()
                done.filter { !it.isDir }.forEach { categories[it.category] = (categories.getValue(it.category) - it.size).coerceAtLeast(0) }
                s.copy(
                    result = ScanResult(
                        r.root, categories,
                        r.large.filterNot { inside(it.path) },
                        r.junk.filterNot { inside(it.file.path) },
                        r.root.size, r.fileCount - done.size,
                    ),
                    volume = volume(),
                    revision = s.revision + 1,
                    message = if (done.size == items.size) "${formatSize(freed)} libérés" else "${formatSize(freed)} libérés · ${items.size - done.size} élément(s) non supprimé(s)",
                )
            }
        }
    }

    fun clearMessage() = _state.update { it.copy(message = null) }
}
