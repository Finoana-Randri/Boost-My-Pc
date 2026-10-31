package com.boostmypc.android

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.boostmypc.android.scan.hasUsageAccess
import com.boostmypc.android.ui.AppsScreen
import com.boostmypc.android.ui.BoostTheme
import com.boostmypc.android.ui.Dest
import com.boostmypc.android.ui.HomeScreen
import com.boostmypc.android.ui.JunkScreen
import com.boostmypc.android.ui.LargeScreen
import com.boostmypc.android.ui.MapScreen

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BoostTheme {
                val state by vm.state.collectAsStateWithLifecycle()
                var dest by rememberSaveable { mutableStateOf(Dest.HOME) }
                var mapStart by rememberSaveable { mutableStateOf<String?>(null) }
                var allFiles by rememberSaveable { mutableStateOf(hasAllFiles()) }
                var usage by rememberSaveable { mutableStateOf(hasUsageAccess(this)) }

                // Permissions and sizes change while the user is in the system settings.
                LifecycleResumeEffect(Unit) {
                    allFiles = hasAllFiles()
                    usage = hasUsageAccess(this@MainActivity)
                    vm.refresh()
                    if (dest == Dest.APPS) vm.reloadApps()
                    onPauseOrDispose { }
                }
                LaunchedEffect(state.message) {
                    state.message?.let { Toast.makeText(this@MainActivity, it, Toast.LENGTH_LONG).show(); vm.clearMessage() }
                }
                BackHandler(dest != Dest.HOME) { dest = Dest.HOME }

                val home = { dest = Dest.HOME }
                AnimatedContent(
                    dest,
                    transitionSpec = {
                        val forward = targetState != Dest.HOME
                        val motion = spring<androidx.compose.ui.unit.IntOffset>(dampingRatio = 1f, stiffness = Spring.StiffnessMediumLow)
                        (slideInHorizontally(motion) { if (forward) it / 4 else -it / 4 } + fadeIn()) togetherWith
                            (slideOutHorizontally(motion) { if (forward) -it / 4 else it / 4 } + fadeOut())
                    },
                    label = "screen",
                ) { d ->
                    when (d) {
                        Dest.HOME -> HomeScreen(
                            state, allFiles, usage,
                            onGrantFiles = ::grantFiles,
                            onGrantUsage = ::grantUsage,
                            onScan = vm::scan,
                            onCancel = vm::cancel,
                            onOpen = { to, path -> mapStart = path; dest = to },
                        )
                        Dest.JUNK -> JunkScreen(state, home, vm::delete)
                        Dest.LARGE -> LargeScreen(state, home, vm::delete)
                        Dest.APPS -> AppsScreen(state, usage, ::grantUsage, home)
                        Dest.MAP -> MapScreen(state, mapStart, home, vm::delete)
                    }
                }
            }
        }
    }

    private fun hasAllFiles() = if (Build.VERSION.SDK_INT >= 30) Environment.isExternalStorageManager()
    else ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

    private fun grantFiles() {
        if (Build.VERSION.SDK_INT >= 30) {
            val app = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:$packageName"))
            runCatching { startActivity(app) }.onFailure { startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION)) }
        } else {
            requestPermissions(arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE, Manifest.permission.WRITE_EXTERNAL_STORAGE), 1)
        }
    }

    private fun grantUsage() {
        val app = Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:$packageName"))
        runCatching { startActivity(app) }.onFailure { startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
    }
}
