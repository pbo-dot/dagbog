package dk.dagbog.billeder

import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sqrt

/** Det største antal billeder pr. dag (ferie- og rejsedage). */
const val MAX_PER_DAY = 15

/**
 * Så mange billeder pr. dag kommer med i Dagbog: som før 5 på almindelige dage, flere på dage med
 * mange billeder (fx ferie): 1,5 × √antal, mindst 5 og højst MAX_PER_DAY (10 → 5, 30 → 8, 60 → 12, 100 → 15).
 */
fun picksFor(n: Int): Int = if (n <= 5) n else (1.5 * sqrt(n.toDouble())).roundToInt().coerceIn(5, MAX_PER_DAY)

/**
 * Vælger billederne spredt over dagen: dagen deles i lige store stykker, og i hvert tages billedet
 * nærmest midten, dog ikke under 2 min fra et allerede valgt (så det ikke bliver 15 af samme solnedgang).
 */
fun <T> spreadOverDay(list: List<T>, time: (T) -> Long): List<T> {
    val sorted = list.sortedBy(time)
    val k = picksFor(sorted.size)
    if (sorted.size <= k) return sorted
    val first = time(sorted.first())
    val span = time(sorted.last()) - first
    val chosen = ArrayList<T>()
    for (i in 0 until k) {
        val target = first + span * (2 * i + 1) / (2 * k)
        val best = sorted.filter { p -> p !in chosen && chosen.none { abs(time(it) - time(p)) < 120_000 } }
            .minByOrNull { abs(time(it) - target) } ?: continue
        chosen.add(best)
    }
    return chosen.sortedBy(time)
}
