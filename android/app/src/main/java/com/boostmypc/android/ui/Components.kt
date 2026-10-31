package com.boostmypc.android.ui

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Page frame: back pill, large title, a line under it, then the content. */
@Composable
fun Screen(title: String, subtitle: String?, tint: Tint, onBack: (() -> Unit)?, bottom: (@Composable () -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Aurora(tint) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            Column(Modifier.padding(start = 20.dp, end = 20.dp, top = 10.dp, bottom = 6.dp)) {
                if (onBack != null) {
                    Row(
                        Modifier.glass(CircleShape, .8f).clickable(onClick = onBack).padding(horizontal = 12.dp, vertical = 7.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.AutoMirrored.Rounded.ArrowBack, null, Modifier.size(16.dp), tint = Palette.text)
                        Spacer(Modifier.width(6.dp))
                        Text("Vue d'ensemble", color = Palette.text, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    }
                    Spacer(Modifier.height(14.dp))
                }
                Text(title, color = Palette.text, fontSize = 30.sp, fontWeight = FontWeight.Bold, letterSpacing = (-.5).sp)
                if (subtitle != null) Text(subtitle, color = Palette.text2, fontSize = 14.sp, modifier = Modifier.padding(top = 4.dp))
            }
            Column(Modifier.weight(1f).fillMaxWidth()) { content() }
            if (bottom != null) Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(16.dp), contentAlignment = Alignment.Center) { bottom() }
        }
    }
}

@Composable
fun IconTile(icon: ImageVector, tint: Tint, size: Dp = 40.dp) {
    Box(Modifier.size(size).tile(tint, size * .3f), contentAlignment = Alignment.Center) {
        Icon(icon, null, Modifier.size(size * .55f), tint = Color.White)
    }
}

/** The round button of the desktop app: a lit core inside a thin ring that tightens when pressed. */
@Composable
fun ScanButton(label: String, tint: Tint, size: Dp = 124.dp, enabled: Boolean = true, onClick: () -> Unit) {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .94f else 1f, spring(dampingRatio = .6f, stiffness = Spring.StiffnessMedium), label = "press")
    Box(
        Modifier.size(size + 22.dp).scale(scale).border(1.5.dp, tint.to.copy(alpha = .35f), CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .size(size)
                .clip(CircleShape)
                .background(Brush.linearGradient(listOf(tint.to, tint.from), Offset(0f, 0f), Offset(0f, Float.POSITIVE_INFINITY)))
                .background(Brush.radialGradient(listOf(Color.White.copy(alpha = .42f), Color.Transparent), Offset(size.value * .9f, size.value * .6f), size.value * 1.4f))
                .border(1.dp, Color.White.copy(alpha = .3f), CircleShape)
                .clickable(source, null, enabled = enabled, onClick = onClick),
            contentAlignment = Alignment.Center,
        ) {
            Text(label, color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.Bold)
        }
    }
}

data class Segment(val fraction: Float, val color: Color)

/** Used space as colored arcs around a track, one per kind of content. */
@Composable
fun StorageRing(segments: List<Segment>, modifier: Modifier = Modifier, stroke: Dp = 16.dp, center: @Composable () -> Unit) {
    val progress by animateFloatAsState(1f, spring(stiffness = Spring.StiffnessVeryLow), label = "ring")
    Box(modifier, contentAlignment = Alignment.Center) {
        Canvas(Modifier.fillMaxSize()) {
            val w = stroke.toPx()
            val inset = w / 2
            val arcSize = Size(size.width - w, size.height - w)
            drawArc(Palette.track, 0f, 360f, false, Offset(inset, inset), arcSize, style = Stroke(w))
            var start = -90f
            val gap = 1.6f
            segments.filter { it.fraction > .004f }.forEach { s ->
                val sweep = s.fraction * 360f * progress
                drawArc(s.color, start + gap / 2, (sweep - gap).coerceAtLeast(.5f), false, Offset(inset, inset), arcSize, style = Stroke(w, cap = StrokeCap.Butt))
                start += sweep
            }
        }
        center()
    }
}

/** A row of a glass list: icon, title, line below, value at the end. */
@Composable
fun ListRow(
    title: String,
    sub: String?,
    value: String?,
    leading: @Composable () -> Unit,
    checked: Boolean? = null,
    onCheck: ((Boolean) -> Unit)? = null,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .then(if (onClick != null || onCheck != null) Modifier.clickable { if (onClick != null) onClick() else onCheck?.invoke(checked != true) } else Modifier)
            .padding(horizontal = 14.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (checked != null) {
            CheckMark(checked)
            Spacer(Modifier.width(12.dp))
        }
        leading()
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = Palette.text, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (sub != null) Text(sub, color = Palette.text3, fontSize = 12.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (value != null) Text(value, color = Palette.text, fontSize = 14.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 8.dp))
        if (trailing != null) { Spacer(Modifier.width(6.dp)); trailing() }
    }
}

@Composable
fun CheckMark(checked: Boolean) {
    Box(
        Modifier.size(22.dp).clip(CircleShape)
            .then(if (checked) Modifier.background(Tint.SMART.brush) else Modifier.border(1.5.dp, Color.White.copy(alpha = .35f), CircleShape)),
        contentAlignment = Alignment.Center,
    ) {
        if (checked) Icon(Icons.Rounded.Check, null, Modifier.size(15.dp), tint = Color.White)
    }
}

/** The floating bar at the bottom of a list: what is selected, and the action. */
@Composable
fun ActionBar(summary: String, action: String, tint: Tint, enabled: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().glass(RoundedCornerShape(30.dp), 1.4f).padding(start = 20.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(summary, color = Palette.text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
        Box(
            Modifier.clip(CircleShape).background(if (enabled) tint.brush else Brush.linearGradient(listOf(Palette.track, Palette.track)))
                .clickable(enabled = enabled, onClick = onClick).padding(horizontal = 26.dp, vertical = 13.dp),
        ) { Text(action, color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.Bold) }
    }
}

@Composable
fun ConfirmDelete(count: Int, size: String, onConfirm: () -> Unit, onDismiss: () -> Unit) {
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Color(0xFF34285E),
        title = { Text("Supprimer définitivement ?", color = Palette.text) },
        text = { Text("$count élément(s) · $size. Ils ne passent pas par une corbeille et ne pourront pas être récupérés.", color = Palette.text2) },
        confirmButton = { TextButton(onClick = onConfirm) { Text("Supprimer", color = Palette.bad, fontWeight = FontWeight.Bold) } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Annuler", color = Palette.text) } },
    )
}

@Composable
fun SectionTitle(text: String) {
    Text(text, color = Palette.text, fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(start = 4.dp, top = 18.dp, bottom = 8.dp))
}
