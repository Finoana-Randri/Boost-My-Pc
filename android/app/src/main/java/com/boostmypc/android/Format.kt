package com.boostmypc.android

import java.util.Locale
import kotlin.math.abs

private val FR = Locale.FRANCE

/** Sizes as Android shows them: decimal units, French notation (1,6 Go). */
fun formatSize(bytes: Long): String {
    val b = abs(bytes).toDouble()
    return when {
        b >= 1e9 -> String.format(FR, if (b >= 1e11) "%.0f Go" else "%.1f Go", b / 1e9)
        b >= 1e6 -> String.format(FR, "%.0f Mo", b / 1e6)
        b >= 1e3 -> String.format(FR, "%.0f Ko", b / 1e3)
        else -> "${b.toLong()} o"
    }
}

fun plural(n: Int, one: String, many: String) = "${String.format(FR, "%,d", n).replace(' ', ' ')} ${if (n > 1) many else one}"

fun daysAgo(time: Long): String {
    if (time <= 0) return "Jamais ouverte ces deux dernières années"
    val days = ((System.currentTimeMillis() - time) / 86_400_000).toInt()
    return when {
        days < 1 -> "Ouverte aujourd'hui"
        days < 2 -> "Ouverte hier"
        days < 60 -> "Ouverte il y a $days jours"
        else -> "Pas ouverte depuis ${days / 30} mois"
    }
}
