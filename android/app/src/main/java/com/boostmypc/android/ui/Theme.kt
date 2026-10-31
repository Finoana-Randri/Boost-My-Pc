package com.boostmypc.android.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

// Same palette as the desktop app in dark mode.
object Palette {
    val bg = Color(0xFF291E4D)
    val text = Color.White
    val text2 = Color.White.copy(alpha = .8f)
    val text3 = Color.White.copy(alpha = .58f)
    val ok = Color(0xFF5EF0A0)
    val warn = Color(0xFFFFB238)
    val bad = Color(0xFFFF6B8B)
    val track = Color.White.copy(alpha = .14f)
}

/** Module colors: each feature keeps the gradient it has on the desktop. */
enum class Tint(val from: Color, val to: Color) {
    SMART(Color(0xFF7418A9), Color(0xFFF133C5)),
    CLEANUP(Color(0xFF0F9B6C), Color(0xFF4BE3A0)),
    CLUTTER(Color(0xFF0D8A9B), Color(0xFF36E0C8)),
    APPS(Color(0xFF1F5FD6), Color(0xFF4FC3FF)),
    LENS(Color(0xFF4B3FD8), Color(0xFF9B6BFF)),
    PROTECTION(Color(0xFFC2185B), Color(0xFFFF6A88)),
    PERFORMANCE(Color(0xFFE8590C), Color(0xFFFFC53D));

    val brush get() = Brush.linearGradient(listOf(from, to))
}

@Composable
fun BoostTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Tint.SMART.to,
            background = Palette.bg,
            surface = Palette.bg,
            onSurface = Palette.text,
            onBackground = Palette.text,
        ),
        content = content,
    )
}

/** The still background: three soft colored lights on deep violet, like the desktop window. */
@Composable
fun Aurora(tint: Tint = Tint.SMART, content: @Composable BoxScope.() -> Unit) {
    Box(
        Modifier
            .fillMaxSize()
            .background(Palette.bg)
            .drawBehind {
                val w = size.width
                val h = size.height
                fun light(c: Color, x: Float, y: Float, r: Float) = drawCircle(
                    Brush.radialGradient(listOf(c.copy(alpha = .5f), Color.Transparent), Offset(x, y), r), r, Offset(x, y),
                )
                light(tint.from, w * .05f, h * .02f, w * .95f)
                light(Color(0xFF5131B0), w * .75f, h * .45f, w * .7f)
                light(tint.to, w * 1.05f, h * 1.02f, w * .9f)
            },
        content = content,
    )
}

/**
 * Clear glass: a faint white fill brighter at the top, and a rim that catches the light on the
 * upper edge and fades along the sides.
 */
fun Modifier.glass(shape: Shape = RoundedCornerShape(24.dp), strength: Float = 1f): Modifier = this
    .clip(shape)
    .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = .13f * strength), Color.White.copy(alpha = .06f * strength))))
    .border(
        1.dp,
        Brush.linearGradient(listOf(Color.White.copy(alpha = .5f), Color.White.copy(alpha = .08f), Color.White.copy(alpha = .22f))),
        shape,
    )

/** A lit color tile, as behind the sidebar icons of the desktop app. */
fun Modifier.tile(tint: Tint, corner: Dp = 12.dp): Modifier = this
    .clip(RoundedCornerShape(corner))
    .background(tint.brush)
    .background(Brush.verticalGradient(listOf(Color.White.copy(alpha = .3f), Color.Transparent), endY = 60f))
    .border(1.dp, Color.White.copy(alpha = .18f), RoundedCornerShape(corner))
